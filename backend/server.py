from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Body, Request, Header, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import base64
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel, EmailStr
from typing import List, Optional
import uuid
from datetime import datetime, date, time, timedelta, timezone

import json
import asyncio

import jwt
from passlib.context import CryptContext
import pandas as pd
import qrcode
from pywebpush import webpush, WebPushException
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from emergentintegrations.payments.stripe.checkout import StripeCheckout, CheckoutSessionRequest

from timing import compute_shed_timing, parse_time_value, parse_date_value, get_tz


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:alerts@feedwithdrawal.app")

STRIPE_API_KEY = os.environ.get("STRIPE_API_KEY", "")

JWT_SECRET = os.environ.get("JWT_SECRET", "dev-insecure-change-me")
JWT_ALGORITHM = os.environ.get("JWT_ALGORITHM", "HS256")
ACCESS_TOKEN_DAYS = int(os.environ.get("ACCESS_TOKEN_DAYS", "30"))

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")


def hash_password(p: str) -> str:
    return pwd_ctx.hash(p[:72])


def verify_password(p: str, hashed: str) -> bool:
    try:
        return pwd_ctx.verify(p[:72], hashed)
    except Exception:
        return False


def make_token(email: str) -> str:
    now = now_utc()
    claims = {"sub": email, "iat": now, "exp": now + timedelta(days=ACCESS_TOKEN_DAYS)}
    return jwt.encode(claims, JWT_SECRET, algorithm=JWT_ALGORITHM)


