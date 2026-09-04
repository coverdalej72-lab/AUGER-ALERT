"""Locks the parser to the grower's real processor 'load/pickup' sheet format."""

import os
from datetime import date

from server import parse_catch_sheet

FIX = os.path.join(os.path.dirname(__file__), "fixtures", "pick_up_31-08-2026.xlsx")


def _load():
    with open(FIX, "rb") as f:
        content = f.read()
    entries, note = parse_catch_sheet("pick up 31-08-2026.xlsx", content, date.today())
    return entries, note


def test_note_extracted():
    _, note = _load()
    assert "picked up from 7am" in note.lower()


def test_farms_and_count():
    entries, _ = _load()
    farms = {e["farm"] for e in entries}
    # multi-farm processor run
    for f in ("Double B", "Blott", "Chicken Mate", "Baqeri", "SFR 5"):
        assert f in farms
    assert len(entries) == 28


def test_no_bad_dates():
    entries, _ = _load()
    for e in entries:
        assert 2000 < e["catch_date"].year < 2100, e


def test_double_b_first_pickups():
    entries, _ = _load()
    db = {e["shed"]: e for e in entries if e["farm"] == "Double B"}
    # earliest pickup per shed
    assert str(db["4"]["catch_time"])[:5] == "05:15"
    assert db["4"]["catch_date"] == date(2026, 8, 31)
    assert str(db["6"]["catch_time"])[:5] == "07:30"
    assert str(db["7"]["catch_time"])[:5] == "10:00"
    assert str(db["9"]["catch_time"])[:5] == "13:15"


def test_overnight_pickup_date_inference():
    entries, _ = _load()
    # PTSA 5 Gourmet shed 1 picked up 00:30 -> must roll to 31 Aug, not year 1
    g = [e for e in entries if e["farm"] == "PTSA 5 Gourmet" and e["shed"] == "1"][0]
    assert g["catch_date"] == date(2026, 8, 31)
    assert str(g["catch_time"])[:5] == "00:30"
