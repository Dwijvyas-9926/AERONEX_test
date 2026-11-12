/*
  The physical aircraft the simulator flies.

  Six numbers a builder can measure or read off a label describe it; the rest
  — moments of inertia, arm geometry, battery resistance, hover throttle — is
  derived here by the usual first-order rules. Those rules are estimates, and
  they are the largest source of error in the simulation: a figure derived
  from "1.5 kg and 450 mm" is right to tens of percent, not to a percent.
*/
export interface Airframe {
  name: string;
  /** Ready to fly, battery included. */
  massKg: number;
  /** Motor to diagonally opposite motor. */
  diagonalM: number;
  /** Static thrust of one motor at full throttle on a full battery. */
  motorMaxThrustN: number;
  propDiaM: number;
  cells: number;
  capacityMah: number;
}

export const G = 9.80665;
export const RHO = 1.225;

export const PRESETS: Airframe[] = [
  { name: '450-class quad, 10" props, 3S', massKg: 1.5, diagonalM: 0.45, motorMaxThrustN: 8.8, propDiaM: 0.254, cells: 3, capacityMah: 5000 },
  { name: '5" quad, 6S', massKg: 0.65, diagonalM: 0.21, motorMaxThrustN: 13.2, propDiaM: 0.127, cells: 6, capacityMah: 1300 },
  { name: '7" long-range quad, 6S', massKg: 1.1, diagonalM: 0.3, motorMaxThrustN: 16.0, propDiaM: 0.178, cells: 6, capacityMah: 3000 },
  { name: '650-class lifter, 15" props, 6S', massKg: 3.6, diagonalM: 0.65, motorMaxThrustN: 26.0, propDiaM: 0.381, cells: 6, capacityMah: 10000 },
];

export interface Derived {
  /** Distance from the centre line to a motor along x or y, m (X layout). */
  a: number;
  Ixx: number;
  Iyy: number;
  Izz: number;
  /** Reaction torque per newton of thrust, m. */
  kYaw: number;
  motorTauS: number;
  /** Lumped drag area Cd·A, m². */
  cdA: number;
  /** Total propeller disc area, m². */
  discArea: number;
  /** Pack resistance including leads, Ω. */
  rPack: number;
  /** Fraction of full thrust that holds a hover on a nominal battery. */
  hoverThrottle: number;
  thrustToWeight: number;
}

export function derive(af: Airframe): Derived {
  const arm = af.diagonalM / 2;
  // Mass is concentrated in the hub and the four motor pods: a radius of
  // gyration of 45% of the arm matches published figures for 250–650 frames.
  const Ixx = af.massKg * (0.45 * arm) ** 2;
  const capAh = af.capacityMah / 1000;
  return {
    a: arm / Math.SQRT2,
    Ixx,
    Iyy: Ixx,
    Izz: 1.8 * Ixx,
    kYaw: 0.06 * af.propDiaM,
    // Bigger propellers have more inertia and spin up more slowly.
    motorTauS: Math.min(0.12, Math.max(0.025, 0.25 * af.propDiaM)),
    // A 450 mm quad leans about 12° to hold 10 m/s, which this reproduces.
    cdA: 0.12 * af.diagonalM ** 2 + 0.003,
    discArea: 4 * Math.PI * (af.propDiaM / 2) ** 2,
    rPack: af.cells * (0.018 / capAh) + 0.004,
    hoverThrottle: (af.massKg * G) / (4 * af.motorMaxThrustN),
    thrustToWeight: (4 * af.motorMaxThrustN) / (af.massKg * G),
  };
}

/** Open-circuit voltage of one LiPo cell against state of charge. */
const OCV: [number, number][] = [
  [0, 3.27], [0.05, 3.55], [0.1, 3.68], [0.2, 3.73], [0.3, 3.77], [0.4, 3.79],
  [0.5, 3.82], [0.6, 3.87], [0.7, 3.92], [0.8, 3.98], [0.9, 4.06], [1, 4.2],
];

export function cellOcv(soc: number): number {
  if (soc <= 0) return Math.max(2.5, 3.27 + soc * 12);
  if (soc >= 1) return 4.2;
  for (let i = 1; i < OCV.length; i++) {
    if (soc <= OCV[i][0]) {
      const [s0, v0] = OCV[i - 1];
      const [s1, v1] = OCV[i];
      return v0 + ((soc - s0) / (s1 - s0)) * (v1 - v0);
    }
  }
  return 4.2;
}

/** Thrust is quoted at this cell voltage; it falls with the square of sag. */
export const NOMINAL_CELL_V = 3.9;
