import { Platform } from "react-native";
import { API } from "@/src/api";

const VAPID = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY || "";

function urlB64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function isIOSWeb(): boolean {
  if (Platform.OS !== "web" || typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && "ontouchend" in document);
  return iOS;
}

export function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS uses navigator.standalone; others use display-mode media query.
  const nav = navigator as unknown as { standalone?: boolean };
  return (
    nav.standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches)
  );
}

export function pushSupported(): boolean {
  return (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function registerSW(): Promise<void> {
  if (Platform.OS !== "web" || typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  } catch {
    // ignore — push simply stays unavailable
  }
}

export type PushState = "unsupported" | "default" | "denied" | "off" | "on";

export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "default") return "default";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    return sub ? "on" : "off";
  } catch {
    return "off";
  }
}

export async function enablePush(deviceId: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  await registerSW();
  const perm = await Notification.requestPermission();
  if (perm !== "granted") return perm === "denied" ? "denied" : "default";
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(VAPID),
    });
  }
  await fetch(`${API}/push/subscribe`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, subscription: sub.toJSON() }),
  });
  return "on";
}

export async function disablePush(deviceId: string): Promise<PushState> {
  if (!pushSupported()) return "unsupported";
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {
    // ignore
  }
  await fetch(`${API}/push/subscribe/${deviceId}`, { method: "DELETE" });
  return "off";
}

export async function sendTestPush(deviceId: string): Promise<void> {
  await fetch(`${API}/push/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId }),
  });
}

export function injectPwaMeta(): void {
  if (Platform.OS !== "web" || typeof document === "undefined") return;
  const head = document.head;
  const ensure = (selector: string, make: () => HTMLElement) => {
    if (!head.querySelector(selector)) head.appendChild(make());
  };
  ensure('link[rel="manifest"]', () => {
    const l = document.createElement("link");
    l.rel = "manifest";
    l.href = "/manifest.json";
    return l;
  });
  ensure('meta[name="apple-mobile-web-app-capable"]', () => {
    const m = document.createElement("meta");
    m.name = "apple-mobile-web-app-capable";
    m.content = "yes";
    return m;
  });
  ensure('meta[name="mobile-web-app-capable"]', () => {
    const m = document.createElement("meta");
    m.name = "mobile-web-app-capable";
    m.content = "yes";
    return m;
  });
  ensure('link[rel="apple-touch-icon"]', () => {
    const l = document.createElement("link");
    l.rel = "apple-touch-icon";
    l.href = "/icon-192.png";
    return l;
  });
}
