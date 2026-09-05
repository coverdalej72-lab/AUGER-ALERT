"""Auth + multi-tenant isolation + manager/device flow + per-tenant billing.

Covers the review request:
- AUTH: /auth/register, /auth/login, /auth/me (Bearer)
- PROTECTED ROUTES require Bearer (401 without)
- MULTI-TENANT ISOLATION between two growers A and B
- MANAGER/DEVICE FLOW (unauth): pairing/claim, whoami, /schedule/latest?device_id,
  /alarms/active?device_id gated by /schedule/assign
- BILLING per tenant: /billing/plan, /payments/checkout (email from token, not body),
  /season-pass/status
- REGRESSION: /upload with token, /schedule/delay non-compounding, push endpoints
"""
import io
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


# ---------------------- helpers ----------------------

def _rand_email(prefix="TEST_grower"):
    return f"{prefix}_{uuid.uuid4().hex[:10]}@example.com"


def _register(email=None, password="secret123"):
    email = email or _rand_email()
    r = requests.post(f"{API}/auth/register", json={"email": email, "password": password})
    assert r.status_code == 200, f"register failed: {r.status_code} {r.text}"
    d = r.json()
    return {"email": email, "password": password, "token": d["access_token"]}


def _hdr(acc):
    return {"Authorization": f"Bearer {acc['token']}", "Content-Type": "application/json"}


# ---------------------- 1. Auth basics ----------------------

