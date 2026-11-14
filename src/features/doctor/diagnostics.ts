/*
  AERONEX Drone Doctor — diagnostics engine.

  A data-in → findings-out rules core. It reads the signals the autopilot
  already reports (telemetry + parameters + recent status messages) and emits
  plain-English findings: what's wrong, why, and how to fix it. The same engine
  is designed to run later over a flight log (feed it recorded samples instead
  of live ones), so checks never assume a live link beyond freshness.

  Thresholds follow ArduPilot's own published guidance:
   - Vibration: < 30 m/s² good, 30–60 marginal, > 60 problematic; clipping
     ideally 0, a rising count is a serious problem.
     (ardupilot.org · Measuring Vibration)
   - EKF variances: 0 (trustworthy) → 1 (untrustworthy); failsafe fires at
     FS_EKF_THRESH (default 0.8) when two of compass/pos/vel exceed it.
     (ardupilot.org · EKF Failsafe)
   - Compass: calibration offset magnitude > 600 indicates likely interference;
     CompassMot interference < 30% good, 30–60% marginal, > 60% bad.
     (ardupilot.org · Advanced Compass Setup)
   - GPS: 3D fix needs fixType ≥ 3; HDOP target < 1.4, marginal to ~2.5.
*/

import type { LinkEvent, Telemetry } from "../../state/linkStore";
import { armingChecks } from "../../mavlink/paramNames";

export type Severity = "critical" | "warn" | "info" | "ok";

export type DiagArea = "Estimation" | "Vibration" | "Compass" | "GPS" | "Power" | "Sensors" | "Configuration" | "Pre-arm";

export interface Finding {
  id: string;
  area: DiagArea;
  severity: Severity;
  title: string; // short verdict, e.g. "Vibration is high"
  detail: string; // plain-English what & why
  fix?: string; // what to do about it
  metric?: string; // measured value, e.g. "48 m/s² (limit 60)"
  link?: { to: string; label: string }; // jump to the page that fixes it
}

export interface DiagContext {
  telemetry: Telemetry;
  params: Record<string, number>;
  armed: boolean;
  events: LinkEvent[];
  now: number;
}

/** Parameters the Doctor reads; requested from the vehicle when it connects. */
export const DOCTOR_PARAMS = [
  "FS_EKF_THRESH",
  "COMPASS_USE",
  "COMPASS_USE2",
  "COMPASS_OFS_X",
  "COMPASS_OFS_Y",
  "COMPASS_OFS_Z",
  "COMPASS_OFS2_X",
  "COMPASS_OFS2_Y",
  "COMPASS_OFS2_Z",
  // Before ArduCopter 4.7 the checks to run; from 4.7 the checks to skip. Either may be answered.
  "ARMING_CHECK",
  "ARMING_SKIPCHK",
  "BATT_MONITOR",
  "FRAME_CLASS",
  "FRAME_TYPE",
  "MOT_THST_HOVER",
  "BATT_ARM_VOLT",
  "BATT_LOW_VOLT",
];

const FRESH_MS = 6000;
const fresh = (at: number | undefined, now: number) => at != null && now - at < FRESH_MS;
const mag3 = (x: number, y: number, z: number) => Math.sqrt(x * x + y * y + z * z);
const one = (dp: number, v: number) => v.toFixed(dp);

export const SEVERITY_RANK: Record<Severity, number> = { critical: 0, warn: 1, info: 2, ok: 3 };

// ---------------------------------------------------------------------------
// Checks. Each returns zero or more findings. A check returns [] when it has no
// fresh data to judge (the page shows those areas as "waiting for data").
// ---------------------------------------------------------------------------

