from fastapi import FastAPI, APIRouter, UploadFile, File, HTTPException, Body
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import io
import base64
import logging
import secrets
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional
import uuid
from datetime import datetime, date, timezone

import pandas as pd
import qrcode

from timing import compute_shed_timing, parse_time_value, parse_date_value, get_tz


ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

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


async def get_settings_doc() -> dict:
    doc = await db.settings.find_one({"id": SETTINGS_ID})
    if not doc:
        await db.settings.insert_one({**DEFAULT_SETTINGS})
        return {**DEFAULT_SETTINGS}
    doc.pop("_id", None)
    return {**DEFAULT_SETTINGS, **doc}


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


class SettingsUpdate(BaseModel):
    augers_offset_min: Optional[int] = None
    lines_offset_min: Optional[int] = None
    catch_headsup_min: Optional[int] = None
    realert_interval_min: Optional[int] = None
    realert_max: Optional[int] = None
    timezone: Optional[str] = None


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


def parse_catch_sheet(filename: str, content: bytes, default_date: date):
    """Best-effort parse of a processor catch sheet (.xlsx/.csv)."""
    name = filename.lower()
    try:
        if name.endswith(".csv"):
            df = pd.read_csv(io.BytesIO(content))
        elif name.endswith((".xlsx", ".xls", ".xlsm")):
            df = pd.read_excel(io.BytesIO(content))
        else:
            raise HTTPException(400, "Unsupported file type. Upload a .xlsx or .csv catch sheet.")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Could not read the file: {e}")

    if df.empty:
        raise HTTPException(400, "The catch sheet appears to be empty.")

    shed_col = _find_col(df.columns, [("shed",), ("house",), ("pen",), ("no",)])
    time_col = _find_col(df.columns, [("catch", "time"), ("time",), ("catch",), ("pickup",)])
    date_col = _find_col(df.columns, [("date",)])

    if time_col is None:
        raise HTTPException(
            400,
            "Could not find a catch-time column. Expected something like 'Catch Time' or "
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
        entries.append({"shed": shed_str, "catch_time": ct, "catch_date": cd})

    if not entries:
        raise HTTPException(400, "No valid rows with a catch time were found in the sheet.")
    return entries


# ---------------------------------------------------------------------------
# Schedule + alarm building
# ---------------------------------------------------------------------------

def build_shed_timings(entries, settings, base_date: date):
    tz = get_tz(settings["timezone"])
    sheds = []
    for e in entries:
        cd = e.get("catch_date") or base_date
        t = compute_shed_timing(
            cd, e["catch_time"],
            settings["augers_offset_min"], settings["lines_offset_min"],
            settings["catch_headsup_min"], tz, shed=e["shed"],
        )
        d = t.to_dict()
        d["catch_date"] = cd.isoformat()
        sheds.append(d)
    sheds.sort(key=lambda s: s["catch_utc"])
    return sheds


def make_alarms(schedule_id: str, sheds: List[dict], settings: dict, preserve: dict):
    alarms = []
    for s in sheds:
        specs = [
            ("auger_off", s["auger_off_utc"], s["auger_off_local"]),
            ("lines_up", s["lines_up_utc"], s["lines_up_local"]),
        ]
        if settings["catch_headsup_min"] > 0:
            specs.append(("catch_headsup", s["catch_headsup_utc"], s["catch_headsup_local"]))
        specs.append(("catch", s["catch_utc"], s["catch_local"]))

        for kind, futc, flocal in specs:
            old = preserve.get((s["shed"], kind))
            alarm = {
                "id": str(uuid.uuid4()),
                "schedule_id": schedule_id,
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
            alarms.append(alarm)
    return alarms


async def rebuild_active_alarms(settings: dict):
    sched = await db.schedules.find_one({"active": True})
    if not sched:
        return
    clean(sched)
    base_date = date.fromisoformat(sched["catch_date"])
    entries = []
    for s in sched["sheds"]:
        entries.append({
            "shed": s["shed"],
            "catch_time": parse_time_value(s["catch_time"]),
            "catch_date": date.fromisoformat(s.get("catch_date", sched["catch_date"])),
        })
    sheds = build_shed_timings(entries, settings, base_date)

    old_alarms = await db.alarms.find({"schedule_id": sched["id"]}).to_list(1000)
    preserve = {(a["shed"], a["kind"]): a for a in old_alarms}

    await db.schedules.update_one({"id": sched["id"]}, {"$set": {"sheds": sheds, "offsets": {
        "augers_offset_min": settings["augers_offset_min"],
        "lines_offset_min": settings["lines_offset_min"],
        "catch_headsup_min": settings["catch_headsup_min"],
    }}})
    await db.alarms.delete_many({"schedule_id": sched["id"]})
    alarms = make_alarms(sched["id"], sheds, settings, preserve)
    if alarms:
        await db.alarms.insert_many([{**a} for a in alarms])


# ---------------------------------------------------------------------------
# Routes: health / settings
# ---------------------------------------------------------------------------

@api_router.get("/")
async def root():
    return {"message": "Farm Feed Withdrawal Timer API"}


@api_router.get("/settings", response_model=Settings)
async def read_settings():
    s = await get_settings_doc()
    return Settings(**{k: s[k] for k in Settings.model_fields})


@api_router.put("/settings", response_model=Settings)
async def update_settings(update: SettingsUpdate):
    s = await get_settings_doc()
    changes = {k: v for k, v in update.model_dump().items() if v is not None}
    for k in ("augers_offset_min", "lines_offset_min", "catch_headsup_min"):
        if k in changes and changes[k] < 0:
            changes[k] = 0
    if "realert_interval_min" in changes:
        changes["realert_interval_min"] = max(1, changes["realert_interval_min"])
    if "realert_max" in changes:
        changes["realert_max"] = max(1, changes["realert_max"])
    s.update(changes)
    await db.settings.update_one({"id": SETTINGS_ID}, {"$set": s}, upsert=True)
    await rebuild_active_alarms(s)
    return Settings(**{k: s[k] for k in Settings.model_fields})


# ---------------------------------------------------------------------------
# Routes: upload / schedule
# ---------------------------------------------------------------------------

async def _create_schedule(entries, filename, base_date, settings):
    sheds = build_shed_timings(entries, settings, base_date)
    schedule_id = str(uuid.uuid4())
    await db.schedules.update_many({"active": True}, {"$set": {"active": False}})
    doc = {
        "id": schedule_id,
        "catch_date": base_date.isoformat(),
        "source_filename": filename,
        "created_at": iso_now(),
        "active": True,
        "sheds": sheds,
        "offsets": {
            "augers_offset_min": settings["augers_offset_min"],
            "lines_offset_min": settings["lines_offset_min"],
            "catch_headsup_min": settings["catch_headsup_min"],
        },
    }
    await db.schedules.insert_one({**doc})
    alarms = make_alarms(schedule_id, sheds, settings, {})
    if alarms:
        await db.alarms.insert_many([{**a} for a in alarms])
    return doc, alarms


@api_router.post("/upload")
async def upload_sheet(file: UploadFile = File(...)):
    settings = await get_settings_doc()
    content = await file.read()
    base_date = date.today()
    entries = parse_catch_sheet(file.filename or "sheet", content, base_date)
    dated = [e["catch_date"] for e in entries if e.get("catch_date")]
    if dated:
        base_date = min(dated)
    doc, alarms = await _create_schedule(entries, file.filename or "sheet", base_date, settings)
    return {"schedule": clean(doc), "alarms": [clean(a) for a in alarms], "shed_count": len(doc["sheds"])}


@api_router.post("/schedule/manual")
async def create_manual(sheds: List[ManualShed] = Body(...)):
    if not sheds:
        raise HTTPException(400, "Provide at least one shed.")
    settings = await get_settings_doc()
    base_date = date.today()
    entries = []
    for s in sheds:
        try:
            ct = parse_time_value(s.catch_time)
        except Exception:
            raise HTTPException(400, f"Invalid time for shed {s.shed}: {s.catch_time}")
        cd = parse_date_value(s.catch_date, base_date) if s.catch_date else base_date
        entries.append({"shed": s.shed, "catch_time": ct, "catch_date": cd})
    base_date = min(e["catch_date"] for e in entries)
    doc, alarms = await _create_schedule(entries, "Manual entry", base_date, settings)
    return {"schedule": clean(doc), "alarms": [clean(a) for a in alarms], "shed_count": len(doc["sheds"])}


@api_router.get("/schedule/latest")
async def latest_schedule():
    sched = await db.schedules.find_one({"active": True})
    if not sched:
        return {"schedule": None, "alarms": []}
    clean(sched)
    alarms = await db.alarms.find({"schedule_id": sched["id"]}).to_list(1000)
    alarms = [clean(a) for a in alarms]
    alarms.sort(key=lambda a: a["fire_at_utc"])
    return {"schedule": sched, "alarms": alarms}


@api_router.get("/schedules")
async def list_schedules():
    docs = await db.schedules.find().sort("created_at", -1).to_list(100)
    return [clean(d) for d in docs]


@api_router.delete("/schedule/{schedule_id}")
async def delete_schedule(schedule_id: str):
    await db.schedules.update_one({"id": schedule_id}, {"$set": {"active": False}})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Routes: pairing
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


async def get_pairing_doc(create=True) -> Optional[dict]:
    doc = await db.pairing.find_one({"id": PAIRING_ID})
    if not doc and create:
        doc = {
            "id": PAIRING_ID,
            "code": f"{secrets.randbelow(1000000):06d}",
            "token": secrets.token_urlsafe(24),
            "paired": False,
            "device_id": None,
            "device_name": None,
            "paired_at": None,
            "created_at": iso_now(),
        }
        await db.pairing.insert_one({**doc})
    if doc:
        clean(doc)
    return doc


@api_router.get("/pairing")
async def pairing_status():
    doc = await get_pairing_doc(create=True)
    payload = f"farmtimer://pair?code={doc['code']}&token={doc['token']}"
    return {
        "paired": doc["paired"],
        "code": doc["code"],
        "device_name": doc.get("device_name"),
        "paired_at": doc.get("paired_at"),
        "qr_data_url": make_qr_data_url(payload),
        "payload": payload,
    }


@api_router.post("/pairing/regenerate")
async def pairing_regenerate():
    doc = {
        "id": PAIRING_ID,
        "code": f"{secrets.randbelow(1000000):06d}",
        "token": secrets.token_urlsafe(24),
        "paired": False,
        "device_id": None,
        "device_name": None,
        "paired_at": None,
        "created_at": iso_now(),
    }
    await db.pairing.update_one({"id": PAIRING_ID}, {"$set": doc}, upsert=True)
    return await pairing_status()


@api_router.post("/pairing/claim")
async def pairing_claim(req: ClaimRequest):
    doc = await get_pairing_doc(create=True)
    if req.code.strip() != doc["code"]:
        raise HTTPException(400, "Incorrect pairing code. Check the code on your desktop.")
    await db.pairing.update_one({"id": PAIRING_ID}, {"$set": {
        "paired": True,
        "device_id": req.device_id,
        "device_name": req.device_name or "Phone",
        "paired_at": iso_now(),
    }})
    return {"ok": True, "token": doc["token"], "device_name": req.device_name or "Phone"}


@api_router.delete("/pairing")
async def pairing_unpair():
    return await pairing_regenerate()


# ---------------------------------------------------------------------------
# Routes: alarms + escalation
# ---------------------------------------------------------------------------

async def log_event(alarm: dict, event: str):
    await db.alarm_log.insert_one({
        "id": str(uuid.uuid4()),
        "alarm_id": alarm["id"],
        "shed": alarm["shed"],
        "kind": alarm["kind"],
        "title": alarm["title"],
        "event": event,
        "at": iso_now(),
    })


@api_router.get("/alarms")
async def list_alarms(schedule_id: Optional[str] = None):
    if not schedule_id:
        sched = await db.schedules.find_one({"active": True})
        if not sched:
            return []
        schedule_id = sched["id"]
    alarms = await db.alarms.find({"schedule_id": schedule_id}).to_list(1000)
    alarms = [clean(a) for a in alarms]
    alarms.sort(key=lambda a: a["fire_at_utc"])
    return alarms


@api_router.get("/alarms/active")
async def active_alarms():
    settings = await get_settings_doc()
    now = now_utc()
    sched = await db.schedules.find_one({"active": True})
    base = {"alarms": [], "realert_interval_min": settings["realert_interval_min"],
            "realert_max": settings["realert_max"]}
    if not sched:
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
async def alarm_log(limit: int = 100):
    docs = await db.alarm_log.find().sort("at", -1).to_list(limit)
    return [clean(d) for d in docs]


# ---------------------------------------------------------------------------

app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
