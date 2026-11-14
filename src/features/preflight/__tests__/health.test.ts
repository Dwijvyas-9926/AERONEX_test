import { describe, expect, it } from "vitest";
import { batteryHealth, gpsHealth, PREARM_BIT, preflightVerdict, type PreflightInput, sensorHealth, varianceHealth, vibeHealth, worst } from "../health";

describe("preflight health thresholds", () => {
  it("reads sensor present/health bitmasks", () => {
    const GYRO = 1 << 0;
    const ACCEL = 1 << 1;
    // gyro present+healthy, accel present but unhealthy, mag absent
    const present = GYRO | ACCEL;
    const health = GYRO;
    expect(sensorHealth(GYRO, present, health)).toBe("ok");
    expect(sensorHealth(ACCEL, present, health)).toBe("bad");
    expect(sensorHealth(1 << 2, present, health)).toBe("absent");
  });

  it("grades EKF variance against the ~0.8 red line", () => {
    expect(varianceHealth(0.2)).toBe("ok");
    expect(varianceHealth(0.6)).toBe("warn");
    expect(varianceHealth(0.9)).toBe("bad");
  });

  it("grades vibration in m/s/s", () => {
    expect(vibeHealth(12)).toBe("ok");
    expect(vibeHealth(45)).toBe("warn");
    expect(vibeHealth(80)).toBe("bad");
  });

  it("needs a 3D fix for GPS to be healthy", () => {
    expect(gpsHealth(3)).toBe("ok");
    expect(gpsHealth(2)).toBe("warn");
    expect(gpsHealth(1)).toBe("bad");
  });

  it("grades battery by remaining percent, else by voltage against the aircraft's own limits", () => {
    expect(batteryHealth(80, null)).toBe("ok");
    expect(batteryHealth(35, null)).toBe("warn");
    expect(batteryHealth(10, null)).toBe("bad");
    // A voltage alone says nothing without knowing the pack: a full 3S and a flat 6S were both misread.
    expect(batteryHealth(null, 12.6)).toBe("unknown");
    expect(batteryHealth(null, 21.0)).toBe("unknown");
    const s3 = { low: 10.5, crit: 9.9 };
    expect(batteryHealth(null, 12.6, s3)).toBe("ok");
    expect(batteryHealth(null, 10.8, s3)).toBe("warn");
    expect(batteryHealth(null, 10.4, s3)).toBe("bad");
    expect(batteryHealth(null, 9.8, s3)).toBe("bad");
    // No battery monitor: ArduPilot reports 0 V.
    expect(batteryHealth(null, 0, s3)).toBe("unknown");
    expect(batteryHealth(null, null)).toBe("unknown");
  });

  it("does not fail a sensor that is present but switched off", () => {
    expect(sensorHealth(4, 4, 0, 0)).toBe("absent");
    expect(sensorHealth(4, 4, 0, 4)).toBe("bad");
  });

  it("rolls several checks up to the worst one", () => {
    expect(worst(["ok", "ok", "warn"])).toBe("warn");
    expect(worst(["ok", "bad", "warn"])).toBe("bad");
    expect(worst(["ok", "ok", "ok"])).toBe("ok");
    expect(worst(["absent", "ok"])).toBe("ok"); // absent isn't a failure
  });
});