class TestAuth:
    def test_register_returns_token(self):
        email = _rand_email()
        r = requests.post(f"{API}/auth/register", json={"email": email, "password": "goodpass"})
        assert r.status_code == 200
        d = r.json()
        assert "access_token" in d and d["access_token"]
        assert d["email"] == email.lower()

    def test_register_duplicate_409(self):
        email = _rand_email()
        r1 = requests.post(f"{API}/auth/register", json={"email": email, "password": "goodpass"})
        assert r1.status_code == 200
        r2 = requests.post(f"{API}/auth/register", json={"email": email, "password": "goodpass"})
        assert r2.status_code == 409

    def test_register_short_password_400(self):
        r = requests.post(f"{API}/auth/register",
                          json={"email": _rand_email(), "password": "abc"})
        assert r.status_code == 400

    def test_login_success_and_wrong_password_401(self):
        acc = _register()
        r = requests.post(f"{API}/auth/login",
                          json={"email": acc["email"], "password": acc["password"]})
        assert r.status_code == 200
        assert r.json().get("access_token")

        r = requests.post(f"{API}/auth/login",
                          json={"email": acc["email"], "password": "wrongpass"})
        assert r.status_code == 401
        # must not reveal whether email exists
        detail = r.json().get("detail", "").lower()
        assert "email" not in detail or "incorrect" in detail

    def test_login_nonexistent_email_401(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": _rand_email("TEST_missing"), "password": "whatever"})
        assert r.status_code == 401
        detail = r.json().get("detail", "").lower()
        # error message should be identical to wrong-password case (no email disclosure)
        assert "not found" not in detail and "unknown" not in detail

    def test_me_bearer_valid(self):
        acc = _register()
        r = requests.get(f"{API}/auth/me", headers=_hdr(acc))
        assert r.status_code == 200
        assert r.json()["email"] == acc["email"].lower()

    def test_me_missing_token_401(self):
        r = requests.get(f"{API}/auth/me")
        assert r.status_code == 401

    def test_me_garbage_token_401(self):
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": "Bearer not-a-real-jwt"})
        assert r.status_code == 401

    def test_me_wrong_scheme_401(self):
        acc = _register()
        r = requests.get(f"{API}/auth/me",
                         headers={"Authorization": f"Basic {acc['token']}"})
        assert r.status_code == 401


# ---------------------- 2. Protected routes require Bearer ----------------------

class TestProtectedRoutes:
    """Every listed route must 401 without a valid Bearer token."""

    ENDPOINTS = [
        ("GET",    "/settings"),
        ("PUT",    "/settings"),
        ("POST",   "/upload"),
        ("POST",   "/schedule/manual"),
        ("GET",    "/schedules"),
        ("DELETE", "/schedule/some-fake-id"),
        ("PUT",    "/schedule/delay"),
        ("PUT",    "/schedule/assign"),
        ("GET",    "/recipients"),
        ("POST",   "/recipients"),
        ("DELETE", "/recipients/some-fake-id"),
        ("GET",    "/alarms"),
        ("GET",    "/alarms/log"),
        ("GET",    "/season-pass/status"),
        ("POST",   "/payments/checkout"),
    ]

    @pytest.mark.parametrize("method,path", ENDPOINTS)
    def test_requires_bearer(self, method, path):
        url = f"{API}{path}"
        if method == "GET":
            r = requests.get(url)
        elif method == "POST":
            if path == "/upload":
                r = requests.post(url, files={"file": ("x.csv", b"Shed,Catch Time\n1,7:00\n", "text/csv")})
            else:
                r = requests.post(url, json={})
        elif method == "PUT":
            r = requests.put(url, json={})
        elif method == "DELETE":
            r = requests.delete(url)
        assert r.status_code == 401, f"{method} {path} expected 401 got {r.status_code}: {r.text[:120]}"


# ---------------------- 3. Multi-tenant isolation A vs B ----------------------

@pytest.fixture(scope="module")
def growers():
    A = _register()
    B = _register()
    yield A, B
    # best-effort cleanup: recipients & schedules per owner will get GC'd; we don't
    # delete accounts via API (none exposed). Leave as-is.


class TestTenantIsolation:
    def test_a_creates_data_b_cannot_see(self, growers):
        A, B = growers
        # A: custom settings
        r = requests.put(f"{API}/settings", headers=_hdr(A),
                         json={"augers_offset_min": 240, "lines_offset_min": 90,
                               "catch_headsup_min": 15, "realert_interval_min": 5,
                               "realert_max": 2, "timezone": "Australia/Brisbane"})
        assert r.status_code == 200

        # A: create manual schedule with unique shed label
        uniq_shed = f"AONLY_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/schedule/manual", headers=_hdr(A),
                          json=[{"shed": uniq_shed, "catch_time": "7:00"}])
        assert r.status_code == 200
        a_sched = r.json()["schedule"]
        a_sched_id = a_sched["id"]

        # A: create recipient with unique name
        rec_name = f"TEST_MgrA_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/recipients", headers=_hdr(A),
                          json={"name": rec_name})
        assert r.status_code == 200
        a_rec = r.json()
        a_rec_id = a_rec["id"]

        # === B checks: sees nothing of A's ===
        # settings default (not A's 240)
        b_settings = requests.get(f"{API}/settings", headers=_hdr(B)).json()
        assert b_settings["augers_offset_min"] == 360, "B should see defaults, not A's 240"
        assert b_settings["timezone"] == "Australia/Sydney"

        # schedules empty
        b_scheds = requests.get(f"{API}/schedules", headers=_hdr(B)).json()
        assert all(uniq_shed not in [sh.get("shed") for sh in s.get("sheds", [])] for s in b_scheds)
        assert not any(s.get("id") == a_sched_id for s in b_scheds)

        # /schedule/latest -> either None or B's own (never A's id/shed)
        b_latest = requests.get(f"{API}/schedule/latest", headers=_hdr(B)).json()
        if b_latest.get("schedule"):
            assert b_latest["schedule"]["id"] != a_sched_id
            assert uniq_shed not in [sh.get("shed") for sh in b_latest["schedule"].get("sheds", [])]

        # recipients empty of A's manager
        b_recs = requests.get(f"{API}/recipients", headers=_hdr(B)).json()
        assert not any(r.get("id") == a_rec_id or r.get("name") == rec_name for r in b_recs)

        # alarms empty (no active schedule for B)
        b_alarms = requests.get(f"{API}/alarms", headers=_hdr(B)).json()
        assert b_alarms == []

        # alarm_log empty for B
        b_log = requests.get(f"{API}/alarms/log", headers=_hdr(B)).json()
        assert isinstance(b_log, list)
        assert not any(row.get("shed") == uniq_shed for row in b_log)

        # === Cross-tenant deletion attempts ===
        # B tries to delete A's schedule — returns 200 but must NOT actually delete
        rd = requests.delete(f"{API}/schedule/{a_sched_id}", headers=_hdr(B))
        assert rd.status_code in (200, 404)
        # A can still read it
        a_scheds_after = requests.get(f"{API}/schedules", headers=_hdr(A)).json()
        assert any(s.get("id") == a_sched_id for s in a_scheds_after), \
            "B was able to delete A's schedule — SECURITY BREACH"

        # B tries to delete A's recipient by id
        rd = requests.delete(f"{API}/recipients/{a_rec_id}", headers=_hdr(B))
        assert rd.status_code in (200, 404)
        a_recs_after = requests.get(f"{API}/recipients", headers=_hdr(A)).json()
        assert any(r.get("id") == a_rec_id for r in a_recs_after), \
            "B was able to delete A's recipient — SECURITY BREACH"

        # === A sees only A's data ===
        a_scheds = requests.get(f"{API}/schedules", headers=_hdr(A)).json()
        assert any(s.get("id") == a_sched_id for s in a_scheds)
        a_recs = requests.get(f"{API}/recipients", headers=_hdr(A)).json()
        assert any(r.get("id") == a_rec_id for r in a_recs)
        a_settings = requests.get(f"{API}/settings", headers=_hdr(A)).json()
        assert a_settings["augers_offset_min"] == 240

        # restore A defaults
        requests.put(f"{API}/settings", headers=_hdr(A),
                     json={"augers_offset_min": 360, "lines_offset_min": 120,
                           "catch_headsup_min": 30, "realert_interval_min": 10,
                           "realert_max": 3, "timezone": "Australia/Sydney"})
        # cleanup recipient
        requests.delete(f"{API}/recipients/{a_rec_id}", headers=_hdr(A))


