"""Tests for the new Web Push endpoints and scheduler gating.

Covers:
  - GET  /api/push/vapid-public
  - POST /api/push/subscribe (upsert)
  - GET  /api/push/status
  - POST /api/push/test  (must be graceful vs unreachable endpoint, 400 w/o sub)
  - DEL  /api/push/subscribe/{device_id}
  - Scheduler gating via GET /api/alarms/active?device_id=...
    (paired-not-assigned device -> 0 alarms; assigned device -> alarms; unpaired
     device -> alarms as fail-safe)
  - Backend stability while scheduler runs every 15s (no crash / still 200)
"""
import os
import time as _time
import uuid

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


# Fake but well-formed subscription pointing at an unreachable endpoint. The
# server must catch WebPushException / network errors and NOT return 500.
def _fake_sub(host: str = "https://nonexistent-push.invalid/xyz") -> dict:
    return {
        "endpoint": host + "/" + uuid.uuid4().hex,
        "keys": {
            # These are valid base64url shaped placeholders (86/22 chars) so
            # pywebpush parses them without complaint before the network call.
            "p256dh": "BNbRSv4wR1S6b7uEUW5mM1_Tf4EfGZ7ZjfB2h1eF4v0sD7fV1kk5r3LrDQhJb2mAP4h6qWv0LqQm8m1s7c0dEqk",
            "auth": "k9T3sJz3H2wM1n9pQwE3vQ",
        },
    }


# ---------------------- VAPID public key ----------------------

class TestVapidPublic:
    def test_vapid_public_returns_key(self, s):
        r = s.get(f"{API}/push/vapid-public")
        assert r.status_code == 200
        d = r.json()
        assert "public_key" in d
        assert isinstance(d["public_key"], str)
        assert len(d["public_key"]) > 40  # sanity: real key is ~87 chars


# ---------------------- Subscribe / status / unsubscribe ----------------------

class TestPushSubscribeLifecycle:
    def test_status_empty_without_id(self, s):
        r = s.get(f"{API}/push/status")
        assert r.status_code == 200
        assert r.json() == {"subscribed": False}

    def test_status_false_before_subscribe(self, s):
        dev = f"TEST_dev_{uuid.uuid4().hex[:8]}"
        r = s.get(f"{API}/push/status", params={"device_id": dev})
        assert r.status_code == 200
        assert r.json() == {"subscribed": False}

    def test_subscribe_then_status_then_unsubscribe(self, s):
        dev = f"TEST_dev_{uuid.uuid4().hex[:8]}"
        sub = _fake_sub()
        try:
            r = s.post(f"{API}/push/subscribe", json={"device_id": dev, "subscription": sub})
            assert r.status_code == 200
            assert r.json() == {"ok": True}

            r = s.get(f"{API}/push/status", params={"device_id": dev})
            assert r.status_code == 200
            assert r.json() == {"subscribed": True}

            # upsert on same endpoint should not create duplicates
            r = s.post(f"{API}/push/subscribe", json={"device_id": dev, "subscription": sub})
            assert r.status_code == 200

            # still subscribed=True (count > 0)
            r = s.get(f"{API}/push/status", params={"device_id": dev})
            assert r.json() == {"subscribed": True}
        finally:
            r = s.delete(f"{API}/push/subscribe/{dev}")
            assert r.status_code == 200
            assert r.json() == {"ok": True}
            # status now False
            r = s.get(f"{API}/push/status", params={"device_id": dev})
            assert r.json() == {"subscribed": False}

    def test_subscribe_missing_endpoint_400(self, s):
        r = s.post(f"{API}/push/subscribe", json={"device_id": "TEST_dev_bad", "subscription": {"keys": {}}})
        assert r.status_code == 400


# ---------------------- Push test endpoint ----------------------

class TestPushTest:
    def test_push_test_400_when_no_subscription(self, s):
        dev = f"TEST_dev_none_{uuid.uuid4().hex[:6]}"
        r = s.post(f"{API}/push/test", json={"device_id": dev})
        assert r.status_code == 400

    def test_push_test_graceful_when_endpoint_unreachable(self, s):
        """Even though the fake endpoint is unreachable and pywebpush will
        raise, the API must catch it and still return 200 ok:true."""
        dev = f"TEST_dev_{uuid.uuid4().hex[:8]}"
        try:
            s.post(f"{API}/push/subscribe", json={"device_id": dev, "subscription": _fake_sub()})
            r = s.post(f"{API}/push/test", json={"device_id": dev})
            assert r.status_code == 200, r.text
            assert r.json() == {"ok": True}
        finally:
            s.delete(f"{API}/push/subscribe/{dev}")


# ---------------------- Scheduler gating for alarms/active ----------------------

