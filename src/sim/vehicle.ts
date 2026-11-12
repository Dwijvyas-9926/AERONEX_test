import { encode, type FieldValue } from "../mavlink/encode";
import { decode, MavlinkParser, type Decoded } from "../mavlink/parser";
import type { Airframe } from "./airframe";
import { Autopilot, MODE, type Home, type Inputs, type MissionItem, type SimEvent } from "./autopilot";
import { defaultParams, PARAM_DEFS, type Params } from "./params";
import { euler, Physics } from "./physics";
import type { Terrain } from "./terrain";

/*
  A virtual aircraft that speaks MAVLink.

  It is the physics, the flight-controller model and a MAVLink endpoint in
  one object. Bytes go in exactly as they would go down a serial cable to a
  Pixhawk, and bytes come out the same way, so the rest of the app cannot
  tell it from hardware and nothing in the app is special-cased for it.
*/

export interface VehicleOptions {
  airframe: Airframe;
  home: Home;
  params?: Params;
  /** State of charge at the start, 0–1. */
  soc?: number;
  yawDeg?: number;
  seed?: number;
  /** The landscape. Level ground when left out. */
  terrain?: Terrain;
}

const SELF = { sysid: 1, compid: 1 };
export const SIM_DT = 1 / 400;

// SYS_STATUS sensor bits.
const SENS = { GYRO: 1, ACCEL: 2, MAG: 4, BARO: 8, GPS: 32, RATE: 1024, ATT: 2048, YAW: 4096, ALT: 8192, XY: 16384, MOTORS: 32768, RC: 65536, AHRS: 2097152, BATTERY: 33554432, PREARM: 268435456 };

export class VirtualVehicle {
  readonly phys: Physics;
  readonly ap: Autopilot;
  readonly home: Home;
  terrain: Terrain | null = null;
  gpsOk = true;
  rcOk = true;
  sticks: Inputs["sticks"] = null;
  /** In a scripted run there is no real ground station: say whether one is "there". */
  scriptedGcs: boolean | null = null;

  private parser = new MavlinkParser();
  private outbox: Uint8Array[] = [];
  private seq = 0;
  /** Wall-clock seconds, advanced by the host; telemetry is paced on it. */
  private clock = 0;
  private due: Record<string, number> = {};
  private gcsHeardAt: number | null = null;
  private gcsLostAt: number | null = null;
  private sentEvents = 0;
  private paramQueue: number[] = [];
  private upload: { count: number; next: number; items: MissionItem[] } | null = null;
  private accelCal: number | null = null;
  private magCal: { start: number; last: number } | null = null;
  private paramNames: string[];
  private rcOverrideAt = -1;

  constructor(o: VehicleOptions) {
    this.home = o.home;
    this.phys = new Physics(o.airframe, { soc: o.soc, yawDeg: o.yawDeg, seed: o.seed });
    if (o.terrain) {
      this.terrain = o.terrain;
      this.phys.ground = o.terrain.surface;
      this.phys.water = o.terrain.isWater;
    }
    this.ap = new Autopilot(this.phys, { ...defaultParams(o.airframe), ...(o.params ?? {}) }, o.home);
    this.ap.mode = MODE.STABILIZE;
    this.ap.onReached = (seq) => this.send("MISSION_ITEM_REACHED", { seq });
    this.paramNames = PARAM_DEFS.map((d) => d.name);
  }

  /* ----------------------------------------------------------- stepping */

  inputs(): Inputs {
    const silent = this.scriptedGcs !== null ? (this.scriptedGcs ? 0 : this.phys.s.t - (this.gcsLostAt ?? this.phys.s.t)) : this.gcsHeardAt === null ? 0 : this.clock - this.gcsHeardAt;
    return {
      gpsOk: this.gpsOk,
      rcOk: this.rcOk,
      gcsSilentS: silent,
      gcsSeen: this.scriptedGcs !== null ? true : this.gcsHeardAt !== null,
      sticks: this.sticks,
    };
  }

  /** In a scripted run, connect or cut the ground-station link. */
  setScriptedGcs(present: boolean) {
    if (this.scriptedGcs !== false && !present) this.gcsLostAt = this.phys.s.t;
    this.scriptedGcs = present;
  }