# ---------------------- 4. Manager / device flow ----------------------

class TestManagerDeviceFlow:
    def test_device_flow_and_gating(self):
        A = _register()
        # A creates recipient
        rec_name = f"TEST_MgrDev_{uuid.uuid4().hex[:6]}"
        r = requests.post(f"{API}/recipients", headers=_hdr(A),
                          json={"name": rec_name})
        assert r.status_code == 200
        rec = r.json()
        code = rec["code"]
        rid = rec["id"]

        try:
            device_id = f"TEST_dev_{uuid.uuid4().hex[:8]}"

            # unpaired device: whoami -> paired=false, schedule/latest empty, no leakage
            w0 = requests.get(f"{API}/pairing/whoami", params={"device_id": device_id}).json()
            assert w0["paired"] is False
            sl0 = requests.get(f"{API}/schedule/latest", params={"device_id": device_id}).json()
            # should be None schedule (no leakage) — even if A has one
            assert sl0.get("schedule") is None, f"unpaired device leaked schedule: {sl0}"

            # claim
            r = requests.post(f"{API}/pairing/claim",
                              json={"code": code, "device_id": device_id, "device_name": "TestPhone"})
            assert r.status_code == 200, r.text
            d = r.json()
            assert d["recipient_id"] == rid
            assert d["name"] == rec_name

            # whoami paired
            w = requests.get(f"{API}/pairing/whoami", params={"device_id": device_id}).json()
            assert w["paired"] is True
            assert w["recipient_id"] == rid
            assert w["name"] == rec_name

            # A creates schedule with due alarm (catch 5:00 => in past today)
            r = requests.post(f"{API}/schedule/manual", headers=_hdr(A),
                              json=[{"shed": "1", "catch_time": "5:00"}])
            assert r.status_code == 200

            # device gets A's active schedule via /schedule/latest?device_id (no token)
            sl = requests.get(f"{API}/schedule/latest", params={"device_id": device_id}).json()
            assert sl.get("schedule") is not None, "paired device should see owner's schedule"

            _time.sleep(0.6)

            # NOT ASSIGNED yet: alarms/active?device_id -> empty
            aa = requests.get(f"{API}/alarms/active", params={"device_id": device_id}).json()
            assert aa["alarms"] == [], f"expected empty (unassigned), got {aa}"

            # assign to this recipient
            r = requests.put(f"{API}/schedule/assign", headers=_hdr(A),
                             json={"recipient_id": rid})
            assert r.status_code == 200

            # now alarms/active?device_id should have due alarms
            aa2 = requests.get(f"{API}/alarms/active", params={"device_id": device_id}).json()
            assert len(aa2["alarms"]) > 0, f"expected due alarms when assigned, got {aa2}"

            # clear assignment
            r = requests.put(f"{API}/schedule/assign", headers=_hdr(A),
                             json={"recipient_id": None})
            assert r.status_code == 200
            aa3 = requests.get(f"{API}/alarms/active", params={"device_id": device_id}).json()
            assert aa3["alarms"] == []

            # unknown device_id => empty (no leakage)
            unknown = f"unknown_dev_{uuid.uuid4().hex[:8]}"
            sl_u = requests.get(f"{API}/schedule/latest", params={"device_id": unknown}).json()
            assert sl_u.get("schedule") is None
            aa_u = requests.get(f"{API}/alarms/active", params={"device_id": unknown}).json()
            assert aa_u["alarms"] == []
        finally:
            requests.delete(f"{API}/recipients/{rid}", headers=_hdr(A))

    def test_pairing_claim_wrong_code_400(self):
        r = requests.post(f"{API}/pairing/claim",
                          json={"code": "000000", "device_id": "TEST_devX"})
        assert r.status_code == 400


