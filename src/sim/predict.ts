import { derive, type Airframe } from "./airframe";
import { CMD, MODE, MODE_NAME, type Home, type MissionItem, type SimEvent } from "./autopilot";
import type { Params } from "./params";
import { euler, type Environment } from "./physics";
import { VirtualVehicle } from "./vehicle";

/*
  Fly a mission before it is flown.

  Runs the same virtual aircraft the live simulator uses, with no display and
  as fast as the computer allows, and reports what happened: whether it got
  round, what the battery had left, which failsafes fired and what they did.

  A fault can be scheduled — a motor, the GPS, the radio or the ground-station
  link — at a time or on reaching a waypoint, which is the question a mission
  plan cannot otherwise answer: not "does it work" but "what does it do when
  this breaks, there".
*/

export type FaultKind = "motor" | "gps" | "radio" | "gcs";

export interface FaultPlan {
  kind: FaultKind;
  /** Which motor (1–4), for a motor fault. */
  motor?: number;
  /** Thrust the motor has left, 0–1. */
  level?: number;
  /** When: seconds after take-off, or on reaching a mission item. */
  at: { time: number } | { waypoint: number };
}

export interface Scenario extends Environment {
  /** Battery state of charge at arming, 0–1. */
  soc: number;
  faults: FaultPlan[];
}

export interface TrackPoint {
  t: number;
  n: number;
  e: number;
  alt: number;
  mode: number;
  soc: number;
  volts: number;
}

export type Verdict = "completed" | "came-home" | "landed-away" | "crashed" | "holding" | "timeout" | "refused";

export interface Finding {
  sev: "ok" | "warn" | "bad";
  text: string;
}

export interface Prediction {
  verdict: Verdict;
  headline: string;
  findings: Finding[];
  track: TrackPoint[];
  events: SimEvent[];
  stats: {
    durationS: number;
    distanceM: number;
    maxAltM: number;
    maxSpeed: number;
    maxLeanDeg: number;
    /** Seconds spent leaning at the limit: the sign of fighting the wind. */
    atLeanLimitS: number;
    maxThrottle: number;
    usedMah: number;
    endSoc: number;
    minVolts: number;
    maxAmps: number;
    endN: number;
    endE: number;
    impact: number;
    reached: number[];
    commands: number;
  };
}

const LIMIT_S = 45 * 60;