  /** Advance the simulation by `simSeconds`; `wallSeconds` paces telemetry. */
  advance(simSeconds: number, wallSeconds = simSeconds, telemetry = true) {
    const steps = Math.max(0, Math.round(simSeconds / SIM_DT));
    for (let i = 0; i < steps; i++) {
      this.ap.step(SIM_DT, this.inputs());
      this.phys.step(this.ap.out, SIM_DT);
    }
    this.clock += wallSeconds;
    // Stick overrides lapse if the ground station stops sending them.
    if (this.sticks && this.rcOverrideAt >= 0 && this.clock - this.rcOverrideAt > 1.5) this.sticks = null;
    if (telemetry) this.emit();
  }

  /** Everything the vehicle has to say since the last call, as one buffer. */
  drain(): Uint8Array {
    const n = this.outbox.reduce((a, b) => a + b.length, 0);
    const out = new Uint8Array(n);
    let at = 0;
    for (const b of this.outbox) {
      out.set(b, at);
      at += b.length;
    }
    this.outbox = [];
    return out;
  }

  /** Put it back on the ground at home, as it started. */
  reset(soc = 1) {
    const s = this.phys.s;
    this.ap.disarm("Reset");
    Object.assign(s, { pos: [0, 0, -this.phys.ground(0, 0)], vel: [0, 0, 0], acc: [0, 0, 0], w: [0, 0, 0], thrust: [0, 0, 0, 0], onGround: true, crashed: false, crashWhy: null, usedMah: (1 - soc) * this.phys.af.capacityMah });
    this.phys.faults.motor = [1, 1, 1, 1];
    this.gpsOk = true;
    this.rcOk = true;
    this.ap.landed = true;
    this.ap.failsafes.clear();
    this.ap.mode = MODE.STABILIZE;
    this.ap.log("info", "Aircraft reset to home");
  }

  /* ----------------------------------------------------------- outbound */

  private send(name: string, fields: Record<string, FieldValue>) {
    this.outbox.push(encode(name, fields, { ...SELF, seq: this.seq++ & 0xff }));
  }

  private every(key: string, hz: number): boolean {
    const next = this.due[key] ?? 0;
    if (this.clock < next) return false;
    this.due[key] = Math.max(next + 1 / hz, this.clock - 1 / hz);
    return true;
  }

  private text(sev: number, text: string) {
    this.send("STATUSTEXT", { severity: sev, text: text.slice(0, 50) });
  }