def _email_from_token(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        sub = payload.get("sub")
        return sub.lower().strip() if sub else None
    except Exception:
        return None


async def current_owner(authorization: Optional[str] = Header(None)) -> str:
    """Required auth — the grower's account email is the tenant key."""
    email = _email_from_token(authorization)
    if not email:
        raise HTTPException(status_code=401, detail="Please sign in.")
    user = await db.users.find_one({"email": email})
    if not user:
        raise HTTPException(status_code=401, detail="Account not found.")
    return email


async def optional_owner(authorization: Optional[str] = Header(None)) -> Optional[str]:
    return _email_from_token(authorization)


async def resolve_owner(owner: Optional[str], device_id: Optional[str]) -> Optional[str]:
    """Grower (token) -> their email; else a paired manager device -> its owner."""
    if owner:
        return owner
    if device_id:
        r = await db.recipients.find_one({"device_id": device_id, "active": True, "paired": True})
        if r:
            return r.get("owner")
    return None

# Season pass catalog — amounts are fixed server-side (never trust the client).
SEASON_PASS_DAYS = 365
PRICE_MAP = {
    "season_pass": {"amount": 29.00, "currency": "aud", "name": "Season Pass — 1 year"},
}

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO,
                    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants / helpers
# ---------------------------------------------------------------------------

SETTINGS_ID = "settings"
PAIRING_ID = "pairing"

DEFAULT_SETTINGS = {
    "id": SETTINGS_ID,
    "augers_offset_min": 360,      # 6h before catch
    "lines_offset_min": 120,       # 2h before catch
    "catch_headsup_min": 30,       # heads-up before the catch itself
    "realert_interval_min": 10,    # re-alert unacknowledged alarms every N min
    "realert_max": 3,              # after N re-alerts the alarm is flagged critical
    "timezone": "Australia/Sydney",
    "my_farms": [],                # grower's own farm(s); only these arm alarms
}

KIND_META = {
    "auger_off": {"title": "Turn OFF cross auger", "order": 0},
    "lines_up": {"title": "Raise feed lines UP", "order": 1},
    "catch_headsup": {"title": "Catch heads-up", "order": 2},
    "catch": {"title": "Catch starting NOW", "order": 3},
}


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return now_utc().replace(microsecond=0).isoformat()


def parse_iso(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


async def get_settings_doc(owner: str) -> dict:
    doc = await db.settings.find_one({"owner": owner})
    if not doc:
        fresh = {**DEFAULT_SETTINGS, "owner": owner}
        await db.settings.insert_one({**fresh})
        return fresh
    doc.pop("_id", None)
    return {**DEFAULT_SETTINGS, **doc, "owner": owner}


def clean(doc: dict) -> dict:
    doc.pop("_id", None)
    return doc


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------

class Settings(BaseModel):
    augers_offset_min: int
    lines_offset_min: int
    catch_headsup_min: int
    realert_interval_min: int
    realert_max: int
    timezone: str
    my_farms: List[str] = []


class SettingsUpdate(BaseModel):
    augers_offset_min: Optional[int] = None
    lines_offset_min: Optional[int] = None
    catch_headsup_min: Optional[int] = None
    realert_interval_min: Optional[int] = None
    realert_max: Optional[int] = None
    timezone: Optional[str] = None
    my_farms: Optional[List[str]] = None


class ManualShed(BaseModel):
    shed: str
    catch_time: str
    catch_date: Optional[str] = None


class ClaimRequest(BaseModel):
    code: str
    device_id: str
    device_name: Optional[str] = "Phone"


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def _find_col(columns, keywords):
    lowered = {c: str(c).strip().lower() for c in columns}
    for kwset in keywords:
        for col, low in lowered.items():
            if all(k in low for k in kwset):
                return col
    return None


def _cell_time(v):
    if isinstance(v, datetime):
        return v.time().replace(second=0, microsecond=0)
    if isinstance(v, time):
        return v.replace(second=0, microsecond=0)
    try:
        return parse_time_value(v)
    except Exception:
        return None


def extract_sheet_note(df) -> str:
    for r in range(min(len(df), 40)):
        for c in range(min(df.shape[1], 3)):
            v = df.iat[r, c]
            if isinstance(v, str) and "picked up" in v.lower():
                return v.strip()
    return ""


def parse_block_sheet(df):
    """Parse the processor 'load / pickup' format: repeating blocks each headed by
    a 'Load Time' row, where every load lists a Load Time, a Farm and one or more
    Shed # groups. The withdrawal anchor per (farm, shed) is its EARLIEST pickup.
    Returns a list of entries or None if the format is not recognised."""
    ncols = df.shape[1]
    header_rows = [
        r for r in range(len(df))
        if any(str(df.iat[r, c]).strip() == "Load Time" for c in range(ncols))
    ]
    if not header_rows:
        return None

    h0 = header_rows[0]
    hdr = [str(df.iat[h0, c]).strip() for c in range(ncols)]

    def idx(name_options):
        for c, v in enumerate(hdr):
            if v in name_options:
                return c
        return None

    lt_col = idx(("Load Time",))
    farm_col = idx(("Farm",))
    shed_cols = [c for c, v in enumerate(hdr) if v in ("Shed #", "Shed", "Shed#")]
    if lt_col is None or not shed_cols:
        return None

    # date column = the column with the most datetime-at-midnight cells
    best_col, best_n = None, 0
    for c in range(ncols):
        if c == lt_col:
            continue
        n = sum(
            1 for r in range(len(df))
            if isinstance(df.iat[r, c], datetime) and df.iat[r, c].hour == 0 and df.iat[r, c].minute == 0
        )
        if n > best_n:
            best_n, best_col = n, c
    date_col = best_col

    # reference date from a "Date:" label
    ref = None
    for r in range(min(len(df), 30)):
        for c in range(ncols - 1):
            if str(df.iat[r, c]).strip().lower().rstrip(":") == "date":
                for cc in range(c + 1, ncols):
                    v = df.iat[r, cc]
                    if isinstance(v, datetime):
                        ref = v.date()
                        break
            if ref:
                break
        if ref:
            break

    bounds = header_rows + [len(df)]
    pickups = {}  # (farm, shed) -> [datetime]
    for b in range(len(header_rows)):
        prev = None
        for r in range(header_rows[b] + 1, bounds[b + 1]):
            t = _cell_time(df.iat[r, lt_col])
            if t is None:
                continue
            fv = df.iat[r, farm_col] if farm_col is not None else ""
            if farm_col is not None and (fv is None or (isinstance(fv, float) and pd.isna(fv))):
                continue
            farm_str = str(fv).strip() if farm_col is not None else ""

            d = None
            if date_col is not None:
                dv = df.iat[r, date_col]
                if isinstance(dv, datetime) and pd.notna(dv):
                    d = dv.date()
            if d is None:
                d = prev.date() if prev else (ref or date.today())
                if prev and datetime.combine(d, t) < prev:
                    d = d + timedelta(days=1)
            dt = datetime.combine(d, t)
            prev = dt

            for sc in shed_cols:
                s = df.iat[r, sc]
                if s is None or (isinstance(s, float) and pd.isna(s)):
                    continue
                shed = str(int(s)) if isinstance(s, float) and float(s).is_integer() else str(s).strip()
                pickups.setdefault((farm_str, shed), []).append(dt)

    if not pickups:
        return None

    entries = []
    for (fm, shed), times in pickups.items():
        c = min(times)
        loads = sorted({x.strftime("%H:%M") for x in times})
        entries.append({
            "farm": fm,
            "shed": shed,
            "catch_time": c.time(),
            "catch_date": c.date(),
            "loads": loads,
        })
    return entries


def parse_catch_sheet(filename: str, content: bytes, default_date: date):
    """Parse a processor catch/pickup sheet (.xlsx/.csv). Handles the multi-block
    load format and a simple Shed/Catch-Time table."""
    name = filename.lower()
    note = ""

    if name.endswith((".xlsx", ".xls", ".xlsm")):
        try:
            raw = pd.read_excel(io.BytesIO(content), header=None)
        except Exception as e:
            raise HTTPException(400, f"Could not read the file: {e}")
        if raw.empty:
            raise HTTPException(400, "The catch sheet appears to be empty.")
        block = parse_block_sheet(raw)
        if block:
            note = extract_sheet_note(raw)
            return block, note
        try:
            df = pd.read_excel(io.BytesIO(content))
        except Exception as e:
            raise HTTPException(400, f"Could not read the file: {e}")
    elif name.endswith(".csv"):
        try:
            df = pd.read_csv(io.BytesIO(content))
        except Exception as e:
            raise HTTPException(400, f"Could not read the file: {e}")
    else:
        raise HTTPException(400, "Unsupported file type. Upload a .xlsx or .csv catch sheet.")

    if df.empty:
        raise HTTPException(400, "The catch sheet appears to be empty.")

    shed_col = _find_col(df.columns, [("shed",), ("house",), ("pen",), ("no",)])
    time_col = _find_col(df.columns, [("catch", "time"), ("load", "time"), ("time",), ("catch",), ("pickup",)])
    date_col = _find_col(df.columns, [("date",)])
    farm_col = _find_col(df.columns, [("farm",)])

    if time_col is None:
        raise HTTPException(
            400,
            "Could not find a catch/pickup time column. Expected 'Catch Time', 'Load Time' or "
            "'Time'. Columns found: " + ", ".join(str(c) for c in df.columns),
        )

    entries = []
    for _, row in df.iterrows():
        raw_time = row.get(time_col)
        if raw_time is None or (isinstance(raw_time, float) and pd.isna(raw_time)):
            continue
        try:
            ct = parse_time_value(raw_time)
        except Exception:
            continue
        shed_val = row.get(shed_col) if shed_col is not None else None
        if shed_val is None or (isinstance(shed_val, float) and pd.isna(shed_val)):
            shed_str = str(len(entries) + 1)
        elif isinstance(shed_val, float) and shed_val.is_integer():
            shed_str = str(int(shed_val))
        else:
            shed_str = str(shed_val).strip()
        cd = default_date
        if date_col is not None:
            cd = parse_date_value(row.get(date_col), default_date)
        farm_val = row.get(farm_col) if farm_col is not None else ""
        farm_str = "" if farm_val is None or (isinstance(farm_val, float) and pd.isna(farm_val)) else str(farm_val).strip()
        entries.append({"farm": farm_str, "shed": shed_str, "catch_time": ct, "catch_date": cd, "loads": []})

    if not entries:
        raise HTTPException(400, "No valid rows with a catch time were found in the sheet.")
    return entries, note


# ---------------------------------------------------------------------------
# Schedule + alarm building
# ---------------------------------------------------------------------------

def build_shed_timings(entries, settings, base_date: date, delay_min: int = 0):
    tz = get_tz(settings["timezone"])
    sheds = []
    for e in entries:
        cd = e.get("catch_date") or base_date
        base_dt = datetime.combine(cd, e["catch_time"])
        if delay_min:
            base_dt = base_dt + timedelta(minutes=delay_min)
        t = compute_shed_timing(
            base_dt.date(), base_dt.time(),
            settings["augers_offset_min"], settings["lines_offset_min"],
            settings["catch_headsup_min"], tz, shed=e["shed"],
        )
        d = t.to_dict()
        d["catch_date"] = base_dt.date().isoformat()
        d["farm"] = e.get("farm", "")
        d["loads"] = e.get("loads", [])
        sheds.append(d)
    sheds.sort(key=lambda s: (s.get("farm", ""), s["catch_utc"]))
    return sheds


def serialize_base(entries):
    """Store the raw (undelayed) catch anchors so delay/offset changes always
    recompute from the original times, never from already-shifted values."""
    return [{
        "farm": e.get("farm", ""),
        "shed": e["shed"],
        "catch_time": e["catch_time"].strftime("%H:%M"),
        "catch_date": (e.get("catch_date") or date.today()).isoformat(),
        "loads": e.get("loads", []),
    } for e in entries]


def entries_from_base(base):
    return [{
        "farm": b.get("farm", ""),
        "shed": b["shed"],
        "catch_time": parse_time_value(b["catch_time"]),
        "catch_date": date.fromisoformat(b["catch_date"]),
        "loads": b.get("loads", []),
    } for b in base]


def make_alarms(schedule_id: str, sheds: List[dict], settings: dict, preserve: dict, selected_farms, owner: str = ""):
    farms_present = any(s.get("farm") for s in sheds)
    selected = set(selected_farms or [])
    alarms = []
    for s in sheds:
        if farms_present and s.get("farm") not in selected:
            continue
        specs = [
            ("auger_off", s["auger_off_utc"], s["auger_off_local"]),
            ("lines_up", s["lines_up_utc"], s["lines_up_local"]),
        ]
        if settings["catch_headsup_min"] > 0:
            specs.append(("catch_headsup", s["catch_headsup_utc"], s["catch_headsup_local"]))
        specs.append(("catch", s["catch_utc"], s["catch_local"]))

        for kind, futc, flocal in specs:
            old = preserve.get((s.get("farm", ""), s["shed"], kind))
            alarm = {
                "id": str(uuid.uuid4()),
                "owner": owner,
                "schedule_id": schedule_id,
                "farm": s.get("farm", ""),
                "shed": s["shed"],
                "kind": kind,
                "title": KIND_META[kind]["title"],
                "fire_at_utc": futc,
                "fire_at_local": flocal,
                "status": "pending",
                "acknowledged_at": None,
                "alert_count": 0,
                "last_alerted_at": None,
                "created_at": iso_now(),
            }
            if old and old.get("status") == "acknowledged":
                alarm["status"] = "acknowledged"
                alarm["acknowledged_at"] = old.get("acknowledged_at")
                alarm["alert_count"] = old.get("alert_count", 0)
            if old:
                alarm["push_count"] = old.get("push_count", 0)
                alarm["last_pushed_at"] = old.get("last_pushed_at")
            alarms.append(alarm)
    return alarms


async def rebuild_active_alarms(owner: str, settings: dict):
    sched = await db.schedules.find_one({"owner": owner, "active": True})
    if not sched:
        return
    clean(sched)
    base = sched.get("base")
    if not base:
        base = [{
            "farm": s.get("farm", ""), "shed": s["shed"], "catch_time": s["catch_time"],
            "catch_date": s.get("catch_date", sched["catch_date"]), "loads": s.get("loads", []),
        } for s in sched["sheds"]]
    entries = entries_from_base(base)
    base_date = min((e["catch_date"] for e in entries), default=date.fromisoformat(sched["catch_date"]))
    delay_min = sched.get("delay_min", 0)
    sheds = build_shed_timings(entries, settings, base_date, delay_min)
    selected = settings.get("my_farms", [])

    old_alarms = await db.alarms.find({"schedule_id": sched["id"]}).to_list(1000)
    preserve = {(a.get("farm", ""), a["shed"], a["kind"]): a for a in old_alarms}

    await db.schedules.update_one({"id": sched["id"]}, {"$set": {"sheds": sheds, "offsets": {
        "augers_offset_min": settings["augers_offset_min"],
        "lines_offset_min": settings["lines_offset_min"],
        "catch_headsup_min": settings["catch_headsup_min"],
    }}})
    await db.alarms.delete_many({"schedule_id": sched["id"]})
    alarms = make_alarms(sched["id"], sheds, settings, preserve, selected, owner)
    if alarms:
        await db.alarms.insert_many([{**a} for a in alarms])


# ---------------------------------------------------------------------------
# Routes: health / settings
# ---------------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "Farm Feed Withdrawal Timer API"}


@api_router.get("/health")
async def api_health():
    """Liveness probe reachable through the public /api proxy — no DB access."""
    return {"status": "ok"}


@api_router.get("/share/qr")
async def share_qr(url: str):
    """Return a scannable QR code (PNG data URL) for the given app link."""
    return {"url": url, "qr_data_url": make_qr_data_url(url)}


@api_router.get("/settings", response_model=Settings)
async def read_settings(owner: str = Depends(current_owner)):
    s = await get_settings_doc(owner)
    return Settings(**{k: s[k] for k in Settings.model_fields})


@api_router.put("/settings", response_model=Settings)
async def update_settings(update: SettingsUpdate, owner: str = Depends(current_owner)):
    s = await get_settings_doc(owner)
    changes = {k: v for k, v in update.model_dump().items() if v is not None}
    for k in ("augers_offset_min", "lines_offset_min", "catch_headsup_min"):
        if k in changes and changes[k] < 0:
            changes[k] = 0
    if "realert_interval_min" in changes:
        changes["realert_interval_min"] = max(1, changes["realert_interval_min"])
    if "realert_max" in changes:
        changes["realert_max"] = max(1, changes["realert_max"])
    s.update(changes)
    await db.settings.update_one({"owner": owner}, {"$set": s}, upsert=True)
    await rebuild_active_alarms(owner, s)
    return Settings(**{k: s[k] for k in Settings.model_fields})


# ---------------------------------------------------------------------------
# Routes: upload / schedule
# ---------------------------------------------------------------------------

async def _create_schedule(entries, filename, base_date, settings, owner, note=""):
    sheds = build_shed_timings(entries, settings, base_date, 0)
    farms = sorted({s.get("farm", "") for s in sheds if s.get("farm")})
    selected = settings.get("my_farms", [])
    schedule_id = str(uuid.uuid4())
    await db.schedules.update_many({"owner": owner, "active": True}, {"$set": {"active": False}})
    doc = {
        "id": schedule_id,
        "owner": owner,
        "catch_date": base_date.isoformat(),
        "source_filename": filename,
        "note": note,
        "created_at": iso_now(),
        "active": True,
        "delay_min": 0,
        "assigned_to": None,
        "assigned_name": None,
        "base": serialize_base(entries),
        "sheds": sheds,
        "farms": farms,
        "offsets": {
            "augers_offset_min": settings["augers_offset_min"],
            "lines_offset_min": settings["lines_offset_min"],
            "catch_headsup_min": settings["catch_headsup_min"],
        },
    }
    await db.schedules.insert_one({**doc})
    alarms = make_alarms(schedule_id, sheds, settings, {}, selected, owner)
    if alarms:
        await db.alarms.insert_many([{**a} for a in alarms])
    return doc, alarms


@api_router.post("/upload")
async def upload_sheet(file: UploadFile = File(...), owner: str = Depends(current_owner)):
    settings = await get_settings_doc(owner)
    content = await file.read()
    base_date = date.today()
    entries, note = parse_catch_sheet(file.filename or "sheet", content, base_date)
    dated = [e["catch_date"] for e in entries if e.get("catch_date")]
    if dated:
        base_date = min(dated)
    doc, alarms = await _create_schedule(entries, file.filename or "sheet", base_date, settings, owner, note)
    return {"schedule": clean(doc), "alarms": [clean(a) for a in alarms],
            "shed_count": len(doc["sheds"]), "farms": doc["farms"]}


@api_router.post("/schedule/manual")
async def create_manual(sheds: List[ManualShed] = Body(...), owner: str = Depends(current_owner)):
    if not sheds:
        raise HTTPException(400, "Provide at least one shed.")
    settings = await get_settings_doc(owner)
    base_date = date.today()
    entries = []
    for s in sheds:
        try:
            ct = parse_time_value(s.catch_time)
        except Exception:
            raise HTTPException(400, f"Invalid time for shed {s.shed}: {s.catch_time}")
        cd = parse_date_value(s.catch_date, base_date) if s.catch_date else base_date
        entries.append({"farm": "", "shed": s.shed, "catch_time": ct, "catch_date": cd, "loads": []})
    base_date = min(e["catch_date"] for e in entries)
    doc, alarms = await _create_schedule(entries, "Manual entry", base_date, settings, owner)
    return {"schedule": clean(doc), "alarms": [clean(a) for a in alarms],
            "shed_count": len(doc["sheds"]), "farms": doc["farms"]}


async def _latest_for(owner: Optional[str]):
    if not owner:
        return {"schedule": None, "alarms": []}
    sched = await db.schedules.find_one({"owner": owner, "active": True})
    if not sched:
        return {"schedule": None, "alarms": []}
    clean(sched)
    alarms = await db.alarms.find({"schedule_id": sched["id"]}).to_list(1000)
    alarms = [clean(a) for a in alarms]
    alarms.sort(key=lambda a: a["fire_at_utc"])
    return {"schedule": sched, "alarms": alarms}


@api_router.get("/schedule/latest")
async def latest_schedule(device_id: Optional[str] = None, owner: Optional[str] = Depends(optional_owner)):
    resolved = await resolve_owner(owner, device_id)
    return await _latest_for(resolved)


@api_router.get("/schedules")
async def list_schedules(owner: str = Depends(current_owner)):
    docs = await db.schedules.find({"owner": owner}).sort("created_at", -1).to_list(100)
    return [clean(d) for d in docs]


@api_router.delete("/schedule/{schedule_id}")
async def delete_schedule(schedule_id: str, owner: str = Depends(current_owner)):
    await db.schedules.update_one({"id": schedule_id, "owner": owner}, {"$set": {"active": False}})
    return {"ok": True}


class DelayUpdate(BaseModel):
    delay_min: int


@api_router.put("/schedule/delay")
async def set_delay(update: DelayUpdate, owner: str = Depends(current_owner)):
    sched = await db.schedules.find_one({"owner": owner, "active": True})
    if not sched:
        raise HTTPException(404, "No active schedule to delay.")
    delay = max(0, update.delay_min)
    await db.schedules.update_one({"id": sched["id"]}, {"$set": {"delay_min": delay}})
    settings = await get_settings_doc(owner)
    await rebuild_active_alarms(owner, settings)
    return await _latest_for(owner)



# ---------------------------------------------------------------------------
# Routes: managers (recipients) + pairing + assignment
# ---------------------------------------------------------------------------

def make_qr_data_url(payload: str) -> str:
    qr = qrcode.QRCode(border=2, box_size=10, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(payload)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode()
    return f"data:image/png;base64,{b64}"


def new_code() -> str:
    return f"{secrets.randbelow(1000000):06d}"


def recipient_public(r: dict, app_url: Optional[str]) -> dict:
    if app_url:
        payload = f"{app_url.rstrip('/')}/pair?code={r['code']}"
    else:
        payload = f"farmtimer://pair?code={r['code']}"
    return {
        "id": r["id"],
        "name": r["name"],
        "paired": r.get("paired", False),
        "device_name": r.get("device_name"),
        "paired_at": r.get("paired_at"),
        "code": r["code"],
        "qr_data_url": make_qr_data_url(payload),
        "payload": payload,
    }


class RecipientCreate(BaseModel):
    name: str


class AssignRequest(BaseModel):
    recipient_id: Optional[str] = None


@api_router.get("/recipients")
async def list_recipients(app_url: Optional[str] = None, owner: str = Depends(current_owner)):
    docs = await db.recipients.find({"owner": owner, "active": True}).sort("created_at", 1).to_list(100)
    return [recipient_public(clean(r), app_url) for r in docs]


@api_router.post("/recipients")
async def create_recipient(req: RecipientCreate, app_url: Optional[str] = None, owner: str = Depends(current_owner)):
    r = {
        "id": str(uuid.uuid4()),
        "owner": owner,
        "name": (req.name or "").strip() or "Manager",
        "code": new_code(),
        "device_id": None,
        "device_name": None,
        "paired": False,
        "paired_at": None,
        "active": True,
        "created_at": iso_now(),
    }
    await db.recipients.insert_one({**r})
    return recipient_public(r, app_url)


@api_router.delete("/recipients/{rid}")
async def delete_recipient(rid: str, owner: str = Depends(current_owner)):
    await db.recipients.update_one({"id": rid, "owner": owner}, {"$set": {"active": False}})
    await db.schedules.update_many({"owner": owner, "assigned_to": rid}, {"$set": {"assigned_to": None, "assigned_name": None}})
    return {"ok": True}


@api_router.post("/recipients/{rid}/regenerate")
async def regen_recipient(rid: str, app_url: Optional[str] = None, owner: str = Depends(current_owner)):
    r = await db.recipients.find_one({"id": rid, "owner": owner})
    if not r:
        raise HTTPException(404, "Manager not found")
    await db.recipients.update_one({"id": rid}, {"$set": {
        "code": new_code(), "device_id": None, "device_name": None, "paired": False, "paired_at": None,
    }})
    r = await db.recipients.find_one({"id": rid})
    return recipient_public(clean(r), app_url)


@api_router.post("/pairing/claim")
async def pairing_claim(req: ClaimRequest):
    r = await db.recipients.find_one({"code": req.code.strip(), "active": True})
    if not r:
        raise HTTPException(400, "Incorrect pairing code. Check the control centre.")
    # a phone can only be one manager at a time
    await db.recipients.update_many({"device_id": req.device_id}, {"$set": {"device_id": None, "paired": False}})
    await db.recipients.update_one({"id": r["id"]}, {"$set": {
        "device_id": req.device_id,
        "device_name": req.device_name or "Phone",
        "paired": True,
        "paired_at": iso_now(),
    }})
    return {"ok": True, "recipient_id": r["id"], "name": r["name"]}


@api_router.get("/pairing/whoami")
async def whoami(device_id: Optional[str] = None):
    if not device_id:
        return {"paired": False}
    r = await db.recipients.find_one({"device_id": device_id, "active": True, "paired": True})
    if not r:
        return {"paired": False}
    sched = await db.schedules.find_one({"owner": r.get("owner"), "active": True})
    assigned = bool(sched and sched.get("assigned_to") == r["id"])
    return {
        "paired": True,
        "recipient_id": r["id"],
        "name": r["name"],
        "assigned": assigned,
        "assigned_name": (sched.get("assigned_name") if sched else None),
    }


@api_router.put("/schedule/assign")
async def assign_schedule(req: AssignRequest, owner: str = Depends(current_owner)):
    sched = await db.schedules.find_one({"owner": owner, "active": True})
    if not sched:
        raise HTTPException(404, "No active schedule to assign.")
    name = None
    if req.recipient_id:
        r = await db.recipients.find_one({"id": req.recipient_id, "owner": owner, "active": True})
        if not r:
            raise HTTPException(404, "Manager not found")
        name = r["name"]
    await db.schedules.update_one({"id": sched["id"]}, {"$set": {
        "assigned_to": req.recipient_id, "assigned_name": name,
    }})
    return await _latest_for(owner)




# ---------------------------------------------------------------------------
# Routes: alarms + escalation
# ---------------------------------------------------------------------------

async def log_event(alarm: dict, event: str):
    await db.alarm_log.insert_one({
        "id": str(uuid.uuid4()),
        "owner": alarm.get("owner", ""),
        "alarm_id": alarm["id"],
        "farm": alarm.get("farm", ""),
        "shed": alarm["shed"],
        "kind": alarm["kind"],
        "title": alarm["title"],
        "event": event,
        "at": iso_now(),
    })


@api_router.get("/alarms")
async def list_alarms(schedule_id: Optional[str] = None, owner: str = Depends(current_owner)):
    if not schedule_id:
        sched = await db.schedules.find_one({"owner": owner, "active": True})
        if not sched:
            return []
        schedule_id = sched["id"]
    alarms = await db.alarms.find({"schedule_id": schedule_id, "owner": owner}).to_list(1000)
    alarms = [clean(a) for a in alarms]
    alarms.sort(key=lambda a: a["fire_at_utc"])
    return alarms


@api_router.get("/alarms/active")
async def active_alarms(device_id: Optional[str] = None, owner: Optional[str] = Depends(optional_owner)):
    resolved = await resolve_owner(owner, device_id)
    if not resolved:
        return {"alarms": [], "realert_interval_min": 10, "realert_max": 3}
    settings = await get_settings_doc(resolved)
    now = now_utc()
    sched = await db.schedules.find_one({"owner": resolved, "active": True})
    base = {"alarms": [], "realert_interval_min": settings["realert_interval_min"],
            "realert_max": settings["realert_max"]}
    if not sched:
        return base
    # A phone paired to a manager only rings when the active schedule is
    # assigned to that manager. The grower's desktop (token) always sees due
    # alarms as a fail-safe.
    if device_id and not owner:
        r = await db.recipients.find_one({"device_id": device_id, "active": True, "paired": True})
        if r and sched.get("assigned_to") != r["id"]:
            return base
    docs = await db.alarms.find({"schedule_id": sched["id"], "status": "pending"}).to_list(1000)
    due = [clean(a) for a in docs if parse_iso(a["fire_at_utc"]) <= now]
    due.sort(key=lambda a: a["fire_at_utc"])
    base["alarms"] = due
    return base


@api_router.post("/alarms/{alarm_id}/ack")
async def ack_alarm(alarm_id: str):
    alarm = await db.alarms.find_one({"id": alarm_id})
    if not alarm:
        raise HTTPException(404, "Alarm not found")
    await db.alarms.update_one({"id": alarm_id}, {"$set": {
        "status": "acknowledged",
        "acknowledged_at": iso_now(),
    }})
    await log_event(alarm, "acknowledged")
    return {"ok": True}


@api_router.post("/alarms/{alarm_id}/escalate")
async def escalate_alarm(alarm_id: str):
    alarm = await db.alarms.find_one({"id": alarm_id})
    if not alarm:
        raise HTTPException(404, "Alarm not found")
    count = alarm.get("alert_count", 0) + 1
    await db.alarms.update_one({"id": alarm_id}, {"$set": {
        "alert_count": count,
        "last_alerted_at": iso_now(),
    }})
    await log_event(alarm, "escalated")
    return {"ok": True, "alert_count": count}


@api_router.get("/alarms/log")
async def alarm_log(limit: int = 100, owner: str = Depends(current_owner)):
    docs = await db.alarm_log.find({"owner": owner}).sort("at", -1).to_list(limit)
    return [clean(d) for d in docs]


# ---------------------------------------------------------------------------
# Routes: web push (reliable phone-browser alarms, incl. locked screen)
# ---------------------------------------------------------------------------

class PushSubscribe(BaseModel):
    device_id: str
    subscription: dict


@api_router.get("/push/vapid-public")
async def vapid_public():
    return {"public_key": VAPID_PUBLIC_KEY}


@api_router.post("/push/subscribe")
async def push_subscribe(req: PushSubscribe):
    endpoint = (req.subscription or {}).get("endpoint")
    if not endpoint:
        raise HTTPException(400, "Invalid push subscription.")
    await db.push_subscriptions.update_one(
        {"endpoint": endpoint},
        {"$set": {
            "device_id": req.device_id,
            "endpoint": endpoint,
            "subscription": req.subscription,
            "disabled": False,
            "updated_at": iso_now(),
        }},
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/push/subscribe/{device_id}")
async def push_unsubscribe(device_id: str):
    # User-initiated opt-out: soft-disable rather than destroy history.
    await db.push_subscriptions.update_many(
        {"device_id": device_id},
        {"$set": {"disabled": True, "disabled_at": iso_now()}},
    )
    return {"ok": True}


@api_router.get("/push/status")
async def push_status(device_id: Optional[str] = None):
    if not device_id:
        return {"subscribed": False}
    n = await db.push_subscriptions.count_documents(
        {"device_id": device_id, "disabled": {"$ne": True}}
    )
    return {"subscribed": n > 0}


class PushTest(BaseModel):
    device_id: str


@api_router.post("/push/test")
async def push_test(req: PushTest):
    if not await db.push_subscriptions.count_documents(
        {"device_id": req.device_id, "disabled": {"$ne": True}}
    ):
        raise HTTPException(400, "No push subscription for this device yet.")
    await _push_to_device(req.device_id, {
        "title": "Test alarm ✓",
        "body": "Push notifications are working on this phone.",
        "tag": "test",
        "url": "/",
    })
    return {"ok": True}


def _send_web_push(subscription: dict, payload: dict):
    """Blocking pywebpush call — run via asyncio.to_thread."""
    webpush(
        subscription_info=subscription,
        data=json.dumps(payload),
        vapid_private_key=VAPID_PRIVATE_KEY,
        vapid_claims={"sub": VAPID_SUBJECT},
        ttl=600,
    )


async def _push_to_device(device_id: str, payload: dict):
    subs = await db.push_subscriptions.find(
        {"device_id": device_id, "disabled": {"$ne": True}}
    ).to_list(20)
    for sub in subs:
        try:
            await asyncio.to_thread(_send_web_push, sub["subscription"], payload)
        except WebPushException as exc:
            status = getattr(getattr(exc, "response", None), "status_code", None)
            if status in (404, 410):
                # Endpoint is gone — soft-disable (non-destructive). Re-subscribing
                # from the browser re-enables it. Never hard-delete in a background job.
                await db.push_subscriptions.update_one(
                    {"_id": sub["_id"]},
                    {"$set": {"disabled": True, "disabled_at": iso_now()}},
                )
            else:
                logger.warning("web push failed: %s", exc)
        except Exception as exc:  # noqa: BLE001
            logger.warning("web push error: %s", exc)


async def deliver_due_alarms():
    """Runs on a timer. For every grower's active schedule, delivers browser push
    for due, unacknowledged alarms to the phone of the manager on catch, then
    re-alerts on the escalation interval until acknowledged or the max is reached."""
    try:
        scheds = await db.schedules.find({"active": True}).to_list(1000)
        for sched in scheds:
            if not sched.get("assigned_to"):
                continue
            recipient = await db.recipients.find_one(
                {"id": sched["assigned_to"], "active": True, "paired": True}
            )
            if not recipient or not recipient.get("device_id"):
                continue
            device_id = recipient["device_id"]
            if not await db.push_subscriptions.count_documents(
                {"device_id": device_id, "disabled": {"$ne": True}}
            ):
                continue

            settings = await get_settings_doc(sched["owner"])
            interval = timedelta(minutes=max(1, settings["realert_interval_min"]))
            max_alerts = max(1, settings["realert_max"])
            now = now_utc()

            docs = await db.alarms.find(
                {"schedule_id": sched["id"], "status": "pending"}
            ).to_list(1000)
            for a in docs:
                if parse_iso(a["fire_at_utc"]) > now:
                    continue
                count = a.get("push_count", 0)
                last = a.get("last_pushed_at")
                send = False
                if count == 0:
                    send = True
                elif count < max_alerts and last and (now - parse_iso(last)) >= interval:
                    send = True
                if not send:
                    continue
                payload = {
                    "title": a["title"],
                    "body": f"{a.get('farm') or ''} Shed {a['shed']} · {a['fire_at_local'][11:16]}".strip(),
                    "tag": a["id"],
                    "url": "/",
                }
                await _push_to_device(device_id, payload)
                await db.alarms.update_one(
                    {"id": a["id"]},
                    {"$set": {"push_count": count + 1, "last_pushed_at": iso_now()}},
                )
                await log_event(a, "fired" if count == 0 else "escalated")
    except Exception as exc:  # noqa: BLE001
        logger.warning("deliver_due_alarms error: %s", exc)


scheduler = AsyncIOScheduler()


# ---------------------------------------------------------------------------
# Routes: billing (Stripe season pass — one-time payment, unlocks 1 year)
# ---------------------------------------------------------------------------

def _norm_email(email: str) -> str:
    return (email or "").strip().lower()


class CheckoutRequest(BaseModel):
    email: str
    product: str = "season_pass"
    origin: Optional[str] = None


@api_router.get("/billing/plan")
async def billing_plan():
    p = PRICE_MAP["season_pass"]
    return {"product": "season_pass", "amount": p["amount"], "currency": p["currency"],
            "name": p["name"], "term_days": SEASON_PASS_DAYS}


@api_router.post("/payments/checkout")
async def create_checkout(body: CheckoutRequest, request: Request, owner: str = Depends(current_owner)):
    email = owner  # tenant email from the signed-in account; never trust the client
    product = PRICE_MAP.get(body.product)
    if not product:
        raise HTTPException(400, "Unknown product.")
    origin = (body.origin or "").rstrip("/")
    if not origin:
        origin = str(request.base_url).rstrip("/")

    checkout = StripeCheckout(api_key=STRIPE_API_KEY)
    req = CheckoutSessionRequest(
        amount=product["amount"],
        currency=product["currency"],
        success_url=f"{origin}/billing?session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{origin}/dashboard",
        metadata={"email": email, "product": body.product, "term_days": str(SEASON_PASS_DAYS)},
    )
    try:
        session = await checkout.create_checkout_session(req)
    except Exception as exc:  # noqa: BLE001
        logger.warning("stripe checkout failed: %s", exc)
        raise HTTPException(502, "Could not start checkout. Please try again.")

    await db.payment_transactions.insert_one({
        "session_id": session.session_id,
        "email": email,
        "product": body.product,
        "amount": product["amount"],
        "currency": product["currency"],
        "payment_status": "unpaid",
        "fulfilled": False,
        "created_at": iso_now(),
    })
    return {"url": session.url, "session_id": session.session_id}


@api_router.get("/payments/status/{session_id}")
async def checkout_status(session_id: str):
    tx = await db.payment_transactions.find_one({"session_id": session_id})
    if not tx:
        raise HTTPException(404, "Unknown checkout session.")

    checkout = StripeCheckout(api_key=STRIPE_API_KEY)
    try:
        result = await checkout.get_checkout_status(session_id)
    except Exception as exc:  # noqa: BLE001
        logger.warning("stripe status failed: %s", exc)
        raise HTTPException(502, "Could not check payment status.")

    payment_status = getattr(result, "payment_status", "unpaid")
    checkout_state = getattr(result, "status", "open")
    await db.payment_transactions.update_one(
        {"session_id": session_id},
        {"$set": {"payment_status": payment_status, "checkout_status": checkout_state,
                  "updated_at": iso_now()}},
    )

    if payment_status == "paid":
        claim = await db.payment_transactions.find_one_and_update(
            {"session_id": session_id, "payment_status": "paid", "fulfilled": False},
            {"$set": {"fulfilled": True, "fulfilled_at": iso_now()}},
        )
        if claim:
            now = now_utc()
            until = now + timedelta(days=SEASON_PASS_DAYS)
            await db.season_passes.update_one(
                {"email": claim["email"]},
                {"$set": {
                    "email": claim["email"],
                    "product": claim["product"],
                    "valid_from": now.replace(microsecond=0).isoformat(),
                    "valid_until": until.replace(microsecond=0).isoformat(),
                    "source_session_id": session_id,
                    "updated_at": iso_now(),
                }, "$setOnInsert": {"created_at": iso_now()}},
                upsert=True,
            )

    return {"status": checkout_state, "payment_status": payment_status,
            "fulfilled": payment_status == "paid", "email": tx["email"]}


@api_router.get("/season-pass/status")
async def season_pass_status(owner: str = Depends(current_owner)):
    doc = await db.season_passes.find_one({"email": owner})
    if not doc:
        return {"active": False, "valid_until": None}
    active = parse_iso(doc["valid_until"]) > now_utc()
    return {"active": active, "valid_until": doc["valid_until"]}


# ---------------------------------------------------------------------------
# Routes: auth (email + password accounts; account email is the tenant key)
# ---------------------------------------------------------------------------

class RegisterIn(BaseModel):
    email: EmailStr
    password: str


class LoginIn(BaseModel):
    email: EmailStr
    password: str


@api_router.post("/auth/register")
async def register(body: RegisterIn):
    email = _norm_email(body.email)
    if len(body.password) < 6:
        raise HTTPException(400, "Password must be at least 6 characters.")
    if await db.users.find_one({"email": email}):
        raise HTTPException(409, "That email is already registered — try signing in.")
    await db.users.insert_one({
        "id": str(uuid.uuid4()),
        "email": email,
        "password_hash": hash_password(body.password),
        "created_at": iso_now(),
    })
    return {"access_token": make_token(email), "email": email}


@api_router.post("/auth/login")
async def login(body: LoginIn):
    email = _norm_email(body.email)
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(body.password, user.get("password_hash", "")):
        raise HTTPException(401, "Incorrect email or password.")
    return {"access_token": make_token(email), "email": email}


@api_router.get("/auth/me")
async def auth_me(owner: str = Depends(current_owner)):
    return {"email": owner}


# ---------------------------------------------------------------------------

app.include_router(api_router)


@app.get("/health")
async def health():
    """Lightweight liveness probe — no DB access."""
    return {"status": "ok"}

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def start_scheduler():
    try:
        await db.users.create_index("email", unique=True)
    except Exception:  # noqa: BLE001
        pass
    scheduler.add_job(deliver_due_alarms, "interval", seconds=15, id="deliver", replace_existing=True)
    scheduler.start()


@app.on_event("shutdown")
async def shutdown_db_client():
    try:
        scheduler.shutdown(wait=False)
    except Exception:  # noqa: BLE001
        pass
    client.close()
