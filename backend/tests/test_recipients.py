"""Tests for the new multi-manager (recipients) + pairing/assign + alarms gating features."""
import os
import time as _time
import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
API = f"{BASE_URL.rstrip('/')}/api"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


@pytest.fixture(scope="module")
def two_managers(s):
    """Create two managers (TEST_A, TEST_B), yield them, clean up after."""
    a = s.post(f"{API}/recipients", json={"name": "TEST_A"}).json()
    b = s.post(f"{API}/recipients", json={"name": "TEST_B"}).json()
    yield a, b
    s.delete(f"{API}/recipients/{a['id']}")
    s.delete(f"{API}/recipients/{b['id']}")


# ---------------------- CRUD ----------------------

class TestRecipientsCRUD:
    def test_create_and_list(self, s):
        rc = s.post(f"{API}/recipients", json={"name": "TEST_Create"}).json()
        try:
            assert rc["id"]
            assert rc["name"] == "TEST_Create"
            assert len(rc["code"]) == 6
            assert rc["paired"] is False
            assert rc["qr_data_url"].startswith("data:image/png;base64,")
            assert rc["payload"].startswith("farmtimer://pair?code=")

            lst = s.get(f"{API}/recipients").json()
            names = {r["name"] for r in lst}
            assert "TEST_Create" in names
        finally:
            s.delete(f"{API}/recipients/{rc['id']}")

    def test_delete_soft_removes(self, s):
        rc = s.post(f"{API}/recipients", json={"name": "TEST_Del"}).json()
        r = s.delete(f"{API}/recipients/{rc['id']}")
        assert r.status_code == 200
        lst = s.get(f"{API}/recipients").json()
        assert rc["id"] not in {r["id"] for r in lst}

    def test_regenerate_changes_code_and_unpairs(self, s):
        rc = s.post(f"{API}/recipients", json={"name": "TEST_Regen"}).json()
        try:
            # Pair it
            s.post(f"{API}/pairing/claim", json={"code": rc["code"], "device_id": "TEST_dev_regen", "device_name": "P"})
            w = s.get(f"{API}/pairing/whoami", params={"device_id": "TEST_dev_regen"}).json()
            assert w["paired"] is True
            # Regenerate
            r = s.post(f"{API}/recipients/{rc['id']}/regenerate").json()
            assert r["code"] != rc["code"]
            assert r["paired"] is False
            # Device is now unpaired
            w2 = s.get(f"{API}/pairing/whoami", params={"device_id": "TEST_dev_regen"}).json()
            assert w2["paired"] is False
        finally:
            s.delete(f"{API}/recipients/{rc['id']}")


# ---------------------- Pairing: device single-manager rule ----------------------

class TestDeviceSingleManager:
    def test_device_moves_between_managers(self, s, two_managers):
        a, b = two_managers
        dev = "TEST_dev_move"
        s.post(f"{API}/pairing/claim", json={"code": a["code"], "device_id": dev, "device_name": "P"})
        w = s.get(f"{API}/pairing/whoami", params={"device_id": dev}).json()
        assert w["name"] == "TEST_A"

        s.post(f"{API}/pairing/claim", json={"code": b["code"], "device_id": dev, "device_name": "P"})
        w2 = s.get(f"{API}/pairing/whoami", params={"device_id": dev}).json()
        assert w2["name"] == "TEST_B"

        # A should no longer have the device (paired False)
        lst = {r["id"]: r for r in s.get(f"{API}/recipients").json()}
        assert lst[a["id"]]["paired"] is False
        assert lst[b["id"]]["paired"] is True


# ---------------------- Assign + whoami.assigned ----------------------

class TestAssign:
    def test_assign_and_clear(self, s, two_managers):
        a, b = two_managers
        # Ensure an active schedule
        s.post(f"{API}/schedule/manual", json=[{"shed": "1", "catch_time": "7:00"}])

        # Assign to A
        r = s.put(f"{API}/schedule/assign", json={"recipient_id": a["id"]})
        assert r.status_code == 200
        latest = s.get(f"{API}/schedule/latest").json()
        assert latest["schedule"]["assigned_to"] == a["id"]
        assert latest["schedule"]["assigned_name"] == "TEST_A"

        # Pair A device and check whoami.assigned
        s.post(f"{API}/pairing/claim", json={"code": a["code"], "device_id": "TEST_devA", "device_name": "PA"})
        s.post(f"{API}/pairing/claim", json={"code": b["code"], "device_id": "TEST_devB", "device_name": "PB"})
        wa = s.get(f"{API}/pairing/whoami", params={"device_id": "TEST_devA"}).json()
        wb = s.get(f"{API}/pairing/whoami", params={"device_id": "TEST_devB"}).json()
        assert wa["assigned"] is True and wa["assigned_name"] == "TEST_A"
        assert wb["assigned"] is False

        # Clear assignment
        r = s.put(f"{API}/schedule/assign", json={"recipient_id": None})
        assert r.status_code == 200
        latest = s.get(f"{API}/schedule/latest").json()
        assert latest["schedule"]["assigned_to"] is None
        assert latest["schedule"]["assigned_name"] is None

    def test_assign_bad_recipient_404(self, s):
        s.post(f"{API}/schedule/manual", json=[{"shed": "1", "catch_time": "7:00"}])
        r = s.put(f"{API}/schedule/assign", json={"recipient_id": "does-not-exist"})
        assert r.status_code == 404


# ---------------------- Alarms gating by device -> manager -> assignment ----------------------

class TestAlarmsGating:
    def test_gating_only_assigned_manager_gets_alarms(self, s, two_managers):
        a, b = two_managers
        # Fresh schedule with due alarms (past-time catch)
        s.post(f"{API}/schedule/manual", json=[{"shed": "9", "catch_time": "5:00"}])
        _time.sleep(0.5)

        # Pair both devices
        s.post(f"{API}/pairing/claim", json={"code": a["code"], "device_id": "TEST_devA2", "device_name": "PA"})
        s.post(f"{API}/pairing/claim", json={"code": b["code"], "device_id": "TEST_devB2", "device_name": "PB"})

        # Assign to A
        s.put(f"{API}/schedule/assign", json={"recipient_id": a["id"]})

        aA = s.get(f"{API}/alarms/active", params={"device_id": "TEST_devA2"}).json()
        aB = s.get(f"{API}/alarms/active", params={"device_id": "TEST_devB2"}).json()
        # A (assigned) gets alarms; B (paired but not assigned) gets zero
        assert len(aA["alarms"]) > 0
        assert len(aB["alarms"]) == 0

        # Unpaired desktop still sees alarms (fail-safe)
        aDesk = s.get(f"{API}/alarms/active", params={"device_id": "TEST_desktop_unpaired"}).json()
        assert len(aDesk["alarms"]) > 0

        # No device_id also sees alarms (fail-safe)
        aNone = s.get(f"{API}/alarms/active").json()
        assert len(aNone["alarms"]) > 0

        # Clear assignment: even A gets none (fail-safe applies only to UNPAIRED devices)
        s.put(f"{API}/schedule/assign", json={"recipient_id": None})
        aA2 = s.get(f"{API}/alarms/active", params={"device_id": "TEST_devA2"}).json()
        assert len(aA2["alarms"]) == 0
