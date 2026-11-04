import { describe, expect, it } from "vitest";
import { encode } from "../encode";
import { decode, MavlinkParser } from "../parser";

/*
  Reference frames were produced by pymavlink (v2.4.50, ardupilotmega dialect)
  with srcSystem=255, srcComponent=190, seq=0 — the same encoder a real GCS
  uses. encode() must reproduce them byte-for-byte, including MAVLink 2 trailing-
  zero truncation. See scripts note in encode.ts.
*/
const SRC = { sysid: 255, compid: 190, seq: 0 };
const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const REFERENCE: Record<string, { name: string; fields: Record<string, number | string | number[]>; hex: string }> = {
  "COMMAND_LONG accel cal": {
    name: "COMMAND_LONG",
    fields: { target_system: 1, target_component: 1, command: 241, confirmation: 0, param1: 0, param2: 0, param3: 0, param4: 0, param5: 1, param6: 0, param7: 0 },
    hex: "fd20000000ffbe4c0000000000000000000000000000000000000000803f0000000000000000f10001013c73",
  },
  "PARAM_SET COMPASS_USE": {
    name: "PARAM_SET",
    fields: { target_system: 1, target_component: 1, param_id: "COMPASS_USE", param_value: 1.0, param_type: 9 },
    hex: "fd17000000ffbe1700000000803f0101434f4d504153535f5553450000000000092abd",
  },
  "PARAM_REQUEST_READ FLTMODE1": {
    name: "PARAM_REQUEST_READ",
    fields: { target_system: 1, target_component: 1, param_id: "FLTMODE1", param_index: -1 },
    hex: "fd0c000000ffbe140000ffff0101464c544d4f444531a406",
  },
  PARAM_REQUEST_LIST: {
    name: "PARAM_REQUEST_LIST",
    fields: { target_system: 1, target_component: 1 },
    hex: "fd02000000ffbe150000010188c0",
  },
  "COMMAND_ACK accel step 0": {
    name: "COMMAND_ACK",
    fields: { command: 0, result: 1 },
    hex: "fd03000000ffbe4d0000000001db18",
  },
  "COMMAND_LONG start mag cal": {
    name: "COMMAND_LONG",
    fields: { target_system: 1, target_component: 1, command: 42424, confirmation: 0, param1: 0, param2: 0, param3: 1, param4: 0, param5: 0, param6: 0, param7: 0 },
    hex: "fd20000000ffbe4c000000000000000000000000803f00000000000000000000000000000000b8a50101cd4f",
  },
  "REQUEST_DATA_STREAM EXTRA1": {
    name: "REQUEST_DATA_STREAM",
    // EXTRA1 (attitude) at 10 Hz, start.
    fields: { target_system: 1, target_component: 1, req_stream_id: 10, req_message_rate: 10, start_stop: 1 },
    hex: "fd06000000ffbe4200000a0001010a012224",
  },
  "COMMAND_LONG motor test": {
    name: "COMMAND_LONG",
    // DO_MOTOR_TEST: motor 1, throttle type 0 (percent), 10%, 3 s timeout.
    fields: { target_system: 1, target_component: 1, command: 209, confirmation: 0, param1: 1, param2: 0, param3: 10, param4: 3, param5: 0, param6: 0, param7: 0 },
    hex: "fd20000000ffbe4c00000000803f000000000000204100004040000000000000000000000000d1000101deb6",
  },
  "COMMAND_LONG reboot": {
    name: "COMMAND_LONG",
    // PREFLIGHT_REBOOT_SHUTDOWN: param1=1 → reboot autopilot; confirmation=0.
    fields: { target_system: 1, target_component: 1, command: 246, confirmation: 0, param1: 1, param2: 0, param3: 0, param4: 0, param5: 0, param6: 0, param7: 0 },
    hex: "fd20000000ffbe4c00000000803f000000000000000000000000000000000000000000000000f60001010ec8",
  },
};

describe("MAVLink encoder matches pymavlink byte-for-byte", () => {
  for (const [label, c] of Object.entries(REFERENCE)) {
    it(label, () => {
      expect(hex(encode(c.name, c.fields, SRC))).toBe(c.hex);
    });
  }
});

describe("encoded frames round-trip through the parser", () => {
  it("decodes a COMMAND_LONG back to its field values", () => {
    const bytes = encode(
      "COMMAND_LONG",
      { target_system: 3, target_component: 1, command: 42424, confirmation: 0, param1: 0, param2: 0, param3: 1, param4: 0, param5: 0, param6: 0, param7: 0 },
      { sysid: 255, compid: 190 },
    );
    const parser = new MavlinkParser();
    const frames = parser.push(bytes);
    expect(frames).toHaveLength(1);
    expect(frames[0].name).toBe("COMMAND_LONG");
    expect(frames[0].sysid).toBe(255);
    const d = decode(frames[0])!;
    expect(d.command).toBe(42424);
    expect(d.target_system).toBe(3);
    expect(d.param3).toBeCloseTo(1, 5);
    expect(parser.stats.crcErrors).toBe(0);
  });

  it("round-trips a PARAM_SET string id and value", () => {
    const bytes = encode("PARAM_SET", { target_system: 1, target_component: 1, param_id: "MOT_PWM_TYPE", param_value: 6, param_type: 9 }, { sysid: 255, compid: 190 });
    const parser = new MavlinkParser();
    const [frame] = parser.push(bytes);
    const d = decode(frame)!;
    expect(d.param_id).toBe("MOT_PWM_TYPE");
    expect(d.param_value).toBeCloseTo(6, 5);
    expect(d.param_type).toBe(9);
  });
});