class TestSchedulerGating:
    """Verify /api/alarms/active only surfaces alarms for the paired manager
    that is currently assigned. Paired-but-not-assigned devices must see 0.
    Unpaired device_ids fall through as fail-safe and see due alarms."""

    def test_gating_by_assignment(self, s):
        # Reset settings + seed a due schedule (5:00 today -> auger yesterday 23:00)
        s.put(f"{API}/settings", json={
            "augers_offset_min": 360, "lines_offset_min": 120,
            "catch_headsup_min": 30, "realert_interval_min": 10,
            "realert_max": 3, "timezone": "Australia/Sydney", "my_farms": [],
        })
        r = s.post(f"{API}/schedule/manual", json=[{"shed": "9", "catch_time": "5:00"}])
        assert r.status_code == 200

        # create two managers
        a = s.post(f"{API}/recipients", json={"name": "TEST_PushA"}).json()
        b = s.post(f"{API}/recipients", json={"name": "TEST_PushB"}).json()
        dev_a = f"TEST_dev_A_{uuid.uuid4().hex[:6]}"
        dev_b = f"TEST_dev_B_{uuid.uuid4().hex[:6]}"

        try:
            # pair both phones
            assert s.post(f"{API}/pairing/claim", json={"code": a["code"], "device_id": dev_a, "device_name": "PhA"}).status_code == 200
            assert s.post(f"{API}/pairing/claim", json={"code": b["code"], "device_id": dev_b, "device_name": "PhB"}).status_code == 200

            # assign schedule to A
            r = s.put(f"{API}/schedule/assign", json={"recipient_id": a["id"]})
            assert r.status_code == 200

            _time.sleep(0.3)

            # dev_a (assigned) -> should see due alarms
            body_a = s.get(f"{API}/alarms/active", params={"device_id": dev_a}).json()
            assert len(body_a["alarms"]) > 0, body_a

            # dev_b (paired, NOT assigned) -> 0 alarms
            body_b = s.get(f"{API}/alarms/active", params={"device_id": dev_b}).json()
            assert body_b["alarms"] == [], body_b

            # unpaired arbitrary device_id -> fail-safe, alarms visible
            body_u = s.get(f"{API}/alarms/active", params={"device_id": f"TEST_unpaired_{uuid.uuid4().hex[:6]}"}).json()
            assert len(body_u["alarms"]) > 0

            # no device_id -> fail-safe, alarms visible
            body_n = s.get(f"{API}/alarms/active").json()
            assert len(body_n["alarms"]) > 0

            # switch assignment to B
            r = s.put(f"{API}/schedule/assign", json={"recipient_id": b["id"]})
            assert r.status_code == 200
            _time.sleep(0.3)

            body_a2 = s.get(f"{API}/alarms/active", params={"device_id": dev_a}).json()
            assert body_a2["alarms"] == []
            body_b2 = s.get(f"{API}/alarms/active", params={"device_id": dev_b}).json()
            assert len(body_b2["alarms"]) > 0

            # clear assignment -> everyone falls through fail-safe? Paired
            # manager with no assignment still gets 0 alarms.
            s.put(f"{API}/schedule/assign", json={"recipient_id": None})
            _time.sleep(0.2)
            body_a3 = s.get(f"{API}/alarms/active", params={"device_id": dev_a}).json()
            assert body_a3["alarms"] == []
        finally:
            s.delete(f"{API}/recipients/{a['id']}")
            s.delete(f"{API}/recipients/{b['id']}")


# ---------------------- Scheduler stability (runs every 15s) ----------------------

class TestSchedulerStability:
    def test_backend_still_up_after_scheduler_ticks(self, s):
        # Poll /api/settings a few times spanning at least one scheduler tick
        for _ in range(3):
            r = s.get(f"{API}/settings")
            assert r.status_code == 200
            _time.sleep(1)
        # After a longer wait, still up
        _time.sleep(6)
        r = s.get(f"{API}/schedule/latest")
        assert r.status_code == 200


# ---------------------- Regression: existing endpoints still work ----------------------

class TestRegression:
    def test_manual_schedule_delay_assign_ack_log(self, s):
        # seed
        r = s.post(f"{API}/schedule/manual",
                   json=[{"shed": "1", "catch_time": "7:00"}, {"shed": "2", "catch_time": "5:00"}])
        assert r.status_code == 200

        # delay +30 shifts, then back to 0
        r = s.put(f"{API}/schedule/delay", json={"delay_min": 30})
        assert r.status_code == 200
        assert r.json()["schedule"]["delay_min"] == 30
        r = s.put(f"{API}/schedule/delay", json={"delay_min": 0})
        assert r.status_code == 200

        # assign to a recipient then clear
        r = s.post(f"{API}/recipients", json={"name": "TEST_RegressGuy"}).json()
        try:
            a = s.put(f"{API}/schedule/assign", json={"recipient_id": r["id"]})
            assert a.status_code == 200
            assert a.json()["schedule"]["assigned_to"] == r["id"]
            a = s.put(f"{API}/schedule/assign", json={"recipient_id": None})
            assert a.status_code == 200
            assert a.json()["schedule"]["assigned_to"] is None
        finally:
            s.delete(f"{API}/recipients/{r['id']}")

        # ack + log
        act = s.get(f"{API}/alarms/active").json()
        assert len(act["alarms"]) > 0
        aid = act["alarms"][0]["id"]
        assert s.post(f"{API}/alarms/{aid}/ack").status_code == 200
        log = s.get(f"{API}/alarms/log").json()
        assert log and log[0]["event"] == "acknowledged"
        assert log[0]["alarm_id"] == aid

    def test_upload_csv_regression(self, s):
        import io as _io
        csv = "Shed,Catch Time\n1,7:00\n2,7:30\n"
        r = requests.post(f"{API}/upload", files={"file": ("regress.csv", _io.BytesIO(csv.encode()), "text/csv")})
        assert r.status_code == 200
        assert r.json()["shed_count"] == 2
