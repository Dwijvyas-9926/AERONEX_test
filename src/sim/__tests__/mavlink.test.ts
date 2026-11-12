import { describe, expect, it } from "vitest";
import { encode } from "../../mavlink/encode";
import { decode, MavlinkParser, type Decoded } from "../../mavlink/parser";
import { VehicleSession } from "../../services/link/vehicleSession";
import { PRESETS } from "../airframe";
import { CMD, MODE } from "../autopilot";
import { PARAM_DEFS } from "../params";
import { predict } from "../predict";
import { defaultParams } from "../params";
import { VirtualVehicle } from "../vehicle";

const HOME = { lat: 23.0225, lon: 72.5714, altMsl: 53 };
const GCS = { sysid: 255, compid: 190 };

/** A ground station made of nothing but the MAVLink encoder and parser. */
function rig() {
  const v = new VirtualVehicle({ airframe: PRESETS[0], home: HOME });
  const parser = new MavlinkParser();
  const got: { name: string; d: Decoded }[] = [];
  const pump = (seconds: number) => {
    for (let t = 0; t < seconds; t += 0.05) {
      v.receive(encode("HEARTBEAT", { type: 6, autopilot: 8, base_mode: 0, custom_mode: 0, system_status: 4, mavlink_version: 3 }, GCS));
      v.advance(0.05, 0.05);
      for (const f of parser.push(v.drain())) got.push({ name: f.name, d: decode(f)! });
    }
  };
  const send = (name: string, fields: Record<string, number | string | number[]>) => v.receive(encode(name, { target_system: 1, target_component: 1, ...fields }, GCS));
  const cmd = (command: number, p: number[] = []) => send("COMMAND_LONG", { command, param1: p[0] ?? 0, param2: p[1] ?? 0, param3: p[2] ?? 0, param4: p[3] ?? 0, param5: p[4] ?? 0, param6: p[5] ?? 0, param7: p[6] ?? 0 });
  const last = (name: string) => [...got].reverse().find((g) => g.name === name)?.d;
  return { v, got, pump, send, cmd, last };
}

