/** Browser capability detection. Results are facts about this browser, not assumptions. */

export const hasWebSerial = () => typeof navigator !== "undefined" && "serial" in navigator && !!navigator.serial;

export const isSecureContextOk = () => typeof window !== "undefined" && window.isSecureContext;

export function hasWebGL2(): boolean {
  try {
    const c = document.createElement("canvas");
    return !!c.getContext("webgl2");
  } catch {
    return false;
  }
}

export const hasGamepadApi = () => typeof navigator !== "undefined" && "getGamepads" in navigator;

export function browserName(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Microsoft Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "This browser";
}

/** Common USB-serial bridges seen on Pixhawk boards and SiK telemetry radios. Informational only. */
export function describeUsbDevice(info: SerialPortInfo): string {
  const vid = info.usbVendorId;
  const pid = info.usbProductId;
  if (vid === undefined) return "Serial device (no USB identity reported)";
  const hex = (n: number) => n.toString(16).padStart(4, "0").toUpperCase();
  const known: Record<number, string> = {
    0x26ac: "3D Robotics / Pixhawk-family USB",
    0x1209: "pid.codes (used by ArduPilot/PX4 boards)",
    0x3162: "Holybro",
    0x0403: "FTDI USB-serial (common on telemetry radios)",
    0x10c4: "Silicon Labs CP210x USB-serial (common on telemetry radios)",
    0x1a86: "WCH CH340 USB-serial",
    0x2dae: "Hex/ProfiCNC (Cube)",
  };
  const name = known[vid] ?? "USB serial device";
  return `${name} (${hex(vid)}:${pid !== undefined ? hex(pid) : "????"})`;
}
