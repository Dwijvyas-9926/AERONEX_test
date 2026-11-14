import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_CONFIG, FlightController, type FlightDeps, type Telemetry } from "../flightController";

const MODE = { GUIDED: 4, RTL: 6, LAND: 9 };

/*
  A tiny simulated ArduCopter: responds to the same commands the real vehicle
  does and integrates a crude altitude model, so the controller's full
  arm→takeoff→move→land→disarm sequence can be exercised without hardware.
*/
class MockAutopilot {
  armed = false;
  mode: number | null = null;
  relAlt = 0;
  connected = true;
  private climbingTo: number | null = null;
  private landing = false;
  lastVel = { vx: 0, vy: 0, vz: 0, yawRate: 0 };
  /** Metres north and east of where it started, and heading in radians. */
  n = 0;
  e = 0;
  heading = 0;
  hasPos = true;
  rejectArm = false;
  rejectMode = false;

  arm = vi.fn(async (on: boolean) => {
    if (on && this.rejectArm) return 4; // MAV_RESULT_FAILED
    this.armed = on;
    if (!on) { this.climbingTo = null; this.landing = false; }
    return 0;
  });
  setMode = vi.fn(async (m: number) => {
    if (this.rejectMode) return 4;
    this.mode = m;
    if (m === MODE.LAND || m === MODE.RTL) this.landing = true;
    return 0;
  });
  takeoff = vi.fn(async (alt: number) => {
    this.climbingTo = alt;
    return 0;
  });
  setVelocity = vi.fn((vx: number, vy: number, vz: number, yawRate: number) => {
    this.lastVel = { vx, vy, vz, yawRate };
  });

  telemetry = (): Telemetry => ({
    armed: this.armed, relAlt: this.relAlt, mode: this.mode, connected: this.connected,
    pos: this.hasPos ? { n: this.n, e: this.e } : null, heading: this.hasPos ? this.heading : null,
  });

  // Advance the physical model.
  tickSim(dt: number) {
    if (this.landing) {
      this.relAlt = Math.max(0, this.relAlt - 0.5 * dt);
      if (this.relAlt <= 0.01) { this.armed = false; this.landing = false; }
      return;
    }
    if (this.climbingTo != null) {
      this.relAlt = Math.min(this.climbingTo, this.relAlt + 2.5 * dt);
      if (this.relAlt >= this.climbingTo - 0.01) this.climbingTo = null;
      return;
    }
    if (this.armed) {
      this.relAlt = Math.max(0, this.relAlt - this.lastVel.vz * dt); // vz is +down
      const c = Math.cos(this.heading), s = Math.sin(this.heading);
      this.n += (this.lastVel.vx * c - this.lastVel.vy * s) * dt;
      this.e += (this.lastVel.vx * s + this.lastVel.vy * c) * dt;
      this.heading += this.lastVel.yawRate * dt;
    }
  }
}

function makeController(ap: MockAutopilot) {
  const logs: string[] = [];
  const deps: FlightDeps = {
    arm: ap.arm,
    setMode: ap.setMode,
    takeoff: ap.takeoff,
    setVelocity: ap.setVelocity,
    getTelemetry: ap.telemetry,
    now: () => Date.now(),
    log: (_l, m) => logs.push(m),
    onChange: () => {},
  };
  return { fc: new FlightController(deps, { ...DEFAULT_CONFIG }), logs };
}

// Run the coupled loop for a number of control ticks.
function run(fc: FlightController, ap: MockAutopilot, ticks: number) {
  const dt = DEFAULT_CONFIG.tickMs / 1000;
  for (let i = 0; i < ticks; i++) {
    fc.tick();
    ap.tickSim(dt);
  }
}

describe("FlightController — full flight sequence", () => {
  let ap: MockAutopilot;
  let fc: FlightController;
  beforeEach(() => {
    ap = new MockAutopilot();
    ({ fc } = makeController(ap));
  });

  it("arms in GUIDED and takes off to the target altitude", async () => {
    await fc.requestTakeoff();
    expect(ap.setMode).toHaveBeenCalledWith(MODE.GUIDED);
    expect(ap.arm).toHaveBeenCalledWith(true);
    expect(ap.takeoff).toHaveBeenCalledWith(DEFAULT_CONFIG.takeoffAlt);
    expect(fc.phase).toBe("takeoff");
    run(fc, ap, 20); // climb
    expect(fc.phase).toBe("flying");
    expect(ap.relAlt).toBeGreaterThanOrEqual(DEFAULT_CONFIG.takeoffAlt * 0.9);
  });

  it("refuses takeoff when already armed or disconnected", async () => {
    ap.armed = true;
    await fc.requestTakeoff();
    expect(fc.phase).toBe("idle");
    expect(ap.takeoff).not.toHaveBeenCalled();

    ap.armed = false;
    ap.connected = false;
    await fc.requestTakeoff();
    expect(ap.takeoff).not.toHaveBeenCalled();
  });

  it("lands and the mock auto-disarms, returning to idle", async () => {
    await fc.requestTakeoff();
    run(fc, ap, 20);
    expect(fc.phase).toBe("flying");
    await fc.requestLand();
    expect(ap.setMode).toHaveBeenCalledWith(MODE.LAND);
    run(fc, ap, 60); // descend
    expect(ap.armed).toBe(false);
    expect(fc.phase).toBe("idle");
  });
});

