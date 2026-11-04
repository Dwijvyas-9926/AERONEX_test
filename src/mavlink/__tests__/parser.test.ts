import { describe, expect, it } from "vitest";
import fixtures from "./fixtures.json";
import { decode, MavlinkParser } from "../parser";
import { firmwareFamily, flightModeLabel, isArmed, isAutopilotHeartbeat, type Heartbeat } from "../identity";

// Fixtures are real frames encoded by pymavlink (see scripts/gen_dialect.py notes in README).
const F = fixtures as Record<string, number[]>;
const bytes = (k: string) => new Uint8Array(F[k]);

describe("MavlinkParser", () => {
  it("parses a v2 ArduPilot heartbeat and decodes its fields", () => {
    const p = new MavlinkParser();
    const frames = p.push(bytes("v2_heartbeat_ardupilot"));
    expect(frames).toHaveLength(1);
    const f = frames[0];
    expect(f.version).toBe(2);
    expect(f.name).toBe("HEARTBEAT");
    expect([f.sysid, f.compid]).toEqual([1, 1]);
    const hb = decode(f) as unknown as Heartbeat;
    expect(hb.type).toBe(2);
    expect(firmwareFamily(hb.autopilot)).toBe("ardupilot");
    expect(isArmed(hb)).toBe(true);
    expect(flightModeLabel(hb)).toBe("Loiter");
    expect(isAutopilotHeartbeat(hb)).toBe(true);
  });

  it("parses a v1 heartbeat", () => {
    const p = new MavlinkParser();
    const [f] = p.push(bytes("v1_heartbeat_ardupilot"));
    expect(f.version).toBe(1);
    const hb = decode(f) as unknown as Heartbeat;
    expect(isArmed(hb)).toBe(false);
    expect(flightModeLabel(hb)).toBe("Stabilize");
  });

  it("identifies PX4 and its auto sub-mode", () => {
    const [f] = new MavlinkParser().push(bytes("v2_heartbeat_px4"));
    const hb = decode(f) as unknown as Heartbeat;
    expect(firmwareFamily(hb.autopilot)).toBe("px4");
    expect(flightModeLabel(hb)).toBe("Auto: Mission");
  });

  it("does not treat a GCS heartbeat as a vehicle", () => {
    const [f] = new MavlinkParser().push(bytes("v2_heartbeat_gcs"));
    expect(isAutopilotHeartbeat(decode(f) as unknown as Heartbeat)).toBe(false);
  });

  it("decodes v2 zero-truncated payloads (ATTITUDE, SYS_STATUS, GPS_RAW_INT, STATUSTEXT)", () => {
    const p = new MavlinkParser();
    const att = decode(p.push(bytes("v2_attitude"))[0])!;
    expect(att.roll as number).toBeCloseTo(0.1, 5);
    expect(att.pitch as number).toBeCloseTo(-0.2, 5);
    expect(att.yaw as number).toBeCloseTo(1.5, 5);
    const ss = decode(p.push(bytes("v2_sys_status"))[0])!;
    expect(ss.voltage_battery).toBe(15800);
    expect(ss.battery_remaining).toBe(-1); // int8: -1 means "not reported"
    expect(ss.current_battery).toBe(1200);
    const gps = decode(p.push(bytes("v2_gps_raw_int"))[0])!;
    expect(gps.fix_type).toBe(3);
    expect(gps.satellites_visible).toBe(11);
    expect(gps.lat).toBe(214000000);
    const st = decode(p.push(bytes("v2_statustext"))[0])!;
    expect(st.text).toBe("PreArm: Compass not calibrated");
  });

  it("reassembles frames split across chunks and skips leading noise", () => {
    const p = new MavlinkParser();
    const all = new Uint8Array([0x00, 0x13, 0x37, ...F.v2_heartbeat_ardupilot, ...F.v2_attitude]);
    const out = [];
    for (let i = 0; i < all.length; i += 5) out.push(...p.push(all.subarray(i, i + 5)));
    expect(out.map((f) => f.name)).toEqual(["HEARTBEAT", "ATTITUDE"]);
  });

  it("rejects a frame with a corrupted payload", () => {
    const p = new MavlinkParser();
    const bad = bytes("v2_heartbeat_ardupilot");
    bad[12] ^= 0xff;
    expect(p.push(bad)).toHaveLength(0);
    expect(p.stats.crcErrors).toBeGreaterThan(0);
  });

  it("finds nothing in non-MAVLink data (e.g. wrong baud rate)", () => {
    const p = new MavlinkParser();
    const junk = new Uint8Array(2000).map((_, i) => (i * 73 + 11) & 0xff);
    expect(p.push(junk)).toHaveLength(0);
    expect(p.stats.framesOk).toBe(0);
  });
});
