import { describe, expect, it } from "vitest";
import type { Telemetry } from "../../../state/linkStore";
import { type DiagContext, runDiagnostics, summarize } from "../diagnostics";

const NOW = 1_000_000;
const S = <T>(value: T) => ({ at: NOW, value }); // a fresh stamped sample

function ctx(over: { telemetry?: Telemetry; params?: Record<string, number>; events?: DiagContext["events"]; armed?: boolean }): DiagContext {
  return {
    now: NOW,
    armed: over.armed ?? false,
    events: over.events ?? [],
    params: over.params ?? {},
    telemetry: over.telemetry ?? {},
  };
}

const healthyTel: Telemetry = {
  vibration: S({ x: 8, y: 9, z: 12, clip0: 0, clip1: 0, clip2: 0 }),
  ekf: S({ flags: 0, velVar: 0.1, posHoriz: 0.1, posVert: 0.1, compass: 0.1, terrain: 0 }),
  gps: S({ fixType: 3, satellites: 14, hdop: 0.8 }),
  battery: S({ voltage: 16.2, current: 10, remaining: 85 }),
  sensors: S({ present: 0xffffffff, enabled: 0xffffffff, health: 0xffffffff }),
};
const healthyParams = { COMPASS_USE: 1, COMPASS_OFS_X: 40, COMPASS_OFS_Y: -30, COMPASS_OFS_Z: 50, ARMING_CHECK: 1, FRAME_CLASS: 1, BATT_MONITOR: 4 };

describe("drone doctor diagnostics", () => {
  it("passes a healthy vehicle with a ready verdict", () => {
    const f = runDiagnostics(ctx({ telemetry: healthyTel, params: healthyParams }));
    const s = summarize(f);
    expect(s.critical).toBe(0);
    expect(s.warn).toBe(0);
    expect(s.verdict).toBe("ready");
    expect(s.score).toBe(100);
  });

  it("flags high vibration as critical", () => {
    const tel = { ...healthyTel, vibration: S({ x: 70, y: 20, z: 25, clip0: 0, clip1: 0, clip2: 0 }) };
    const f = runDiagnostics(ctx({ telemetry: tel, params: healthyParams }));
    const vibe = f.find((x) => x.area === "Vibration");
    expect(vibe?.severity).toBe("critical");
    expect(summarize(f).verdict).toBe("grounded");
  });

  it("identifies the worst EKF variance and names the cause", () => {
    const tel = { ...healthyTel, ekf: S({ flags: 0, velVar: 0.2, posHoriz: 0.2, posVert: 0.1, compass: 0.9, terrain: 0 }) };
    const f = runDiagnostics(ctx({ telemetry: tel, params: healthyParams }));
    const ekf = f.find((x) => x.area === "Estimation");
    expect(ekf?.severity).toBe("critical");
    expect(ekf?.title.toLowerCase()).toContain("magnetometer");
  });

  it("uses FS_EKF_THRESH when provided", () => {
    const tel = { ...healthyTel, ekf: S({ flags: 0, velVar: 0.65, posHoriz: 0.1, posVert: 0.1, compass: 0.1, terrain: 0 }) };
    // threshold 0.6 → 0.65 is critical; default 0.8 → would be warn
    const f = runDiagnostics(ctx({ telemetry: tel, params: { ...healthyParams, FS_EKF_THRESH: 0.6 } }));
    expect(f.find((x) => x.area === "Estimation")?.severity).toBe("critical");
  });

  it("flags no GPS fix as critical", () => {
    const tel = { ...healthyTel, gps: S({ fixType: 1, satellites: 2, hdop: null }) };
    const f = runDiagnostics(ctx({ telemetry: tel, params: healthyParams }));
    expect(f.find((x) => x.area === "GPS")?.severity).toBe("critical");
  });

  it("flags weak GPS (few sats) as a warning", () => {
    const tel = { ...healthyTel, gps: S({ fixType: 3, satellites: 7, hdop: 1.1 }) };
    const f = runDiagnostics(ctx({ telemetry: tel, params: healthyParams }));
    expect(f.find((x) => x.area === "GPS")?.severity).toBe("warn");
  });

  it("flags a critically low battery", () => {
    const tel = { ...healthyTel, battery: S({ voltage: 13.6, current: 20, remaining: 12 }) }; // ~3.4 V/cell on 4S
    const f = runDiagnostics(ctx({ telemetry: tel, params: healthyParams }));
    expect(f.find((x) => x.area === "Power")?.severity).toBe("critical");
  });

  it("flags high compass offsets from parameters", () => {
    const f = runDiagnostics(ctx({ telemetry: healthyTel, params: { ...healthyParams, COMPASS_OFS_X: 500, COMPASS_OFS_Y: 400, COMPASS_OFS_Z: 300 } }));
    const c = f.find((x) => x.id === "compass-ofs");
    expect(c?.severity).toBe("warn");
  });

  it("warns when arming checks are disabled", () => {
    const f = runDiagnostics(ctx({ telemetry: healthyTel, params: { ...healthyParams, ARMING_CHECK: 0 } }));
    expect(f.find((x) => x.id === "cfg-armcheck")?.severity).toBe("warn");
  });

  it("translates a pre-arm compass message", () => {
    const f = runDiagnostics(ctx({ telemetry: healthyTel, params: healthyParams, events: [{ id: 1, at: NOW - 2000, level: "vehicle", text: "PreArm: Compass not calibrated" }] }));
    const pa = f.find((x) => x.area === "Pre-arm");
    expect(pa).toBeTruthy();
    expect(pa?.title.toLowerCase()).toContain("compass");
  });

  it("ignores stale telemetry", () => {
    const stale: Telemetry = { vibration: { at: NOW - 20000, value: { x: 99, y: 99, z: 99, clip0: 0, clip1: 0, clip2: 0 } } };
    const f = runDiagnostics(ctx({ telemetry: stale, params: {} }));
    expect(f.find((x) => x.area === "Vibration")).toBeUndefined();
  });

  it("sorts critical findings before warnings and ok", () => {
    const tel = { ...healthyTel, vibration: S({ x: 70, y: 20, z: 25, clip0: 0, clip1: 0, clip2: 0 }) };
    const f = runDiagnostics(ctx({ telemetry: tel, params: healthyParams }));
    expect(f[0].severity).toBe("critical");
  });
});
