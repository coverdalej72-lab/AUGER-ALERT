"""Backend API tests for Farm Feed Withdrawal Timer."""
import os
import io
import time as _time
from datetime import date, timedelta

import pytest
import requests

BASE_URL = os.environ.get("EXPO_PUBLIC_BACKEND_URL") or os.environ.get("EXPO_BACKEND_URL")
if not BASE_URL:
    # fallback to reading frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
API = f"{BASE_URL.rstrip('/')}/api"


@pytest.fixture(scope="session")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


# ---------------------- Settings ----------------------

class TestSettings:
    def test_defaults(self, s):
        # Reset to defaults first
        r = s.put(f"{API}/settings", json={
            "augers_offset_min": 360, "lines_offset_min": 120,
            "catch_headsup_min": 30, "realert_interval_min": 10,
            "realert_max": 3, "timezone": "Australia/Sydney",
        })
        assert r.status_code == 200
        r = s.get(f"{API}/settings")
        assert r.status_code == 200
        d = r.json()
        assert d["augers_offset_min"] == 360
        assert d["lines_offset_min"] == 120
        assert d["catch_headsup_min"] == 30
        assert d["realert_interval_min"] == 10
        assert d["realert_max"] == 3
        assert d["timezone"] == "Australia/Sydney"

    def test_update_recomputes_schedule(self, s):
        # Create a manual schedule so we have alarms
        r = s.post(f"{API}/schedule/manual", json=[{"shed": "1", "catch_time": "7:00"}])
        assert r.status_code == 200
        # capture original auger fire time
        orig = r.json()["schedule"]["sheds"][0]["auger_off_local"]

        # Change auger offset to 60 min
        r = s.put(f"{API}/settings", json={"augers_offset_min": 60})
        assert r.status_code == 200
        assert r.json()["augers_offset_min"] == 60

        latest = s.get(f"{API}/schedule/latest").json()
        new_aug = latest["schedule"]["sheds"][0]["auger_off_local"]
        assert new_aug != orig  # recomputed
        # 7:00 - 60min => 6:00
        assert new_aug.endswith("06:00:00") or "T06:00" in new_aug

        # restore
        s.put(f"{API}/settings", json={"augers_offset_min": 360})


# ---------------------- Manual schedule (anchor timing) ----------------------

class TestManualSchedule:
    def test_anchor_timings(self, s):
        # ensure defaults
        s.put(f"{API}/settings", json={"augers_offset_min": 360, "lines_offset_min": 120,
                                        "catch_headsup_min": 30, "timezone": "Australia/Sydney"})
        payload = [
            {"shed": "1", "catch_time": "7:00"},
            {"shed": "2", "catch_time": "7:30"},
            {"shed": "3", "catch_time": "5:00"},
        ]
        r = s.post(f"{API}/schedule/manual", json=payload)
        assert r.status_code == 200
        body = r.json()
        sheds = {sh["shed"]: sh for sh in body["schedule"]["sheds"]}

        # shed 1: auger 01:00, lines 05:00 same day
        s1 = sheds["1"]
        assert "T01:00" in s1["auger_off_local"]
        assert "T05:00" in s1["lines_up_local"]
        assert s1["catch_date"] in s1["auger_off_local"]

        # shed 2: auger 01:30, lines 05:30
        s2 = sheds["2"]
        assert "T01:30" in s2["auger_off_local"]
        assert "T05:30" in s2["lines_up_local"]

        # shed 3: catch 05:00 => auger 23:00 previous day
        s3 = sheds["3"]
        catch_d = date.fromisoformat(s3["catch_date"])
        prev = (catch_d - timedelta(days=1)).isoformat()
        assert s3["auger_off_local"].startswith(prev)
        assert "T23:00" in s3["auger_off_local"]

    def test_empty_body_400(self, s):
        r = s.post(f"{API}/schedule/manual", json=[])
        assert r.status_code == 400


# ---------------------- Upload ----------------------