# ---------------------- 5. Billing per tenant ----------------------

class TestBilling:
    def test_billing_plan(self):
        r = requests.get(f"{API}/billing/plan")
        assert r.status_code == 200
        d = r.json()
        assert d["product"] == "season_pass"
        assert d["amount"] == 29.0
        assert d["currency"] == "aud"
        assert d["term_days"] == 365

    def test_checkout_uses_token_email_not_body(self):
        A = _register()
        # try to inject a different email — server must ignore it and use token email
        r = requests.post(
            f"{API}/payments/checkout",
            headers=_hdr(A),
            json={
                "email": "attacker@evil.com",
                "product": "season_pass",
                "origin": BASE_URL,
                "amount": 0.01,        # should be dropped by pydantic
                "currency": "usd",     # should be dropped by pydantic
            },
        )
        # In test env stripe may 502; accept both but if 200 must record A's email
        if r.status_code == 502:
            pytest.skip("Stripe proxy unavailable")
        assert r.status_code == 200, r.text
        body = r.json()
        assert "checkout.stripe.com" in body["url"]
        session_id = body["session_id"]
        assert session_id.startswith("cs_test_") or session_id.startswith("cs_")

        # status uses server-stored email (from token)
        st = requests.get(f"{API}/payments/status/{session_id}")
        assert st.status_code == 200
        sd = st.json()
        assert sd["email"] == A["email"].lower(), \
            f"tampered email accepted! got {sd['email']} expected {A['email'].lower()}"
        assert sd["email"] != "attacker@evil.com"

    def test_season_pass_status_per_tenant(self):
        A = _register()
        r = requests.get(f"{API}/season-pass/status", headers=_hdr(A))
        assert r.status_code == 200
        d = r.json()
        assert d["active"] is False
        assert d["valid_until"] is None

        # seeded account should be active — if login succeeds
        seed = requests.post(f"{API}/auth/login",
                             json={"email": "demo@feedwithdrawal.app", "password": "demo123456"})
        if seed.status_code != 200:
            pytest.skip("seed demo account not available")
        tok = seed.json()["access_token"]
        r = requests.get(f"{API}/season-pass/status",
                         headers={"Authorization": f"Bearer {tok}"})
        assert r.status_code == 200
        assert r.json()["active"] is True

    def test_seeded_double_bb_login(self):
        r = requests.post(f"{API}/auth/login",
                          json={"email": "doublebb@baqerifarming.com.au",
                                "password": "DoubleB2026"})
        if r.status_code != 200:
            pytest.skip("doublebb seed account not present in this env")
        tok = r.json()["access_token"]
        st = requests.get(f"{API}/season-pass/status",
                          headers={"Authorization": f"Bearer {tok}"})
        assert st.status_code == 200
        assert st.json()["active"] is True