function checkVibration(c: DiagContext): Finding[] {
  const s = c.telemetry.vibration;
  if (!s || !fresh(s.at, c.now)) return [];
  const v = s.value;
  const peak = Math.max(v.x, v.y, v.z);
  const axis = v.x === peak ? "X (roll axis)" : v.y === peak ? "Y (pitch axis)" : "Z (vertical)";
  const clip = v.clip0 + v.clip1 + v.clip2;
  const metric = `${one(0, peak)} m/s² peak${clip > 0 ? ` · ${clip} clip events` : ""}`;

  if (peak > 60 || clip > 100) {
    return [{
      id: "vibe-high", area: "Vibration", severity: "critical", metric,
      title: "Vibration is too high",
      detail: `Peak vibration is ${one(0, peak)} m/s² on ${axis}. Above 60 m/s² the EKF usually starts rejecting the accelerometers, which causes position and altitude hold to drift or fail — a common cause of fly-aways and "toilet-bowling".${clip > 0 ? ` The IMU has also clipped ${clip} times, meaning the accelerometer physically maxed out.` : ""}`,
      fix: "Soft-mount the flight controller (gel/foam), balance your props and motors, and check nothing rigid touches the board. Re-test and aim for under 30 m/s².",
      link: { to: "/flight-data", label: "Watch live vibration" },
    }];
  }
  if (peak > 30 || clip > 0) {
    return [{
      id: "vibe-marginal", area: "Vibration", severity: "warn", metric,
      title: "Vibration is in the marginal zone",
      detail: `Peak vibration is ${one(0, peak)} m/s² on ${axis}. Between 30 and 60 m/s² it may fly but can intermittently upset altitude and position hold.${clip > 0 ? ` ${clip} clip event(s) were recorded — occasional clips on a hard landing are fine, a rising count is not.` : ""}`,
      fix: "Improve prop/motor balance and controller damping before relying on GPS modes. Re-test for under 30 m/s².",
    }];
  }
  return [{
    id: "vibe-ok", area: "Vibration", severity: "ok", metric: `${one(0, peak)} m/s² peak`,
    title: "Vibration is healthy", detail: `Peak vibration is ${one(0, peak)} m/s², comfortably under the 30 m/s² guideline, with no clipping.`,
  }];
}

function checkEstimation(c: DiagContext): Finding[] {
  const s = c.telemetry.ekf;
  if (!s || !fresh(s.at, c.now)) return [];
  const e = s.value;
  const thresh = c.params.FS_EKF_THRESH ?? 0.8;
  const vars: { k: string; v: number; what: string; cause: string; fix: string }[] = [
    { k: "compass", v: e.compass, what: "Magnetometer (compass)", cause: "the heading estimate disagrees with the gyros — usually magnetic interference from power wiring or a bad compass calibration", fix: "Recalibrate the compass away from metal, move it further from the power leads, or prefer an external compass." },
    { k: "velocity", v: e.velVar, what: "Velocity", cause: "the measured velocity disagrees with the model — typically GPS noise or high vibration feeding the accelerometers", fix: "Check GPS reception and vibration levels; both feed the velocity estimate." },
    { k: "position (horizontal)", v: e.posHoriz, what: "Horizontal position", cause: "GPS position is noisy or glitching", fix: "Fly with a clear sky view and a solid 3D fix; check the GPS antenna and HDOP." },
    { k: "position (vertical)", v: e.posVert, what: "Vertical position", cause: "barometer and GPS altitude disagree, often from prop-wash over the baro or vibration", fix: "Shield the barometer from prop-wash and reduce vibration." },
  ];
  const worst = vars.reduce((a, b) => (b.v > a.v ? b : a));
  const metric = `worst variance ${one(2, worst.v)} (red line ${one(2, thresh)})`;

  if (worst.v >= thresh) {
    return [{
      id: "ekf-bad", area: "Estimation", severity: "critical", metric,
      title: `State estimate is unreliable — ${worst.what.toLowerCase()}`,
      detail: `The EKF ${worst.k} variance is ${one(2, worst.v)}, at or past ArduPilot's failsafe line of ${one(2, thresh)}. Variances run 0 (trustworthy) to 1 (untrustworthy); ${worst.cause}. At this level the aircraft can trigger an EKF failsafe and refuse GPS modes.`,
      fix: worst.fix,
      link: { to: "/preflight", label: "See estimator health" },
    }];
  }
  if (worst.v >= 0.5) {
    return [{
      id: "ekf-warn", area: "Estimation", severity: "warn", metric,
      title: `State estimate is getting noisy — ${worst.what.toLowerCase()}`,
      detail: `The EKF ${worst.k} variance is ${one(2, worst.v)} (watch above 0.5, failsafe at ${one(2, thresh)}). Likely cause: ${worst.cause}.`,
      fix: worst.fix,
    }];
  }
  return [{
    id: "ekf-ok", area: "Estimation", severity: "ok", metric: `worst variance ${one(2, worst.v)}`,
    title: "State estimate is solid", detail: `All EKF variances are low (worst ${one(2, worst.v)}), so the autopilot trusts its attitude, velocity and position estimates.`,
  }];
}