class TestUpload:
    def test_upload_csv_valid(self, s):
        csv = "Shed,Catch Time\n1,7:00\n2,7:30\n"
        files = {"file": ("test.csv", io.BytesIO(csv.encode()), "text/csv")}
        r = requests.post(f"{API}/upload", files=files)
        assert r.status_code == 200
        body = r.json()
        assert body["shed_count"] == 2
        assert len(body["schedule"]["sheds"]) == 2

    def test_upload_bad_no_time_column(self, s):
        csv = "Shed,Notes\n1,hello\n"
        files = {"file": ("bad.csv", io.BytesIO(csv.encode()), "text/csv")}
        r = requests.post(f"{API}/upload", files=files)
        assert r.status_code == 400
        assert "time" in r.json()["detail"].lower()


# ---------------------- Schedule latest ----------------------

class TestScheduleLatest:
    def test_latest_and_sorted_alarms(self, s):
        s.post(f"{API}/schedule/manual", json=[
            {"shed": "1", "catch_time": "7:00"}, {"shed": "2", "catch_time": "7:30"}])
        r = s.get(f"{API}/schedule/latest")
        assert r.status_code == 200
        body = r.json()
        assert body["schedule"] is not None
        alarms = body["alarms"]
        assert len(alarms) > 0
        fires = [a["fire_at_utc"] for a in alarms]
        assert fires == sorted(fires)


# ---------------------- Pairing ----------------------

class TestPairing:
    def test_pairing_get_and_claim(self, s):
        # regenerate to a known state
        r = s.post(f"{API}/pairing/regenerate")
        assert r.status_code == 200
        p = r.json()
        assert p["paired"] is False
        assert len(p["code"]) == 6
        assert p["qr_data_url"].startswith("data:image/png;base64,")

        # wrong code
        r = s.post(f"{API}/pairing/claim", json={"code": "000000" if p["code"] != "000000" else "111111",
                                                  "device_id": "dev-x"})
        assert r.status_code == 400

        # correct code
        r = s.post(f"{API}/pairing/claim", json={"code": p["code"], "device_id": "dev-1", "device_name": "TestPhone"})
        assert r.status_code == 200

        r = s.get(f"{API}/pairing")
        d = r.json()
        assert d["paired"] is True
        assert d["device_name"] == "TestPhone"

    def test_regenerate_unpairs(self, s):
        # pair first
        r = s.post(f"{API}/pairing/regenerate").json()
        s.post(f"{API}/pairing/claim", json={"code": r["code"], "device_id": "d", "device_name": "P"})
        # regenerate
        r2 = s.post(f"{API}/pairing/regenerate").json()
        assert r2["paired"] is False
        assert r2["code"] != r["code"]


# ---------------------- Alarms flow ----------------------

class TestAlarms:
    def test_active_ack_escalate_log(self, s):
        # create a schedule with a past-time catch (5:00 today) so alarms are due
        r = s.post(f"{API}/schedule/manual", json=[{"shed": "9", "catch_time": "5:00"}])
        assert r.status_code == 200

        # give backend a beat
        _time.sleep(0.5)

        r = s.get(f"{API}/alarms/active")
        assert r.status_code == 200
        body = r.json()
        assert "realert_interval_min" in body
        assert "realert_max" in body
        assert len(body["alarms"]) > 0
        alarm = body["alarms"][0]

        # ack
        r = s.post(f"{API}/alarms/{alarm['id']}/ack")
        assert r.status_code == 200

        # log has acknowledged entry newest first
        log = s.get(f"{API}/alarms/log").json()
        assert log[0]["event"] == "acknowledged"
        assert log[0]["alarm_id"] == alarm["id"]

        # get next active alarm to escalate
        act2 = s.get(f"{API}/alarms/active").json()["alarms"]
        if act2:
            r = s.post(f"{API}/alarms/{act2[0]['id']}/escalate")
            assert r.status_code == 200
            assert r.json()["alert_count"] == 1

    def test_ack_not_found(self, s):
        r = s.post(f"{API}/alarms/does-not-exist/ack")
        assert r.status_code == 404
