import { describe, expect, it } from "vitest";
import type { Telemetry, VehicleIdentity } from "../../../state/linkStore";
import { buildDroneContext } from "../anthropicClient";
import { buildSystemPrompt } from "../droneKnowledge";
import type { Finding } from "../diagnostics";

const NOW = Date.now();
const S = <T>(value: T) => ({ at: NOW, value });
const vehicle = { firmwareLabel: "ArduCopter 4.5", sysid: 1 } as VehicleIdentity;

describe("buildDroneContext", () => {
  it("returns null with no vehicle", () => {
    expect(buildDroneContext({ vehicle: null, armed: false, findings: [], telemetry: {}, params: {} })).toBeNull();
  });

  it("includes findings, live telemetry and parameters", () => {
    const tel: Telemetry = {
      vibration: S({ x: 48, y: 10, z: 12, clip0: 0, clip1: 0, clip2: 0 }),
      gps: S({ fixType: 3, satellites: 12, hdop: 0.9 }),
      battery: S({ voltage: 16.1, current: 12, remaining: 80 }),
    };
    const findings: Finding[] = [
      { id: "vibe-high", area: "Vibration", severity: "critical", title: "Vibration is too high", detail: "", metric: "48 m/s² peak" },
    ];
    const ctx = buildDroneContext({ vehicle, armed: false, findings, telemetry: tel, params: { MOT_THST_HOVER: 0.3, FRAME_CLASS: 1 } })!;
    expect(ctx).toContain("ArduCopter 4.5");
    expect(ctx).toContain("Vibration is too high");
    expect(ctx).toContain("vibration peak 48");
    expect(ctx).toContain("GPS fix 3, 12 sats");
    expect(ctx).toContain("MOT_THST_HOVER=0.3");
  });

  it("omits stale telemetry from the snapshot", () => {
    const tel: Telemetry = { vibration: { at: NOW - 60000, value: { x: 99, y: 99, z: 99, clip0: 0, clip1: 0, clip2: 0 } } };
    const ctx = buildDroneContext({ vehicle, armed: false, findings: [], telemetry: tel, params: {} })!;
    expect(ctx).not.toContain("vibration peak");
  });
});

describe("buildSystemPrompt", () => {
  it("embeds the verified reference and accuracy rules", () => {
    const p = buildSystemPrompt({ context: "Vehicle: test" });
    expect(p).toContain("VERIFIED REFERENCE");
    expect(p).toContain("Never invent parameter names");
    expect(p).toContain("Vehicle: test");
  });

  it("notes when no vehicle is connected", () => {
    const p = buildSystemPrompt({ context: null });
    expect(p.toLowerCase()).toContain("no vehicle is connected");
  });
});