function checkCompass(c: DiagContext): Finding[] {
  const p = c.params;
  const out: Finding[] = [];
  const has = (k: string) => p[k] !== undefined;

  if (has("COMPASS_USE") && p.COMPASS_USE === 0) {
    out.push({
      id: "compass-off", area: "Compass", severity: "warn",
      title: "Primary compass is disabled",
      detail: "COMPASS_USE is 0, so the autopilot is flying without its main magnetometer. That's only safe in specific setups (e.g. GPS-for-yaw); otherwise heading-dependent modes like Loiter and RTL will misbehave.",
      fix: "Set COMPASS_USE = 1 unless you deliberately run a compass-less configuration.",
      link: { to: "/params", label: "Open COMPASS_USE" },
    });
  }

  if (has("COMPASS_OFS_X") && has("COMPASS_OFS_Y") && has("COMPASS_OFS_Z")) {
    const m = mag3(p.COMPASS_OFS_X, p.COMPASS_OFS_Y, p.COMPASS_OFS_Z);
    const metric = `offset magnitude ${one(0, m)} mGauss`;
    if (m > 600) {
      out.push({
        id: "compass-ofs", area: "Compass", severity: "warn", metric,
        title: "Compass offsets are high",
        detail: `The calibration offsets total ${one(0, m)} mGauss. ArduPilot flags anything over 600 as likely magnetic interference — the compass is mounted too close to the power wiring, ESCs or a battery.`,
        fix: "Move the compass (or an external mast compass) away from high-current wiring, then recalibrate. Re-check that the magnitude drops below ~600.",
        link: { to: "/calibration", label: "Recalibrate compass" },
      });
    } else {
      out.push({
        id: "compass-ofs-ok", area: "Compass", severity: "ok", metric,
        title: "Compass calibration looks clean",
        detail: `Calibration offsets total ${one(0, m)} mGauss, under the 600 interference threshold.`,
      });
    }
  }

  if (has("COMPASS_USE2") && p.COMPASS_USE2 === 1 && has("COMPASS_OFS2_X")) {
    const m2 = mag3(p.COMPASS_OFS2_X, p.COMPASS_OFS2_Y ?? 0, p.COMPASS_OFS2_Z ?? 0);
    if (m2 > 600) {
      out.push({
        id: "compass-ofs2", area: "Compass", severity: "warn", metric: `compass 2 offset ${one(0, m2)} mGauss`,
        title: "Second compass offsets are high",
        detail: `The secondary compass offsets total ${one(0, m2)} mGauss (> 600). It's picking up interference.`,
        fix: "Relocate or recalibrate the second compass, or disable it with COMPASS_USE2 = 0 if it isn't needed.",
      });
    }
  }
  return out;
}

