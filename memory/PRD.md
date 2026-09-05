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
- [x] REAL SHEET LOCKED: parser for the grower's processor "load/pickup" format —
      multi-block sheets, each load has a Load Time + Farm + up to 3 Shed # groups.
      Per (farm, shed) anchor = EARLIEST pickup; overnight pickup-date inference; the
      sheet note ("delay lights off until 12am") is surfaced. 5 regression tests
      (backend/test_real_sheet.py) against the actual file.
- [x] Multi-farm sheets: alarms armed ONLY for the grower's own farm(s), chosen in
      Settings > "My farms" (free-text add + quick-pick from the sheet). Farm shown on
      the alarm screen, schedule, log and the dashboard Farm column.
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
- P1: Lock exact column mapping to the grower's REAL catch sheet once uploaded (parser is
      currently tolerant/best-effort).
- P2: Per-farm delay overrides (user hinted; scope unclear — confirm before building).
- P2: Auto-detect the grower's timezone instead of the fixed Australia/Sydney default.
- P2: History view of past days' schedules and completion stats.
- Cleanup: expo-camera still declared in package.json but unused.

## Done — session (web push + phone upload)
- [x] Browser Web Push: VAPID configured, /sw.js + manifest at root, PushOptIn card on phone
      Home + Settings, subscribe/status/test/unsubscribe endpoints, APScheduler delivery every
      15s gated to the manager on catch (locked-screen alarms; iOS needs Add-to-Home-Screen).
- [x] Upload catch sheet from the phone browser (Home header + empty-state) -> /api/upload.
- [x] Tests: 36/36 backend pass (11 push + 25 regression); frontend smoke render OK.
- NOTE: real locked-phone push delivery must be validated on a live paired device after deploy.

## Next tasks
- Confirm per-farm delay vs timezone auto-detect intent with the user.
- User acceptance test on a real phone (pair, assign, lock screen, receive alarm).
