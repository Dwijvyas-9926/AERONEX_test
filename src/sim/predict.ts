import { derive, type Airframe } from "./airframe";
import { CMD, MODE, MODE_NAME, type Home, type MissionItem, type SimEvent } from "./autopilot";
import type { Params } from "./params";
import { euler, type Environment } from "./physics";
import { VirtualVehicle } from "./vehicle";
import type { Terrain } from "./terrain";

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

export type Verdict = "completed" | "came-home" | "landed-away" | "crashed" | "holding" | "timeout" | "refused" | "grounded" | "stuck" | "flew-away";

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
    /** Least height above the ground while travelling, m; null if it never travelled. */
    minClearanceM: number | null;
    /** Height of the ground where the flight ended, m above home. */
    endGroundM: number;
    reached: number[];
    commands: number;
  };
}

const LIMIT_S = 45 * 60;

export function predict(airframe: Airframe, params: Params, home: Home, mission: MissionItem[], sc: Scenario, seed = 7, terrain?: Terrain): Prediction {
  const v = new VirtualVehicle({ airframe, home, params, soc: sc.soc, seed, terrain });
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
  const stats = { durationS: 0, distanceM: 0, maxAltM: 0, maxSpeed: 0, maxLeanDeg: 0, atLeanLimitS: 0, maxThrottle: 0, usedMah: 0, endSoc: sc.soc, minVolts: Infinity, maxAmps: 0, endN: 0, endE: 0, impact: 0, minClearanceM: null as number | null, endGroundM: 0, reached, commands: Math.max(0, mission.length - 1) };
  const startMah = v.phys.s.usedMah;
  const finish = (verdict: Verdict, headline: string): Prediction => {
    const s = v.phys.s;
    stats.durationS = s.t;
    stats.usedMah = s.usedMah - startMah;
    stats.endSoc = Math.max(0, v.phys.soc);
    stats.endN = s.pos[0];
    stats.endE = s.pos[1];
    stats.impact = s.lastImpact;
    stats.endGroundM = v.phys.ground(s.pos[0], s.pos[1]);
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
  let progress = { key: "", best: Infinity, since: 0 };
  let idleSince: number | null = null;
  // The highest it should ever need to be.
  const ceiling = Math.max(v.ap.params.RTL_ALT / 100, ...mission.slice(1).map((m) => (m.frame === 0 ? m.z - home.altMsl : m.z)), 0);
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
    // Travelling under control: a landing, wherever it happens, is not a near miss.
    if (!s.onGround && v.ap.goal !== null && v.ap.mode !== MODE.LAND && Math.hypot(s.vel[0], s.vel[1]) > 2) {
      const agl = alt - v.phys.ground(s.pos[0], s.pos[1]);
      stats.minClearanceM = Math.min(stats.minClearanceM ?? Infinity, agl);
    }
    if (!s.onGround) {
      const lean = (Math.acos(Math.max(-1, Math.min(1, Math.cos(e.roll) * Math.cos(e.pitch)))) * 180) / Math.PI;
      stats.maxLeanDeg = Math.max(stats.maxLeanDeg, lean);
      if (lean > v.ap.params.ANGLE_MAX / 100 - 1.5) stats.atLeanLimitS += STEP;
      stats.maxThrottle = Math.max(stats.maxThrottle, v.ap.throttleOut);
      stats.minVolts = Math.min(stats.minVolts, s.volts);
      stats.maxAmps = Math.max(stats.maxAmps, s.amps);
    }
    if (Math.round(t / STEP) % 5 === 0) track.push({ t: s.t, n: s.pos[0], e: s.pos[1], alt, mode: v.ap.mode, soc: v.phys.soc, volts: s.volts });

    const off = Math.hypot(s.pos[0], s.pos[1]);
    const all = reached.length >= stats.commands;
    const here = { t: s.t, n: s.pos[0], e: s.pos[1], alt, mode: v.ap.mode, soc: v.phys.soc, volts: s.volts };

    if (!v.ap.armed) {
      track.push(here);
      if (s.crashed) {
        const groundM = v.phys.ground(s.pos[0], s.pos[1]);
        const deadMotor = sc.faults.find((f) => f.kind === "motor" && (f.level ?? 0) < 0.45);
        const cause =
          v.phys.soc <= 0.01
            ? "the battery ran flat"
            : s.crashWhy === "water"
              ? "it came down in the water"
              : deadMotor && pendingFaults.some((f) => f.kind === "motor" && f.done)
                ? `it could not fly with motor ${deadMotor.motor ?? 1} at ${Math.round((deadMotor.level ?? 0) * 100)}% thrust`
                : v.ap.failsafes.has("control")
                  ? "it lost control of its attitude"
                  : groundM > 1.5 && v.ap.mode !== MODE.LAND
                    ? `it flew into rising ground, ${groundM.toFixed(0)} m above home`
                    : stats.maxThrottle > 0.985 && derive(airframe).thrustToWeight < 1.5
                      ? "it did not have the thrust to hold its height and sank into the ground"
                      : s.crashWhy === "sliding"
                        ? `it touched down drifting sideways at ${s.lastSlide.toFixed(0)} m/s and went over`
                        : `it hit the ground at ${s.lastImpact.toFixed(1)} m/s`;
        return finish("crashed", `It crashed ${Math.round(off)} m from home after ${clock(s.t)}: ${cause}.`);
      }
      // It never flew: a mission that cannot start is not a flight that came home.
      if (stats.maxAltM < 0.5) {
        const why = v.events.some((e) => e.kind === "mission-error")
          ? "the mission has no take-off command before its first waypoint"
          : v.events.some((e) => e.kind === "grounded")
            ? "it could not lift off"
            : "it sat armed on the ground and disarmed itself";
        return finish("refused", `It never left the ground: ${why}.`);
      }
      // Every command done is a completed mission, whatever warnings came with it.
      if (all) return finish("completed", off < 5 ? `It flew the whole mission and landed at home in ${clock(s.t)}.` : `It flew the whole mission and landed ${Math.round(off)} m from home in ${clock(s.t)}.`);
      if (off < 5) return finish("came-home", `It came home and landed after ${clock(s.t)}, without finishing the mission.`);
      return finish("landed-away", `It landed ${Math.round(off)} m from home after ${clock(s.t)}, without finishing the mission.`);
    }

    // Full throttle and still on the ground.
    if (v.events.some((e) => e.kind === "grounded")) {
      track.push(here);
      if (stats.maxAltM > 1) {
        return finish("stuck", `It got to ${Math.round(stats.maxAltM)} m, could not hold its height, and sank back to the ground ${Math.round(off)} m from home, where it sits at full throttle.`);
      }
      const d = derive(airframe);
      const sag = s.volts < airframe.cells * 3.1;
      return finish(
        "grounded",
        sag
          ? `It cannot take off: at full throttle the battery sags to ${s.volts.toFixed(1)} V and the motors have nothing left. The pack is too small for this aircraft.`
          : `It cannot take off: four motors make ${((4 * airframe.motorMaxThrustN) / 9.80665).toFixed(1)} kg of thrust and the aircraft weighs ${airframe.massKg.toFixed(1)} kg${d.thrustToWeight >= 1 ? ", which leaves nothing once the battery sags under load" : ""}.`,
      );
    }

    // Gone: far above anything it was asked to do.
    if (alt > ceiling + 150) {
      track.push(here);
      return finish("flew-away", `It climbed away to ${Math.round(alt)} m and was still going up after ${clock(s.t)}: it cannot descend.`);
    }

    // No headway: the same leg, and no nearer its end than a minute and a half ago.
    const g = v.ap.goal;
    const key = g ? `${v.ap.mode}:${v.ap.missionSeq}:${g.n.toFixed(0)}:${g.e.toFixed(0)}:${g.alt.toFixed(0)}` : "";
    if (!g || key !== progress.key) progress = { key, best: Infinity, since: t };
    if (g) {
      const left = Math.hypot(g.n - s.pos[0], g.e - s.pos[1], g.alt - alt);
      if (left < progress.best - 2) progress = { key, best: left, since: t };
      if (t - progress.since > 90) {
        track.push(here);
        const climbing = Math.abs(g.alt - alt) > Math.hypot(g.n - s.pos[0], g.e - s.pos[1]);
        return finish(
          "stuck",
          climbing
            ? `It could not climb: after ${clock(s.t)} it was still ${Math.round(Math.abs(g.alt - alt))} m short of the height asked for, at ${Math.round(v.ap.throttleOut * 100)}% throttle.`
            : `It could not make headway: after ${clock(s.t)} it was still ${Math.round(left)} m from where it was going${sc.windSpeed > 0 ? `, against ${sc.windSpeed.toFixed(0)} m/s of wind` : ""}. It would stay there until a failsafe or the battery ended the flight.`,
        );
      }
    }

    // Handed to a pilot who is not there: a mode that waits for stick input.
    const waiting = v.ap.mode === MODE.ALT_HOLD || v.ap.mode === MODE.LOITER || v.ap.mode === MODE.STABILIZE || v.ap.mode === MODE.BRAKE;
    idleSince = waiting && !s.onGround ? (idleSince ?? t) : null;
    if (idleSince !== null && t - idleSince > 30) {
      track.push(here);
      return finish("holding", `It is in ${MODE_NAME[v.ap.mode]} ${Math.round(off)} m from home, ${v.gpsOk ? "holding there" : "holding height and drifting with the wind"}, and will stay up until a pilot takes over or the battery runs out.`);
    }

    // A mission with nothing after its last waypoint hovers there until told otherwise.
    const done = v.ap.mode === MODE.AUTO && all;
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
  const flew = verdict !== "refused" && verdict !== "grounded";
  for (const n of v.paramNotes) out.push({ sev: "warn", text: n });
  if (verdict === "grounded") {
    out.push({ sev: "bad", text: `Thrust to weight is ${d.thrustToWeight.toFixed(2)} : 1. An aircraft needs about 2 : 1 to fly properly, and more than 1.3 : 1 to leave the ground at all once the battery sags. Lighten it, or fit larger motors or propellers.` });
  } else if (d.thrustToWeight < 1.5) {
    out.push({ sev: "bad", text: `Thrust to weight is only ${d.thrustToWeight.toFixed(2)} : 1. It will climb slowly, lose height when it leans, and has nothing in hand for wind. Aim for 2 : 1 or more.` });
  } else if (d.thrustToWeight > 12) {
    out.push({ sev: "warn", text: `Thrust to weight is ${d.thrustToWeight.toFixed(0)} : 1, far beyond any real aircraft. Check the weight and the thrust of one motor.` });
  }
  if (verdict === "flew-away") {
    out.push(
      p.MOT_SPIN_MIN >= d.hoverThrottle * 0.9
        ? { sev: "bad", text: `The lowest the motors are allowed to run (MOT_SPIN_MIN, ${p.MOT_SPIN_MIN}) is at or above the throttle that hovers this aircraft (about ${d.hoverThrottle.toFixed(2)}). It can only go up. Set MOT_SPIN_MIN well below the hover throttle.` }
        : { sev: "bad", text: "The height controller is not holding height. Check PSC_POSZ_P, PSC_VELZ_P, PSC_ACCZ_P and PSC_ACCZ_I, and that MOT_THST_HOVER is near the real hover throttle." },
    );
  }
  if (verdict === "stuck" && sc.windSpeed > 0) out.push({ sev: "bad", text: `The wind is at or beyond what this aircraft can fly against at a ${(p.ANGLE_MAX / 100).toFixed(0)}° lean. Do not fly it in ${sc.windSpeed.toFixed(0)} m/s.` });

  if (fired("fs-batt-critical")) out.push({ sev: "bad", text: "The critical battery failsafe fired. The pack is too small for this flight in these conditions." });
  else if (fired("fs-batt-low")) out.push({ sev: "warn", text: `The low battery failsafe fired and ${p.BATT_FS_LOW_ACT === 0 ? "only warned, because BATT_FS_LOW_ACT is 0" : "took over the flight"}.` });
  if (flew && verdict !== "crashed" && st.endSoc < 0.2) out.push({ sev: st.endSoc < 0.1 ? "bad" : "warn", text: `It finished with ${Math.round(st.endSoc * 100)}% of the battery. Under 20% leaves no reserve for wind or a second approach.` });
  if (flew && st.endSoc >= 0.2 && verdict !== "crashed") out.push({ sev: "ok", text: `Battery: used ${Math.round(st.usedMah)} mAh and finished with ${Math.round(st.endSoc * 100)}%.` });
  if (flew && Number.isFinite(st.minVolts) && st.minVolts / af.cells < 3.3) out.push({ sev: "warn", text: `Voltage sagged to ${(st.minVolts / af.cells).toFixed(2)} V per cell under load. Below 3.3 V damages a LiPo.` });

  if (verdict === "crashed" && st.endGroundM > 1.5 && v.phys.soc > 0.01 && !fired("loss-of-control")) {
    out.push({ sev: "bad", text: `The ground there is ${st.endGroundM.toFixed(0)} m above home. Mission heights are measured from home, not from the ground below, so a waypoint or a return that is high enough at home can be too low over a hill.` });
  } else if (st.minClearanceM !== null && st.minClearanceM < 8 && verdict !== "crashed") {
    out.push({ sev: st.minClearanceM < 4 ? "bad" : "warn", text: `It passed within ${Math.max(0, st.minClearanceM).toFixed(0)} m of the ground on the way. Trees are not simulated: leave at least 15 m.` });
  }
  if (fired("fs-fence")) out.push({ sev: "warn", text: `The geofence was breached${p.FENCE_ACTION === 0 ? " and only reported it, because FENCE_ACTION is 0" : p.FENCE_ACTION === 2 ? " and landed the aircraft where it was" : " and turned the aircraft back"}. Part of the route lies outside FENCE_RADIUS (${p.FENCE_RADIUS} m) or above FENCE_ALT_MAX (${p.FENCE_ALT_MAX} m).` });
  if (fired("fs-gcs")) out.push({ sev: "warn", text: "The ground-station failsafe fired when the link went quiet." });
  if (fired("fs-radio")) out.push({ sev: "warn", text: "The radio failsafe fired when the transmitter was lost." });
  if (fired("fs-ekf")) out.push({ sev: "bad", text: p.FS_EKF_ACTION === 2 ? "Position was lost and it switched to AltHold (FS_EKF_ACTION is 2): it holds its height but drifts with the wind until a pilot takes over." : "Position was lost. It landed without holding position, so the wind decided where it came down." });
  if (fired("loss-of-control")) out.push({ sev: "bad", text: sc.faults.some((f) => f.kind === "motor") ? "It lost control of its attitude. A quadcopter cannot fly on three motors." : "It lost control of its attitude with nothing broken: the attitude gains cannot keep it level. Check the ATC_RAT_ and ATC_ANG_ values." });
  if (fired("mission-skip")) out.push({ sev: "warn", text: "The mission contains commands the simulator does not fly; they were skipped." });

  if (flew && st.maxThrottle > 0.9 && d.thrustToWeight >= 1.5) out.push({ sev: "bad", text: `Throttle reached ${Math.round(st.maxThrottle * 100)}%. There is no thrust in reserve: the aircraft is too heavy or the wind too strong.` });
  else if (d.hoverThrottle > 0.6 && d.thrustToWeight >= 1.5) out.push({ sev: "warn", text: `It needs ${Math.round(d.hoverThrottle * 100)}% throttle just to hover. Aim for 50% or less.` });
  const limit = p.ANGLE_MAX / 100;
  // A moment at the limit is a hard stop or turn; many seconds is the wind winning.
  if (flew && st.atLeanLimitS > 12 && st.atLeanLimitS > 0.12 * st.durationS && !fired("loss-of-control")) out.push({ sev: "warn", text: `It spent ${Math.round(st.atLeanLimitS)} s leaning at its ${limit.toFixed(0)}° limit${sc.windSpeed >= 1 ? `, fighting ${sc.windSpeed.toFixed(0)} m/s of wind` : ""}. It was flying as hard as it is allowed to and could not hold the speed asked for.` });

  // Protection that is switched off is a finding even when nothing went wrong.
  if (p.BATT_FS_LOW_ACT === 0 && p.BATT_FS_CRT_ACT === 0) out.push({ sev: "warn", text: "No battery failsafe action is set (BATT_FS_LOW_ACT and BATT_FS_CRT_ACT are 0). A flat battery means a fall, not a landing." });
  else if (p.BATT_LOW_MAH === 0 && p.BATT_LOW_VOLT > 0 && p.BATT_LOW_VOLT < af.cells * 3.3) out.push({ sev: "warn", text: `BATT_LOW_VOLT is ${p.BATT_LOW_VOLT} V, which is ${(p.BATT_LOW_VOLT / af.cells).toFixed(2)} V per cell on this ${af.cells}S pack: too low to act in time.` });
  if (p.FS_GCS_ENABLE === 0) out.push({ sev: "warn", text: "The ground-station failsafe is off (FS_GCS_ENABLE is 0). If this app loses the link, the aircraft carries on regardless." });
  if (p.FENCE_ENABLE === 0) out.push({ sev: "warn", text: "No geofence is set (FENCE_ENABLE is 0)." });
  const last = mission[mission.length - 1];
  if (last && last.command !== CMD.RTL && last.command !== CMD.LAND) out.push({ sev: "warn", text: "The mission does not end with a return or a landing. It will hover at the last waypoint until someone takes over." });
  out.push({ sev: "ok", text: `A return home flies at ${(p.RTL_ALT / 100).toFixed(0)} m (RTL_ALT), or at its own height if it is already higher. Trees, buildings and wires are not modelled: check that clears everything on the way.` });

  const order = { bad: 0, warn: 1, ok: 2 };
  return out.sort((a, b) => order[a.sev] - order[b.sev]);
}