# ---------------------- 6. Regression w/ auth ----------------------

class TestRegressionAuth:
    def test_upload_with_token(self):
        A = _register()
        csv = "Shed,Catch Time\n1,7:00\n2,7:30\n"
        files = {"file": ("t.csv", io.BytesIO(csv.encode()), "text/csv")}
        r = requests.post(f"{API}/upload", files=files,
                          headers={"Authorization": f"Bearer {A['token']}"})
        assert r.status_code == 200
        body = r.json()
        assert body["shed_count"] == 2
        # verify persisted per-owner
        latest = requests.get(f"{API}/schedule/latest", headers=_hdr(A)).json()
        assert latest["schedule"] is not None
        assert len(latest["schedule"]["sheds"]) == 2

    def test_delay_non_compounding(self):
        A = _register()
        r = requests.post(f"{API}/schedule/manual", headers=_hdr(A),
                          json=[{"shed": "1", "catch_time": "7:00"}])
        assert r.status_code == 200
        base_auger = r.json()["schedule"]["sheds"][0]["auger_off_local"]

        # apply +120 delay
        r = requests.put(f"{API}/schedule/delay", headers=_hdr(A),
                         json={"delay_min": 120})
        assert r.status_code == 200
        after1 = requests.get(f"{API}/schedule/latest", headers=_hdr(A)) \
            .json()["schedule"]["sheds"][0]["auger_off_local"]
        assert after1 != base_auger

        # apply +120 again — should NOT compound (still 120 from base)
        r = requests.put(f"{API}/schedule/delay", headers=_hdr(A),
                         json={"delay_min": 120})
        assert r.status_code == 200
        after2 = requests.get(f"{API}/schedule/latest", headers=_hdr(A)) \
            .json()["schedule"]["sheds"][0]["auger_off_local"]
        assert after2 == after1, "delay is compounding — bug"

        # reset
        requests.put(f"{API}/schedule/delay", headers=_hdr(A), json={"delay_min": 0})
        after0 = requests.get(f"{API}/schedule/latest", headers=_hdr(A)) \
            .json()["schedule"]["sheds"][0]["auger_off_local"]
        assert after0 == base_auger

    def test_push_endpoints_unauth_still_work(self):
        # push subscribe / status / test / unsubscribe don't require token (device-level)
        vk = requests.get(f"{API}/push/vapid-public").json()
        assert vk.get("public_key")

        device_id = f"TEST_push_{uuid.uuid4().hex[:8]}"
        sub = {
            "endpoint": f"https://fcm.googleapis.com/fcm/send/fake-{uuid.uuid4().hex}",
            "keys": {"auth": "AAAA", "p256dh": "BBBB"},
        }
        r = requests.post(f"{API}/push/subscribe",
                          json={"device_id": device_id, "subscription": sub})
        assert r.status_code == 200

        s = requests.get(f"{API}/push/status", params={"device_id": device_id}).json()
        assert s["subscribed"] is True

        # test on unreachable endpoint should be graceful (200 or 500 handled)
        r = requests.post(f"{API}/push/test", json={"device_id": device_id})
        assert r.status_code in (200, 500)

        # unsubscribe = soft disable
        r = requests.delete(f"{API}/push/subscribe/{device_id}")
        assert r.status_code == 200
        s = requests.get(f"{API}/push/status", params={"device_id": device_id}).json()
        assert s["subscribed"] is False
