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
  /** Cut frames: sheet thickness, mm. Printed frames: starting arm width, mm. */
  fixedDimMm: number;
  /** Printed frames: wall thickness of the hollow box section, mm. */
  wallMm: number;
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
  /** True when the section is a hollow box rather than a solid bar. */
  hollow: boolean;
  /** Wall thickness of the box, mm. Zero for solid cut sections. */
  wallMm: number;
  /** Cross-sectional area of the finished section, mm² — this is what it weighs. */
  areaMm2: number;
  /** Second moment of area actually achieved, mm⁴. */
  inertiaMm4: number;
}

/** Share of a hard-landing impulse taken by the worst-loaded arm. */
const ARM_IMPACT_SHARE = 0.5;
/** Tip deflection limit as a fraction of arm length (keeps the arm's first mode high). */
const DEFLECTION_LIMIT_RATIO = 1 / 150;
/** Never produce an arm narrower than this, whatever the maths says. */
const MIN_ARM_WIDTH = 8;

/**
 * Minimum arm root width as a fraction of the motor pad width.
 *
 * Nothing structural forces this — a carbon arm can be narrower and still hold
 * the load. It is about the taper: a 14 mm root blending out to a 36 mm pad is
 * a severe change of section, and change of section is where stress
 * concentrates and where arms snap. Production frames sit around 0.5–0.6 of
 * pad width at the root, so this is the conservative end of observed practice.
 */
const ROOT_TO_PAD_RATIO = 0.45;

/**
 * Deepest a printed section may be relative to its width.
 *
 * A section taller than it is wide is efficient in pure vertical bending and
 * poor at everything else — it twists easily and is prone to lateral buckling,
 * and on a printed part it is also a tall thin wall to lay down. Past this
 * ratio the solver widens the arm instead of deepening it further.
 */
const MAX_DEPTH_TO_WIDTH = 0.8;

/* ----------------------------------------------------- section properties */

/**
 * Second moment of area for a hollow rectangular (box) section, mm⁴.
 *
 * Printed arms are not solid bars. Published design guidance is explicit that
 * a solid rectangular printed arm is a prototyping shape, not a flying one —
 * a box section of the same outside size weighs far less for nearly the same
 * stiffness, because the material near the neutral axis contributes almost
 * nothing to bending. Removing it costs stiffness in proportion to the cube of
 * the cavity's depth, which is small when the walls are thin.
 */
/**
 * The wall that will actually be built, mm.
 *
 * A cavity is only worth having if there is room for one. Below about a
 * millimetre of clear space the geometry builder leaves the section solid, and
 * the stiffness and mass calculations have to agree with that — otherwise the
 * studio quotes the weight of a hollow part and exports a solid one.
 */
export function effectiveWall(w: number, h: number, wall: number): number {
  const solid = Math.min(w, h) / 2;
  if (wall <= 0) return solid;
  if (h <= 2 * wall + 1 || w <= 2 * wall + 1) return solid;
  return Math.min(wall, solid);
}

export function boxInertia(w: number, h: number, wall: number): number {
  const wi = Math.max(0, w - 2 * wall);
  const hi = Math.max(0, h - 2 * wall);
  return (w * h ** 3 - wi * hi ** 3) / 12;
}

/** Cross-sectional area of a hollow box, mm² — what the part actually weighs. */
export function boxArea(w: number, h: number, wall: number): number {
  const wi = Math.max(0, w - 2 * wall);
  const hi = Math.max(0, h - 2 * wall);
  return w * h - wi * hi;
}

/** Section modulus of a hollow box about the horizontal axis, mm³. */
export function boxModulus(w: number, h: number, wall: number): number {
  return boxInertia(w, h, wall) / (h / 2);
}

/**
 * Smallest depth whose box section satisfies `ok`, by bisection.
 *
 * The hollow-section equations do not invert in closed form the way the solid
 * ones do, and a numeric solve is both shorter and harder to get subtly wrong
 * than an algebraic rearrangement would be.
 */
