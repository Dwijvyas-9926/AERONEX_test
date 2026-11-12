import { create } from "zustand";
import type { FirmwareFamily } from "../mavlink/identity";
import type { ParserStats } from "../mavlink/parser";

/*
  The link to an aircraft. Usually that is a serial port with a flight
  controller on the other end; it can also be the virtual aircraft, which
  speaks the same MAVLink through the same session. `virtual` says which, so
  no page can mistake a simulated reading for a real one.
*/

export type LinkStatus =
  | "idle" // nothing open
  | "selecting" // browser port chooser is open
  | "opening" // port.open() in progress
  | "listening" // port open, waiting for an autopilot heartbeat
  | "no-heartbeat" // port open, no autopilot heartbeat within the timeout
  | "connected" // autopilot heartbeats arriving
  | "stale" // was connected, heartbeats have stopped
  | "lost" // port closed unexpectedly (unplugged, read failure)
  | "error"; // could not open

export type LinkMethod = "usb" | "radio";

export interface VehicleIdentity {
  sysid: number;
  compid: number;
  type: number;
  typeLabel: string;
  autopilot: number;
  firmware: FirmwareFamily;
  firmwareLabel: string;
  armed: boolean;
  mode: string | null;
  /** The autopilot's own mode number, as sent in the heartbeat. */
  customMode: number | null;
  systemStatus: string;
  mavlinkVersion: number;
  protocol: 1 | 2;
}

export interface Stamped<T> {
  value: T;
  at: number;
}

export interface Telemetry {
  attitude?: Stamped<{ roll: number; pitch: number; yaw: number }>;
  position?: Stamped<{ lat: number; lon: number; relAlt: number; mslAlt: number; heading: number | null }>;
  gps?: Stamped<{ fixType: number; satellites: number | null; hdop: number | null }>;
  battery?: Stamped<{ voltage: number | null; current: number | null; remaining: number | null }>;
  hud?: Stamped<{ groundspeed: number; climb: number; alt: number; heading: number; throttle: number }>;
  rc?: Stamped<{ count: number; channels: number[]; rssi: number | null }>;
  radio?: Stamped<{ rssi: number; remrssi: number; noise: number; remnoise: number; rxerrors: number; fixed: number; txbuf: number }>;
  sensors?: Stamped<{ present: number; enabled: number; health: number }>;
  ekf?: Stamped<{ flags: number; velVar: number; posHoriz: number; posVert: number; compass: number; terrain: number }>;
  vibration?: Stamped<{ x: number; y: number; z: number; clip0: number; clip1: number; clip2: number }>;
  /** Which mission item the autopilot is working on. */
  mission?: Stamped<{ seq: number }>;
  home?: Stamped<{ lat: number; lon: number; altMsl: number }>;
}

export interface LinkEvent {
  id: number;
  at: number;
  level: "info" | "warn" | "error" | "vehicle";
  text: string;
}

export interface FrameRecord {
  at: number;
  name: string;
  sysid: number;
  compid: number;
  len: number;
  seq: number;
  version: 1 | 2;
}

export interface LinkError {
  title: string;
  detail: string;
  hints: string[];
}

export interface LinkStats extends ParserStats {
  heartbeats: number;
  rates: Record<string, { count: number; hz: number }>;
  otherSystems: number[];
}

export interface LinkState {
  status: LinkStatus;
  /** True when the aircraft on the link is the simulator's, not hardware. */
  virtual: boolean;
  method: LinkMethod;
  baud: number;
  portLabel: string | null;
  openedAt: number | null;
  connectedAt: number | null;
  lastHeartbeatAt: number | null;
  vehicle: VehicleIdentity | null;
  telemetry: Telemetry;
  stats: LinkStats;
  events: LinkEvent[];
  recentFrames: FrameRecord[];
  error: LinkError | null;
  setMethod: (m: LinkMethod) => void;
  setBaud: (b: number) => void;
}

export const emptyStats = (): LinkStats => ({
  bytes: 0,
  framesOk: 0,
  crcErrors: 0,
  unknownMsg: 0,
  unsupportedFlags: 0,
  v1: 0,
  v2: 0,
  heartbeats: 0,
  rates: {},
  otherSystems: [],
});

export const DEFAULT_BAUD: Record<LinkMethod, number> = { usb: 115200, radio: 57600 };
export const BAUD_RATES = [9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600, 1500000];

export const useLink = create<LinkState>((set) => ({
  status: "idle",
  virtual: false,
  method: "usb",
  baud: DEFAULT_BAUD.usb,
  portLabel: null,
  openedAt: null,
  connectedAt: null,
  lastHeartbeatAt: null,
  vehicle: null,
  telemetry: {},
  stats: emptyStats(),
  events: [],
  recentFrames: [],
  error: null,
  setMethod: (method) => set({ method, baud: DEFAULT_BAUD[method] }),
  setBaud: (baud) => set({ baud }),
}));

/** A link is "live" only while autopilot heartbeats are actually arriving. */
export const isLinkLive = (s: LinkStatus) => s === "connected";
export const isPortOpen = (s: LinkStatus) => ["listening", "no-heartbeat", "connected", "stale"].includes(s);
