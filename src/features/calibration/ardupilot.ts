/*
  ArduPilot (Copter) constants for the calibration workflows — mode numbers,
  ESC PWM types, ESC-calibration options, flight-mode switch PWM bands and the
  parameter names each screen reads and writes. Values mirror the ArduCopter
  parameter documentation so the UI matches Mission Planner exactly.
*/

export interface Option {
  value: number;
  label: string;
}

/** FLTMODE1..6 accept these Copter mode numbers. */
export const COPTER_FLIGHT_MODES: Option[] = [
  { value: 0, label: "Stabilize" },
  { value: 1, label: "Acro" },
  { value: 2, label: "AltHold" },
  { value: 3, label: "Auto" },
  { value: 4, label: "Guided" },
  { value: 5, label: "Loiter" },
  { value: 6, label: "RTL" },
  { value: 7, label: "Circle" },
  { value: 9, label: "Land" },
  { value: 11, label: "Drift" },
  { value: 13, label: "Sport" },
  { value: 14, label: "Flip" },
  { value: 15, label: "AutoTune" },
  { value: 16, label: "PosHold" },
  { value: 17, label: "Brake" },
  { value: 18, label: "Throw" },
  { value: 19, label: "Avoid_ADSB" },
  { value: 20, label: "Guided_NoGPS" },
  { value: 21, label: "Smart_RTL" },
  { value: 22, label: "FlowHold" },
  { value: 23, label: "Follow" },
  { value: 24, label: "ZigZag" },
  { value: 25, label: "SystemID" },
  { value: 27, label: "Auto RTL" },
  { value: 28, label: "Turtle" },
];

export const flightModeName = (v: number) => COPTER_FLIGHT_MODES.find((m) => m.value === v)?.label ?? `Mode ${v}`;

/** MOT_PWM_TYPE — the "ESC type" dropdown in Mission Planner. */
export const ESC_TYPES: Option[] = [
  { value: 0, label: "Normal (PWM)" },
  { value: 1, label: "OneShot" },
  { value: 2, label: "OneShot125" },
  { value: 3, label: "Brushed" },
  { value: 4, label: "DShot150" },
  { value: 5, label: "DShot300" },
  { value: 6, label: "DShot600" },
  { value: 7, label: "DShot1200" },
];

export const escTypeName = (v: number) => ESC_TYPES.find((t) => t.value === v)?.label ?? `Type ${v}`;

export const ESC_CALIBRATION: Option[] = [
  { value: 0, label: "Normal start-up (no calibration)" },
  { value: 1, label: "Calibrate at next boot if throttle is high" },
  { value: 2, label: "Always calibrate at next boot" },
  { value: 3, label: "Auto-calibrate on next boot" },
  { value: 9, label: "Disabled" },
];

/** Flight-mode switch position (1..6) from a channel's PWM, ArduPilot's bands. */
export function switchPosition(pwm: number): number {
  if (pwm <= 1230) return 1;
  if (pwm <= 1360) return 2;
  if (pwm <= 1490) return 3;
  if (pwm <= 1620) return 4;
  if (pwm <= 1749) return 5;
  return 6;
}

/** FLTMODE_CH channel options. */
export const FLTMODE_CH: Option[] = [5, 6, 7, 8].map((n) => ({ value: n, label: `Channel ${n}` }));

export const RADIO_FUNCTION: Record<number, string> = {
  1: "Roll (aileron)",
  2: "Pitch (elevator)",
  3: "Throttle",
  4: "Yaw (rudder)",
};

/** Parameter names each screen depends on. */
export const PARAMS = {
  fltmode: ["FLTMODE_CH", "FLTMODE1", "FLTMODE2", "FLTMODE3", "FLTMODE4", "FLTMODE5", "FLTMODE6", "SIMPLE", "SUPER_SIMPLE"],
  esc: ["MOT_PWM_TYPE", "MOT_PWM_MIN", "MOT_PWM_MAX", "MOT_SPIN_ARM", "MOT_SPIN_MIN", "MOT_SPIN_MAX", "ESC_CALIBRATION"],
  compass: ["COMPASS_USE", "COMPASS_USE2", "COMPASS_USE3"],
  radio: (ch: number) => [`RC${ch}_MIN`, `RC${ch}_MAX`, `RC${ch}_TRIM`, `RC${ch}_REVERSED`],
};
