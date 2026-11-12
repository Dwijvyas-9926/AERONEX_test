import { decode, MavlinkParser, type Decoded, type MavFrame } from "../../mavlink/parser";
import {
  firmwareFamily,
  firmwareLabel,
  flightModeLabel,
  isArmed,
  isAutopilotHeartbeat,
  severityLabel,
  systemStatusLabel,
  vehicleTypeLabel,
  type Heartbeat,
} from "../../mavlink/identity";
import { emptyStats, type FrameRecord, type LinkEvent, type LinkStats, type Telemetry, type VehicleIdentity } from "../../state/linkStore";

/*
  Transport-independent vehicle session: bytes in, vehicle state out.
  Only data the vehicle actually sent ends up here. Each telemetry group
  carries the timestamp it was received so the UI can show staleness.
*/

const UINT16_MAX = 65535;
const MAX_EVENTS = 200;
const MAX_FRAMES = 40;

export interface SessionSnapshot {
  vehicle: VehicleIdentity | null;
  lastHeartbeatAt: number | null;
  telemetry: Telemetry;
  stats: LinkStats;
  events: LinkEvent[];
  recentFrames: FrameRecord[];
}

let eventSeq = 0;

export class VehicleSession {
  private parser = new MavlinkParser();
  private target: { sysid: number; compid: number } | null = null;
  private counts: Record<string, number> = {};
  private lastRateCounts: Record<string, number> = {};
  private lastRateAt = 0;
  private others = new Set<number>();

  vehicle: VehicleIdentity | null = null;
  lastHeartbeatAt: number | null = null;
  heartbeats = 0;
  telemetry: Telemetry = {};
  rates: LinkStats["rates"] = {};
  events: LinkEvent[] = [];
  recentFrames: FrameRecord[] = [];
  private lastMode: string | null = null;
  private lastArmed: boolean | null = null;

  private now: () => number;
  /** Optional sink for command/parameter/calibration messages from the vehicle. */
  private onDecoded?: (name: string, d: Decoded) => void;

  constructor(now: () => number = () => Date.now(), onDecoded?: (name: string, d: Decoded) => void) {
    this.now = now;
    this.onDecoded = onDecoded;
  }

  /** Feed raw bytes. Returns true if the vehicle identity changed (first heartbeat, mode, arm state). */
  ingest(bytes: Uint8Array): boolean {
    let identityChanged = false;
    for (const f of this.parser.push(bytes)) {
      if (this.handle(f)) identityChanged = true;
    }
    return identityChanged;
  }

  log(level: LinkEvent["level"], text: string) {
    this.events = [{ id: ++eventSeq, at: this.now(), level, text }, ...this.events].slice(0, MAX_EVENTS);
  }

  /** Recompute per-message rates. Call about once a second. */
  tickRates() {
    const t = this.now();
    const dt = (t - this.lastRateAt) / 1000;
    if (this.lastRateAt && dt > 0) {
      const rates: LinkStats["rates"] = {};
      for (const [k, c] of Object.entries(this.counts)) {
        rates[k] = { count: c, hz: (c - (this.lastRateCounts[k] ?? 0)) / dt };
      }
      this.rates = rates;
    }
    this.lastRateCounts = { ...this.counts };
    this.lastRateAt = t;
  }

  snapshot(): SessionSnapshot {
    return {
      vehicle: this.vehicle,
      lastHeartbeatAt: this.lastHeartbeatAt,
      telemetry: this.telemetry,
      stats: { ...emptyStats(), ...this.parser.stats, heartbeats: this.heartbeats, rates: this.rates, otherSystems: [...this.others] },
      events: this.events,
      recentFrames: this.recentFrames,
    };
  }

