import { describe, expect, it } from "vitest";
import { derive, PRESETS, type Airframe } from "../airframe";
import { CMD, MODE, type MissionItem } from "../autopilot";
import { euler } from "../physics";
import { VirtualVehicle } from "../vehicle";

const HOME = { lat: 23.0225, lon: 72.5714, altMsl: 53 };
const M = 111319.5;

const make = (af: Airframe = PRESETS[0], params = {}, soc = 1) => {
  const v = new VirtualVehicle({ airframe: af, home: HOME, params, soc });
  v.setScriptedGcs(true);
  return v;
};
const run = (v: VirtualVehicle, seconds: number, until?: () => boolean) => {
  for (let t = 0; t < seconds; t += 0.1) {
    v.advance(0.1, 0.1, false);
    if (until?.()) return true;
  }
  return false;
};
const wp = (seq: number, n: number, e: number, alt: number, command: number = CMD.WAYPOINT, p1 = 0): MissionItem => ({
  seq, frame: 3, command, p1, p2: 0, p3: 0, p4: 0,
  x: command === CMD.RTL || (n === 0 && e === 0 && command !== CMD.WAYPOINT) ? 0 : Math.round((HOME.lat + n / M) * 1e7),
  y: command === CMD.RTL || (n === 0 && e === 0 && command !== CMD.WAYPOINT) ? 0 : Math.round((HOME.lon + e / (M * Math.cos((HOME.lat * Math.PI) / 180))) * 1e7),
  z: alt,
});
const square = (side: number, alt: number): MissionItem[] => [
  wp(0, 0, 0, 0), wp(1, 0, 0, alt, CMD.TAKEOFF), wp(2, side, 0, alt), wp(3, side, side, alt), wp(4, 0, side, alt), wp(5, 0, 0, 0, CMD.RTL),
];
const takeoff = (v: VirtualVehicle, alt: number) => {
  v.ap.setMode(MODE.GUIDED, v.inputs());
  expect(v.ap.arm(v.inputs())).toEqual([]);
  expect(v.ap.guidedTakeoff(alt)).toBe(true);
  run(v, 30, () => v.ap.alt > alt - 0.4);
};
const flyMission = (v: VirtualVehicle, items: MissionItem[], seconds = 600) => {
  v.ap.mission = items;
  v.ap.setMode(MODE.GUIDED, v.inputs());
  expect(v.ap.arm(v.inputs())).toEqual([]);
  expect(v.ap.setMode(MODE.AUTO, v.inputs())).toBe(true);
  expect(v.ap.startMission()).toBe(true);
  return run(v, seconds, () => !v.ap.armed);
};
const kinds = (v: VirtualVehicle) => v.events.map((e) => e.kind).filter(Boolean);

describe("the airframe", () => {
  it("derives a hover throttle that leaves thrust in hand on every preset", () => {
    for (const af of PRESETS) {
      const d = derive(af);
      expect(d.hoverThrottle, af.name).toBeGreaterThan(0.1);
      expect(d.hoverThrottle, af.name).toBeLessThan(0.6);
      expect(d.thrustToWeight, af.name).toBeGreaterThan(1.8);
    }
  });
});