export function predict(airframe: Airframe, params: Params, home: Home, mission: MissionItem[], sc: Scenario, seed = 7): Prediction {
  const v = new VirtualVehicle({ airframe, home, params, soc: sc.soc, seed });
  v.setScriptedGcs(true);
  v.phys.env = { windSpeed: sc.windSpeed, windFromDeg: sc.windFromDeg, gust: sc.gust };
  v.ap.mission = mission.map((m) => ({ ...m }));
  const reached: number[] = [];
  const pendingFaults = sc.faults.map((f) => ({ ...f, done: false }));
  const apply = (f: FaultPlan) => {
    if (f.kind === "motor") {
      v.phys.faults.motor[Math.max(0, Math.min(3, (f.motor ?? 1) - 1))] = f.level ?? 0;
      v.ap.log("warn", `Injected: motor ${f.motor ?? 1} at ${Math.round((f.level ?? 0) * 100)}% thrust`, "inject");
    } else if (f.kind === "gps") {
      v.gpsOk = false;
      v.ap.log("warn", "Injected: GPS lost", "inject");
    } else if (f.kind === "radio") {
      v.rcOk = false;
      v.ap.log("warn", "Injected: radio transmitter lost", "inject");
    } else {
      v.setScriptedGcs(false);
      v.ap.log("warn", "Injected: ground station link lost", "inject");
    }
  };
  v.ap.onReached = (seq) => {
    reached.push(seq);
    for (const f of pendingFaults) {
      if (!f.done && "waypoint" in f.at && f.at.waypoint === seq) {
        f.done = true;
        apply(f);
      }
    }
  };

  const track: TrackPoint[] = [];
  const stats = { durationS: 0, distanceM: 0, maxAltM: 0, maxSpeed: 0, maxLeanDeg: 0, atLeanLimitS: 0, maxThrottle: 0, usedMah: 0, endSoc: sc.soc, minVolts: Infinity, maxAmps: 0, endN: 0, endE: 0, impact: 0, reached, commands: Math.max(0, mission.length - 1) };
  const startMah = v.phys.s.usedMah;
  const finish = (verdict: Verdict, headline: string): Prediction => {
    const s = v.phys.s;
    stats.durationS = s.t;
    stats.usedMah = s.usedMah - startMah;
    stats.endSoc = Math.max(0, v.phys.soc);
    stats.endN = s.pos[0];
    stats.endE = s.pos[1];
    stats.impact = s.lastImpact;
    if (!Number.isFinite(stats.minVolts)) stats.minVolts = s.volts;
    return { verdict, headline, findings: findings(v, airframe, verdict, stats, sc, mission), track, events: v.events.slice(), stats };
  };

  // The same sequence a pilot would use: Guided, arm, Auto, start.
  v.ap.setMode(MODE.GUIDED, v.inputs());
  const why = v.ap.arm(v.inputs());
  if (why.length) return finish("refused", `It would refuse to arm: ${why[0]}.`);
  if (!v.ap.setMode(MODE.AUTO, v.inputs()) || !v.ap.startMission()) return finish("refused", "It would not start the mission: there is no mission to fly.");

  let lastN = 0;
  let lastE = 0;
  let holdingSince: number | null = null;
  const STEP = 0.1;
  for (let t = 0; t < LIMIT_S; t += STEP) {
    for (const f of pendingFaults) {
      if (!f.done && "time" in f.at && t >= f.at.time) {
        f.done = true;
        apply(f);
      }
    }
    v.advance(STEP, STEP, false);
    const s = v.phys.s;
    const e = euler(s.q);
    const alt = -s.pos[2];
    stats.distanceM += Math.hypot(s.pos[0] - lastN, s.pos[1] - lastE);
    lastN = s.pos[0];
    lastE = s.pos[1];
    stats.maxAltM = Math.max(stats.maxAltM, alt);
    stats.maxSpeed = Math.max(stats.maxSpeed, Math.hypot(s.vel[0], s.vel[1]));
    if (!s.onGround) {
      const lean = (Math.acos(Math.max(-1, Math.min(1, Math.cos(e.roll) * Math.cos(e.pitch)))) * 180) / Math.PI;
      stats.maxLeanDeg = Math.max(stats.maxLeanDeg, lean);
      if (lean > v.ap.params.ANGLE_MAX / 100 - 1.5) stats.atLeanLimitS += STEP;
      stats.maxThrottle = Math.max(stats.maxThrottle, v.ap.throttleOut);
      stats.minVolts = Math.min(stats.minVolts, s.volts);
      stats.maxAmps = Math.max(stats.maxAmps, s.amps);
    }
    if (Math.round(t / STEP) % 5 === 0) track.push({ t: s.t, n: s.pos[0], e: s.pos[1], alt, mode: v.ap.mode, soc: v.phys.soc, volts: s.volts });

    if (!v.ap.armed) {
      track.push({ t: s.t, n: s.pos[0], e: s.pos[1], alt, mode: v.ap.mode, soc: v.phys.soc, volts: s.volts });
      const off = Math.hypot(s.pos[0], s.pos[1]);
      if (s.crashed) {
        const cause =
          v.phys.soc <= 0.01
            ? "the battery ran flat"
            : v.ap.failsafes.has("control")
              ? "it lost control"
              : s.crashWhy === "sliding"
                ? `it touched down drifting sideways at ${s.lastSlide.toFixed(0)} m/s and went over`
                : "it hit the ground too hard";
        return finish("crashed", `It crashed ${Math.round(off)} m from home after ${clock(s.t)}: ${cause}.`);
      }
      const all = reached.length >= stats.commands;
      if (off < 5) return finish(all && v.ap.failsafes.size === 0 ? "completed" : "came-home", all && v.ap.failsafes.size === 0 ? `It flew the whole mission and landed at home in ${clock(s.t)}.` : `It came home and landed after ${clock(s.t)}, without finishing the mission.`);
      return finish(all && v.ap.failsafes.size === 0 ? "completed" : "landed-away", all && v.ap.failsafes.size === 0 ? `It flew the whole mission and landed ${Math.round(off)} m from home in ${clock(s.t)}.` : `It landed ${Math.round(off)} m from home after ${clock(s.t)}, without finishing the mission.`);
    }
    // A mission with nothing after its last waypoint hovers there until told otherwise.
    const done = v.ap.mode === MODE.AUTO && reached.length >= stats.commands;
    holdingSince = done ? (holdingSince ?? t) : null;
    if (holdingSince !== null && t - holdingSince > 20) {
      return finish("holding", `It flew every waypoint in ${clock(v.phys.s.t - 20)} and is hovering at the last one: the mission has no landing or return at the end.`);
    }
  }
  return finish("timeout", `It was still flying after ${LIMIT_S / 60} minutes in ${MODE_NAME[v.ap.mode] ?? "an unknown mode"}.`);
}

const clock = (s: number) => `${Math.floor(s / 60)} min ${String(Math.round(s % 60)).padStart(2, "0")} s`;

