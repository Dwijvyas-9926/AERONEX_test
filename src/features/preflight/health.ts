/*
  Pre-flight health evaluation. Turns the raw MAVLink health signals the vehicle
  already sends — SYS_STATUS sensor bitmasks, EKF_STATUS_REPORT variances,
  VIBRATION levels, GPS fix and battery — into simple go / caution / no-go
  verdicts. Thresholds follow ArduPilot's own guidance. This never replaces the
  autopilot's pre-arm checks; it mirrors the same signals so issues are visible.
*/

export type Health = "ok" | "warn" | "bad" | "absent" | "unknown";

/** MAV_SYS_STATUS_SENSOR_* bits we surface, in display order. */
export const SENSOR_BITS: { bit: number; label: string; critical?: boolean }[] = [
  { bit: 1 << 0, label: "Gyroscope", critical: true },
  { bit: 1 << 1, label: "Accelerometer", critical: true },
  { bit: 1 << 2, label: "Magnetometer" },
  { bit: 1 << 3, label: "Barometer", critical: true },
  { bit: 1 << 5, label: "GPS" },
  { bit: 1 << 16, label: "RC receiver" },
  { bit: 1 << 21, label: "AHRS / EKF", critical: true },
  { bit: 1 << 25, label: "Battery monitor" },
  { bit: 1 << 26, label: "Logging" },
];

export function sensorHealth(bit: number, present: number, health: number): Health {
  if (!(present & bit)) return "absent";
  return health & bit ? "ok" : "bad";
}

/** EKF variance: ArduPilot treats ~0.8 as the red line. */
export function varianceHealth(v: number): Health {
  if (v == null || Number.isNaN(v)) return "unknown";
  return v < 0.5 ? "ok" : v < 0.8 ? "warn" : "bad";
}

/** Vibration (m/s/s): < 30 good, 30–60 marginal, > 60 problematic. */
export function vibeHealth(v: number): Health {
  if (v == null) return "unknown";
  return v < 30 ? "ok" : v < 60 ? "warn" : "bad";
}

export function gpsHealth(fixType: number): Health {
  return fixType >= 3 ? "ok" : fixType === 2 ? "warn" : "bad";
}

export function batteryHealth(remaining: number | null, voltage: number | null): Health {
  if (remaining != null) return remaining > 50 ? "ok" : remaining > 20 ? "warn" : "bad";
  if (voltage != null) return voltage > 14.5 ? "ok" : voltage > 13.2 ? "warn" : "bad"; // rough 4S guide
  return "unknown";
}

const RANK: Record<Health, number> = { bad: 3, warn: 2, unknown: 1, absent: 0, ok: 0 };
export const worst = (hs: Health[]): Health => hs.reduce<Health>((acc, h) => (RANK[h] > RANK[acc] ? h : acc), "ok");

export const GPS_FIX_LABEL: Record<number, string> = {
  0: "No GPS",
  1: "No fix",
  2: "2D fix",
  3: "3D fix",
  4: "DGPS",
  5: "RTK float",
  6: "RTK fixed",
};

/** EKF_STATUS_FLAGS bits that should be set for a healthy estimate. */
export const EKF_FLAG = {
  ATTITUDE: 1,
  VELOCITY_HORIZ: 2,
  POS_HORIZ_REL: 8,
  POS_HORIZ_ABS: 16,
  POS_VERT_ABS: 32,
};