describe("hovering", () => {
  it("takes off, reaches the height asked for and holds it, on every preset", () => {
    for (const af of PRESETS) {
      const v = make(af);
      takeoff(v, 10);
      let worstAlt = 0;
      let worstPos = 0;
      let worstTilt = 0;
      run(v, 10);
      for (let i = 0; i < 100; i++) {
        v.advance(0.1, 0.1, false);
        worstAlt = Math.max(worstAlt, Math.abs(v.ap.alt - 10));
        worstPos = Math.max(worstPos, Math.hypot(v.phys.s.pos[0], v.phys.s.pos[1]));
        const e = euler(v.phys.s.q);
        worstTilt = Math.max(worstTilt, Math.abs(e.roll), Math.abs(e.pitch));
      }
      expect(worstAlt, `${af.name} height`).toBeLessThan(0.3);
      expect(worstPos, `${af.name} position`).toBeLessThan(0.3);
      expect(worstTilt, `${af.name} tilt`).toBeLessThan(0.05);
      expect(v.phys.s.crashed).toBe(false);
    }
  });

  it("hovers at about the throttle the airframe predicts", () => {
    const v = make();
    takeoff(v, 10);
    run(v, 15);
    expect(v.ap.throttleOut).toBeGreaterThan(derive(PRESETS[0]).hoverThrottle * 0.85);
    expect(v.ap.throttleOut).toBeLessThan(derive(PRESETS[0]).hoverThrottle * 1.25);
  });

  it("holds position in a steady wind by leaning into it", () => {
    const v = make();
    v.phys.env = { windSpeed: 8, windFromDeg: 0, gust: 0 };
    takeoff(v, 10);
    run(v, 25);
    expect(Math.hypot(v.phys.s.pos[0], v.phys.s.pos[1])).toBeLessThan(1.5);
    // Wind from the north pushes south: it pitches nose down toward north.
    expect(euler(v.phys.s.q).pitch).toBeLessThan(-0.05);
  });

  it("lands and disarms itself", () => {
    const v = make();
    takeoff(v, 8);
    v.ap.setMode(MODE.LAND, v.inputs());
    expect(run(v, 60, () => !v.ap.armed)).toBe(true);
    expect(v.phys.s.crashed).toBe(false);
    expect(v.phys.s.onGround).toBe(true);
    expect(v.phys.s.lastImpact).toBeLessThan(1);
  });
});

describe("a mission", () => {
  it("flies every waypoint, comes home and lands where it started", () => {
    const v = make();
    const reached: number[] = [];
    v.ap.onReached = (s) => reached.push(s);
    expect(flyMission(v, square(60, 20))).toBe(true);
    expect(reached).toEqual([1, 2, 3, 4, 5]);
    expect(v.phys.s.crashed).toBe(false);
    expect(Math.hypot(v.phys.s.pos[0], v.phys.s.pos[1])).toBeLessThan(2);
    expect(kinds(v)).toContain("rtl-land");
  });

  it("cruises at WPNAV_SPEED and no faster", () => {
    const v = make(PRESETS[0], { WPNAV_SPEED: 600 });
    v.ap.mission = [wp(0, 0, 0, 0), wp(1, 0, 0, 20, CMD.TAKEOFF), wp(2, 300, 0, 20)];
    v.ap.setMode(MODE.GUIDED, v.inputs());
    v.ap.arm(v.inputs());
    v.ap.setMode(MODE.AUTO, v.inputs());
    v.ap.startMission();
    let top = 0;
    run(v, 45, () => {
      top = Math.max(top, Math.hypot(v.phys.s.vel[0], v.phys.s.vel[1]));
      return false;
    });
    expect(top).toBeGreaterThan(5.5);
    expect(top).toBeLessThan(7);
  });

  it("will not arm in Auto, as ArduCopter will not by default", () => {
    const v = make();
    v.ap.mission = square(30, 10);
    v.ap.mode = MODE.AUTO;
    expect(v.ap.arm(v.inputs())).toContain("Mode not armable");
  });
});