function solveDepth(lo: number, hi: number, ok: (h: number) => boolean): number {
  if (ok(lo)) return lo;
  let a = lo;
  let b = hi;
  if (!ok(b)) return b; // caller handles the over-range case
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (ok(m)) b = m;
    else a = m;
  }
  return b;
}

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
  /*
    The root has to carry the larger of the motor bolts and its own mounting
    bolts — sizing it off the motor alone leaves an M3 bolt in a 10 mm arm —
    and it must not be so much narrower than the motor pad that the taper
    between them becomes a stress riser. See ROOT_TO_PAD_RATIO.
  */
  const geomMin = Math.max(
    minRootWidth(input.motorBolt),
    minRootWidth(input.rootBolt),
    MIN_ARM_WIDTH,
    ROOT_TO_PAD_RATIO * padWidthMm,
  );

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
    /*
      Printed arm: a hollow box of a chosen outside width, solved for depth.

      Width is the dimension we are free to pick (it costs plan area, not
      height), so the solver widens the arm whenever the depth would otherwise
      grow out of proportion. That is what keeps a 10" arm from coming out as a
      deep narrow fin next to a 3 mm plate.
    */
    const wall = input.wallMm;
    let b = Math.max(fixedDimMm, geomMin, 2 * wall + 4);
    const ew = (width: number, h: number) => effectiveWall(width, h, wall);
    const depthFor = (width: number) => {
      const minH = Math.max(4, 2 * wall + 1);
      const maxH = 200;
      const strengthOk = (h: number) => Math.max(mThrust, mImpact) / boxModulus(width, h, ew(width, h)) <= allowable;
      const stiffOk = (h: number) => (thrustN * L ** 3) / (3 * E * boxInertia(width, h, ew(width, h))) <= deflLimit;
      return {
        thrust: solveDepth(minH, maxH, (h) => mThrust / boxModulus(width, h, ew(width, h)) <= allowable),
        impact: solveDepth(minH, maxH, (h) => mImpact / boxModulus(width, h, ew(width, h)) <= allowable),
        stiffness: solveDepth(minH, maxH, stiffOk),
        geometry: minH,
        all: solveDepth(minH, maxH, (h) => strengthOk(h) && stiffOk(h) && h >= minH),
      };
    };

    // Widen until the section is no deeper than it is wide, within reason.
    let solved = depthFor(b);
    for (let i = 0; i < 24 && solved.all > MAX_DEPTH_TO_WIDTH * b; i++) {
      b += Math.max(1, b * 0.08);
      solved = depthFor(b);
    }

    required.thrust = solved.thrust;
    required.impact = solved.impact;
    required.stiffness = solved.stiffness;
    required.geometry = solved.geometry;
    heightMm = solved.all;
    widthMm = b;
  }

  /*
    Which case governs, with ties broken toward geometry.

    When several cases land on the same floor — common on a printed arm, where
    the minimum practical depth satisfies strength several times over — the
    honest answer is that no load decided the size, the geometry did. Reporting
    "thrust" there would tell the user their arm is thrust-limited when its
    stress is a third of allowable.
  */
  const ORDER: LoadCase[] = ["geometry", "stiffness", "impact", "thrust"];
  const peak = Math.max(...Object.values(required));
  const governing = ORDER.find((k) => Math.abs(required[k] - peak) < 1e-6) ?? "thrust";

  /*
    Report the stress and deflection of the section actually chosen. A cut arm
    is solid, so its wall is its full half-depth; a printed arm is a box and
    must be measured as one or its weight and stiffness are both wrong.
  */
  const solidWall = Math.min(widthMm, heightMm) / 2;
  const wall = material.method === "print" ? effectiveWall(widthMm, heightMm, input.wallMm) : solidWall;
  // "Hollow" means a cavity will really be built, not merely that it was asked for.
  const isHollow = wall < solidWall - 1e-9;
  const Z = boxModulus(widthMm, heightMm, wall);
  const I = boxInertia(widthMm, heightMm, wall);
  const areaMm2 = boxArea(widthMm, heightMm, wall);
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
    hollow: isHollow,
    wallMm: isHollow ? round(wall, 2) : 0,
    areaMm2: round(areaMm2),
    inertiaMm4: round(I),
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