describe("the virtual aircraft over MAVLink", () => {
  it("is taken for an ArduPilot quadcopter by the app's own session", () => {
    const v = new VirtualVehicle({ airframe: PRESETS[0], home: HOME });
    const session = new VehicleSession(() => 0);
    for (let i = 0; i < 40; i++) {
      v.advance(0.05, 0.05);
      session.ingest(v.drain());
    }
    expect(session.vehicle?.firmware).toBe("ardupilot");
    expect(session.vehicle?.armed).toBe(false);
    expect(session.vehicle?.mode).toMatch(/stabilize/i);
    expect(session.telemetry.attitude).toBeDefined();
    expect(session.telemetry.position?.value.lat).toBeCloseTo(HOME.lat, 5);
    expect(session.telemetry.gps?.value.fixType).toBe(3);
    expect(session.telemetry.battery?.value.voltage).toBeGreaterThan(12);
    expect(session.telemetry.home?.value.lon).toBeCloseTo(HOME.lon, 5);
    expect(session.snapshot().stats.crcErrors).toBe(0);
  });

  it("sends its whole parameter list and echoes a write", () => {
    const r = rig();
    r.send("PARAM_REQUEST_LIST", {});
    r.pump(2);
    const values = r.got.filter((g) => g.name === "PARAM_VALUE");
    expect(new Set(values.map((g) => g.d.param_id)).size).toBe(PARAM_DEFS.length);
    expect(values[0].d.param_count).toBe(PARAM_DEFS.length);
    r.send("PARAM_SET", { param_id: "RTL_ALT", param_value: 2500, param_type: 9 });
    r.pump(0.2);
    expect(r.last("PARAM_VALUE")?.param_id).toBe("RTL_ALT");
    expect(r.last("PARAM_VALUE")?.param_value).toBe(2500);
    expect(r.v.ap.params.RTL_ALT).toBe(2500);
  });

  it("arms, takes off and lands on commands alone", () => {
    const r = rig();
    r.pump(1);
    r.cmd(176, [1, MODE.GUIDED]);
    r.cmd(400, [1]);
    r.cmd(22, [0, 0, 0, 0, 0, 0, 12]);
    r.pump(12);
    expect(r.got.filter((g) => g.name === "COMMAND_ACK").map((g) => g.d.result)).toEqual([0, 0, 0]);
    expect((r.last("GLOBAL_POSITION_INT")!.relative_alt as number) / 1000).toBeGreaterThan(11);
    expect((r.last("HEARTBEAT")!.base_mode as number) & 128).toBe(128);
    r.cmd(21);
    r.pump(40);
    expect((r.last("HEARTBEAT")!.base_mode as number) & 128).toBe(0);
    expect(r.got.some((g) => g.name === "STATUSTEXT" && /Landed/.test(String(g.d.text)))).toBe(true);
  });

  it("refuses to arm and says why", () => {
    const r = rig();
    r.v.gpsOk = false;
    r.v.ap.mode = MODE.GUIDED;
    r.pump(0.5);
    r.cmd(400, [1]);
    r.pump(0.5);
    expect(r.last("COMMAND_ACK")?.result).toBe(4);
    expect(r.got.some((g) => g.name === "STATUSTEXT" && /PreArm: Need position/.test(String(g.d.text)))).toBe(true);
  });

  it("takes a mission by the request-and-reply handshake and hands it back", () => {
    const r = rig();
    const items = [
      { seq: 0, frame: 0, command: 16, x: Math.round(HOME.lat * 1e7), y: Math.round(HOME.lon * 1e7), z: 53 },
      { seq: 1, frame: 3, command: CMD.TAKEOFF, x: 0, y: 0, z: 15 },
      { seq: 2, frame: 3, command: CMD.WAYPOINT, x: Math.round((HOME.lat + 0.0004) * 1e7), y: Math.round(HOME.lon * 1e7), z: 15 },
      { seq: 3, frame: 3, command: CMD.RTL, x: 0, y: 0, z: 0 },
    ];
    r.send("MISSION_COUNT", { count: items.length, mission_type: 0 });
    for (let guard = 0; guard < 20; guard++) {
      r.pump(0.1);
      const req = r.last("MISSION_REQUEST_INT");
      if (r.last("MISSION_ACK")) break;
      const it = items[req!.seq as number];
      r.send("MISSION_ITEM_INT", { ...it, param1: 0, param2: 0, param3: 0, param4: 0, current: 0, autocontinue: 1, mission_type: 0 });
    }
    expect(r.last("MISSION_ACK")?.type).toBe(0);
    expect(r.v.ap.mission.map((m) => m.command)).toEqual([16, 22, 16, 20]);

    r.send("MISSION_REQUEST_LIST", { mission_type: 0 });
    r.pump(0.1);
    expect(r.last("MISSION_COUNT")?.count).toBe(4);
    r.send("MISSION_REQUEST_INT", { seq: 2, mission_type: 0 });
    r.pump(0.1);
    expect(r.last("MISSION_ITEM_INT")?.x).toBe(items[2].x);

    // And flies it: Guided, arm, Auto, start.
    r.cmd(176, [1, MODE.GUIDED]);
    r.cmd(400, [1]);
    r.cmd(176, [1, MODE.AUTO]);
    r.cmd(300);
    r.pump(120);
    expect(r.got.filter((g) => g.name === "MISSION_ITEM_REACHED").map((g) => g.d.seq)).toEqual([1, 2, 3]);
    expect((r.last("HEARTBEAT")!.base_mode as number) & 128).toBe(0);
  });

  it("lands when this ground station stops sending heartbeats, if set to", () => {
    const r = rig();
    r.send("PARAM_SET", { param_id: "FS_GCS_ENABLE", param_value: 5, param_type: 9 });
    r.cmd(176, [1, MODE.GUIDED]);
    r.cmd(400, [1]);
    r.cmd(22, [0, 0, 0, 0, 0, 0, 10]);
    r.pump(8);
    // The ground station falls silent: advance the aircraft with no heartbeats.
    for (let i = 0; i < 140; i++) r.v.advance(0.05, 0.05);
    expect(r.v.ap.mode).toBe(MODE.LAND);
  });
});