describe("failsafes", () => {
  const long = square(400, 30);

  it("with no battery action set, flies until the pack is empty and falls", () => {
    const v = make(PRESETS[0], { BATT_LOW_VOLT: 0 }, 0.12);
    flyMission(v, long, 900);
    expect(v.phys.s.crashed).toBe(true);
    expect(kinds(v)).toContain("crash");
  });

  it("with a low-battery return set, turns for home and lands", () => {
    const v = make(PRESETS[0], { BATT_LOW_MAH: 1200, BATT_FS_LOW_ACT: 2, BATT_LOW_VOLT: 0 }, 0.4);
    expect(flyMission(v, long, 900)).toBe(true);
    expect(kinds(v)).toContain("fs-batt-low");
    expect(v.phys.s.crashed).toBe(false);
    expect(Math.hypot(v.phys.s.pos[0], v.phys.s.pos[1])).toBeLessThan(3);
  });

  it("the voltage trigger waits out BATT_LOW_TIMER", () => {
    const v = make(PRESETS[0], { BATT_LOW_VOLT: 20, BATT_FS_LOW_ACT: 1, BATT_ARM_VOLT: 0, ARMING_CHECK: 0 });
    takeoff(v, 10);
    const armedAt = v.events.find((e) => e.kind === "arm")!.t;
    run(v, 30, () => v.ap.failsafes.has("batt-low"));
    const fired = v.events.find((e) => e.kind === "fs-batt-low")!.t;
    expect(fired - armedAt).toBeGreaterThan(9.5);
    expect(fired - armedAt).toBeLessThan(12);
  });

  it("lands when the ground station goes quiet, if told to", () => {
    const v = make(PRESETS[0], { FS_GCS_ENABLE: 5 });
    takeoff(v, 15);
    v.setScriptedGcs(false);
    run(v, 4);
    expect(v.ap.mode).toBe(MODE.GUIDED);
    run(v, 3);
    expect(v.ap.mode).toBe(MODE.LAND);
    expect(run(v, 60, () => !v.ap.armed)).toBe(true);
    expect(v.phys.s.crashed).toBe(false);
  });

  it("ignores a quiet ground station when the failsafe is off", () => {
    const v = make();
    takeoff(v, 15);
    v.setScriptedGcs(false);
    run(v, 20);
    expect(v.ap.mode).toBe(MODE.GUIDED);
  });

  it("returns on radio loss in a pilot mode", () => {
    const v = make();
    takeoff(v, 15);
    v.ap.setMode(MODE.LOITER, v.inputs());
    v.rcOk = false;
    run(v, 3);
    expect(v.ap.mode).toBe(MODE.RTL);
  });

  it("turns back at the fence", () => {
    const v = make(PRESETS[0], { FENCE_ENABLE: 1, FENCE_RADIUS: 50 });
    flyMission(v, [wp(0, 0, 0, 0), wp(1, 0, 0, 20, CMD.TAKEOFF), wp(2, 150, 0, 20)], 300);
    expect(kinds(v)).toContain("fs-fence");
    expect(v.phys.s.crashed).toBe(false);
    expect(Math.hypot(v.phys.s.pos[0], v.phys.s.pos[1])).toBeLessThan(3);
  });

  it("lands without position hold when GPS is lost, and drifts with the wind", () => {
    const v = make();
    v.phys.env = { windSpeed: 5, windFromDeg: 270, gust: 0 };
    takeoff(v, 20);
    run(v, 10);
    v.gpsOk = false;
    run(v, 3);
    expect(v.ap.mode).toBe(MODE.LAND);
    expect(kinds(v)).toContain("fs-ekf");
    run(v, 90, () => !v.ap.armed);
    // Wind from the west carries it east.
    expect(v.phys.s.pos[1]).toBeGreaterThan(5);
  });

  it("cannot stay up on three motors", () => {
    const v = make();
    takeoff(v, 20);
    v.phys.faults.motor[0] = 0;
    run(v, 20, () => v.phys.s.crashed);
    expect(v.phys.s.crashed).toBe(true);
    expect(kinds(v)).toContain("crash");
  });

  it("flies on with one motor down to 80%", () => {
    const v = make();
    takeoff(v, 20);
    v.phys.faults.motor[2] = 0.8;
    run(v, 20);
    expect(v.phys.s.crashed).toBe(false);
    expect(Math.abs(v.ap.alt - 20)).toBeLessThan(1);
  });
});

describe("energy", () => {
  it("draws a plausible hover current and drains the pack as it flies", () => {
    const v = make();
    takeoff(v, 10);
    run(v, 60);
    // A 1.5 kg quad on 10-inch propellers hovers on roughly 150–250 W.
    const watts = v.phys.s.amps * v.phys.s.volts;
    expect(watts).toBeGreaterThan(120);
    expect(watts).toBeLessThan(280);
    expect(v.phys.soc).toBeLessThan(0.97);
    expect(v.phys.s.volts).toBeLessThan(12.6);
  });
});
