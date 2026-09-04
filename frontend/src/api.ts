// Thin API client for the Farm Feed Withdrawal Timer backend.
const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const API = `${BASE}/api`;

async function handle(res: Response) {
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return res.json();
}

export const api = {
  get: (path: string) => fetch(`${API}${path}`).then(handle),
  post: (path: string, body?: unknown) =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle),
  put: (path: string, body?: unknown) =>
    fetch(`${API}${path}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle),
  del: (path: string) => fetch(`${API}${path}`, { method: "DELETE" }).then(handle),
};

// ---- Domain types ----------------------------------------------------------

export type ShedTiming = {
  shed: string;
  catch_time: string;
  catch_local: string;
  auger_off_local: string;
  lines_up_local: string;
  catch_headsup_local: string;
  catch_utc: string;
  auger_off_utc: string;
  lines_up_utc: string;
  catch_headsup_utc: string;
  catch_date: string;
};

export type AlarmKind = "auger_off" | "lines_up" | "catch_headsup" | "catch";

export type Alarm = {
  id: string;
  schedule_id: string;
  shed: string;
  kind: AlarmKind;
  title: string;
  fire_at_utc: string;
  fire_at_local: string;
  status: "pending" | "acknowledged";
  acknowledged_at: string | null;
  alert_count: number;
  last_alerted_at: string | null;
};

export type Schedule = {
  id: string;
  catch_date: string;
  source_filename: string;
  created_at: string;
  active: boolean;
  sheds: ShedTiming[];
  offsets: { augers_offset_min: number; lines_offset_min: number; catch_headsup_min: number };
};

export type Settings = {
  augers_offset_min: number;
  lines_offset_min: number;
  catch_headsup_min: number;
  realert_interval_min: number;
  realert_max: number;
  timezone: string;
};

export type PairingStatus = {
  paired: boolean;
  code: string;
  device_name: string | null;
  paired_at: string | null;
  qr_data_url: string;
  payload: string;
};

export type LogEntry = {
  id: string;
  alarm_id: string;
  shed: string;
  kind: AlarmKind;
  title: string;
  event: "acknowledged" | "escalated" | "fired";
  at: string;
};

export const qk = {
  settings: ["settings"] as const,
  schedule: ["schedule", "latest"] as const,
  alarms: ["alarms"] as const,
  activeAlarms: ["alarms", "active"] as const,
  pairing: ["pairing"] as const,
  log: ["alarms", "log"] as const,
};
