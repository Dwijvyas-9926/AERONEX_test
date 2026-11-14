import { expect, it } from "vitest";
import { derive, PRESETS, type Airframe } from "../airframe";
import { type MissionItem } from "../autopilot";
import { defaultParams } from "../params";
import { predict, type Scenario } from "../predict";
import { makeTerrain } from "../terrain";
import { planToMission, type PlanPoint } from "../../state/simStore";

const HOME = { lat: 23.0225, lon: 72.5714, altMsl: 53 };
const calm: Scenario = { windSpeed: 0, windFromDeg: 0, gust: 0, soc: 1, faults: [] };
const pts = (list: [number, number, number][]): PlanPoint[] => list.map(([n, e, alt], i) => ({ id: `p${i}`, n, e, alt, holdS: 0 }));
const square = pts([[80, 0, 20], [80, 80, 20], [0, 80, 20]]);

/*
  A sweep of the simulator across the ways an aircraft, a plan or its settings
  can be wrong: too heavy, too little battery, too much wind, nonsense
  parameters, broken missions, things failing in flight.

  Every case has to end with a verdict, quickly, in real numbers. A prediction
  that runs to the time limit, or reports NaN, has told the pilot nothing.
*/
it("ends every flight with a verdict, in real numbers, however wrong the inputs", () => {
  const out: string[] = [];
  const verdicts: Record<string, { verdict: string; headline: string; findings: string }> = {};
  const run = (label: string, af: Airframe, params: Record<string, number>, mission: MissionItem[], sc: Scenario, terrain = makeTerrain("flat")) => {
    const t0 = performance.now();
    let r;
    try {
      r = predict(af, { ...defaultParams(af), ...params }, HOME, mission, sc, 7, terrain);
    } catch (e) {
      out.push(`${label}: threw ${(e as Error).message}`);
      return;
    }
    const ms = performance.now() - t0;
    const s = r.stats;
    const nums = [s.durationS, s.distanceM, s.maxAltM, s.maxSpeed, s.maxLeanDeg, s.maxThrottle, s.usedMah, s.endSoc, s.minVolts, s.maxAmps, s.endN, s.endE];
    const bad: string[] = [];
    if (nums.some((x) => !Number.isFinite(x))) bad.push("NaN/inf in stats");
    if (r.track.some((p) => !Number.isFinite(p.n + p.e + p.alt))) bad.push("NaN in track");
    if (s.maxSpeed > 60) bad.push(`speed ${s.maxSpeed.toFixed(0)}`);
    if (s.maxAltM > 2000) bad.push(`alt ${s.maxAltM.toFixed(0)}`);
    if (s.endSoc < 0 || s.endSoc > 1) bad.push(`soc ${s.endSoc}`);
    if (s.minVolts < 0) bad.push("negative volts");
    if (ms > 6000) bad.push(`slow ${ms.toFixed(0)}ms`);
    if (r.findings.length === 0) bad.push("no findings");
    if (r.verdict === "timeout") bad.push("ran to the time limit");
    verdicts[label] = { verdict: r.verdict, headline: r.headline, findings: r.findings.map((f) => f.text).join(" | ") };
    if (bad.length) out.push(`${label}: ${bad.join("; ")}`);
    return;

  };
  const m = (p: PlanPoint[], end: "rtl" | "land" | "hold" = "rtl", takeoff = 20) => planToMission(HOME, takeoff, p, end);
  const base = PRESETS[0];

  // ---- weight and thrust
  for (const mass of [1.5, 2.5, 3.0, 3.3, 3.5, 3.6, 3.7, 4.0, 6]) run(`mass ${mass} kg (T/W ${(derive({ ...base, massKg: mass }).thrustToWeight).toFixed(2)})`, { ...base, massKg: mass }, {}, m(square), calm);
  run("mass 3.4 kg + 30% battery", { ...base, massKg: 3.4 }, {}, m(square), { ...calm, soc: 0.3 });
  run("mass 3.2 kg + 10 m/s wind", { ...base, massKg: 3.2 }, {}, m(square), { ...calm, windSpeed: 10, gust: 0.5 });
  run("featherweight 0.2 kg", { ...base, massKg: 0.2 }, {}, m(square), calm);
  run("thrust tiny 100 g/motor", { ...base, motorMaxThrustN: 0.98 }, {}, m(square), calm);
  run("thrust huge 20 kg/motor", { ...base, motorMaxThrustN: 196 }, {}, m(square), calm);

  // ---- every preset, each landscape
  for (const af of PRESETS) for (const k of ["flat", "hills", "highlands"] as const) run(`${af.name.slice(0, 22)} ${k}`, af, {}, m(pts([[150, 0, 30], [150, 200, 30], [-100, 200, 30]])), calm, makeTerrain(k));

  // ---- battery
  for (const soc of [1, 0.5, 0.2, 0.1, 0.05, 0.01]) run(`start charge ${soc * 100}%`, base, {}, m(pts([[400, 0, 30], [400, 400, 30]])), { ...calm, soc });
  run("capacity 100 mAh", { ...base, capacityMah: 100 }, {}, m(square), calm);
  run("1 cell", { ...base, cells: 1 }, {}, m(square), calm);
  run("14 cells", { ...base, cells: 14 }, {}, m(square), calm);
  run("batt failsafe land", base, { BATT_LOW_MAH: 4000, BATT_FS_LOW_ACT: 1, BATT_LOW_VOLT: 0 }, m(pts([[400, 0, 30], [400, 400, 30]])), calm);
  run("batt failsafe rtl + crt land", base, { BATT_LOW_MAH: 4200, BATT_FS_LOW_ACT: 2, BATT_CRT_MAH: 3800, BATT_FS_CRT_ACT: 1, BATT_LOW_VOLT: 0 }, m(pts([[900, 0, 30], [900, 900, 30]])), calm);
  run("BATT_ARM_VOLT blocks arming", base, { BATT_ARM_VOLT: 13 }, m(square), calm);

  // ---- wind
  for (const w of [5, 10, 14, 18, 25, 30]) run(`wind ${w} m/s gusting`, base, {}, m(square), { ...calm, windSpeed: w, windFromDeg: 45, gust: 0.4 });
  run("wind 12 on 5-inch", PRESETS[1], {}, m(square), { ...calm, windSpeed: 12, gust: 0.5 });

  // ---- mission shapes
  run("no waypoints, rtl", base, {}, m([], "rtl"), calm);
  run("no waypoints, hold", base, {}, m([], "hold"), calm);
  run("waypoint at home", base, {}, m(pts([[0, 0, 20]])), calm);
  run("two identical waypoints", base, {}, m(pts([[50, 50, 20], [50, 50, 20]])), calm);
  run("takeoff 2 m, wp 2 m", base, {}, m(pts([[60, 0, 2]]), "rtl", 2), calm);
  run("takeoff 500 m", base, {}, m(pts([[60, 0, 500]]), "rtl", 500), calm);
  run("wp lower than takeoff", base, {}, m(pts([[60, 0, 5]]), "land", 40), calm);
  run("very far 20 km", base, {}, m(pts([[20000, 0, 50]])), calm);
  run("land ending", base, {}, m(square, "land"), calm);
  run("hold ending", base, {}, m(square, "hold"), calm);
  run("wait 600 s at wp", base, {}, m([{ id: "a", n: 50, e: 0, alt: 20, holdS: 600 }]), calm);
  run("land in the lake (hills)", base, {}, m(pts([[-170, 250, 30]]), "land"), calm, makeTerrain("hills"));
  run("50 waypoints", base, {}, m(pts(Array.from({ length: 50 }, (_, i) => [Math.cos(i) * 120, Math.sin(i) * 120, 25] as [number, number, number]))), calm);
  run("mission without takeoff cmd", base, {}, [m(square)[0], ...m(square).slice(2).map((x, i) => ({ ...x, seq: i + 1 }))], calm);
  run("unknown command in mission", base, {}, [...m(square).slice(0, 3), { ...m(square)[3], command: 201 }, ...m(square).slice(4)], calm);
  run("empty mission array", base, {}, [], calm);

  // ---- parameters gone wrong
  run("all rate gains 0", base, { ATC_RAT_RLL_P: 0, ATC_RAT_RLL_I: 0, ATC_RAT_RLL_D: 0, ATC_RAT_PIT_P: 0, ATC_RAT_PIT_I: 0, ATC_RAT_PIT_D: 0 }, m(square), calm);
  run("rate P x10", base, { ATC_RAT_RLL_P: 1.35, ATC_RAT_PIT_P: 1.35 }, m(square), calm);
  run("angle P 0", base, { ATC_ANG_RLL_P: 0, ATC_ANG_PIT_P: 0 }, m(square), calm);
  run("ANGLE_MAX 1000 (10 deg)", base, { ANGLE_MAX: 1000 }, m(square), { ...calm, windSpeed: 8 });
  run("ANGLE_MAX 8000", base, { ANGLE_MAX: 8000 }, m(square), calm);
  run("WPNAV_SPEED 50 (0.5 m/s)", base, { WPNAV_SPEED: 50 }, m(square), calm);
  run("WPNAV_SPEED 3000", base, { WPNAV_SPEED: 3000 }, m(pts([[600, 0, 30]])), calm);
  run("WPNAV_SPEED 0", base, { WPNAV_SPEED: 0 }, m(square), calm);
  run("WPNAV_ACCEL 0", base, { WPNAV_ACCEL: 0 }, m(square), calm);
  run("WPNAV_SPEED_UP 0", base, { WPNAV_SPEED_UP: 0 }, m(square), calm);
  run("WPNAV_SPEED_DN 0, LAND_SPEED 0", base, { WPNAV_SPEED_DN: 0, LAND_SPEED: 0 }, m(square), calm);
  run("LAND_SPEED 500 (5 m/s)", base, { LAND_SPEED: 500 }, m(square), calm);
  run("MOT_THST_HOVER 0.9 (wrong)", base, { MOT_THST_HOVER: 0.9 }, m(square), calm);
  run("MOT_THST_HOVER 0.05 (wrong)", base, { MOT_THST_HOVER: 0.05 }, m(square), calm);
  run("MOT_SPIN_MIN 0.6", base, { MOT_SPIN_MIN: 0.6 }, m(square), calm);
  run("PSC all 0", base, { PSC_POSXY_P: 0, PSC_VELXY_P: 0, PSC_VELXY_I: 0, PSC_VELXY_D: 0 }, m(square), calm);
  run("PSC_ACCZ 0 / VELZ 0", base, { PSC_ACCZ_P: 0, PSC_ACCZ_I: 0, PSC_VELZ_P: 0, PSC_POSZ_P: 0 }, m(square), calm);
  run("RTL_ALT 0", base, { RTL_ALT: 0 }, m(square), calm);
  run("RTL_ALT 12000", base, { RTL_ALT: 12000 }, m(square), calm);
  run("NaN parameter", base, { WPNAV_SPEED: NaN }, m(square), calm);
  run("negative parameters", base, { WPNAV_SPEED: -500, RTL_ALT: -100, ANGLE_MAX: -3000 }, m(square), calm);
  run("fence 30 m, route 80 m", base, { FENCE_ENABLE: 1, FENCE_RADIUS: 30 }, m(square), calm);
  run("fence alt 10, takeoff 20", base, { FENCE_ENABLE: 1, FENCE_ALT_MAX: 10 }, m(square), calm);
  run("fence action land", base, { FENCE_ENABLE: 1, FENCE_RADIUS: 30, FENCE_ACTION: 2 }, m(square), calm);
  run("fence action report only", base, { FENCE_ENABLE: 1, FENCE_RADIUS: 30, FENCE_ACTION: 0 }, m(square), calm);
  run("ARMING_CHECK 0, dead battery", base, { ARMING_CHECK: 0 }, m(square), { ...calm, soc: 0.01 });

  // ---- faults
  for (const kind of ["motor", "gps", "radio", "gcs"] as const) {
    run(`fault ${kind} at wp1`, base, {}, m(square), { ...calm, faults: [{ kind, motor: 2, level: 0, at: { waypoint: 2 } }] });
    run(`fault ${kind} at t=1 s (on take-off)`, base, {}, m(square), { ...calm, faults: [{ kind, motor: 2, level: 0, at: { time: 1 } }] });
  }
  for (const lvl of [0.9, 0.7, 0.5, 0.3]) run(`motor at ${lvl * 100}%`, base, {}, m(square), { ...calm, faults: [{ kind: "motor", motor: 1, level: lvl, at: { time: 15 } }] });
  run("gcs loss with FS_GCS 1 (rtl)", base, { FS_GCS_ENABLE: 1 }, m(square), { ...calm, faults: [{ kind: "gcs", at: { waypoint: 2 } }] });
  run("gcs loss with FS_GCS 5 (land)", base, { FS_GCS_ENABLE: 5 }, m(square), { ...calm, faults: [{ kind: "gcs", at: { waypoint: 2 } }] });
  run("gcs loss FS_GCS 1 + continue-auto opt", base, { FS_GCS_ENABLE: 1, FS_OPTIONS: 2 }, m(square), { ...calm, faults: [{ kind: "gcs", at: { waypoint: 2 } }] });
  run("radio loss with FS_THR 0", base, { FS_THR_ENABLE: 0 }, m(square), { ...calm, faults: [{ kind: "radio", at: { waypoint: 2 } }] });
  run("radio loss FS_THR 3 (land)", base, { FS_THR_ENABLE: 3 }, m(square), { ...calm, faults: [{ kind: "radio", at: { waypoint: 2 } }] });
  run("gps loss FS_EKF_ACTION 2", base, { FS_EKF_ACTION: 2 }, m(square), { ...calm, faults: [{ kind: "gps", at: { waypoint: 2 } }] });
  run("fault at waypoint that does not exist", base, {}, m(square), { ...calm, faults: [{ kind: "gps", at: { waypoint: 99 } }] });
  run("two faults", base, {}, m(square), { ...calm, faults: [{ kind: "gcs", at: { time: 10 } }, { kind: "radio", at: { time: 12 } }] });

  expect(out).toEqual([]);

  const is = (label: string, verdict: string, headline?: RegExp, finding?: RegExp) => {
    expect(verdicts[label]?.verdict, label).toBe(verdict);
    if (headline) expect(verdicts[label].headline, label).toMatch(headline);
    if (finding) expect(verdicts[label].findings, label).toMatch(finding);
  };
  // Too heavy: it says so, in three different ways for three different weights.
  is("mass 6 kg (T/W 0.60)", "grounded", /cannot take off: four motors make 3\.6 kg of thrust and the aircraft weighs 6\.0 kg/, /Thrust to weight is 0\.60/);
  // With 3% of thrust to spare it can neither climb to the height asked for nor stay up long: either is "stuck".
  is("mass 3.5 kg (T/W 1.03)", "stuck", /could not climb|could not hold its height, and sank back/);
  is("mass 3.3 kg (T/W 1.09)", "crashed", /did not have the thrust to hold its height/);
  is("mass 2.5 kg (T/W 1.44)", "completed", undefined, /Thrust to weight is only 1\.44/);
  is("capacity 100 mAh", "grounded", /battery sags/);
  is("thrust huge 20 kg/motor", "completed", undefined, /far beyond any real aircraft/);
  // Wind.
  is("wind 10 m/s gusting", "completed");
  is("wind 25 m/s gusting", "stuck", /could not make headway/, /Do not fly it in 25 m\/s/);
  // Settings that cannot work.
  is("NaN parameter", "completed", undefined, /WPNAV_SPEED was not a number/);
  is("all rate gains 0", "crashed", /lost control of its attitude/, /attitude gains cannot keep it level/);
  is("PSC_ACCZ 0 / VELZ 0", "flew-away", /climbed away/, /height controller is not holding height/);
  is("mission without takeoff cmd", "refused", /no take-off command/);
  is("empty mission array", "refused");
  is("fence action report only", "completed", undefined, /only reported it/);
  // Terrain and water.
  is('450-class quad, 10" pr highlands', "crashed", /flew into rising ground/);
  is("land in the lake (hills)", "crashed", /came down in the water/);
  // Failures.
  is("fault motor at wp1", "crashed", /could not fly with motor 2 at 0% thrust/);
  is("gps loss FS_EKF_ACTION 2", "holding", /ALT_HOLD/, /switched to AltHold/);
  is("gcs loss with FS_GCS 5 (land)", "landed-away");
  is("gcs loss with FS_GCS 1 (rtl)", "came-home");
}, 300000);
