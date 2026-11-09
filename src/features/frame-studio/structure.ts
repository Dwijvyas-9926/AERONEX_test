/*
  Frame Studio — structural sizing.

  Consistent unit system throughout: N, mm, MPa (= N/mm²).
    moment  M = F·L                [N·mm]
    section modulus  Z = b·h²/6    [mm³]      σ = M/Z
    second moment    I = b·h³/12   [mm⁴]
    cantilever tip deflection  δ = F·L³/(3·E·I)

  An arm is sized by whichever of four cases governs — and it is almost never
  the static one. A 4 mm carbon arm needs under 2 mm of width to hold max
  thrust, yet real 5" arms are ~16 mm wide, because crash loads, stiffness
  (which sets the arm's natural frequency, and therefore vibration) and bolt
  edge-distance all demand more material. We solve all four and take the max.
*/

import { BOLT_HEAD_DIA, EDGE_DISTANCE_FACTOR, type Material } from "./catalog";

export const G = 9.81;
export const gramsToNewtons = (g: number) => (g / 1000) * G;

export type LoadCase = "thrust" | "impact" | "stiffness" | "geometry";

export interface SectionInput {
  material: Material;
  /** Allowable stress after knockdown and safety factor, MPa. */
  safetyFactor: number;
  /** Cantilever length from arm root to motor centre, mm. */
  armLengthMm: number;
  /** Peak thrust of one motor, grams. */
  motorThrustG: number;
  /** All-up weight of the finished aircraft, grams. */
  auwG: number;
  /** Impact load factor for the chosen flying style. */
  loadFactor: number;
  /** Motor mount bolt pattern (square side) and bolt diameter, mm. */
  motorPattern: number;
  motorBolt: number;
  /** Diameter of the arm's own mounting bolts, mm. The root must fit these too. */
  rootBolt: number;
  /** Cut frames: sheet thickness, mm. Printed frames: arm width, mm. */
  fixedDimMm: number;
}

export interface SectionResult {
  /** Horizontal width of the arm at the root, mm. */
  widthMm: number;
  /** Vertical height of the arm section, mm (= sheet thickness for cut parts). */
  heightMm: number;
  /** Width of the motor mounting pad, mm. */
  padWidthMm: number;
  /** Which case decided the size. */
  governing: LoadCase;
  /** Allowable stress used, MPa. */
  allowableMPa: number;
  /** Peak bending stress at the root under the governing load, MPa. */
  stressMPa: number;
  /** Tip deflection under one motor's peak thrust, mm. */
  deflectionMm: number;
  /** Design forces, N. */
  thrustN: number;
  impactN: number;
  /** Per-case required width (cut) or height (print), for transparency in the UI. */
  required: Record<LoadCase, number>;
}

/** Share of a hard-landing impulse taken by the worst-loaded arm. */
const ARM_IMPACT_SHARE = 0.5;
/** Tip deflection limit as a fraction of arm length (keeps the arm's first mode high). */
const DEFLECTION_LIMIT_RATIO = 1 / 150;
/** Never produce an arm narrower than this, whatever the maths says. */
const MIN_ARM_WIDTH = 8;

/**
 * Edge distance at a motor pad, as a multiple of bolt diameter.
 *
 * Lower than the structural 1.5 × d used elsewhere, and deliberately so: a
 * motor bolt clamps the motor down against the pad face rather than pulling
 * along it, so the governing concern is bearing under the washer, not edge
 * tear-out. Production 5" arms run roughly 0.4–1.0 × d here; we take the
 * conservative end of observed practice.
 */
export const PAD_EDGE_FACTOR = 1.0;

/**
 * Minimum pad width to land the motor's bolt pattern with proper edge distance.
 *
 * The four bolts sit on the corners of a square, so the furthest hole centre is
 * at (pattern/2)·√2 from the motor axis — not pattern/2. Sizing a round pad off
 * the flat-to-flat span instead of the diagonal leaves the corner holes hanging
 * over the edge, which is a mistake that looks fine on screen.
 */
export function motorPadWidth(pattern: number, bolt: number): number {
  const padR = (pattern / 2) * Math.SQRT2 + bolt / 2 + PAD_EDGE_FACTOR * bolt;
  return 2 * padR;
}