describe("the go / no-go", () => {
  const NOW = 1_000_000;
  const ALL = 0b11 | (1 << 3) | (1 << 5) | (1 << 21) | (1 << 25) | PREARM_BIT;
  const good = (over: Partial<PreflightInput> = {}): PreflightInput => ({
    now: NOW,
    armed: false,
    sensors: { at: NOW - 200, value: { present: ALL, enabled: ALL, health: ALL } },
    attitude: { at: NOW - 100, value: {} },
    ekf: { at: NOW - 300, value: { velVar: 0.1, posHoriz: 0.1, posVert: 0.1, compass: 0.1 } },
    gps: { at: NOW - 300, value: { fixType: 3 } },
    battery: { at: NOW - 200, value: { voltage: 16.4, remaining: 90 } },
    vibration: { at: NOW - 300, value: { x: 5, y: 5, z: 8, clip0: 0, clip1: 0, clip2: 0 } },
    events: [],
    ...over,
  });

  it("is ready only when the autopilot and every reading agree", () => {
    expect(preflightVerdict(good()).title).toBe("Ready to arm");
  });

  it("is not ready while ArduPilot's own pre-arm check fails, and quotes its reason", () => {
    const v = preflightVerdict(
      good({
        sensors: { at: NOW - 200, value: { present: ALL, enabled: ALL, health: ALL & ~PREARM_BIT } },
        events: [{ at: NOW - 5000, text: "Critical: PreArm: Compass not calibrated" }, { at: NOW - 5000, text: "Critical: PreArm: Compass not calibrated" }],
      }),
    );
    expect(v.cls).toBe("nogo");
    expect(v.prearm).toEqual(["Compass not calibrated"]);
  });

  it("is not ready on a PreArm message when the firmware does not report the pre-arm bit", () => {
    const noBit = ALL & ~PREARM_BIT;
    const v = preflightVerdict(good({ sensors: { at: NOW, value: { present: noBit, enabled: noBit, health: noBit } }, events: [{ at: NOW - 20_000, text: "Critical: PreArm: Need 3D Fix" }] }));
    expect(v.cls).toBe("nogo");
  });

  it("forgets a PreArm reason ArduPilot has stopped repeating", () => {
    const noBit = ALL & ~PREARM_BIT;
    const v = preflightVerdict(good({ sensors: { at: NOW, value: { present: noBit, enabled: noBit, health: noBit } }, events: [{ at: NOW - 120_000, text: "Critical: PreArm: Need 3D Fix" }] }));
    expect(v.cls).toBe("go");
  });

  it("waits, rather than passing, when the readings it needs have not arrived", () => {
    // Only a battery and vibration: this used to say "Ready to arm".
    const v = preflightVerdict(good({ sensors: undefined, attitude: undefined, ekf: undefined, gps: undefined }));
    expect(v.cls).toBe("wait");
  });

  it("says the telemetry is stale when it stops", () => {
    expect(preflightVerdict(good({ attitude: { at: NOW - 10_000, value: {} } })).title).toBe("Telemetry stale");
  });

  it("flags a missing GPS, which it used not to grade at all", () => {
    const noGps = ALL & ~(1 << 5);
    const v = preflightVerdict(good({ gps: undefined, sensors: { at: NOW, value: { present: noGps, enabled: noGps, health: noGps } } }));
    expect(v.cls).toBe("caution");
    expect(v.reasons.join(" ")).toMatch(/No GPS/);
  });

  it("warns when arming checks are turned off", () => {
    const off = ALL & ~PREARM_BIT;
    const v = preflightVerdict(good({ sensors: { at: NOW, value: { present: ALL, enabled: off, health: off } } }));
    expect(v.cls).toBe("caution");
    expect(v.reasons.join(" ")).toMatch(/Arming checks are turned off/);
  });

  it("is not ready on an unhealthy critical sensor, a flat battery, or a diverged EKF", () => {
    expect(preflightVerdict(good({ sensors: { at: NOW, value: { present: ALL, enabled: ALL, health: ALL & ~1 } } })).cls).toBe("nogo");
    expect(preflightVerdict(good({ battery: { at: NOW, value: { voltage: 13, remaining: 10 } } })).cls).toBe("nogo");
    expect(preflightVerdict(good({ ekf: { at: NOW, value: { velVar: 0.95, posHoriz: 0.1, posVert: 0.1, compass: 0.1 } } })).cls).toBe("nogo");
  });

  it("shows armed as armed", () => {
    expect(preflightVerdict(good({ armed: true })).title).toBe("Armed");
  });
});
