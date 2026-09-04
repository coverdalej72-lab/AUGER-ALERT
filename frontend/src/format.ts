import type { AlarmKind } from "@/src/api";

// "2025-06-01T01:00:00+10:00" -> "01:00"
export function hhmm(iso: string): string {
  if (!iso) return "";
  return iso.slice(11, 16);
}

export function dateLabel(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso.slice(0, 10) + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
}

// Relative label like "in 3h 20m" or "5m ago"
export function relative(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  const diffMs = target - now.getTime();
  const past = diffMs < 0;
  let mins = Math.round(Math.abs(diffMs) / 60000);
  const h = Math.floor(mins / 60);
  mins = mins % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${mins}m`);
  const body = parts.join(" ");
  if (Math.abs(diffMs) < 60000) return "now";
  return past ? `${body} ago` : `in ${body}`;
}

type KindMeta = { label: string; short: string; icon: string; action: string };

export const KIND: Record<AlarmKind, KindMeta> = {
  auger_off: { label: "Cross auger OFF", short: "Auger OFF", icon: "cog-off", action: "Turn OFF cross auger" },
  lines_up: { label: "Feed lines UP", short: "Lines UP", icon: "arrow-up-bold", action: "Raise feed lines UP" },
  catch_headsup: { label: "Catch heads-up", short: "Heads-up", icon: "bell-ring", action: "Catch heads-up" },
  catch: { label: "Catch starting", short: "Catch", icon: "truck", action: "Catch starting NOW" },
};