function checkGps(c: DiagContext): Finding[] {
  const s = c.telemetry.gps;
  const sensors = c.telemetry.sensors;
  const gpsPresent = sensors && fresh(sensors.at, c.now) ? !!(sensors.value.present & (1 << 5)) : s != null;
  if (!gpsPresent && !s) {
    return [{
      id: "gps-none", area: "GPS", severity: "info",
      title: "No GPS detected",
      detail: "No GPS is reporting. That's fine for a stabilize-only / indoor build, but autonomous modes (Loiter, RTL, Auto) won't be available.",
    }];
  }
  if (!s || !fresh(s.at, c.now)) return [];
  const g = s.value;
  const sats = g.satellites ?? 0;
  const hdop = g.hdop;
  const metric = `fix ${g.fixType}, ${sats} sats${hdop != null ? `, HDOP ${one(1, hdop)}` : ""}`;

  if (g.fixType < 3) {
    return [{
      id: "gps-nofix", area: "GPS", severity: "critical", metric,
      title: "No 3D GPS fix",
      detail: `The GPS reports fix type ${g.fixType} with ${sats} satellites. Below a 3D fix the aircraft cannot hold position; arming in GPS modes will be blocked.`,
      fix: "Take the aircraft outside with a clear view of the sky, keep it away from buildings and RF sources, and wait for the fix to reach 3D with 10+ satellites.",
    }];
  }
  const issues: string[] = [];
  let sev: Severity = "ok";
  if (sats < 6) { issues.push(`only ${sats} satellites`); sev = "critical"; }
  else if (sats < 10) { issues.push(`${sats} satellites (aim for 10+)`); sev = "warn"; }
  if (hdop != null && hdop > 2.5) { issues.push(`HDOP ${one(1, hdop)} is poor`); if (sev !== "critical") sev = "warn"; }
  else if (hdop != null && hdop > 1.4 && sev === "ok") { issues.push(`HDOP ${one(1, hdop)} is marginal`); sev = "warn"; }

  if (sev === "ok") {
    return [{
      id: "gps-ok", area: "GPS", severity: "ok", metric,
      title: "GPS is strong", detail: `3D fix with ${sats} satellites${hdop != null ? ` and HDOP ${one(1, hdop)}` : ""} — good enough for stable position hold.`,
    }];
  }
  return [{
    id: "gps-weak", area: "GPS", severity: sev, metric,
    title: "GPS signal is weak",
    detail: `3D fix, but ${issues.join(" and ")}. Weak GPS makes position hold wander and can feed the EKF bad data.`,
    fix: "Wait for more satellites with a clear sky view, move the GPS mast up and away from carbon/metal, and keep telemetry/video transmitters away from the antenna.",
  }];
}

function checkPower(c: DiagContext): Finding[] {
  const s = c.telemetry.battery;
  if (c.params.BATT_MONITOR !== undefined && c.params.BATT_MONITOR === 0) {
    return [{
      id: "batt-nomon", area: "Power", severity: "warn",
      title: "Battery monitoring is off",
      detail: "BATT_MONITOR is 0, so the autopilot can't see pack voltage or current. You lose low-battery failsafe — a leading cause of crashes from flying a pack flat.",
      fix: "Set BATT_MONITOR to match your power module (4 = Analog Voltage+Current) and set the voltage failsafe.",
      link: { to: "/params", label: "Open BATT_MONITOR" },
    }];
  }
  if (!s || !fresh(s.at, c.now) || s.value.voltage == null) return [];
  const v = s.value.voltage;
  const remaining = s.value.remaining;
  // Estimate cell count from the ~4.2 V/cell charged ceiling (ceil), which is
  // robust across the charge range — round(v/3.7) wrongly reads a full 4S (16.8 V)
  // as 5 cells and flags a healthy pack as critically low.
  const cells = Math.max(1, Math.min(14, Math.ceil(v / 4.21)));
  const perCell = v / cells;
  const metric = `${one(2, v)} V (~${cells}S, ${one(2, perCell)} V/cell)${remaining != null ? ` · ${remaining}%` : ""}`;

  if (perCell < 3.5 || (remaining != null && remaining < 20)) {
    return [{
      id: "batt-low", area: "Power", severity: "critical", metric,
      title: "Battery is critically low",
      detail: `Pack is ${one(2, v)} V (~${one(2, perCell)} V/cell on an estimated ${cells}S). Below 3.5 V/cell a LiPo is nearly empty and sags hard under throttle — do not fly.`,
      fix: "Charge or swap the pack. Confirm your voltage failsafe (BATT_LOW_VOLT / BATT_CRT_VOLT) is set so this triggers an automatic RTL or Land.",
    }];
  }
  if (perCell < 3.7 || (remaining != null && remaining < 40)) {
    return [{
      id: "batt-warn", area: "Power", severity: "warn", metric,
      title: "Battery is getting low",
      detail: `Pack is about ${one(2, perCell)} V/cell. There's limited headroom left for a full flight, and voltage sags further under load.`,
      fix: "Plan a short flight or swap to a fresh pack. Make sure the low-battery failsafe is configured.",
    }];
  }
  return [{
    id: "batt-ok", area: "Power", severity: "ok", metric,
    title: "Battery is healthy", detail: `Pack is ${one(2, v)} V (~${one(2, perCell)} V/cell on an estimated ${cells}S) — a good, fresh charge.`,
  }];
}

