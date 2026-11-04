import { describe, expect, it } from "vitest";
import { batteryHealth, gpsHealth, sensorHealth, varianceHealth, vibeHealth, worst } from "../health";

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

  it("grades battery by remaining percent, falling back to voltage", () => {
    expect(batteryHealth(80, null)).toBe("ok");
    expect(batteryHealth(35, null)).toBe("warn");
    expect(batteryHealth(10, null)).toBe("bad");
    expect(batteryHealth(null, 15.6)).toBe("ok");
    expect(batteryHealth(null, null)).toBe("unknown");
  });

  it("rolls several checks up to the worst one", () => {
    expect(worst(["ok", "ok", "warn"])).toBe("warn");
    expect(worst(["ok", "bad", "warn"])).toBe("bad");
    expect(worst(["ok", "ok", "ok"])).toBe("ok");
    expect(worst(["absent", "ok"])).toBe("ok"); // absent isn't a failure
  });
});