  private handle(f: MavFrame): boolean {
    const t = this.now();
    this.counts[f.name] = (this.counts[f.name] ?? 0) + 1;
    this.recentFrames = [
      { at: t, name: f.name, sysid: f.sysid, compid: f.compid, len: f.payload.length, seq: f.seq, version: f.version },
      ...this.recentFrames,
    ].slice(0, MAX_FRAMES);

    // The radio reports its own link status under its own system id.
    if (f.name === "RADIO_STATUS") {
      const d = decode(f)!;
      this.telemetry = {
        ...this.telemetry,
        radio: {
          at: t,
          value: {
            rssi: d.rssi as number,
            remrssi: d.remrssi as number,
            noise: d.noise as number,
            remnoise: d.remnoise as number,
            rxerrors: d.rxerrors as number,
            fixed: d.fixed as number,
            txbuf: d.txbuf as number,
          },
        },
      };
      return false;
    }

    if (f.name === "HEARTBEAT") return this.onHeartbeat(f, t);

    if (!this.target || f.sysid !== this.target.sysid) {
      if (this.target && f.sysid !== this.target.sysid) this.others.add(f.sysid);
      return false;
    }
    // Accept autopilot telemetry from the target system's autopilot component only.
    if (f.compid !== this.target.compid && f.name !== "STATUSTEXT") return false;

    const d = decode(f);
    if (!d) return false;
    switch (f.name) {
      case "ATTITUDE":
        this.telemetry = { ...this.telemetry, attitude: { at: t, value: { roll: d.roll as number, pitch: d.pitch as number, yaw: d.yaw as number } } };
        break;
      case "GLOBAL_POSITION_INT": {
        const hdg = d.hdg as number;
        this.telemetry = {
          ...this.telemetry,
          position: {
            at: t,
            value: {
              lat: (d.lat as number) / 1e7,
              lon: (d.lon as number) / 1e7,
              relAlt: (d.relative_alt as number) / 1000,
              mslAlt: (d.alt as number) / 1000,
              heading: hdg === UINT16_MAX ? null : hdg / 100,
            },
          },
        };
        break;
      }
      case "GPS_RAW_INT": {
        const sats = d.satellites_visible as number;
        const eph = d.eph as number;
        this.telemetry = {
          ...this.telemetry,
          gps: { at: t, value: { fixType: d.fix_type as number, satellites: sats === 255 ? null : sats, hdop: eph === UINT16_MAX ? null : eph / 100 } },
        };
        break;
      }
      case "SYS_STATUS": {
        const mv = d.voltage_battery as number;
        const ca = d.current_battery as number;
        const rem = d.battery_remaining as number;
        this.telemetry = {
          ...this.telemetry,
          battery: {
            at: t,
            value: {
              voltage: mv === UINT16_MAX ? null : mv / 1000,
              current: ca === -1 ? null : ca / 100,
              remaining: rem < 0 ? null : rem,
            },
          },
          sensors: {
            at: t,
            value: {
              present: d.onboard_control_sensors_present as number,
              enabled: d.onboard_control_sensors_enabled as number,
              health: d.onboard_control_sensors_health as number,
            },
          },
        };
        break;
      }
      case "EKF_STATUS_REPORT":
        this.telemetry = {
          ...this.telemetry,
          ekf: {
            at: t,
            value: {
              flags: d.flags as number,
              velVar: d.velocity_variance as number,
              posHoriz: d.pos_horiz_variance as number,
              posVert: d.pos_vert_variance as number,
              compass: d.compass_variance as number,
              terrain: d.terrain_alt_variance as number,
            },
          },
        };
        break;
      case "VIBRATION":
        this.telemetry = {
          ...this.telemetry,
          vibration: {
            at: t,
            value: {
              x: d.vibration_x as number,
              y: d.vibration_y as number,
              z: d.vibration_z as number,
              clip0: d.clipping_0 as number,
              clip1: d.clipping_1 as number,
              clip2: d.clipping_2 as number,
            },
          },
        };
        break;
      case "VFR_HUD":
        this.telemetry = {
          ...this.telemetry,
          hud: {
            at: t,
            value: {
              groundspeed: d.groundspeed as number,
              climb: d.climb as number,
              alt: d.alt as number,
              heading: d.heading as number,
              throttle: d.throttle as number,
            },
          },
        };
        break;
      case "RC_CHANNELS": {
        const count = d.chancount as number;
        const ch: number[] = [];
        for (let i = 1; i <= 18; i++) ch.push(d[`chan${i}_raw`] as number);
        const rssi = d.rssi as number;
        this.telemetry = { ...this.telemetry, rc: { at: t, value: { count, channels: ch.slice(0, Math.max(count, 0)), rssi: rssi === 255 ? null : rssi } } };
        break;
      }
      case "STATUSTEXT": {
        const sev = d.severity as number;
        const level = sev <= 3 ? "error" : sev === 4 ? "warn" : "vehicle";
        this.log(level, `${severityLabel(sev)}: ${d.text as string}`);
        this.onDecoded?.("STATUSTEXT", d);
        break;
      }
      case "COMMAND_ACK":
      case "PARAM_VALUE":
      case "MAG_CAL_PROGRESS":
      case "MAG_CAL_REPORT":
        this.onDecoded?.(f.name, d);
        break;
    }
    return false;
  }

  private onHeartbeat(f: MavFrame, t: number): boolean {
    const hb = decode(f) as unknown as Heartbeat;
    if (!isAutopilotHeartbeat(hb)) return false;
    if (!this.target) {
      this.target = { sysid: f.sysid, compid: f.compid };
    } else if (f.sysid !== this.target.sysid || f.compid !== this.target.compid) {
      this.others.add(f.sysid);
      return false;
    }

    this.heartbeats++;
    this.lastHeartbeatAt = t;
    const fam = firmwareFamily(hb.autopilot);
    const mode = flightModeLabel(hb);
    const armed = isArmed(hb);
    const first = !this.vehicle;
    this.vehicle = {
      sysid: f.sysid,
      compid: f.compid,
      type: hb.type,
      typeLabel: vehicleTypeLabel(hb.type),
      autopilot: hb.autopilot,
      firmware: fam,
      firmwareLabel: firmwareLabel(fam),
      armed,
      mode,
      customMode: Number.isFinite(hb.custom_mode) ? hb.custom_mode : null,
      systemStatus: systemStatusLabel(hb.system_status),
      mavlinkVersion: hb.mavlink_version,
      protocol: f.version,
    };

    let changed = first;
    if (first) {
      this.log("info", `Heartbeat from system ${f.sysid}, component ${f.compid}: ${this.vehicle.typeLabel}, ${this.vehicle.firmwareLabel}.`);
    }
    if (!first && mode !== this.lastMode) {
      this.log("info", `Flight mode changed to ${mode ?? "unknown"}.`);
      changed = true;
    }
    if (!first && armed !== this.lastArmed) {
      this.log(armed ? "warn" : "info", armed ? "Vehicle armed." : "Vehicle disarmed.");
      changed = true;
    }
    this.lastMode = mode;
    this.lastArmed = armed;
    return changed;
  }
}