  private emit() {
    const { phys, ap } = this;
    const s = phys.s;
    const e = euler(s.q);
    const ms = Math.round(s.t * 1000) >>> 0;
    const g = ap.toGlobal(s.pos[0], s.pos[1]);
    const alt = -s.pos[2];
    const inp = this.inputs();

    // The autopilot's own log, as status text.
    for (; this.sentEvents < ap.events.length; this.sentEvents++) {
      const ev = ap.events[this.sentEvents];
      this.text(ev.sev === "error" ? 3 : ev.sev === "warn" ? 4 : 6, ev.text);
    }
    if (ap.events.length > 300) {
      ap.events.splice(0, 200);
      this.sentEvents = Math.max(0, this.sentEvents - 200);
    }

    if (this.every("hb", 1)) {
      const failsafe = ap.failsafes.size > 0 && ap.armed;
      this.send("HEARTBEAT", {
        type: 2,
        autopilot: 3,
        base_mode: 1 | 16 | 64 | (ap.armed ? 128 : 0),
        custom_mode: ap.mode,
        system_status: s.crashed ? 6 : failsafe ? 5 : ap.armed ? 4 : 3,
        mavlink_version: 3,
      });
    }
    if (this.every("att", 10)) {
      this.send("ATTITUDE", { time_boot_ms: ms, roll: e.roll, pitch: e.pitch, yaw: e.yaw, rollspeed: s.w[0], pitchspeed: s.w[1], yawspeed: s.w[2] });
    }
    const hdg = ((e.yaw * 180) / Math.PI + 360) % 360;
    if (this.gpsOk && this.every("pos", 5)) {
      this.send("GLOBAL_POSITION_INT", {
        time_boot_ms: ms,
        lat: Math.round(g.lat * 1e7),
        lon: Math.round(g.lon * 1e7),
        alt: Math.round((this.home.altMsl + alt) * 1000),
        relative_alt: Math.round(alt * 1000),
        vx: Math.round(s.vel[0] * 100),
        vy: Math.round(s.vel[1] * 100),
        vz: Math.round(s.vel[2] * 100),
        hdg: Math.round(hdg * 100),
      });
    }
    if (this.every("hud", 5)) {
      const gs = Math.hypot(s.vel[0], s.vel[1]);
      const w = phys.wind();
      this.send("VFR_HUD", {
        airspeed: Math.hypot(s.vel[0] - w[0], s.vel[1] - w[1]),
        groundspeed: gs,
        heading: Math.round(hdg),
        throttle: Math.round(ap.throttleOut * 100),
        alt: this.home.altMsl + alt,
        climb: -s.vel[2],
      });
    }
    if (this.every("gps", 2)) {
      this.send("GPS_RAW_INT", {
        time_usec: ms * 1000,
        fix_type: this.gpsOk ? 3 : 1,
        lat: this.gpsOk ? Math.round(g.lat * 1e7) : 0,
        lon: this.gpsOk ? Math.round(g.lon * 1e7) : 0,
        alt: Math.round((this.home.altMsl + alt) * 1000),
        eph: this.gpsOk ? 80 : 9999,
        epv: this.gpsOk ? 120 : 9999,
        vel: Math.round(Math.hypot(s.vel[0], s.vel[1]) * 100),
        cog: Math.round(((Math.atan2(s.vel[1], s.vel[0]) * 180) / Math.PI + 360) % 360 * 100),
        satellites_visible: this.gpsOk ? 14 : 0,
      });
    }
    if (this.every("sys", 2)) {
      const present = SENS.GYRO | SENS.ACCEL | SENS.MAG | SENS.BARO | SENS.GPS | SENS.RATE | SENS.ATT | SENS.YAW | SENS.ALT | SENS.XY | SENS.MOTORS | SENS.RC | SENS.AHRS | SENS.BATTERY | SENS.PREARM;
      let health = present;
      if (!this.gpsOk) health &= ~(SENS.GPS | SENS.XY);
      if (!this.rcOk) health &= ~SENS.RC;
      if (ap.failsafes.has("batt-low") || ap.failsafes.has("batt-critical")) health &= ~SENS.BATTERY;
      if (phys.faults.motor.some((m) => m < 0.5)) health &= ~SENS.MOTORS;
      if (!ap.armed && ap.prearm(inp).length > 0) health &= ~SENS.PREARM;
      this.send("SYS_STATUS", {
        onboard_control_sensors_present: present,
        onboard_control_sensors_enabled: present,
        onboard_control_sensors_health: health,
        load: 180,
        voltage_battery: Math.round(s.volts * 1000),
        current_battery: Math.round(s.amps * 100),
        battery_remaining: Math.max(0, Math.min(100, Math.round(phys.soc * 100))),
      });
    }
    if (this.every("batt", 1)) {
      const cells = Array.from({ length: 10 }, (_, i) => (i < phys.af.cells ? Math.round((s.volts / phys.af.cells) * 1000) : 65535));
      this.send("BATTERY_STATUS", {
        id: 0,
        battery_function: 1,
        type: 1,
        temperature: 32767,
        voltages: cells,
        current_battery: Math.round(s.amps * 100),
        current_consumed: Math.round(s.usedMah),
        energy_consumed: -1,
        battery_remaining: Math.max(0, Math.min(100, Math.round(phys.soc * 100))),
      });
    }
    if (this.every("ekf", 1)) {
      this.send("EKF_STATUS_REPORT", {
        flags: this.gpsOk ? 831 : 165,
        velocity_variance: this.gpsOk ? 0.04 : 0.9,
        pos_horiz_variance: this.gpsOk ? 0.03 : 1.2,
        pos_vert_variance: 0.04,
        compass_variance: 0.03,
        terrain_alt_variance: 0,
      });
    }
    if (this.every("vibe", 1)) {
      const worst = Math.min(...phys.faults.motor);
      const level = ap.armed ? 4 + 14 * ap.throttleOut + (worst < 0.95 ? 25 * (1 - worst) : 0) : 0.3;
      this.send("VIBRATION", { time_usec: ms * 1000, vibration_x: level, vibration_y: level * 1.05, vibration_z: level * 1.4, clipping_0: 0, clipping_1: 0, clipping_2: 0 });
    }
    if (this.every("rc", 2)) {
      const st = this.sticks;
      const pwm = (v: number) => Math.round(1500 + 500 * v);
      const f: Record<string, FieldValue> = { time_boot_ms: ms, chancount: this.rcOk ? 8 : 0, rssi: this.rcOk ? 200 : 0 };
      const ch = [pwm(st?.roll ?? 0), pwm(st?.pitch ?? 0), Math.round(1000 + 1000 * (st?.throttle ?? 0)), pwm(st?.yaw ?? 0), 1500, 1500, 1500, 1500];
      for (let i = 1; i <= 18; i++) f[`chan${i}_raw`] = this.rcOk && i <= 8 ? ch[i - 1] : 0;
      this.send("RC_CHANNELS", f);
    }
    if (this.every("mis", 1)) this.send("MISSION_CURRENT", { seq: ap.missionSeq });
    if (this.every("home", 0.2)) this.sendHome();

    // A parameter download is paced, as a real one is.
    for (let n = 0; n < 12 && this.paramQueue.length; n++) this.sendParam(this.paramQueue.shift()!);

    // Compass calibration: reports progress, then succeeds.
    if (this.magCal && this.clock - this.magCal.last > 0.4) {
      this.magCal.last = this.clock;
      const pct = Math.min(100, Math.round(((this.clock - this.magCal.start) / 6) * 100));
      if (pct < 100) {
        this.send("MAG_CAL_PROGRESS", { compass_id: 0, cal_mask: 1, cal_status: 3, attempt: 1, completion_pct: pct, completion_mask: Array(10).fill(pct > 50 ? 255 : 15), direction_x: 0, direction_y: 0, direction_z: 0 });
      } else {
        this.send("MAG_CAL_REPORT", { compass_id: 0, cal_mask: 1, cal_status: 4, autosaved: 1, fitness: 6.5, ofs_x: 12, ofs_y: -8, ofs_z: 31, diag_x: 1, diag_y: 1, diag_z: 1, offdiag_x: 0, offdiag_y: 0, offdiag_z: 0 });
        this.magCal = null;
      }
    }
  }

