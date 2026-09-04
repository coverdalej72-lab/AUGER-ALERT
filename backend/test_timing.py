"""Anchor tests for the timing engine. Must pass before any UI / alarms."""

from datetime import date, time
from zoneinfo import ZoneInfo

import pytest

from timing import compute_shed_timing, parse_time_value, parse_date_value


TZ = ZoneInfo("Australia/Sydney")
D = date(2025, 6, 1)


def _local_hhmm(iso: str) -> str:
    # iso like 2025-06-01T01:00:00+10:00 -> "01:00"
    return iso[11:16]


def _local_date(iso: str) -> str:
    return iso[:10]


# --- Anchor cases -----------------------------------------------------------

def test_anchor_0700_to_0100():
    t = compute_shed_timing(D, time(7, 0), 360, 120, 0, TZ, shed="1")
    assert _local_hhmm(t.auger_off_local) == "01:00"   # 6h before 07:00
    assert _local_hhmm(t.lines_up_local) == "05:00"     # 2h before 07:00
    assert _local_hhmm(t.catch_local) == "07:00"
    # same calendar day
    assert _local_date(t.auger_off_local) == "2025-06-01"


def test_anchor_0730_to_0130():
    t = compute_shed_timing(D, time(7, 30), 360, 120, 0, TZ, shed="2")
    assert _local_hhmm(t.auger_off_local) == "01:30"
    assert _local_hhmm(t.lines_up_local) == "05:30"
    assert _local_hhmm(t.catch_local) == "07:30"


def test_overnight_rollover_to_previous_day():
    # 05:00 catch, 6h auger offset -> 23:00 the NIGHT BEFORE
    t = compute_shed_timing(D, time(5, 0), 360, 120, 0, TZ, shed="3")
    assert _local_hhmm(t.auger_off_local) == "23:00"
    assert _local_date(t.auger_off_local) == "2025-05-31"  # previous day
    assert _local_hhmm(t.lines_up_local) == "03:00"
    assert _local_date(t.lines_up_local) == "2025-06-01"


def test_custom_offsets():
    t = compute_shed_timing(D, time(9, 0), 480, 90, 30, TZ, shed="4")
    assert _local_hhmm(t.auger_off_local) == "01:00"      # 8h before
    assert _local_hhmm(t.lines_up_local) == "07:30"       # 90m before
    assert _local_hhmm(t.catch_headsup_local) == "08:30"  # 30m before catch


def test_utc_conversion():
    # Sydney in June is UTC+10 (no DST) -> 07:00 local == 21:00 prev day UTC
    t = compute_shed_timing(D, time(7, 0), 360, 120, 0, TZ, shed="1")
    assert t.catch_utc.endswith("+00:00")
    assert t.catch_utc[11:16] == "21:00"
    assert t.catch_utc[:10] == "2025-05-31"


# --- Time parsing -----------------------------------------------------------

@pytest.mark.parametrize("value,expected", [
    ("7:00", time(7, 0)),
    ("07:00", time(7, 0)),
    ("7:30 AM", time(7, 30)),
    ("7:00 PM", time(19, 0)),
    ("12:00 AM", time(0, 0)),
    ("12:00 PM", time(12, 0)),
    ("0700", time(7, 0)),
    ("1930", time(19, 30)),
    ("7.00", time(7, 0)),
    (time(6, 15), time(6, 15)),
    (0.5, time(12, 0)),          # excel fraction
    (0.25, time(6, 0)),
    (700, time(7, 0)),
])
def test_parse_time_value(value, expected):
    assert parse_time_value(value) == expected


def test_parse_date_fallback():
    assert parse_date_value("", default=date(2025, 6, 1)) == date(2025, 6, 1)
    assert parse_date_value("2025-06-01") == date(2025, 6, 1)
    assert parse_date_value("01/06/2025") == date(2025, 6, 1)
