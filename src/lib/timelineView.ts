import { localDayKey } from "./eventTime";

export const HOUR_MS = 60 * 60 * 1000;
export const LANE_PAD = 208;
export const UNASSIGNED_LANE_ID = "__unassigned__";

export type TimeWindow = "full" | "00-06" | "06-12" | "12-18" | "18-24" | "custom";
export type TickPreset = "15m" | "1h" | "4h";

export const TIME_WINDOW_OPTIONS: { id: TimeWindow; label: string }[] = [
  { id: "full", label: "Full Day" },
  { id: "00-06", label: "00:00 – 06:00" },
  { id: "06-12", label: "06:00 – 12:00" },
  { id: "12-18", label: "12:00 – 18:00" },
  { id: "18-24", label: "18:00 – 24:00" },
  { id: "custom", label: "Custom" },
];

export function windowHours(kind: TimeWindow, customStart = "00:00", customEnd = "23:59"): { startH: number; endH: number } {
  if (kind === "00-06") return { startH: 0, endH: 6 };
  if (kind === "06-12") return { startH: 6, endH: 12 };
  if (kind === "12-18") return { startH: 12, endH: 18 };
  if (kind === "18-24") return { startH: 18, endH: 24 };
  if (kind === "custom") {
    const [sh = 0, sm = 0] = customStart.split(":").map(Number);
    const [eh = 23, em = 59] = customEnd.split(":").map(Number);
    return { startH: sh + sm / 60, endH: Math.max(sh + sm / 60 + 0.25, eh + em / 60) };
  }
  return { startH: 0, endH: 24 };
}

export function tickMsFor(preset: TickPreset) {
  if (preset === "15m") return 15 * 60 * 1000;
  if (preset === "4h") return 4 * HOUR_MS;
  return HOUR_MS;
}

export function pxForPreset(preset: TickPreset) {
  if (preset === "15m") return 160;
  if (preset === "4h") return 36;
  return 80;
}

export function formatDayHeading(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }).toUpperCase();
}

export function formatDaySelector(dayKey: string) {
  const [y, m, d] = dayKey.split("-").map(Number);
  const date = new Date(y, (m ?? 1) - 1, d ?? 1);
  return date.toLocaleDateString(undefined, { month: "short", day: "2-digit", year: "numeric" });
}

export function formatClockRange(start: number, end: number) {
  const t = (ms: number) => {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };
  return `${t(start)} → ${t(end)}`;
}

export function busiestDayKey(timestamps: number[]) {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const key = localDayKey(ts);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let n = -1;
  for (const [key, count] of counts) {
    if (count > n || (count === n && key < best)) {
      best = key;
      n = count;
    }
  }
  return best;
}

export function uniqueDayKeys(timestamps: number[]) {
  return [...new Set(timestamps.map(localDayKey))].sort();
}

export function eventInHourWindow(ts: number, startH: number, endH: number) {
  const d = new Date(ts);
  const h = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
  return h >= startH && h < endH;
}

export function paddedBounds(timestamps: number[], fallbackStart: number) {
  if (!timestamps.length) {
    const d = new Date(fallbackStart);
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 8, 0, 0, 0).getTime();
    return { minTime: start, maxTime: start + 8 * HOUR_MS };
  }
  const minTime = Math.min(...timestamps) - HOUR_MS;
  const maxTime = Math.max(...timestamps) + HOUR_MS;
  return { minTime, maxTime };
}

export function fitPxPerHour(spanMs: number, viewportWidth: number) {
  const hours = Math.max(2, spanMs / HOUR_MS);
  const avail = Math.max(320, viewportWidth - LANE_PAD - 48);
  return Math.max(22, Math.min(180, avail / hours));
}