  private sendHome() {
    this.send("HOME_POSITION", { latitude: Math.round(this.home.lat * 1e7), longitude: Math.round(this.home.lon * 1e7), altitude: Math.round(this.home.altMsl * 1000), x: 0, y: 0, z: 0, q: [1, 0, 0, 0], approach_x: 0, approach_y: 0, approach_z: 0 });
  }

  private sendParam(index: number, listed = true) {
    const name = this.paramNames[index];
    if (!name) return;
    this.send("PARAM_VALUE", { param_id: name, param_value: this.ap.params[name], param_type: 9, param_count: this.paramNames.length, param_index: listed ? index : 65535 });
  }

  private ack(command: number, result: number) {
    this.send("COMMAND_ACK", { command, result });
  }

  /* ------------------------------------------------------------ inbound */

  /** Bytes from the ground station. */
  receive(bytes: Uint8Array) {
    for (const f of this.parser.push(bytes)) {
      const d = decode(f);
      if (!d) continue;
      if (f.name === "HEARTBEAT") {
        this.gcsHeardAt = this.clock;
        continue;
      }
      const ts = d.target_system as number | undefined;
      if (ts !== undefined && ts !== 0 && ts !== SELF.sysid) continue;
      this.handle(f.name, d);
    }
  }

  private handle(name: string, d: Decoded) {
    const ap = this.ap;
    const num = (k: string) => (d[k] as number) ?? 0;
    switch (name) {
      case "PARAM_REQUEST_LIST":
        this.paramQueue = this.paramNames.map((_, i) => i);
        break;
      case "PARAM_REQUEST_READ": {
        const idx = num("param_index");
        const i = idx >= 0 && idx < 65535 ? idx : this.paramNames.indexOf(String(d.param_id ?? ""));
        if (i >= 0) this.sendParam(i, idx >= 0 && idx < 65535);
        break;
      }
      case "PARAM_SET": {
        const id = String(d.param_id ?? "");
        const i = this.paramNames.indexOf(id);
        if (i < 0) break;
        const v = num("param_value");
        if (Number.isFinite(v)) ap.params[id] = Math.fround(v);
        this.sendParam(i, false);
        break;
      }
      case "SET_MODE":
        ap.setMode(num("custom_mode"), this.inputs(), "ground station");
        break;
      case "COMMAND_LONG":
        this.command(num("command"), [num("param1"), num("param2"), num("param3"), num("param4"), num("param5"), num("param6"), num("param7")]);
        break;
      case "COMMAND_INT":
        this.command(num("command"), [num("param1"), num("param2"), num("param3"), num("param4"), num("x") / 1e7, num("y") / 1e7, num("z")]);
        break;
      case "COMMAND_ACK":
        // The ground station confirming an accelerometer-calibration position.
        if (this.accelCal !== null) this.accelStep(this.accelCal + 1);
        break;
      case "SET_POSITION_TARGET_LOCAL_NED":
        ap.guidedVelocity(num("vx"), num("vy"), num("vz"), num("yaw_rate"));
        break;
      case "SET_POSITION_TARGET_GLOBAL_INT": {
        const l = ap.toLocal(num("lat_int"), num("lon_int"));
        ap.guidedGoto(l.n, l.e, num("alt"));
        break;
      }
      case "RC_CHANNELS_OVERRIDE": {
        const c = (i: number) => num(`chan${i}_raw`);
        if (c(1) === 0 && c(3) === 0) {
          this.sticks = null;
          break;
        }
        const n = (v: number) => Math.max(-1, Math.min(1, (v - 1500) / 500));
        this.sticks = { roll: n(c(1)), pitch: n(c(2)), throttle: Math.max(0, Math.min(1, (c(3) - 1000) / 1000)), yaw: n(c(4)) };
        this.rcOverrideAt = this.clock;
        break;
      }
      case "MISSION_COUNT": {
        if (num("mission_type") !== 0) {
          this.send("MISSION_ACK", { target_system: 255, target_component: 190, type: num("count") === 0 ? 0 : 3, mission_type: num("mission_type") });
          break;
        }
        const count = num("count");
        if (count === 0) {
          ap.mission = [];
          this.send("MISSION_ACK", { target_system: 255, target_component: 190, type: 0, mission_type: 0 });
          break;
        }
        this.upload = { count, next: 0, items: [] };
        this.send("MISSION_REQUEST_INT", { target_system: 255, target_component: 190, seq: 0, mission_type: 0 });
        break;
      }
      case "MISSION_ITEM_INT":
      case "MISSION_ITEM": {
        const u = this.upload;
        if (!u) break;
        const seq = num("seq");
        if (seq !== u.next) {
          this.send("MISSION_REQUEST_INT", { target_system: 255, target_component: 190, seq: u.next, mission_type: 0 });
          break;
        }
        const scale = name === "MISSION_ITEM" ? 1e7 : 1;
        u.items.push({ seq, frame: num("frame"), command: num("command"), p1: num("param1"), p2: num("param2"), p3: num("param3"), p4: num("param4"), x: Math.round(num("x") * scale), y: Math.round(num("y") * scale), z: num("z") });
        u.next++;
        if (u.next < u.count) {
          this.send("MISSION_REQUEST_INT", { target_system: 255, target_component: 190, seq: u.next, mission_type: 0 });
        } else {
          ap.mission = u.items;
          ap.missionSeq = 0;
          this.upload = null;
          this.send("MISSION_ACK", { target_system: 255, target_component: 190, type: 0, mission_type: 0 });
          ap.log("info", `Mission received: ${u.items.length - 1} commands`);
        }
        break;
      }
      case "MISSION_REQUEST_LIST":
        this.send("MISSION_COUNT", { target_system: 255, target_component: 190, count: num("mission_type") === 0 ? ap.mission.length : 0, mission_type: num("mission_type") });
        break;
      case "MISSION_REQUEST_INT":
      case "MISSION_REQUEST": {
        const it = ap.mission[num("seq")];
        if (!it) {
          this.send("MISSION_ACK", { target_system: 255, target_component: 190, type: 13, mission_type: 0 });
          break;
        }
        this.send("MISSION_ITEM_INT", { target_system: 255, target_component: 190, seq: it.seq, frame: it.frame, command: it.command, current: it.seq === ap.missionSeq ? 1 : 0, autocontinue: 1, param1: it.p1, param2: it.p2, param3: it.p3, param4: it.p4, x: it.x, y: it.y, z: it.z, mission_type: 0 });
        break;
      }
      case "MISSION_CLEAR_ALL":
        ap.mission = [];
        ap.missionSeq = 0;
        this.send("MISSION_ACK", { target_system: 255, target_component: 190, type: 0, mission_type: num("mission_type") });
        break;
      case "MISSION_SET_CURRENT":
        if (num("seq") < ap.mission.length) ap.missionSeq = num("seq");
        break;
    }
  }

