// Thin API client for the Farm Feed Withdrawal Timer backend.
import { storage } from "@/src/utils/storage";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export const API = `${BASE}/api`;

const TOKEN_KEY = "auth_token";
let authToken: string | null = null;

export async function initAuth(): Promise<string | null> {
  authToken = (await storage.getItem<string>(TOKEN_KEY, "")) || null;
  return authToken;
}

export function getToken(): string | null {
  return authToken;
}

export async function setToken(token: string): Promise<void> {
  authToken = token;
  await storage.setItem(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  authToken = null;
  await storage.setItem(TOKEN_KEY, "");
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { ...(extra || {}) };
  if (authToken) h.Authorization = `Bearer ${authToken}`;
  return h;
}

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
  get: (path: string) => fetch(`${API}${path}`, { headers: authHeaders() }).then(handle),
  post: (path: string, body?: unknown) =>
    fetch(`${API}${path}`, {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle),
  put: (path: string, body?: unknown) =>
    fetch(`${API}${path}`, {
      method: "PUT",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    }).then(handle),
  del: (path: string) => fetch(`${API}${path}`, { method: "DELETE", headers: authHeaders() }).then(handle),
};

// ---- Auth ------------------------------------------------------------------

export type AuthResult = { access_token: string; email: string };

export async function registerAccount(email: string, password: string): Promise<AuthResult> {
  const r: AuthResult = await api.post("/auth/register", { email, password });
  await setToken(r.access_token);
  return r;
}

export async function loginAccount(email: string, password: string): Promise<AuthResult> {
  const r: AuthResult = await api.post("/auth/login", { email, password });
  await setToken(r.access_token);
  return r;
}

export const fetchMe = (): Promise<{ email: string }> => api.get("/auth/me");

export const requestPasswordReset = (email: string): Promise<{ message: string }> =>
  api.post("/auth/password-reset/request", { email, origin: appOrigin() });

export async function confirmPasswordReset(token: string, newPassword: string): Promise<AuthResult> {
  const r: AuthResult = await api.post("/auth/password-reset/confirm", { token, new_password: newPassword });
  await setToken(r.access_token);
  return r;
}

// ---- Domain types ----------------------------------------------------------

export type ShedTiming = {
  farm: string;
  shed: string;
  catch_time: string;
  loads: string[];
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
  farm: string;
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
  note?: string;
  created_at: string;
  active: boolean;
  delay_min: number;
  assigned_to: string | null;
  assigned_name: string | null;
  sheds: ShedTiming[];
  farms: string[];
  offsets: { augers_offset_min: number; lines_offset_min: number; catch_headsup_min: number };
};

export type Settings = {
  augers_offset_min: number;
  lines_offset_min: number;
  catch_headsup_min: number;
  realert_interval_min: number;
  realert_max: number;
  timezone: string;
  my_farms: string[];
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
  farm: string;
  shed: string;
  kind: AlarmKind;
  title: string;
  event: "acknowledged" | "escalated" | "fired";
  at: string;
};

export type Recipient = {
  id: string;
  name: string;
  paired: boolean;
  device_name: string | null;
  paired_at: string | null;
  code: string;
  qr_data_url: string;
  payload: string;
};

export type Whoami = {
  paired: boolean;
  recipient_id?: string;
  name?: string;
  assigned?: boolean;
  assigned_name?: string | null;
};

export const qk = {
  settings: ["settings"] as const,
  schedule: ["schedule", "latest"] as const,
  alarms: ["alarms"] as const,
  activeAlarms: ["alarms", "active"] as const,
  recipients: ["recipients"] as const,
  whoami: ["whoami"] as const,
  log: ["alarms", "log"] as const,
  pass: ["season-pass"] as const,
};

export type BillingPlan = {
  product: string;
  amount: number;
  currency: string;
  name: string;
  term_days: number;
};

export type PassStatus = { active: boolean; valid_until: string | null };

// The public origin of the web app (used to build the QR link that opens the
// app in a phone browser — no Expo, no install).
export function appOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return process.env.EXPO_PUBLIC_BACKEND_URL || "";
}

export const fetchRecipients = (): Promise<Recipient[]> =>
  api.get(`/recipients?app_url=${encodeURIComponent(appOrigin())}`);

// ---- Billing (Stripe season pass) -----------------------------------------

export const fetchPassStatus = (): Promise<PassStatus> => api.get(`/season-pass/status`);

export const fetchPlan = (): Promise<BillingPlan> => api.get(`/billing/plan`);

export const fetchShareQr = (url: string): Promise<{ url: string; qr_data_url: string }> =>
  api.get(`/share/qr?url=${encodeURIComponent(url)}`);

export const startCheckout = (): Promise<{ url: string; session_id: string }> =>
  api.post(`/payments/checkout`, { product: "season_pass", origin: appOrigin() });

export const fetchPaymentStatus = (
  sessionId: string,
): Promise<{ status: string; payment_status: string; fulfilled: boolean; email: string }> =>
  api.get(`/payments/status/${encodeURIComponent(sessionId)}`);
