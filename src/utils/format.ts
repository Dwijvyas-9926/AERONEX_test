import type { Units } from "../state/settingsStore";

export const RAD = 180 / Math.PI;

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function ago(at: number | null | undefined, now: number): string {
  if (!at) return "never";
  const s = (now - at) / 1000;
  if (s < 1) return "just now";
  if (s < 60) return `${Math.floor(s)} s ago`;
  return `${Math.floor(s / 60)} min ago`;
}

export function altitude(m: number, units: Units) {
  return units === "imperial" ? { v: (m * 3.28084).toFixed(0), u: "ft" } : { v: m.toFixed(1), u: "m" };
}

export function speed(ms: number, units: Units) {
  return units === "imperial" ? { v: (ms * 2.23694).toFixed(1), u: "mph" } : { v: ms.toFixed(1), u: "m/s" };
}

export const GPS_FIX: Record<number, string> = {
  0: "No GPS",
  1: "No fix",
  2: "2D fix",
  3: "3D fix",
  4: "DGPS",
  5: "RTK float",
  6: "RTK fixed",
  7: "Static",
  8: "PPP",
};

export function clockTime(t: number) {
  return new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
