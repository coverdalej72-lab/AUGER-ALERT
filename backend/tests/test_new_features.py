"""Regression tests for new features: my_farms, delay, pairing app_url payload."""
import os
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


# ---------------------- Settings my_farms ----------------------

class TestMyFarms:
    def test_settings_has_my_farms(self, s):
        r = s.get(f"{API}/settings")
        assert r.status_code == 200
        d = r.json()
        assert "my_farms" in d
        assert isinstance(d["my_farms"], list)

    def test_update_my_farms(self, s):
        # Ensure my_farms empty so all sheds arm
        r = s.put(f"{API}/settings", json={"my_farms": []})
        assert r.status_code == 200
        assert r.json()["my_farms"] == []

        # Set some farms
        r = s.put(f"{API}/settings", json={"my_farms": ["Double B", "Alpha"]})
        assert r.status_code == 200
        assert set(r.json()["my_farms"]) == {"Double B", "Alpha"}

        # Reset
        s.put(f"{API}/settings", json={"my_farms": []})


# ---------------------- Delay feature ----------------------

class TestDelay:
    def test_delay_shifts_from_base(self, s):
        # Reset settings to defaults
        s.put(f"{API}/settings", json={"augers_offset_min": 360, "lines_offset_min": 120,
                                        "catch_headsup_min": 30, "my_farms": [],
                                        "timezone": "Australia/Sydney"})
        # Create manual schedule
        r = s.post(f"{API}/schedule/manual", json=[
            {"shed": "1", "catch_time": "7:00"},
            {"shed": "2", "catch_time": "7:30"},
        ])
        assert r.status_code == 200

        orig = s.get(f"{API}/schedule/latest").json()
        assert orig["schedule"]["delay_min"] == 0
        s1_orig_catch = [sh for sh in orig["schedule"]["sheds"] if sh["shed"] == "1"][0]["catch_local"]
        assert "T07:00" in s1_orig_catch

        # apply +2h
        r = s.put(f"{API}/schedule/delay", json={"delay_min": 120})
        assert r.status_code == 200
        d = r.json()
        assert d["schedule"]["delay_min"] == 120
        s1 = [sh for sh in d["schedule"]["sheds"] if sh["shed"] == "1"][0]
        # 7:00 -> 9:00 catch, 3:00 auger (was 1:00)
        assert "T09:00" in s1["catch_local"]
        assert "T03:00" in s1["auger_off_local"]

        # apply +2h AGAIN -> should still be +2h (not compounded)
        r = s.put(f"{API}/schedule/delay", json={"delay_min": 120})
        assert r.status_code == 200
        d2 = r.json()
        s1b = [sh for sh in d2["schedule"]["sheds"] if sh["shed"] == "1"][0]
        assert "T09:00" in s1b["catch_local"]
        assert "T03:00" in s1b["auger_off_local"]

        # clear
        r = s.put(f"{API}/schedule/delay", json={"delay_min": 0})
        assert r.status_code == 200
        d3 = r.json()
        assert d3["schedule"]["delay_min"] == 0
        s1c = [sh for sh in d3["schedule"]["sheds"] if sh["shed"] == "1"][0]
        assert "T07:00" in s1c["catch_local"]

    def test_latest_has_delay_and_base(self, s):
        s.post(f"{API}/schedule/manual", json=[{"shed": "1", "catch_time": "7:00"}])
        r = s.get(f"{API}/schedule/latest")
        assert r.status_code == 200
        sched = r.json()["schedule"]
        assert "delay_min" in sched
        assert "farms" in sched
        assert "note" in sched
        assert "base" in sched
        assert isinstance(sched["base"], list)
        assert sched["base"][0]["catch_time"] == "07:00"


# ---------------------- Pairing app_url payload (via recipients) ----------------------

class TestPairingAppUrl:
    def test_recipient_with_app_url(self, s):
        rc = s.post(f"{API}/recipients", json={"name": "TEST_QRGuy"}, params={"app_url": "https://example.com"}).json()
        try:
            assert rc["payload"].startswith("https://example.com/pair?code=")
            assert rc["code"] in rc["payload"]
            assert rc["qr_data_url"].startswith("data:image/png;base64,")
        finally:
            s.delete(f"{API}/recipients/{rc['id']}")

    def test_recipient_without_app_url(self, s):
        rc = s.post(f"{API}/recipients", json={"name": "TEST_NoUrl"}).json()
        try:
            assert rc["payload"].startswith("farmtimer://pair?code=")
        finally:
            s.delete(f"{API}/recipients/{rc['id']}")


# ---------------------- Multi-farm arming ----------------------

class TestMultiFarmArming:
    def test_farms_present_only_selected_arm(self, s):
        # Set my_farms to one farm
        s.put(f"{API}/settings", json={"my_farms": ["FarmA"]})

        # Simulate upload via CSV with Farm column
        import io as _io
        csv = "Farm,Shed,Catch Time\nFarmA,1,7:00\nFarmB,2,7:30\n"
        files = {"file": ("multi.csv", _io.BytesIO(csv.encode()), "text/csv")}
        r = requests.post(f"{API}/upload", files=files)
        assert r.status_code == 200
        body = r.json()
        assert set(body["farms"]) == {"FarmA", "FarmB"}
        # Only alarms for FarmA should be armed
        farms_in_alarms = {a["farm"] for a in body["alarms"]}
        assert farms_in_alarms == {"FarmA"}

        # Add FarmB via settings my_farms -> should re-arm both
        s.put(f"{API}/settings", json={"my_farms": ["FarmA", "FarmB"]})
        latest = s.get(f"{API}/schedule/latest").json()
        farms_in_alarms2 = {a["farm"] for a in latest["alarms"]}
        assert farms_in_alarms2 == {"FarmA", "FarmB"}

        # Reset
        s.put(f"{API}/settings", json={"my_farms": []})