describe("predicting a flight", () => {
  const M = 111319.5;
  const at = (n: number, e: number) => ({ x: Math.round((HOME.lat + n / M) * 1e7), y: Math.round((HOME.lon + e / (M * Math.cos((HOME.lat * Math.PI) / 180))) * 1e7) });
  const mission = (side: number, end: number | null = CMD.RTL) => [
    { seq: 0, frame: 0, command: 16, p1: 0, p2: 0, p3: 0, p4: 0, ...at(0, 0), z: 53 },
    { seq: 1, frame: 3, command: CMD.TAKEOFF, p1: 0, p2: 0, p3: 0, p4: 0, x: 0, y: 0, z: 25 },
    { seq: 2, frame: 3, command: CMD.WAYPOINT, p1: 0, p2: 0, p3: 0, p4: 0, ...at(side, 0), z: 25 },
    { seq: 3, frame: 3, command: CMD.WAYPOINT, p1: 0, p2: 0, p3: 0, p4: 0, ...at(side, side), z: 25 },
    ...(end === null ? [] : [{ seq: 4, frame: 3, command: end, p1: 0, p2: 0, p3: 0, p4: 0, x: 0, y: 0, z: 0 }]),
  ];
  const calm = { windSpeed: 0, windFromDeg: 0, gust: 0, soc: 1, faults: [] };
  const P = defaultParams(PRESETS[0]);

  it("reports a clean flight as completed, and still names the protection that is off", () => {
    const r = predict(PRESETS[0], P, HOME, mission(100), calm);
    expect(r.verdict).toBe("completed");
    expect(r.stats.reached).toEqual([1, 2, 3, 4]);
    expect(r.findings.some((f) => /No battery failsafe/.test(f.text))).toBe(true);
    expect(r.findings.some((f) => /FS_GCS_ENABLE/.test(f.text))).toBe(true);
    expect(r.track.length).toBeGreaterThan(50);
  });

  it("says a mission too long for the battery ends in a crash", () => {
    const r = predict(PRESETS[0], { ...P, BATT_LOW_VOLT: 0 }, HOME, mission(1500), { ...calm, soc: 0.3 });
    expect(r.verdict).toBe("crashed");
    expect(r.headline).toMatch(/battery ran flat/);
  });

  it("says the same mission comes home once a battery failsafe is set", () => {
    const r = predict(PRESETS[0], { ...P, BATT_LOW_VOLT: 0, BATT_LOW_MAH: 1500, BATT_FS_LOW_ACT: 2 }, HOME, mission(1500), { ...calm, soc: 0.5 });
    expect(r.stats.endSoc).toBeGreaterThan(0.05);
    expect(r.verdict).toBe("came-home");
    expect(r.findings.some((f) => /low battery failsafe fired/.test(f.text))).toBe(true);
  });

  it("injects a fault at a waypoint", () => {
    const motor = predict(PRESETS[0], P, HOME, mission(100), { ...calm, faults: [{ kind: "motor", motor: 1, level: 0, at: { waypoint: 2 } }] });
    expect(motor.verdict).toBe("crashed");
    expect(motor.stats.endN).toBeGreaterThan(60);
    const gps = predict(PRESETS[0], P, HOME, mission(100), { ...calm, windSpeed: 2.5, windFromDeg: 270, faults: [{ kind: "gps", at: { waypoint: 2 } }] });
    expect(gps.verdict).toBe("landed-away");
    expect(gps.findings[0].text).toMatch(/Position was lost/);
    // The same loss in a stiff wind: it comes down drifting too fast to stay upright.
    const windy = predict(PRESETS[0], P, HOME, mission(100), { ...calm, windSpeed: 7, windFromDeg: 270, faults: [{ kind: "gps", at: { waypoint: 2 } }] });
    expect(windy.verdict).toBe("crashed");
    expect(windy.headline).toMatch(/drifting sideways/);
  });

  it("says a mission with no ending hovers at the last waypoint", () => {
    const r = predict(PRESETS[0], P, HOME, mission(60, null), calm);
    expect(r.verdict).toBe("holding");
    expect(r.findings.some((f) => /does not end with a return/.test(f.text))).toBe(true);
  });

  it("is the same every time it is run", () => {
    const sc = { ...calm, windSpeed: 5, windFromDeg: 40, gust: 0.4 };
    const a = predict(PRESETS[0], P, HOME, mission(80), sc);
    const b = predict(PRESETS[0], P, HOME, mission(80), sc);
    expect(a.stats.usedMah).toBe(b.stats.usedMah);
    expect(a.stats.durationS).toBe(b.stats.durationS);
  });
});