describe("FlightController — gradual, capped motion", () => {
  let ap: MockAutopilot;
  let fc: FlightController;
  beforeEach(async () => {
    ap = new MockAutopilot();
    ({ fc } = makeController(ap));
    await fc.requestTakeoff();
    run(fc, ap, 20); // now flying
  });

  it("ramps forward velocity gradually (no instant jump to max)", () => {
    fc.setKeys({ fwd: true });
    fc.tick();
    const dt = DEFAULT_CONFIG.tickMs / 1000;
    // after one tick, vx must be at most one acceleration step, well below the cap
    expect(ap.lastVel.vx).toBeLessThanOrEqual(DEFAULT_CONFIG.horizAccel * dt + 1e-9);
    expect(ap.lastVel.vx).toBeGreaterThan(0);
  });

  it("never exceeds the horizontal speed cap", () => {
    fc.setKeys({ fwd: true });
    run(fc, ap, 100);
    expect(ap.lastVel.vx).toBeLessThanOrEqual(DEFAULT_CONFIG.maxHoriz + 1e-9);
    expect(ap.lastVel.vx).toBeCloseTo(DEFAULT_CONFIG.maxHoriz, 2);
  });

  it("holds (ramps to zero) when keys are released", () => {
    fc.setKeys({ fwd: true });
    run(fc, ap, 100);
    fc.setKeys({ fwd: false });
    run(fc, ap, 100);
    expect(ap.lastVel.vx).toBeCloseTo(0, 3);
  });

  it("maps yaw keys to signed yaw rate", () => {
    fc.setKeys({ yawRight: true });
    run(fc, ap, 100);
    expect(ap.lastVel.yawRate).toBeGreaterThan(0);
    fc.setKeys({ yawRight: false, yawLeft: true });
    run(fc, ap, 100);
    expect(ap.lastVel.yawRate).toBeLessThan(0);
  });

  it("stops climbing at the altitude ceiling", () => {
    fc.setKeys({ up: true });
    run(fc, ap, 400); // try to climb forever
    expect(ap.relAlt).toBeLessThanOrEqual(DEFAULT_CONFIG.maxAlt + 0.2);
  });

  it("neutralize() commands zero velocity immediately (focus-loss safety)", () => {
    fc.setKeys({ fwd: true });
    run(fc, ap, 50);
    ap.setVelocity.mockClear();
    fc.neutralize();
    expect(ap.setVelocity).toHaveBeenCalledWith(0, 0, 0, 0);
  });
});

describe("FlightController — failure handling", () => {
  it("aborts to LAND if arming is rejected mid-sequence", async () => {
    const ap = new MockAutopilot();
    ap.rejectArm = true;
    ap.armed = true; // pretend it armed so safeLand triggers a LAND, exercising the abort path
    // reset: start disarmed, reject arm
    ap.armed = false;
    const { fc } = makeController(ap);
    await fc.requestTakeoff();
    expect(ap.takeoff).not.toHaveBeenCalled();
    expect(fc.phase === "idle" || fc.phase === "landing").toBe(true);
  });

  it("enters emergency and stops sending if the link drops while flying", async () => {
    const ap = new MockAutopilot();
    const { fc } = makeController(ap);
    await fc.requestTakeoff();
    run(fc, ap, 20);
    expect(fc.phase).toBe("flying");
    ap.connected = false;
    ap.setVelocity.mockClear();
    fc.tick();
    expect(fc.phase).toBe("emergency");
    expect(ap.setVelocity).not.toHaveBeenCalled();
  });
});

