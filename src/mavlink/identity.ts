import { COPTER_MODES, ENUMS } from "./dialect.generated";

/*
  Heartbeat interpretation. Everything here is derived from fields the vehicle
  actually sent; nothing is assumed about board or capabilities.
*/

export const MAV_AUTOPILOT_ARDUPILOTMEGA = 3;
export const MAV_AUTOPILOT_INVALID = 8;
export const MAV_AUTOPILOT_PX4 = 12;
export const MAV_TYPE_GCS = 6;
export const MAV_TYPE_ONBOARD_CONTROLLER = 18;
export const MAV_TYPE_GIMBAL = 26;
export const MAV_TYPE_ADSB = 27;
export const MAV_TYPE_CAMERA = 30;

const MODE_FLAG_SAFETY_ARMED = 128;
const MODE_FLAG_CUSTOM_MODE_ENABLED = 1;

export type FirmwareFamily = "ardupilot" | "px4" | "other";

export interface Heartbeat {
  type: number;
  autopilot: number;
  base_mode: number;
  custom_mode: number;
  system_status: number;
  mavlink_version: number;
}

/** True when a heartbeat comes from a flight controller rather than a GCS, camera or companion. */
export function isAutopilotHeartbeat(hb: Heartbeat): boolean {
  if (hb.autopilot === MAV_AUTOPILOT_INVALID) return false;
  return ![MAV_TYPE_GCS, MAV_TYPE_ONBOARD_CONTROLLER, MAV_TYPE_GIMBAL, MAV_TYPE_ADSB, MAV_TYPE_CAMERA].includes(hb.type);
}

export function firmwareFamily(autopilot: number): FirmwareFamily {
  if (autopilot === MAV_AUTOPILOT_ARDUPILOTMEGA) return "ardupilot";
  if (autopilot === MAV_AUTOPILOT_PX4) return "px4";
  return "other";
}

export const firmwareLabel = (f: FirmwareFamily) => (f === "ardupilot" ? "ArduPilot" : f === "px4" ? "PX4" : "Other MAVLink");

export const isArmed = (hb: Heartbeat) => (hb.base_mode & MODE_FLAG_SAFETY_ARMED) !== 0;

const titleCase = (s: string) =>
  s
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

export function vehicleTypeLabel(type: number): string {
  const raw = ENUMS.MAV_TYPE[type];
  return raw ? titleCase(raw.replace(/^MAV_TYPE_/, "")) : `Type ${type}`;
}

export function systemStatusLabel(status: number): string {
  const raw = ENUMS.MAV_STATE[status];
  return raw ? titleCase(raw.replace(/^MAV_STATE_/, "")) : `State ${status}`;
}

const PX4_MAIN: Record<number, string> = {
  1: "Manual",
  2: "Altitude",
  3: "Position",
  4: "Auto",
  5: "Acro",
  6: "Offboard",
  7: "Stabilized",
  8: "Rattitude",
};
const PX4_AUTO_SUB: Record<number, string> = {
  1: "Ready",
  2: "Takeoff",
  3: "Hold",
  4: "Mission",
  5: "Return",
  6: "Land",
  8: "Follow target",
  9: "Precision land",
  10: "VTOL takeoff",
};

/** Flight mode name. Copter mapping is used for ArduPilot multirotors only. */
export function flightModeLabel(hb: Heartbeat): string | null {
  if ((hb.base_mode & MODE_FLAG_CUSTOM_MODE_ENABLED) === 0) return null;
  const fam = firmwareFamily(hb.autopilot);
  if (fam === "ardupilot") {
    const multirotor = [2, 3, 4, 13, 14, 15].includes(hb.type);
    if (!multirotor) return `Mode ${hb.custom_mode}`;
    const name = COPTER_MODES[hb.custom_mode];
    return name ? titleCase(name).replace("Rtl", "RTL") : `Mode ${hb.custom_mode}`;
  }
  if (fam === "px4") {
    const main = (hb.custom_mode >> 16) & 0xff;
    const sub = (hb.custom_mode >>> 24) & 0xff;
    const m = PX4_MAIN[main];
    if (!m) return `Mode ${hb.custom_mode}`;
    if (main === 4 && PX4_AUTO_SUB[sub]) return `${m}: ${PX4_AUTO_SUB[sub]}`;
    return m;
  }
  return `Mode ${hb.custom_mode}`;
}

export function severityLabel(sev: number): string {
  const raw = ENUMS.MAV_SEVERITY[sev];
  return raw ? titleCase(raw.replace(/^MAV_SEVERITY_/, "")) : "Info";
}