function checkSensors(c: DiagContext): Finding[] {
  const s = c.telemetry.sensors;
  if (!s || !fresh(s.at, c.now)) return [];
  const { present, health } = s.value;
  const CRIT = [
    { bit: 1 << 0, label: "Gyroscope" },
    { bit: 1 << 1, label: "Accelerometer" },
    { bit: 1 << 3, label: "Barometer" },
    { bit: 1 << 21, label: "AHRS / EKF" },
  ];
  const WARN = [
    { bit: 1 << 2, label: "Magnetometer" },
    { bit: 1 << 5, label: "GPS" },
    { bit: 1 << 16, label: "RC receiver" },
    { bit: 1 << 25, label: "Battery monitor" },
  ];
  const badCrit = CRIT.filter((b) => present & b.bit && !(health & b.bit)).map((b) => b.label);
  const badWarn = WARN.filter((b) => present & b.bit && !(health & b.bit)).map((b) => b.label);
  if (badCrit.length) {
    return [{
      id: "sensors-crit", area: "Sensors", severity: "critical", metric: badCrit.join(", "),
      title: "A core sensor is unhealthy",
      detail: `The autopilot reports these required sensors as present but not healthy: ${badCrit.join(", ")}. The vehicle should not fly until they recover.`,
      fix: "Reboot the board; if it persists, recalibrate the sensor or suspect a hardware fault.",
      link: { to: "/preflight", label: "See sensor health" },
    }];
  }
  if (badWarn.length) {
    return [{
      id: "sensors-warn", area: "Sensors", severity: "warn", metric: badWarn.join(", "),
      title: "A sensor is reporting unhealthy",
      detail: `These sensors are present but currently unhealthy: ${badWarn.join(", ")}. Resolve before relying on features that depend on them.`,
      fix: "Check the sensor's wiring and calibration; reboot and re-check.",
      link: { to: "/preflight", label: "See sensor health" },
    }];
  }
  return [{
    id: "sensors-ok", area: "Sensors", severity: "ok",
    title: "All sensors healthy", detail: "Every sensor the autopilot advertises is reporting healthy.",
  }];
}