/** Minimum root width to pass the arm's own mounting bolts through. */
export function minRootWidth(bolt: number): number {
  const head = BOLT_HEAD_DIA[bolt] ?? bolt * 1.9;
  return Math.max(MIN_ARM_WIDTH, head + 2 * EDGE_DISTANCE_FACTOR * bolt);
}

/**
 * Size an arm cross-section.
 *
 * Cut frames have their height fixed by the sheet (bending acts across the
 * plate thickness), so we solve for width. Printed frames can grow vertically,
 * where stiffness scales with height cubed, so we fix a sensible width and
 * solve for height — far more material-efficient.
 */
export function sizeArm(input: SectionInput): SectionResult {
  const { material, safetyFactor, armLengthMm: L, fixedDimMm } = input;
  const allowable = (material.strength * material.knockdown) / safetyFactor;
  const E = material.modulus * 1000; // GPa → MPa

  const thrustN = gramsToNewtons(input.motorThrustG);
  const impactN = gramsToNewtons(input.auwG) * input.loadFactor * ARM_IMPACT_SHARE;

  const mThrust = thrustN * L; // N·mm
  const mImpact = impactN * L;
  const deflLimit = Math.max(0.5, L * DEFLECTION_LIMIT_RATIO);

  const padWidthMm = motorPadWidth(input.motorPattern, input.motorBolt);
  // The root has to carry the larger of the motor bolts and its own mounting
  // bolts — sizing it off the motor alone leaves an M3 bolt in a 10 mm arm.
  const geomMin = Math.max(minRootWidth(input.motorBolt), minRootWidth(input.rootBolt), MIN_ARM_WIDTH);

  const required: Record<LoadCase, number> = { thrust: 0, impact: 0, stiffness: 0, geometry: 0 };
  let widthMm: number;
  let heightMm: number;

  if (material.method === "cut") {
    const t = fixedDimMm; // sheet thickness = section height
    // σ = M/Z, Z = w·t²/6  →  w = 6M/(t²·σ)
    required.thrust = (6 * mThrust) / (t * t * allowable);
    required.impact = (6 * mImpact) / (t * t * allowable);
    // δ = F·L³/(3·E·I), I = w·t³/12  →  w = 12·F·L³/(3·E·δ·t³)
    required.stiffness = (12 * thrustN * L ** 3) / (3 * E * deflLimit * t ** 3);
    required.geometry = geomMin;
    widthMm = Math.max(...Object.values(required));
    heightMm = t;
  } else {
    const b = fixedDimMm; // printed arm width is the fixed dimension
    // h = sqrt(6M/(b·σ))
    required.thrust = Math.sqrt((6 * mThrust) / (b * allowable));
    required.impact = Math.sqrt((6 * mImpact) / (b * allowable));
    // h = cbrt(12·F·L³/(3·E·δ·b))
    required.stiffness = Math.cbrt((12 * thrustN * L ** 3) / (3 * E * deflLimit * b));
    required.geometry = 4; // a printed arm thinner than this is not practical
    heightMm = Math.max(...Object.values(required));
    widthMm = Math.max(b, geomMin);
  }

  const governing = (Object.keys(required) as LoadCase[]).reduce((a, k) =>
    required[k] > required[a] ? k : a,
  "thrust");

  // Report the achieved stress and deflection for the section we actually chose.
  const Z = (widthMm * heightMm ** 2) / 6;
  const I = (widthMm * heightMm ** 3) / 12;
  const stressMPa = Math.max(mThrust, mImpact) / Z;
  const deflectionMm = (thrustN * L ** 3) / (3 * E * I);

  return {
    widthMm: round(widthMm),
    heightMm: round(heightMm),
    padWidthMm: round(padWidthMm),
    governing,
    allowableMPa: round(allowable),
    stressMPa: round(stressMPa),
    deflectionMm: round(deflectionMm, 3),
    thrustN: round(thrustN, 2),
    impactN: round(impactN, 2),
    required: {
      thrust: round(required.thrust),
      impact: round(required.impact),
      stiffness: round(required.stiffness),
      geometry: round(required.geometry),
    },
  };
}

/** Mass of a prismatic part, grams, from mm³ and g/cm³. */
export function massOf(volumeMm3: number, densityGcm3: number): number {
  return (volumeMm3 / 1000) * densityGcm3;
}

export const round = (v: number, dp = 1) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};
