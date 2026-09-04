# PRD — Farm Feed Withdrawal Timer

## Original problem statement
Single-farm, single-grower tool. Upload a processor catch sheet and compute, per shed:
catch time · cross-auger OFF time · lines-UP time (overnight-safe). A desktop control
centre reviews times, sets offsets, and shows a pairing QR. A paired phone fires timed
alarms ("Turn off cross auger — Shed 1 — NOW") with a Done acknowledge; unacknowledged
alarms escalate/re-alert. High-contrast theme readable at 1am.

## Architecture
- **One Expo (React Native) codebase, responsive**: wide web (>=900px) -> `/dashboard`
  (desktop control centre); phone-width web / native -> `/(tabs)` companion
  (Schedule / Log / Settings). A true installable .exe is not produced; the PC control
  centre is the browser dashboard.
- **Backend**: FastAPI + MongoDB. Pure timezone-aware timing engine (`backend/timing.py`)
  with 19 pytest anchor tests. Parser via pandas/openpyxl. QR via `qrcode`.
- **Alarms delivery**: phone/overlay polls `GET /api/alarms/active` every 5s; a global
  full-screen `AlarmOverlay` rings due alarms with haptics (native) / beep (web) and
  re-alerts on the editable interval until acknowledged. (Real background push = future,
  needs a native build.)
- Data: uuid string ids, `_id` excluded; schedule deletes are soft (`active=false`).

## User persona
The grower (you). Acts on 1am/early-morning feed-withdrawal steps across multiple sheds.

## Core requirements (static)
- Catch-sheet upload (.xlsx/.csv) + manual shed entry.
- Per-shed catch / auger-OFF / lines-UP / catch-heads-up, overnight-safe.
- Editable offsets + editable re-alert (escalation) interval.
- QR + 6-digit phone pairing.
- Full-screen alarms with Done acknowledge; escalation re-alerts; activity log.
- High-contrast dark theme.

## Implemented (2026-06)
- [x] Timing engine + 19 anchor tests (7:00->01:00, 7:30->01:30, overnight rollover, UTC).
- [x] Backend: settings (get/put + recompute), upload parser, manual schedule,
      schedule/latest+list+soft-delete, pairing (status/claim/regenerate/unpair),
      alarms (active/ack/escalate), activity log.
- [x] Desktop dashboard: upload + manual add, per-shed times table with status dots,
      pairing QR panel, offsets & escalation editor.
- [x] Mobile companion: Schedule (next-up + timeline), Log, Settings (pair via code or
      QR scan on native, offsets, escalation).
- [x] Global full-screen AlarmOverlay: haptics/beep, pulsing ring, big DONE, escalation,
      "+N more waiting".
- [x] Fonts: Barlow Condensed (display) + IBM Plex Sans (text). Dark high-contrast theme.
- [x] Full testing_agent pass (backend 11/11, all frontend flows).

## Backlog / remaining
- P1: Real push notifications (Emergent-managed) so alarms arrive with app backgrounded —
      requires deploy + native build; user deferred ("defaults for now").
- P1: Lock exact column mapping to the grower's REAL catch sheet once uploaded (parser is
      currently tolerant/best-effort).
- P2: Multiple offset rules per shed group; per-shed overrides.
- P2: History view of past days' schedules and completion stats.

## Next tasks
- Await the user's real catch sheet to finalize parser column mapping.
- Offer Emergent-managed push when they're ready to build for a device.