function checkConfig(c: DiagContext): Finding[] {
  const p = c.params;
  const out: Finding[] = [];
  const has = (k: string) => p[k] !== undefined;

  // ArduCopter 4.7 replaced ARMING_CHECK (checks to run) with ARMING_SKIPCHK (checks to skip).
  const checks = armingChecks(p);
  const newer = has("ARMING_SKIPCHK");
  const param = newer ? "ARMING_SKIPCHK" : "ARMING_CHECK";
  if (checks === "none") {
    out.push({
      id: "cfg-armcheck", area: "Configuration", severity: "warn",
      title: "Arming checks are disabled",
      detail: `${param} is ${p[param]}, so the autopilot will arm without verifying its own health. This hides exactly the problems that cause crashes and should only ever be used briefly on the bench.`,
      fix: newer ? "Set ARMING_SKIPCHK = 0 (skip none) before flying." : "Set ARMING_CHECK = 1 (All) before flying.",
      link: { to: "/params", label: `Open ${param}` },
    });
  } else if (checks === "some") {
    out.push({
      id: "cfg-armcheck", area: "Configuration", severity: "info",
      title: "Some arming checks are turned off",
      detail: `${param} is ${p[param]}, so some of the autopilot's own health checks are skipped before arming.`,
      fix: newer ? "Unless you know why each is skipped, set ARMING_SKIPCHK = 0." : "Unless you know why each is off, set ARMING_CHECK = 1 (All).",
      link: { to: "/params", label: `Open ${param}` },
    });
  }
  if (has("FRAME_CLASS") && p.FRAME_CLASS === 0) {
    out.push({
      id: "cfg-frame", area: "Configuration", severity: "warn",
      title: "Frame class is not set",
      detail: "FRAME_CLASS is 0, meaning no airframe is selected. The autopilot won't know your motor layout, so motors won't spin correctly.",
      fix: "Set FRAME_CLASS and FRAME_TYPE to match your airframe (e.g. Quad / X).",
      link: { to: "/vehicle", label: "Open vehicle config" },
    });
  }
  if (has("MOT_THST_HOVER")) {
    const h = p.MOT_THST_HOVER;
    if (h > 0 && h < 0.18) {
      out.push({
        id: "cfg-overpower", area: "Configuration", severity: "info", metric: `hover ${one(2, h)}`,
        title: "Aircraft looks over-powered",
        detail: `Learned hover throttle is ${one(2, h)} (${one(0, h * 100)}%). Very low hover throttle means lots of spare thrust — it can feel twitchy and be harder to tune smoothly.`,
        fix: "Consider larger/heavier props or a bigger battery for a hover point nearer 0.25–0.35, or expect to soften the tune.",
      });
    } else if (h > 0.55) {
      out.push({
        id: "cfg-underpower", area: "Configuration", severity: "warn", metric: `hover ${one(2, h)}`,
        title: "Aircraft looks under-powered",
        detail: `Learned hover throttle is ${one(2, h)} (${one(0, h * 100)}%). Hovering above ~55% leaves little headroom to climb or recover, and the motors run hot.`,
        fix: "Reduce all-up weight, or move to higher-thrust motors/props, so hover sits nearer 0.3.",
      });
    }
  }
  return out;
}