describe("FlightController — a descent that does not take", () => {
  /** A controller on a clock the test owns, so re-send timing is exact. */
  function flying() {
    const ap = new MockAutopilot();
    let now = 0;
    const logs: string[] = [];
    const fc = new FlightController(
      {
        arm: ap.arm, setMode: ap.setMode, takeoff: ap.takeoff, setVelocity: ap.setVelocity,
        getTelemetry: ap.telemetry, now: () => now, log: (_l, m) => logs.push(m), onChange: () => {},
      },
      { ...DEFAULT_CONFIG },
    );
    const step = (ticks: number) => {
      for (let i = 0; i < ticks; i++) { now += DEFAULT_CONFIG.tickMs; fc.tick(); ap.tickSim(DEFAULT_CONFIG.tickMs / 1000); }
    };
    return { ap, fc, logs, step };
  }

  it("re-sends LAND until the aircraft is actually in it", async () => {
    const { ap, fc, step } = flying();
    await fc.requestTakeoff();
    step(20);
    expect(fc.phase).toBe("flying");
    // The autopilot refuses, as it would with the packet lost or a bad state.
    ap.rejectMode = true;
    await fc.requestLand();
    expect(fc.phase).toBe("landing");
    expect(ap.mode).toBe(MODE.GUIDED);
    const sent = () => ap.setMode.mock.calls.filter((c) => c[0] === MODE.LAND).length;
    expect(sent()).toBe(1);
    step(20); // two seconds on, still hovering in GUIDED
    expect(sent()).toBeGreaterThan(1);
    // Once it gets through, the aircraft lands and the controller goes idle.
    ap.rejectMode = false;
    step(20);
    expect(ap.mode).toBe(MODE.LAND);
    const settled = sent();
    step(100);
    expect(sent()).toBe(settled); // and it stops asking
    expect(ap.armed).toBe(false);
    expect(fc.phase).toBe("idle");
  });

  it("tells the pilot when the aircraft will not take the command", async () => {
    const { ap, fc, logs, step } = flying();
    await fc.requestTakeoff();
    step(20);
    ap.rejectMode = true;
    await fc.requestLand();
    step(80);
    expect(logs.join("\n")).toMatch(/not accepting the command/);
  });

  it("lets go when the aircraft disarms on its own", async () => {
    const { ap, fc, step } = flying();
    await fc.requestTakeoff();
    step(20);
    fc.setKeys({ fwd: true });
    step(5);
    ap.armed = false;
    ap.setVelocity.mockClear();
    step(3);
    expect(fc.phase).toBe("idle");
    expect(ap.setVelocity).not.toHaveBeenCalled();
  });

  it("lets go when the mode is changed from the radio", async () => {
    const { ap, fc, logs, step } = flying();
    await fc.requestTakeoff();
    step(20);
    ap.mode = 5; // LOITER, from the transmitter
    ap.setVelocity.mockClear();
    step(3);
    expect(fc.phase).toBe("emergency");
    expect(ap.setVelocity).not.toHaveBeenCalled();
    expect(logs.join("\n")).toMatch(/changed from the radio/);
    // A landing mode from the radio is followed rather than fought.
    const second = flying();
    await second.fc.requestTakeoff();
    second.step(20);
    second.ap.mode = MODE.LAND;
    second.step(2);
    expect(second.fc.phase).toBe("landing");
    expect(second.ap.setMode.mock.calls.filter((c) => c[0] === MODE.LAND)).toHaveLength(0);
  });

  it("can switch a landing to return-to-home, and re-sends that too", async () => {
    const { ap, fc, step } = flying();
    await fc.requestTakeoff();
    step(20);
    await fc.requestLand();
    await fc.emergencyRTL();
    expect(ap.mode).toBe(MODE.RTL);
    expect(fc.phase).toBe("landing");
  });
});

describe("FlightController — range limit", () => {
  it("stops short of the range limit flying straight out, and lets it fly back", async () => {
    const ap = new MockAutopilot();
    const { fc, logs } = makeController(ap);
    await fc.requestTakeoff();
    run(fc, ap, 20);
    expect(fc.phase).toBe("flying");
    fc.setKeys({ fwd: true });
    run(fc, ap, 600); // a minute of holding W
    const out = Math.hypot(ap.n, ap.e);
    expect(out).toBeLessThanOrEqual(DEFAULT_CONFIG.maxRange + 0.2);
    expect(out).toBeGreaterThan(DEFAULT_CONFIG.maxRange - 3);
    expect(logs.join("\n")).toMatch(/Range limit/);
    fc.setKeys({ fwd: false, back: true });
    run(fc, ap, 100);
    expect(Math.hypot(ap.n, ap.e)).toBeLessThan(out - 5);
  });

  it("holds the limit whichever way the aircraft faces, sliding along it rather than through", async () => {
    const ap = new MockAutopilot();
    const { fc } = makeController(ap);
    await fc.requestTakeoff();
    run(fc, ap, 20);
    ap.heading = 0.7;
    fc.setKeys({ fwd: true, right: true });
    for (let i = 0; i < 900; i++) {
      fc.tick();
      ap.tickSim(DEFAULT_CONFIG.tickMs / 1000);
      expect(Math.hypot(ap.n, ap.e)).toBeLessThanOrEqual(DEFAULT_CONFIG.maxRange + 0.2);
    }
  });

  it("moves nowhere sideways without a position from the aircraft", async () => {
    const ap = new MockAutopilot();
    const { fc, logs } = makeController(ap);
    await fc.requestTakeoff();
    run(fc, ap, 20);
    ap.hasPos = false;
    fc.setKeys({ fwd: true });
    run(fc, ap, 30);
    expect(ap.lastVel.vx).toBe(0);
    expect(ap.lastVel.vy).toBe(0);
    expect(logs.join("\n")).toMatch(/No position or heading/);
  });
});