/** What the run says about the plan, in plain words, worst first. */
function findings(v: VirtualVehicle, af: Airframe, verdict: Verdict, st: Prediction["stats"], sc: Scenario, mission: MissionItem[]): Finding[] {
  const out: Finding[] = [];
  const p = v.ap.params;
  const d = derive(af);
  const fired = (k: string) => v.events.some((e) => e.kind === k);
  const flew = verdict !== "refused";

  if (fired("fs-batt-critical")) out.push({ sev: "bad", text: "The critical battery failsafe fired. The pack is too small for this flight in these conditions." });
  else if (fired("fs-batt-low")) out.push({ sev: "warn", text: `The low battery failsafe fired and ${p.BATT_FS_LOW_ACT === 0 ? "only warned, because BATT_FS_LOW_ACT is 0" : "took over the flight"}.` });
  if (flew && verdict !== "crashed" && st.endSoc < 0.2) out.push({ sev: st.endSoc < 0.1 ? "bad" : "warn", text: `It finished with ${Math.round(st.endSoc * 100)}% of the battery. Under 20% leaves no reserve for wind or a second approach.` });
  if (flew && st.endSoc >= 0.2 && verdict !== "crashed") out.push({ sev: "ok", text: `Battery: used ${Math.round(st.usedMah)} mAh and finished with ${Math.round(st.endSoc * 100)}%.` });
  if (flew && Number.isFinite(st.minVolts) && st.minVolts / af.cells < 3.3) out.push({ sev: "warn", text: `Voltage sagged to ${(st.minVolts / af.cells).toFixed(2)} V per cell under load. Below 3.3 V damages a LiPo.` });

  if (fired("fs-fence")) out.push({ sev: "warn", text: "The geofence was breached and turned the aircraft back. Part of the route lies outside FENCE_RADIUS or above FENCE_ALT_MAX." });
  if (fired("fs-gcs")) out.push({ sev: "warn", text: "The ground-station failsafe fired when the link went quiet." });
  if (fired("fs-radio")) out.push({ sev: "warn", text: "The radio failsafe fired when the transmitter was lost." });
  if (fired("fs-ekf")) out.push({ sev: "bad", text: "Position was lost. It landed without holding position, so the wind decided where it came down." });
  if (fired("loss-of-control")) out.push({ sev: "bad", text: "It lost control of its attitude. A quadcopter cannot fly on three motors." });
  if (fired("mission-skip")) out.push({ sev: "warn", text: "The mission contains commands the simulator does not fly; they were skipped." });

  if (flew && st.maxThrottle > 0.9) out.push({ sev: "bad", text: `Throttle reached ${Math.round(st.maxThrottle * 100)}%. There is no thrust in reserve: the aircraft is too heavy or the wind too strong.` });
  else if (d.hoverThrottle > 0.6) out.push({ sev: "warn", text: `It needs ${Math.round(d.hoverThrottle * 100)}% throttle just to hover. Aim for 50% or less.` });
  const limit = p.ANGLE_MAX / 100;
  // A moment at the limit is a hard stop or turn; many seconds is the wind winning.
  if (flew && st.atLeanLimitS > 6 && !fired("loss-of-control")) out.push({ sev: "warn", text: `It spent ${Math.round(st.atLeanLimitS)} s leaning at its ${limit.toFixed(0)}° limit. It could not hold the speed asked for against ${sc.windSpeed.toFixed(0)} m/s of wind.` });

  // Protection that is switched off is a finding even when nothing went wrong.
  if (p.BATT_FS_LOW_ACT === 0 && p.BATT_FS_CRT_ACT === 0) out.push({ sev: "warn", text: "No battery failsafe action is set (BATT_FS_LOW_ACT and BATT_FS_CRT_ACT are 0). A flat battery means a fall, not a landing." });
  else if (p.BATT_LOW_MAH === 0 && p.BATT_LOW_VOLT > 0 && p.BATT_LOW_VOLT < af.cells * 3.3) out.push({ sev: "warn", text: `BATT_LOW_VOLT is ${p.BATT_LOW_VOLT} V, which is ${(p.BATT_LOW_VOLT / af.cells).toFixed(2)} V per cell on this ${af.cells}S pack: too low to act in time.` });
  if (p.FS_GCS_ENABLE === 0) out.push({ sev: "warn", text: "The ground-station failsafe is off (FS_GCS_ENABLE is 0). If this app loses the link, the aircraft carries on regardless." });
  if (p.FENCE_ENABLE === 0) out.push({ sev: "warn", text: "No geofence is set (FENCE_ENABLE is 0)." });
  const last = mission[mission.length - 1];
  if (last && last.command !== CMD.RTL && last.command !== CMD.LAND) out.push({ sev: "warn", text: "The mission does not end with a return or a landing. It will hover at the last waypoint until someone takes over." });
  out.push({ sev: "ok", text: `A return home flies at ${(p.RTL_ALT / 100).toFixed(0)} m (RTL_ALT), or at its own height if it is already higher. The simulator has no terrain: check that clears everything on the way.` });

  const order = { bad: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}
