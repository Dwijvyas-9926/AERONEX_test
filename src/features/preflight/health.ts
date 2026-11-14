/*
  Pre-flight health evaluation. Turns the raw MAVLink health signals the vehicle
  already sends — SYS_STATUS sensor bitmasks, EKF_STATUS_REPORT variances,
  VIBRATION levels, GPS fix and battery — into simple go / caution / no-go
  verdicts. Thresholds follow ArduPilot's own guidance.

  The verdict defers to the autopilot. ArduPilot reports the outcome of its
  own pre-arm checks in SYS_STATUS (MAV_SYS_STATUS_PREARM_CHECK, bit 28:
  present always, enabled when any arming check is on, healthy when they pass
  or it is armed; GCS_MAVLink/GCS.cpp) and says why they fail in "PreArm:"
  messages, repeated every 30 s. "Ready to arm" is never shown while it says
  otherwise, nor before the data needed to judge has arrived.
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

/** MAV_SYS_STATUS_PREARM_CHECK: the autopilot's own pre-arm verdict. */
export const PREARM_BIT = 1 << 28;
/** ArduPilot repeats a failing pre-arm reason every 30 s (PREARM_DISPLAY_PERIOD); allow for one lost. */
export const PREARM_TEXT_MS = 65_000;
/** Telemetry older than this is not a current reading. */
export const FRESH_MS = 3000;

/** A sensor that is present but switched off is not a failure, and not a pass either. */
export function sensorHealth(bit: number, present: number, health: number, enabled = present): Health {
  if (!(present & bit) || !(enabled & bit)) return "absent";
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

/**
 * Battery: by the remaining charge when the autopilot reports one; otherwise
 * by voltage against the aircraft's own BATT_LOW_VOLT / BATT_CRT_VOLT. With
 * neither there is nothing to grade against: a voltage alone does not say
 * how many cells the pack has, and a fixed 4S guess called a full 3S pack
 * flat and a flat 6S pack full.
 */
export function batteryHealth(remaining: number | null, voltage: number | null, limits?: { low?: number | null; crit?: number | null }): Health {
  if (remaining != null) return remaining > 50 ? "ok" : remaining > 20 ? "warn" : "bad";
  if (voltage == null || voltage <= 0.1) return "unknown";
  const crit = limits?.crit && limits.crit > 0 ? limits.crit : null;
  const low = limits?.low && limits.low > 0 ? limits.low : null;
  if (crit != null && voltage <= crit) return "bad";
  if (low != null) return voltage <= low ? "bad" : voltage <= low * 1.05 ? "warn" : "ok";
  return crit != null ? "ok" : "unknown";
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

/** A reading with the time it arrived. */
interface Seen<T> {
  value: T;
  at: number;
}

export interface PreflightInput {
  now: number;
  armed: boolean;
  sensors?: Seen<{ present: number; enabled: number; health: number }>;
  attitude?: Seen<unknown>;
  ekf?: Seen<{ velVar: number; posHoriz: number; posVert: number; compass: number }>;
  gps?: Seen<{ fixType: number }>;
  battery?: Seen<{ voltage: number | null; remaining: number | null }>;
  vibration?: Seen<{ x: number; y: number; z: number; clip0: number; clip1: number; clip2: number }>;
  /** The aircraft's own battery limits, when its parameters have been read. */
  battLimits?: { low?: number | null; crit?: number | null };
  /** Status texts, newest first. */
  events: { text: string; at: number }[];
}

export interface PreflightVerdict {
  cls: "go" | "caution" | "nogo" | "wait";
  title: string;
  note: string;
  /** Each thing that kept the verdict from "Ready to arm", in words. */
  reasons: string[];
  /** The autopilot's current pre-arm reasons, newest first, without the "PreArm:" prefix. */
  prearm: string[];
  health: { ekf: Health; gps: Health; vibration: Health; battery: Health; sensors: { label: string; health: Health; critical?: boolean }[] };
}

/** The autopilot's own reasons for refusing to arm, as recent as ArduPilot repeats them. */
export function prearmReasons(events: { text: string; at: number }[], now: number): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (now - e.at > PREARM_TEXT_MS) break;
    const m = /\b(?:PreArm|Arm):\s*(.+)$/i.exec(e.text);
    if (m && !out.includes(m[1].trim())) out.push(m[1].trim());
  }
  return out;
}

