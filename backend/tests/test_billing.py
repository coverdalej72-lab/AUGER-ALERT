"""Billing tests: Stripe Season Pass paywall (one-time AUD $29, unlocks 365d).

Verifies:
- /api/billing/plan catalog values (server-fixed).
- /api/payments/checkout returns a real Stripe Checkout URL + session_id and
  writes an unpaid, unfulfilled payment_transactions row.
- Tamper-resistance: client-supplied amount/currency fields are IGNORED
  (server always uses PRICE_MAP values).
- Validation: bad email / unknown product -> 400.
- /api/payments/status/{id} for an unpaid session stays unpaid + fulfilled=false
  (no season_passes doc gets created for that session).
- /api/season-pass/status: demo email active=true, unknown false, missing false.
"""
import os
import time as _time

import pytest
import requests
from motor.motor_asyncio import AsyncIOMotorClient
import asyncio

BASE_URL = (
    os.environ.get("EXPO_PUBLIC_BACKEND_URL")
    or os.environ.get("EXPO_BACKEND_URL")
)
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("EXPO_PUBLIC_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip()
                break
API = f"{BASE_URL.rstrip('/')}/api"
ORIGIN = BASE_URL.rstrip("/")

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "test_database"


@pytest.fixture(scope="module")
def s():
    sess = requests.Session()
    sess.headers.update({"Content-Type": "application/json"})
    return sess


def _mongo():
    return AsyncIOMotorClient(MONGO_URL)[DB_NAME]


# ---------------------- /api/billing/plan ----------------------

class TestBillingPlan:
    def test_plan_catalog(self, s):
        r = s.get(f"{API}/billing/plan")
        assert r.status_code == 200
        d = r.json()
        assert d["product"] == "season_pass"
        assert d["amount"] == 29.0
        assert d["currency"] == "aud"
        assert d["term_days"] == 365
        assert isinstance(d.get("name"), str) and d["name"]


# ---------------------- /api/payments/checkout ----------------------

class TestCheckoutCreate:
    def test_checkout_returns_stripe_url_and_writes_unpaid_tx(self, s):
        payload = {
            "email": "TEST_billing_a@example.com",
            "product": "season_pass",
            "origin": ORIGIN,
        }
        r = s.post(f"{API}/payments/checkout", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "url" in d and "session_id" in d
        assert d["session_id"].startswith("cs_")
        # Real Stripe hosted-checkout URL
        assert "checkout.stripe.com" in d["url"] or "cs_test" in d["url"]

        # Verify a payment_transactions doc was inserted, unpaid + unfulfilled,
        # amount fixed at 29.0 aud regardless of client input.
        async def _check():
            db = _mongo()
            try:
                tx = await db.payment_transactions.find_one({"session_id": d["session_id"]})
                assert tx is not None
                # server normalises to lower-case
                assert tx["email"] == "test_billing_a@example.com"
                assert tx["product"] == "season_pass"
                assert tx["amount"] == 29.0
                assert tx["currency"] == "aud"
                assert tx["payment_status"] == "unpaid"
                assert tx["fulfilled"] is False
            finally:
                await db.payment_transactions.delete_many({"email": "TEST_billing_a@example.com"})
        asyncio.get_event_loop().run_until_complete(_check())

    def test_tamper_resistance_client_amount_ignored(self, s):
        # Try to override amount/currency — server must ignore extra fields
        # (Pydantic model has no such fields → they're silently dropped) and
        # ALWAYS charge $29 AUD.
        payload = {
            "email": "TEST_billing_tamper@example.com",
            "product": "season_pass",
            "origin": ORIGIN,
            "amount": 0.01,
            "currency": "usd",
        }
        r = s.post(f"{API}/payments/checkout", json=payload)
        assert r.status_code == 200, r.text
        session_id = r.json()["session_id"]

        async def _check():
            db = _mongo()
            try:
                tx = await db.payment_transactions.find_one({"session_id": session_id})
                assert tx is not None
                # Server-fixed values only
                assert tx["amount"] == 29.0
                assert tx["currency"] == "aud"
                assert tx["payment_status"] == "unpaid"
                assert tx["fulfilled"] is False
            finally:
                await db.payment_transactions.delete_many(
                    {"email": "TEST_billing_tamper@example.com"}
                )
        asyncio.get_event_loop().run_until_complete(_check())

    def test_checkout_bad_email_400(self, s):
        r = s.post(f"{API}/payments/checkout", json={
            "email": "not-an-email", "product": "season_pass", "origin": ORIGIN,
        })
        assert r.status_code == 400

    def test_checkout_unknown_product_400(self, s):
        r = s.post(f"{API}/payments/checkout", json={
            "email": "TEST_x@example.com", "product": "lifetime", "origin": ORIGIN,
        })
        assert r.status_code == 400


# ---------------------- /api/payments/status/{id} ----------------------

class TestCheckoutStatus:
    def test_unknown_session_404(self, s):
        r = s.get(f"{API}/payments/status/cs_test_this_does_not_exist_zzz")
        assert r.status_code == 404

    def test_unpaid_session_stays_unpaid_and_no_pass_granted(self, s):
        # 1) Create a fresh checkout session
        r = s.post(f"{API}/payments/checkout", json={
            "email": "TEST_billing_unpaid@example.com",
            "product": "season_pass",
            "origin": ORIGIN,
        })
        assert r.status_code == 200, r.text
        session_id = r.json()["session_id"]

        try:
            # 2) Immediately poll status — nothing paid yet
            r2 = s.get(f"{API}/payments/status/{session_id}")
            assert r2.status_code == 200, r2.text
            d = r2.json()
            assert d["payment_status"] in ("unpaid", "no_payment_required"), d
            # UI-level 'fulfilled' only true when payment_status=='paid'
            assert d["fulfilled"] is False
            # Status field is a Stripe checkout state — usually 'open'
            assert d.get("status") in ("open", "complete", "expired", None)

            # 3) Idempotent-fulfilment guard: because payment_status != paid,
            #    NO season_passes doc must exist for this email.
            async def _check():
                db = _mongo()
                pass_doc = await db.season_passes.find_one(
                    {"email": "TEST_billing_unpaid@example.com"}
                )
                assert pass_doc is None, "season pass granted without payment!"
                # And the tx row itself is still fulfilled=False
                tx = await db.payment_transactions.find_one({"session_id": session_id})
                assert tx is not None
                assert tx["fulfilled"] is False
                assert tx["payment_status"] != "paid"
            asyncio.get_event_loop().run_until_complete(_check())
        finally:
            async def _cleanup():
                db = _mongo()
                await db.payment_transactions.delete_many(
                    {"email": "TEST_billing_unpaid@example.com"}
                )
                await db.season_passes.delete_many(
                    {"email": "TEST_billing_unpaid@example.com"}
                )
            asyncio.get_event_loop().run_until_complete(_cleanup())


# ---------------------- /api/season-pass/status ----------------------

class TestSeasonPassStatus:
    def test_demo_email_active(self, s):
        r = s.get(f"{API}/season-pass/status", params={"email": "demo@feedwithdrawal.app"})
        assert r.status_code == 200
        d = r.json()
        assert d["active"] is True
        assert d["valid_until"] is not None

    def test_unknown_email_inactive(self, s):
        r = s.get(
            f"{API}/season-pass/status",
            params={"email": "TEST_never_paid@example.com"},
        )
        assert r.status_code == 200
        d = r.json()
        assert d["active"] is False
        assert d["valid_until"] is None

    def test_no_email_inactive(self, s):
        r = s.get(f"{API}/season-pass/status")
        assert r.status_code == 200
        d = r.json()
        assert d["active"] is False
        assert d["valid_until"] is None

    def test_email_case_normalisation(self, s):
        r = s.get(
            f"{API}/season-pass/status",
            params={"email": "Demo@FEEDwithdrawal.APP"},
        )
        assert r.status_code == 200
        assert r.json()["active"] is True