// Map a raw pre-arm status string to a friendly cause + fix.
const PREARM_RULES: { match: RegExp; title: string; detail: string; fix: string; link?: Finding["link"] }[] = [
  { match: /compass not calibrated|compass.*calibrat/i, title: "Compass needs calibration", detail: "The autopilot won't arm because the compass isn't calibrated (or the compass count changed).", fix: "Run compass calibration.", link: { to: "/calibration", label: "Calibrate compass" } },
  { match: /compasses inconsistent|compass.*inconsistent/i, title: "Compasses disagree", detail: "Two compasses report different headings or field strengths.", fix: "Move away from metal, recalibrate, or disable the internal compass (COMPASS_USE2 = 0).", link: { to: "/calibration", label: "Calibrate compass" } },
  { match: /check mag field|mag field/i, title: "Magnetic field out of range", detail: "The measured field strength is too high or too low — usually nearby metal or interference.", fix: "Move the aircraft away from metal/rebar and recalibrate the compass.", link: { to: "/calibration", label: "Calibrate compass" } },
  { match: /compass offsets too high|offsets too high/i, title: "Compass offsets too high", detail: "Calibration offsets exceed the limit, indicating magnetic interference.", fix: "Relocate the compass away from power wiring and recalibrate.", link: { to: "/calibration", label: "Calibrate compass" } },
  { match: /3d accel|accel calibration|accels calibrated/i, title: "Accelerometer needs calibration", detail: "The accelerometer isn't calibrated (or a reboot is required after calibrating).", fix: "Run accel/level calibration, then reboot.", link: { to: "/calibration", label: "Calibrate accel & level" } },
  { match: /gyros? (not calibrated|inconsistent|not healthy)/i, title: "Gyro problem", detail: "A gyro failed calibration, disagrees with another, or isn't reporting.", fix: "Reboot and keep the vehicle completely still while it calibrates.", link: { to: "/calibration", label: "Open calibration" } },
  { match: /bad fix|waiting for home|need.*position|gps/i, title: "GPS not ready", detail: "The autopilot is waiting for a good GPS fix / home position.", fix: "Go outside with a clear sky view and wait for a 3D fix with 10+ satellites." },
  { match: /ekf|variance/i, title: "EKF not happy", detail: "The state estimator isn't confident enough to arm — usually GPS, compass or vibration related.", fix: "Wait for a solid GPS fix; check compass and vibration.", link: { to: "/preflight", label: "See estimator health" } },
  { match: /rc not calibrated|rc.*calibrat|radio/i, title: "RC needs calibration", detail: "Radio calibration is missing or the receiver isn't reporting.", fix: "Turn on the transmitter and run radio calibration.", link: { to: "/calibration", label: "Calibrate radio" } },
  { match: /battery|voltage/i, title: "Battery check failed", detail: "The pack is below the arming voltage/capacity, or the monitor is unhealthy.", fix: "Charge or swap the battery and check the power module wiring." },
  { match: /baro|barometer/i, title: "Barometer problem", detail: "The barometer isn't healthy or hasn't settled.", fix: "Reboot; if it persists, suspect a hardware fault." },
];

function checkPrearm(c: DiagContext): Finding[] {
  // Look at recent vehicle status messages that mention pre-arm / arming.
  const recent = c.events.filter((e) => c.now - e.at < 30000 && /prearm|pre-arm|arm/i.test(e.text));
  if (!recent.length) return [];
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const e of recent.slice(-12).reverse()) {
    const rule = PREARM_RULES.find((r) => r.match.test(e.text));
    const key = rule ? rule.title : e.text;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rule) {
      out.push({ id: `prearm-${key}`, area: "Pre-arm", severity: "warn", metric: e.text, title: rule.title, detail: rule.detail, fix: rule.fix, link: rule.link });
    } else {
      out.push({ id: `prearm-raw-${e.id}`, area: "Pre-arm", severity: "warn", metric: e.text, title: "Pre-arm check failed", detail: `The autopilot reported: “${e.text}”.`, fix: "Resolve the condition it names, then try arming again." });
    }
    if (out.length >= 5) break;
  }
  return out;
}

const CHECKS = [checkEstimation, checkVibration, checkCompass, checkGps, checkPower, checkSensors, checkConfig, checkPrearm];

export function runDiagnostics(c: DiagContext): Finding[] {
  const findings = CHECKS.flatMap((fn) => fn(c));
  return findings.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

export interface DiagSummary {
  critical: number;
  warn: number;
  info: number;
  ok: number;
  score: number; // 0–100 health score
  verdict: "grounded" | "caution" | "ready" | "unknown";
}

export function summarize(findings: Finding[]): DiagSummary {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  const info = findings.filter((f) => f.severity === "info").length;
  const ok = findings.filter((f) => f.severity === "ok").length;
  const graded = critical + warn + ok;
  const score = graded === 0 ? 0 : Math.round(((ok + warn * 0.5) / graded) * 100);
  const verdict: DiagSummary["verdict"] = graded === 0 ? "unknown" : critical > 0 ? "grounded" : warn > 0 ? "caution" : "ready";
  return { critical, warn, info, ok, score, verdict };
}