/** The go / no-go for arming, from everything the aircraft reports. Pure, so it can be tested. */
export function preflightVerdict(i: PreflightInput): PreflightVerdict {
  const fresh = (s?: { at: number }) => !!s && i.now - s.at < FRESH_MS;
  const graded = (h: Health, s?: { at: number }): Health => (!s ? "unknown" : fresh(s) ? h : "warn");
  const sn = i.sensors?.value;
  const sensors = SENSOR_BITS.map((b) => ({
    label: b.label,
    critical: b.critical,
    health: !sn ? ("unknown" as Health) : !fresh(i.sensors) ? ("warn" as Health) : sensorHealth(b.bit, sn.present, sn.health, sn.enabled),
  }));
  const e = i.ekf?.value;
  const v = i.vibration?.value;
  const b = i.battery?.value;
  const health = {
    sensors,
    ekf: graded(e ? worst([e.velVar, e.posHoriz, e.posVert, e.compass].map(varianceHealth)) : "unknown", i.ekf),
    gps: graded(i.gps ? gpsHealth(i.gps.value.fixType) : "unknown", i.gps),
    vibration: graded(v ? worst([vibeHealth(v.x), vibeHealth(v.y), vibeHealth(v.z), v.clip0 + v.clip1 + v.clip2 > 0 ? "warn" : "ok"]) : "unknown", i.vibration),
    battery: graded(b ? batteryHealth(b.remaining, b.voltage, i.battLimits) : "unknown", i.battery),
  };
  const prearm = prearmReasons(i.events, i.now);
  const base = { prearm, health };

  if (i.armed) return { ...base, cls: "go", title: "Armed", note: "The vehicle is armed.", reasons: [] };

  // Without these there is nothing to judge by; without them current, nothing current.
  const needed: [string, { at: number } | undefined][] = [["sensor status", i.sensors], ["attitude", i.attitude], ["state estimate (EKF)", i.ekf]];
  const missing = needed.filter(([, s]) => !s).map(([n]) => n);
  const old = needed.filter(([, s]) => s && !fresh(s)).map(([n]) => n);
  if (old.length) {
    return { ...base, cls: "caution", title: "Telemetry stale", note: "Live health messages have stopped. Reconnect and let telemetry refresh before trusting this readout.", reasons: old.map((n) => `No current ${n}.`) };
  }
  if (missing.length) {
    return { ...base, cls: "wait", title: "Waiting for data", note: `Waiting for the aircraft to report its ${missing.join(", ")}.`, reasons: missing.map((n) => `No ${n} yet.`) };
  }

  const blockers: string[] = [];
  const cautions: string[] = [];
  // The autopilot's own verdict comes first.
  if (sn!.present & PREARM_BIT) {
    if (!(sn!.enabled & PREARM_BIT)) cautions.push("Arming checks are turned off on this aircraft, so it will arm without checking its own health.");
    else if (!(sn!.health & PREARM_BIT)) blockers.push(prearm.length ? "The autopilot's pre-arm checks are failing." : "The autopilot's pre-arm checks are failing. Its reason is shown below within 30 s.");
  } else if (prearm.length) {
    blockers.push("The autopilot is reporting pre-arm failures.");
  }
  for (const s of sensors) {
    if (s.health === "bad") (s.critical ? blockers : cautions).push(`${s.label} reports unhealthy.`);
  }
  if (health.ekf === "bad") blockers.push("The state estimate (EKF) variance is above ArduPilot's failsafe line.");
  else if (health.ekf === "warn") cautions.push("The state estimate (EKF) variance is elevated.");
  if (health.battery === "bad") blockers.push("The battery is low.");
  else if (health.battery === "warn") cautions.push("The battery is below half, or close to its low-voltage limit.");
  else if (health.battery === "unknown") cautions.push("The battery cannot be graded: no remaining charge is reported and the battery limits have not been read.");
  if (health.vibration === "bad") blockers.push("Vibration is above 60 m/s².");
  else if (health.vibration === "warn") cautions.push("Vibration is marginal, or the accelerometers have clipped.");
  if (health.gps !== "ok") {
    cautions.push(!i.gps ? "No GPS is reporting. Missions and keyboard flight need a 3D fix." : !fresh(i.gps) ? "The GPS has stopped reporting." : "The GPS has no 3D fix. Missions and keyboard flight need one.");
  }

  if (blockers.length) return { ...base, cls: "nogo", title: "Not ready", note: blockers[0], reasons: [...blockers, ...cautions] };
  if (cautions.length) return { ...base, cls: "caution", title: "Caution", note: "Review the flagged items below before flying.", reasons: cautions };
  const own = sn!.present & PREARM_BIT ? "ArduPilot reports its pre-arm checks passing, and" : "No pre-arm failure has been reported, and";
  return { ...base, cls: "go", title: "Ready to arm", note: `${own} nothing here is flagged. The autopilot still makes the final check when it arms.`, reasons: [] };
}
