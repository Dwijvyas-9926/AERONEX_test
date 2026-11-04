import { create } from "zustand";

/*
  Transient calibration state driven by vehicle messages. commandLink updates it
  from COMMAND_ACK, STATUSTEXT (accel "Place ..." prompts), MAG_CAL_PROGRESS and
  MAG_CAL_REPORT; the Calibration UI renders from it. Parameter-based calibration
  (radio, flight modes, ESC) lives in paramStore — only the live sensor flows are
  here.
*/

export type CalPhase = "idle" | "running" | "success" | "failed" | "cancelled";

/** ACCELCAL_VEHICLE_POS order, 1-indexed, matching ArduPilot's 6-point sequence. */
export const ACCEL_POSITIONS = ["level", "on its LEFT side", "on its RIGHT side", "nose DOWN", "nose UP", "on its BACK"] as const;

export interface AccelCal {
  phase: CalPhase;
  step: number; // ArduPilot step counter (0..6), carried in the COMMAND_ACK
  prompt: string | null; // latest "Place ..." text from the vehicle
  awaitingConfirm: boolean; // vehicle is waiting for us to confirm the position
  message: string | null; // result/notice
}

export interface MagCompass {
  id: number;
  pct: number;
  status: number; // MAG_CAL_STATUS
  fitness: number | null; // report fitness (mGauss); lower is better
  offsets: [number, number, number] | null;
  autosaved: boolean;
  coverage: number; // sampled sphere sections (0..80), from completion_mask
}

export interface MagCal {
  phase: CalPhase;
  compasses: Record<number, MagCompass>;
  message: string | null;
  maxPct: number; // highest completion seen (for stall detection)
  lastAdvanceAt: number; // when maxPct last increased
}

export type SimpleCal = { phase: CalPhase; message: string | null };

interface CalibrationStoreState {
  accel: AccelCal;
  level: SimpleCal;
  gyro: SimpleCal;
  mag: MagCal;
  reset: () => void;
  setAccel: (p: Partial<AccelCal>) => void;
  setLevel: (p: Partial<SimpleCal>) => void;
  setGyro: (p: Partial<SimpleCal>) => void;
  setMag: (p: Partial<MagCal>) => void;
  upsertMagCompass: (c: MagCompass) => void;
}

const idleAccel = (): AccelCal => ({ phase: "idle", step: 0, prompt: null, awaitingConfirm: false, message: null });
const idleSimple = (): SimpleCal => ({ phase: "idle", message: null });
const idleMag = (): MagCal => ({ phase: "idle", compasses: {}, message: null, maxPct: 0, lastAdvanceAt: 0 });

export const useCalibration = create<CalibrationStoreState>((set) => ({
  accel: idleAccel(),
  level: idleSimple(),
  gyro: idleSimple(),
  mag: idleMag(),
  reset: () => set({ accel: idleAccel(), level: idleSimple(), gyro: idleSimple(), mag: idleMag() }),
  setAccel: (p) => set((s) => ({ accel: { ...s.accel, ...p } })),
  setLevel: (p) => set((s) => ({ level: { ...s.level, ...p } })),
  setGyro: (p) => set((s) => ({ gyro: { ...s.gyro, ...p } })),
  setMag: (p) => set((s) => ({ mag: { ...s.mag, ...p } })),
  upsertMagCompass: (c) => set((s) => ({ mag: { ...s.mag, compasses: { ...s.mag.compasses, [c.id]: c } } })),
}));

/** MAG_CAL_STATUS enum (ardupilotmega). */
export const MAG_CAL_STATUS: Record<number, string> = {
  0: "Not started",
  1: "Waiting to start",
  2: "Running (step 1)",
  3: "Running (step 2)",
  4: "Success",
  5: "Failed",
  6: "Bad orientation",
  7: "Bad radius",
};
export const magCalDone = (status: number) => status >= 4;
export const magCalOk = (status: number) => status === 4;