  private command(cmd: number, p: number[]) {
    const ap = this.ap;
    const inp = this.inputs();
    switch (cmd) {
      case 400: {
        if (p[0] >= 0.5) {
          const why = ap.arm(inp, p[1] === 21196);
          this.ack(cmd, why.length ? 4 : 0);
        } else {
          if (!ap.landed && p[1] !== 21196) {
            ap.log("warn", "Disarm refused: in flight");
            this.ack(cmd, 4);
          } else {
            ap.disarm();
            this.ack(cmd, 0);
          }
        }
        break;
      }
      case 176:
        this.ack(cmd, ap.setMode(p[1], inp, "ground station") ? 0 : 4);
        break;
      case 22:
        this.ack(cmd, ap.guidedTakeoff(p[6]) ? 0 : 4);
        break;
      case 21:
        this.ack(cmd, ap.setMode(MODE.LAND, inp, "ground station") ? 0 : 4);
        break;
      case 20:
        this.ack(cmd, ap.setMode(MODE.RTL, inp, "ground station") ? 0 : 4);
        break;
      case 300:
        this.ack(cmd, ap.startMission() ? 0 : 4);
        break;
      case 209:
        if (ap.armed) this.ack(cmd, 4);
        else {
          ap.log("info", `Motor test: motor ${p[0]} at ${p[2]}%`);
          this.ack(cmd, 0);
        }
        break;
      case 241:
        if (p[4] === 1) {
          this.ack(cmd, 0);
          this.accelStep(0);
        } else {
          ap.log("info", p[0] === 1 ? "Gyro calibration complete" : p[4] === 2 ? "Trim OK: level set" : "Calibration complete");
          this.ack(cmd, 0);
        }
        break;
      case 42424:
        this.magCal = { start: this.clock, last: this.clock };
        this.ack(cmd, 0);
        break;
      case 42425:
      case 42426:
        this.magCal = null;
        this.ack(cmd, 0);
        break;
      case 246:
        ap.log("info", "Reboot requested: the virtual aircraft stays up");
        this.ack(cmd, 0);
        break;
      case 410:
        this.sendHome();
        this.ack(cmd, 0);
        break;
      case 511:
      case 512:
      case 520:
        this.ack(cmd, 0);
        break;
      default:
        this.ack(cmd, 3); // unsupported
    }
  }

  /** ArduPilot's six-position accelerometer calibration, driven by status text. */
  private accelStep(step: number) {
    const prompts = ["level", "on its LEFT side", "on its RIGHT side", "nose DOWN", "nose UP", "on its BACK"];
    if (step < prompts.length) {
      this.accelCal = step;
      this.text(5, `Place vehicle ${prompts[step]} and press any key.`);
    } else {
      this.accelCal = null;
      this.text(5, "Calibration successful");
    }
  }

  get events(): SimEvent[] {
    return this.ap.events;
  }
}
