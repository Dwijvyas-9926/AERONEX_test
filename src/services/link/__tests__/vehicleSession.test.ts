import { describe, expect, it } from "vitest";
import fixtures from "../../../mavlink/__tests__/fixtures.json";
import { VehicleSession } from "../vehicleSession";

const F = fixtures as Record<string, number[]>;
const b = (...keys: string[]) => new Uint8Array(keys.flatMap((k) => F[k]));

describe("VehicleSession", () => {
  it("ignores telemetry until an autopilot heartbeat identifies the vehicle", () => {
    const s = new VehicleSession(() => 1000);
    s.ingest(b("v2_attitude"));
    expect(s.telemetry.attitude).toBeUndefined();
    expect(s.vehicle).toBeNull();
  });

  it("does not adopt a GCS heartbeat as the vehicle", () => {
    const s = new VehicleSession(() => 1000);
    s.ingest(b("v2_heartbeat_gcs"));
    expect(s.vehicle).toBeNull();
    expect(s.lastHeartbeatAt).toBeNull();
  });

  it("identifies the vehicle and then accepts its telemetry with timestamps", () => {
    let t = 1000;
    const s = new VehicleSession(() => t);
    expect(s.ingest(b("v2_heartbeat_ardupilot"))).toBe(true);
    expect(s.vehicle?.firmware).toBe("ardupilot");
    expect(s.vehicle?.mode).toBe("Loiter");
    expect(s.vehicle?.armed).toBe(true);
    t = 1200;
    s.ingest(b("v2_attitude", "v2_sys_status", "v2_gps_raw_int", "v2_statustext"));
    expect(s.telemetry.attitude?.at).toBe(1200);
    expect(s.telemetry.attitude?.value.yaw).toBeCloseTo(1.5);
    expect(s.telemetry.battery?.value.voltage).toBeCloseTo(15.8);
    expect(s.telemetry.battery?.value.remaining).toBeNull(); // -1 = not reported, never shown as a number
    expect(s.telemetry.gps?.value.satellites).toBe(11);
    expect(s.events[0].text).toContain("PreArm: Compass not calibrated");
  });
});
