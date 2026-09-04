"""
Pure timing engine for the Farm Feed Withdrawal Timer.

Trust-critical. No I/O, no DB, no framework. Everything here is a pure function
so it can be unit-tested in isolation.

Core rule (per shed):
    catch_dt        = catch date + catch time (in the farm's local timezone)
    auger_off_dt    = catch_dt - augers_offset            (default 6h before)
    lines_up_dt     = catch_dt - lines_offset             (default 2h before)
    catch_headsup   = catch_dt - catch_headsup_offset     (default 0 = at catch)

Overnight-safe: subtracting an offset that crosses midnight simply moves the
datetime to the previous day. datetime arithmetic handles the rollover, so a
07:00 catch with a 6h auger offset lands at 01:00 the SAME morning, and a 05:00
catch lands at 23:00 the NIGHT BEFORE.
"""

from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import date, datetime, time, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo


# ---------------------------------------------------------------------------
# Time-string parsing (tolerant of the many shapes a spreadsheet cell can take)
# ---------------------------------------------------------------------------

def parse_time_value(value) -> time:
    """Coerce a spreadsheet / user value into a datetime.time.

    Handles:
      - datetime.time / datetime.datetime objects (from openpyxl/pandas)
      - "7:00", "07:00", "7:00 AM", "07:00:00", "7.00", "0700"
      - excel serial fractions of a day (float in [0, 1))
    Raises ValueError if it cannot be understood.
    """
    if value is None:
        raise ValueError("empty time value")

    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    if isinstance(value, time):
        return value.replace(microsecond=0)

    # Excel stores a time as a fraction of a 24h day.
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        frac = float(value)
        if 0 <= frac < 2:
            frac = frac % 1
            total_seconds = round(frac * 24 * 3600)
            hh = (total_seconds // 3600) % 24
            mm = (total_seconds % 3600) // 60
            return time(hour=hh, minute=mm)
        # Otherwise treat an int like 700 -> 07:00, 1930 -> 19:30
        as_int = int(frac)
        hh, mm = divmod(as_int, 100)
        if 0 <= hh < 24 and 0 <= mm < 60:
            return time(hour=hh, minute=mm)
        raise ValueError(f"cannot parse numeric time: {value!r}")

    s = str(value).strip()
    if not s:
        raise ValueError("empty time string")

    s_up = s.upper().replace(".", ":")
    ampm = None
    for marker in ("AM", "PM"):
        if marker in s_up:
            ampm = marker
            s_up = s_up.replace(marker, "").strip()
            break

    # "0700" style
    if s_up.isdigit() and ":" not in s_up:
        if len(s_up) <= 2:
            hh, mm = int(s_up), 0
        else:
            s_up = s_up.zfill(4)
            hh, mm = int(s_up[:-2]), int(s_up[-2:])
    else:
        parts = s_up.split(":")
        try:
            hh = int(parts[0])
            mm = int(parts[1]) if len(parts) > 1 and parts[1] != "" else 0
        except (ValueError, IndexError):
            raise ValueError(f"cannot parse time: {value!r}")

    if ampm == "PM" and hh < 12:
        hh += 12
    if ampm == "AM" and hh == 12:
        hh = 0

    if not (0 <= hh < 24 and 0 <= mm < 60):
        raise ValueError(f"time out of range: {value!r}")

    return time(hour=hh, minute=mm)


def parse_date_value(value, default: Optional[date] = None) -> date:
    """Coerce a value into a date. Falls back to `default` (or today) if empty."""
    if value is None or (isinstance(value, str) and not value.strip()):
        return default or date.today()
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%m/%d/%Y", "%d-%m-%Y", "%d/%m/%y", "%Y/%m/%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return default or date.today()


# ---------------------------------------------------------------------------
# Core computation
# ---------------------------------------------------------------------------

@dataclass
class ShedTiming:
    shed: str
    catch_time: str          # "HH:MM" as given
    catch_local: str         # ISO local datetime
    auger_off_local: str
    lines_up_local: str
    catch_headsup_local: str
    catch_utc: str           # ISO UTC (for scheduling / comparison)
    auger_off_utc: str
    lines_up_utc: str
    catch_headsup_utc: str

    def to_dict(self) -> dict:
        return asdict(self)


def _fmt_local(dt: datetime) -> str:
    return dt.replace(second=0, microsecond=0).isoformat()


def _fmt_utc(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).replace(second=0, microsecond=0).isoformat()


def compute_shed_timing(
    catch_date: date,
    catch_time: time,
    augers_offset_min: int,
    lines_offset_min: int,
    catch_headsup_min: int,
    tz: ZoneInfo,
    shed: str = "",
) -> ShedTiming:
    """Compute all event datetimes for one shed's catch, overnight-safe."""
    catch_dt = datetime(
        catch_date.year, catch_date.month, catch_date.day,
        catch_time.hour, catch_time.minute, tzinfo=tz,
    )
    auger_off_dt = catch_dt - timedelta(minutes=augers_offset_min)
    lines_up_dt = catch_dt - timedelta(minutes=lines_offset_min)
    catch_headsup_dt = catch_dt - timedelta(minutes=catch_headsup_min)

    return ShedTiming(
        shed=str(shed),
        catch_time=catch_time.strftime("%H:%M"),
        catch_local=_fmt_local(catch_dt),
        auger_off_local=_fmt_local(auger_off_dt),
        lines_up_local=_fmt_local(lines_up_dt),
        catch_headsup_local=_fmt_local(catch_headsup_dt),
        catch_utc=_fmt_utc(catch_dt),
        auger_off_utc=_fmt_utc(auger_off_dt),
        lines_up_utc=_fmt_utc(lines_up_dt),
        catch_headsup_utc=_fmt_utc(catch_headsup_dt),
    )


def get_tz(tz_name: str) -> ZoneInfo:
    try:
        return ZoneInfo(tz_name)
    except Exception:
        return ZoneInfo("UTC")
