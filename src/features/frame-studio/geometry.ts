/*
  Frame Studio — parametric geometry.

  Produces manufacturable 2D profiles (closed outlines + circular holes, in mm)
  for every part of a multirotor frame, derived entirely from the user's
  components. Nothing here is drawn by hand: motor positions come from the
  layout, the wheelbase comes from propeller clearance, and arm sections come
  from the structural solver.
*/

import {
  EDGE_DISTANCE_FACTOR,
  materialById,
  motorById,
  snapToStock,
  styleById,
  thicknessReferenceFor,
  WHEELBASE_REFERENCE,
  type FlyingStyle,
  type Material,
  type MotorSpec,
} from "./catalog";
import { massOf, minRootWidth, motorPadWidth, PAD_EDGE_FACTOR, round, sizeArm, type SectionResult } from "./structure";

export type Layout = "true-x" | "stretched-x" | "h" | "deadcat";

export const LAYOUTS: { id: Layout; name: string; blurb: string }[] = [
  { id: "true-x", name: "True X", blurb: "Equal arms, symmetric handling. The all-round default." },
  { id: "stretched-x", name: "Stretched X", blurb: "Longer front-to-back. Smoother, more locked-in on fast forward flight." },
  { id: "h", name: "H frame", blurb: "Rectangular body with side rails. Roomy for electronics and easy to build." },
  { id: "deadcat", name: "Dead Cat", blurb: "Front arms swept forward to keep propellers out of the camera view." },
];

export type Pt = [number, number];
export interface Hole {
  c: Pt;
  r: number;
  /**
   * Edge distance this hole needs, as a multiple of its diameter. Defaults to
   * the structural 1.5; motor-pad bolts carry a lower factor (see PAD_EDGE_FACTOR).
   */
  edgeFactor?: number;
}

export interface Profile {
  id: string;
  name: string;
  qty: number;
  /** Closed outline polygon, mm. */
  outline: Pt[];
  holes: Hole[];
  /** Extra closed cut-outs (battery strap slots etc.). */
  slots: Pt[][];
  /** Material thickness this part is made at, mm. */
  thicknessMm: number;
  /**
   * Internal void for a hollow printed section, if any.
   *
   * This is NOT a hole: it is enclosed on all six sides, so it never appears
   * in a cutting file and only exists in the solid model. `outline` is the
   * cavity in plan, and it spans `wallMm` to `thicknessMm - wallMm` in depth.
   */
  cavity?: { outline: Pt[]; wallMm: number };
  /** Planar area of the outline minus holes, mm². */
  areaMm2: number;
}

export interface FrameSpec {
  layout: Layout;
  propIn: number;
  /** Gap between adjacent propeller discs, mm. */
  clearanceMm: number;
  /** Motor-to-motor diagonal, mm. Null = use the computed minimum. */
  wheelbaseMm: number | null;
  motorId: string;
  /** Peak thrust per motor, grams (user may override the catalogue default). */
  motorThrustG: number;
  stackPattern: number;
  stackBolt: number;
  battery: { l: number; w: number; h: number; massG: number };
  /** FC, ESC, VTX, camera, RX, wiring — everything that isn't frame or battery. */
  electronicsMassG: number;
  materialId: string;
  /**
   * Cut frames: arm stock thickness, mm. Printed frames: starting outer width
   * of the arm's box section, mm. `null` lets the studio choose from the
   * published reference for this prop class.
   */
  fixedDimMm: number | null;
  /** Cut frames: plate stock thickness, mm. `null` = choose from the reference. */
  plateThicknessMm: number | null;
  /** Printed frames: wall thickness of the hollow arm, mm. */
  wallMm: number;
  styleId: string;
  safetyFactor: number;
}

export interface FrameDesign {
  spec: FrameSpec;
  material: Material;
  motor: MotorSpec;
  style: FlyingStyle;
  wheelbaseMm: number;
  /** Hard floor from propeller clearance, mm. */
  minWheelbaseMm: number;
  /** Clearance floor raised into the published size band for this prop, mm. */
  recommendedWheelbaseMm: number;
  referenceBand: { min: number; max: number } | null;
  motors: Pt[];
  /** Smallest centre-to-centre distance between any two motors, mm. */
  minMotorSpacingMm: number;
  propDiaMm: number;
  bodyWmm: number;
  bodyLmm: number;
  /** Exposed cantilever, plate edge to motor centre, mm. */
  armLengthMm: number;
  /** Radius at which the arm emerges from the plate edge, mm. */
  rootRadiusMm: number;
  /** Length of the arm clamped between the plates, mm. */
  armOverlapMm: number;
  /** Diameter of the arm clamp bolts, mm. */
  rootBoltMm: number;
  section: SectionResult;
  profiles: Profile[];
  /** What the studio decided each part is made from, and why. */
  stock: {
    /** Arm sheet thickness (cut) or arm outer width (printed), mm. */
    armDimMm: number;
    bottomPlateMm: number;
    topPlateMm: number;
    wallMm: number;
    /** The published reference value before any escalation. */
    referenceArmMm: number;
    /** True when the reference stock was too thin and the studio stepped up. */
    escalated: boolean;
    /** True when the studio chose rather than the user. */
    autoChosen: boolean;
    /** Thickness the studio would pick on its own, mm. */
    suggestedArmMm: number;
    /** Arm width that thickness would produce, mm. */
    suggestedWidthMm: number;
    /** Widest the root may be before the arm is really a plate, mm. */
    widthCapMm: number;
  };
  mass: {
    frameG: number;
    /** Bolts, nuts and standoffs. */
    hardwareG: number;
    motorsG: number;
    batteryG: number;
    electronicsG: number;
    auwG: number;
  };
  thrustToWeight: number;
  /** Fraction of total thrust needed to hover, 0–1. */
  hoverThrustFraction: number;
  /**
   * Approximate hover throttle stick position, 0–1. Propeller thrust rises
   * roughly with the square of throttle, so throttle ≈ √(thrust fraction).
   * Comparable to ArduPilot's learned MOT_THST_HOVER.
   */
  hoverThrottle: number;
}

const IN_TO_MM = 25.4;
const TAU = Math.PI * 2;
const deg = (d: number) => (d * Math.PI) / 180;

/* ---------------------------------------------------------------- layouts */

/**
 * Motor centres for a layout at a given wheelbase (motor-to-motor diagonal).
 * Order is front-right, rear-right, rear-left, front-left. +Y is forward.
 */
export function motorPositions(layout: Layout, wheelbase: number): Pt[] {
  const R = wheelbase / 2;
  // stretch = front-back half-length ÷ side half-width
  const stretch = layout === "stretched-x" ? 1.35 : layout === "h" ? 1.25 : 1;
  const w = R / Math.sqrt(1 + stretch * stretch); // half width (X)
  const l = stretch * w; // half length (Y)

  if (layout === "deadcat") {
    // Front arms swept forward and outward so props leave the camera view.
    const fw = w * 1.18;
    const fl = l * 1.05;
    const rw = w * 0.92;
    const rl = l * 1.12;
    return recentre([
      [fw, fl],
      [rw, -rl],
      [-rw, -rl],
      [-fw, fl],
    ]);
  }
  return [
    [w, l],
    [w, -l],
    [-w, -l],
    [-w, l],
  ];
}

/**
 * Shift a motor set so its centroid is the origin.
 *
 * The origin is where the studio puts the plates, the stack and the battery —
 * that is, the centre of mass. For the aircraft to hover level that point has
 * to coincide with the centre of thrust, which is the mean of the four motor
 * positions. Symmetric layouts satisfy this for free; an asymmetric one like
 * the dead cat does not, and leaving it unshifted would hand the user a frame
 * whose CG is permanently off the thrust centre.
 */
function recentre(pts: Pt[]): Pt[] {
  const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  return pts.map(([x, y]) => [x - cx, y - cy] as Pt);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function minSpacing(pts: Pt[]): number {
  let m = Infinity;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) m = Math.min(m, dist(pts[i], pts[j]));
  return m;
}

/**
 * Smallest wheelbase that keeps adjacent propeller discs `clearance` apart.
 * Solved numerically so it is correct for every layout, not just True X
 * (where it reduces to the familiar wheelbase = √2 · (prop + gap)).
 */
export function minWheelbaseFor(layout: Layout, propDiaMm: number, clearanceMm: number): number {
  const need = propDiaMm + clearanceMm;
  // minSpacing scales linearly with wheelbase, so one probe gives the factor.
  const probe = 1000;
  const k = minSpacing(motorPositions(layout, probe)) / probe;
  return Math.ceil(need / k);
}

/* --------------------------------------------------------------- profiles */

/**
 * Points along a circular arc, as a polygon that *circumscribes* the true
 * circle rather than being inscribed in it.
 *
 * This matters for real parts. An inscribed polygon cuts inside the nominal
 * radius at every vertex, so a motor pad drawn that way comes out slightly
 * smaller than designed and its bolts end up closer to the edge than the
 * drawing claims. Pushing the vertices out by 1/cos(half step) puts the facet
 * midpoints exactly on the nominal circle, so the part is never undersized.
 */
export function arcPoints(c: Pt, r: number, a0Deg: number, sweepDeg: number, seg: number): Pt[] {
  const half = deg(sweepDeg / seg / 2);
  const rOut = r / Math.cos(half);
  const pts: Pt[] = [];
  for (let i = 0; i <= seg; i++) {
    const a = deg(a0Deg + (sweepDeg * i) / seg);
    pts.push([c[0] + rOut * Math.cos(a), c[1] + rOut * Math.sin(a)]);
  }
  return pts;
}

/** Rounded rectangle centred on the origin. */
export function roundedRect(w: number, h: number, r: number, seg = 8): Pt[] {
  const rr = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  const x = w / 2;
  const y = h / 2;
  const corners: { c: Pt; a0: number }[] = [
    { c: [x - rr, y - rr], a0: 0 },
    { c: [-x + rr, y - rr], a0: 90 },
    { c: [-x + rr, -y + rr], a0: 180 },
    { c: [x - rr, -y + rr], a0: 270 },
  ];
  const pts: Pt[] = [];
  for (const { c, a0 } of corners) pts.push(...arcPoints(c, rr, a0, 90, seg));
  return pts;
}

/** Square bolt pattern centred at `c`. */
export function patternHoles(c: Pt, pattern: number, bolt: number, edgeFactor?: number): Hole[] {
  const h = pattern / 2;
  return [
    [c[0] + h, c[1] + h],
    [c[0] - h, c[1] + h],
    [c[0] - h, c[1] - h],
    [c[0] + h, c[1] - h],
  ].map((p) => ({ c: p as Pt, r: bolt / 2, edgeFactor }));
}

/**
 * Length of arm kept fully solid at the root, mm.
 * Published printed-arm guidance is to run the first 15 mm at 100% infill:
 * it is where the bending moment peaks and where both clamp bolts pull.
 */
const SOLID_ROOT_MM = 15;

/** Centre-to-centre spacing of the two root bolts, as a multiple of bolt diameter. */
const ROOT_BOLT_SPACING_FACTOR = 4;

/**
 * Clear distance an arm's own bolt needs from the arm's inboard tip.
 *
 * The tip is a half-round, so a bolt on the arm axis at local x has exactly x
 * of material between its centre and that arc. Needing hole radius plus
 * 1.5 × d of edge distance gives 2 × d.
 */
function tipClearance(rootBolt: number): number {
  return rootBolt / 2 + EDGE_DISTANCE_FACTOR * rootBolt;
}

/**
 * How far an arm reaches inboard of the plate edge.
 *
 * Both of its bolts have to sit in material, clear of the arm's own tip, with
 * enough left over for the plate to grip past the last bolt:
 *   tip clearance + bolt spacing + grip margin.
 */
export function armOverlap(rootBolt: number): number {
  return tipClearance(rootBolt) + ROOT_BOLT_SPACING_FACTOR * rootBolt + 2 * rootBolt;
}

/** Local x of each root bolt, measured from the arm's inboard tip. */
export function rootBoltOffsets(rootBolt: number): [number, number] {
  const first = tipClearance(rootBolt);
  return [first, first + ROOT_BOLT_SPACING_FACTOR * rootBolt];
}

/* --------------------------------------------- polygon measurement helpers */

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const vx = b[0] - a[0];
  const vy = b[1] - a[1];
  const wx = p[0] - a[0];
  const wy = p[1] - a[1];
  const len2 = vx * vx + vy * vy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, (wx * vx + wy * vy) / len2));
  return Math.hypot(wx - t * vx, wy - t * vy);
}

/** Shortest distance from a point to a polygon's boundary, mm. */
export function distanceToBoundary(p: Pt, poly: Pt[]): number {
  let best = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    best = Math.min(best, distanceToSegment(p, poly[j], poly[i]));
  }
  return best;
}

/** Even-odd ray cast. True when the point lies inside the polygon. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Edge distance a hole needs from any free edge, measured hole edge to boundary. */
export function requiredEdgeClearance(h: Hole): number {
  return (h.edgeFactor ?? EDGE_DISTANCE_FACTOR) * h.r * 2;
}

/**
 * Grow a rounded rectangle until every hole clears its edge requirement.
 *
 * Sizing a plate from each hole's x and y extent is not enough, because a
 * rounded corner cuts across the diagonal where the arm-root bolts sit — the
 * plate looks big enough and is not. Measuring against the real outline and
 * growing until it passes is both simpler and correct for any hole layout.
 */
export function fitRoundedPlate(w0: number, l0: number, cornerR: number, holes: Hole[]): { w: number; l: number } {
  let w = w0;
  let l = l0;
  for (let pass = 0; pass < 24; pass++) {
    const outline = roundedRect(w, l, Math.min(cornerR, Math.min(w, l) / 2 - 0.01));
    let worst = 0;
    for (const h of holes) {
      const clear = (pointInPolygon(h.c, outline) ? distanceToBoundary(h.c, outline) : -distanceToBoundary(h.c, outline)) - h.r;
      worst = Math.max(worst, requiredEdgeClearance(h) - clear);
    }
    if (worst <= 0.01) break;
    // Grow by the shortfall (doubled, since it applies to both sides) plus a nudge.
    w += 2 * worst + 0.2;
    l += 2 * worst + 0.2;
  }
  return { w: round(w), l: round(l) };
}

/**
 * A tapered arm lying along +X, in local coordinates with its inboard tip at
 * x = 0. The first `overlapMm` is the straight section that is clamped between
 * the plates; the arm emerges from the plate edge at x = overlapMm and runs on
 * to a circular motor pad at x = overlapMm + cantileverMm.
 */
export function armProfile(opts: {
  /** Exposed length, plate edge to motor centre. */
  cantileverMm: number;
  /** Length of the clamped section inboard of the plate edge. */
  overlapMm: number;
  rootWidthMm: number;
  padWidthMm: number;
  motorPattern: number;
  motorBolt: number;
  rootBolt: number;
  thicknessMm: number;
  /** Wall of the hollow box, mm. Omit or zero for a solid cut part. */
  wallMm?: number;
  id: string;
  name: string;
  qty: number;
}): Profile {
  const { cantileverMm, overlapMm, rootWidthMm: wr, padWidthMm: wp, thicknessMm } = opts;
  const motorX = overlapMm + cantileverMm;
  const padR = wp / 2;
  // Hold full width through the clamped section, then taper out to the pad.
  const taperStart = Math.min(overlapMm + wr * 0.5, motorX - padR);
  const taperEnd = Math.max(taperStart, motorX - padR);
  // Half-round inboard end, centred on the arm axis.
  const tipR = Math.min(wr / 2, overlapMm / 2);

  const outline: Pt[] = [];
  // Half-round inboard end: +90° round through 180° to 270°.
  outline.push(...arcPoints([tipR, 0], tipR, 90, 180, 16));
  outline.push([taperStart, -wr / 2]);
  outline.push([taperEnd, -padR]);
  // Semicircular motor pad, swept from -90° up through 0° to +90°.
  outline.push(...arcPoints([motorX, 0], padR, -90, 180, 24));
  outline.push([taperEnd, padR]);
  outline.push([taperStart, wr / 2]);
  // closes back onto the start of the tip arc

  const [b1, b2] = rootBoltOffsets(opts.rootBolt);
  const holes: Hole[] = [
    ...patternHoles([motorX, 0], opts.motorPattern, opts.motorBolt, PAD_EDGE_FACTOR),
    // two root bolts clamping the arm in the plate sandwich
    { c: [b1, 0], r: opts.rootBolt / 2 },
    { c: [b2, 0], r: opts.rootBolt / 2 },
  ];

  /*
    Internal void for a printed arm.

    It runs between the solid root and the motor pad only. Both ends stay
    solid on purpose: the root carries the whole bending moment and both clamp
    bolts, and the pad carries the motor's. Published guidance is to keep the
    first 15 mm at the root fully solid, which is what SOLID_ROOT_MM is.
  */
  let cavity: { outline: Pt[]; wallMm: number } | undefined;
  const wall = opts.wallMm ?? 0;
  if (wall > 0 && thicknessMm > 2 * wall + 1) {
    const halfWidthAt = (x: number) => {
      if (x <= taperStart) return wr / 2;
      if (x >= taperEnd) return padR;
      return (wr / 2) + ((padR - wr / 2) * (x - taperStart)) / Math.max(1e-6, taperEnd - taperStart);
    };
    const xStart = overlapMm + SOLID_ROOT_MM;
    const xEnd = motorX - padR - wall;
    if (xEnd - xStart > 8) {
      const steps = 14;
      const lower: Pt[] = [];
      const upper: Pt[] = [];
      for (let i = 0; i <= steps; i++) {
        const x = xStart + ((xEnd - xStart) * i) / steps;
        const hw = Math.max(0, halfWidthAt(x) - wall);
        lower.push([x, -hw]);
        upper.push([x, hw]);
      }
      if (lower.every((p) => Math.abs(p[1]) > 0.6)) {
        cavity = { outline: [...lower, ...upper.reverse()], wallMm: wall };
      }
    }
  }

  const holeArea = holes.reduce((s, h) => s + Math.PI * h.r * h.r, 0);
  return {
    id: opts.id,
    name: opts.name,
    qty: opts.qty,
    outline,
    holes,
    slots: [],
    thicknessMm,
    cavity,
    areaMm2: polygonArea(outline) - holeArea,
  };
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
}

/* ------------------------------------------------------------ main design */

/** Reference modulus for plate scaling: carbon plate, GPa. */
const PLATE_REF_MODULUS = 64;
/**
 * Printed arm outer width as a fraction of the motor pad width.
 * Width is the cheap dimension on a printed arm — it costs plan area, not
 * height — so starting generous keeps the section from coming out as a deep
 * narrow fin beside a 3 mm plate.
 */
const PRINT_WIDTH_TO_PAD = 0.7;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Thickness of each plate, and the wall of a printed arm. */
export interface PlateStock {
  bottomMm: number;
  topMm: number;
  wallMm: number;
}


export function designFrame(spec: FrameSpec): FrameDesign {
  const material = materialById(spec.materialId);
  const motor = motorById(spec.motorId);
  const style = styleById(spec.styleId);
  const propDiaMm = spec.propIn * IN_TO_MM;

  const minWheelbaseMm = minWheelbaseFor(spec.layout, propDiaMm, spec.clearanceMm);
  const band = WHEELBASE_REFERENCE.find((w) => Math.abs(w.prop - spec.propIn) < 0.01) ?? null;
  // Bare clearance is the hard floor, but production frames in each prop class
  // run a little larger, so default into the published band when one exists.
  const recommendedWheelbaseMm = Math.max(minWheelbaseMm, band?.min ?? 0);
  const wheelbaseMm = Math.max(spec.wheelbaseMm ?? recommendedWheelbaseMm, minWheelbaseMm);
  const motors = motorPositions(spec.layout, wheelbaseMm);
  const minMotorSpacingMm = round(minSpacing(motors));

  /*
    Plate sizing works outward from what has to fit on it.

    The arms are not butted against the plate edge — they reach inboard and are
    clamped between the two plates, which is how every production frame does it
    and the only way the root bolts land in material. So the plate has to be
    large enough to cover that overlap without its bolts fouling the stack:

      root radius ≥ stack hole outer edge + clearance + arm overlap

    and the plate must then contain the root point along every arm bearing.
  */
  // Arm bolts match the class of hardware the build already uses: micro frames
  // run M2 throughout, full-size frames M3. Using M3 on a 3" frame would force
  // an overlap — and therefore a centre plate — far larger than it needs.
  const ROOT_BOLT = spec.stackPattern <= 20 || motor.bolt <= 2 ? 2 : 3;
  const armOverlapMm = armOverlap(ROOT_BOLT);
  const stackSpan = spec.stackPattern + 2 * EDGE_DISTANCE_FACTOR * spec.stackBolt;
  // Stack holes sit on a square; its corners are the furthest out.
  const stackHoleEdgeR = spec.stackPattern * Math.SQRT1_2 + spec.stackBolt / 2;
  const rootRadius = round(stackHoleEdgeR + ROOT_BOLT + 2 + armOverlapMm);

  const motorRadius = Math.min(...motors.map((m) => Math.hypot(m[0], m[1])));
  const armLengthMm = round(Math.max(25, motorRadius - rootRadius));

  /*
    Plate half-dimensions must cover the arm roots, the stack and the battery,
    and must also keep some proportion to the aircraft: a 10" frame with a 5"
    centre plate looks — and handles — like a plank with motors on it.
  */
  const edgeMargin = EDGE_DISTANCE_FACTOR * ROOT_BOLT + 1;
  const rootHalfW = Math.max(...motors.map((m) => Math.abs(Math.cos(Math.atan2(m[1], m[0]))))) * rootRadius;
  const rootHalfL = Math.max(...motors.map((m) => Math.abs(Math.sin(Math.atan2(m[1], m[0]))))) * rootRadius;
  const bodyWmm = round(2 * Math.max(rootHalfW + edgeMargin, stackSpan / 2 + 5, spec.battery.w / 2 + 4, wheelbaseMm * 0.13, 20));
  const bodyLmm = round(2 * Math.max(rootHalfL + edgeMargin, stackSpan / 2 + 12, spec.battery.l * 0.325, wheelbaseMm * 0.17, 28));

  /*
    Resolve how thick each part is made.

    Production frames do not cut a whole airframe from one sheet: a 10" frame
    runs 7.5 mm arms against 2–3 mm plates. Arm thickness is what buys bending
    stiffness (it enters as t³), so it is the dimension that scales with the
    aircraft, while plates barely move across the whole size range. Defaults
    come from the published reference table; the user may override either.
  */
  const ref = thicknessReferenceFor(spec.propIn);
  const stock = material.stock ?? [1.5, 2, 2.5, 3, 4, 5, 6];
  const padW = motorPadWidth(motor.pattern, motor.bolt);
  const isCut = material.method === "cut";
  const wallMm = Math.max(1.2, spec.wallMm);

  const modulusScale = isCut ? 1 : Math.cbrt(PLATE_REF_MODULUS / material.modulus);
  // Printed thicknesses are rounded to a tenth: nobody slices a 6.6038 mm
  // plate, and the extra digits only make the file names absurd.
  const bottomPlateMm = spec.plateThicknessMm
    ?? (isCut ? snapToStock(ref.bottomMm, stock) : round(clamp(ref.bottomMm * modulusScale, 3, 12), 1));
  const topPlateMm = spec.plateThicknessMm
    ?? (isCut ? snapToStock(ref.topMm, stock) : round(clamp(ref.topMm * modulusScale, 2.5, 10), 1));

  /*
    An arm wider than this stops being an arm and becomes a plate. When the
    chosen stock cannot meet the stiffness requirement without exceeding it,
    the studio steps up to the next thickness rather than returning the
    80 mm-wide paddle the equations would otherwise be happy with.
  */
  const widthCap = Math.max(minRootWidth(motor.bolt), minRootWidth(ROOT_BOLT), 0.8 * padW);
  const autoArm = spec.fixedDimMm === null;
  const refArmDim = isCut
    ? snapToStock(ref.armMm, stock)
    : Math.max(PRINT_WIDTH_TO_PAD * padW, minRootWidth(motor.bolt));

  const solveSection = (auw: number, forceAuto = false) => {
    const auto = autoArm || forceAuto;
    const inputAt = (dim: number) => sectionInput(spec, material, motor, armLengthMm, auw, style.loadFactor, ROOT_BOLT, dim, wallMm);
    if (!isCut) {
      const dim = auto ? refArmDim : spec.fixedDimMm!;
      return { section: sizeArm(inputAt(dim)), armDimMm: dim, escalated: false };
    }
    const start = auto ? refArmDim : spec.fixedDimMm!;
    // Step up through stocked thicknesses until the arm stops being a plate.
    const candidates = auto ? stock.filter((t) => t >= start - 1e-6) : [start];
    let fallback = { section: sizeArm(inputAt(start)), armDimMm: start, escalated: false };
    for (const t of candidates) {
      const section = sizeArm(inputAt(t));
      fallback = { section, armDimMm: t, escalated: t > start + 1e-6 };
      if (section.widthMm <= widthCap) return fallback;
    }
    return fallback;
  };

  // Arm section and all-up weight are mutually dependent (a heavier aircraft
  // needs stronger arms, which are heavier). Converge in a few passes.
  // Fasteners and standoffs: small but not negligible on a light airframe.
  const hardwareG = 25;
  const fixedMass = motor.massG * 4 + spec.battery.massG + spec.electronicsMassG + hardwareG;
  let auwG = fixedMass + 120; // first guess at frame mass
  let solved = solveSection(auwG);
  /*
    Always work out what the studio *would* have chosen, even when the user has
    fixed the thickness. That is what lets the review panel say "this would
    need 7 mm stock" instead of silently drawing an arm as wide as the plate.
  */
  let suggested = autoArm ? solved : solveSection(auwG, true);
  const plateGeom: PlateGeom = { motors, rootRadius, armOverlapMm, rootBolt: ROOT_BOLT };
  const plates: PlateStock = { bottomMm: bottomPlateMm, topMm: topPlateMm, wallMm };
  let profiles = buildProfiles(spec, motor, solved.section, armLengthMm, bodyWmm, bodyLmm, plateGeom, plates);
  let frameG = frameMass(profiles, material, solved.section, armLengthMm);
  for (let i = 0; i < 5; i++) {
    auwG = fixedMass + frameG;
    solved = solveSection(auwG);
    suggested = autoArm ? solved : solveSection(auwG, true);
    profiles = buildProfiles(spec, motor, solved.section, armLengthMm, bodyWmm, bodyLmm, plateGeom, plates);
    const next = frameMass(profiles, material, solved.section, armLengthMm);
    if (Math.abs(next - frameG) < 0.5) { frameG = next; break; }
    frameG = next;
  }
  auwG = fixedMass + frameG;
  const section = solved.section;

  const totalThrustG = spec.motorThrustG * 4;
  const thrustToWeight = auwG > 0 ? totalThrustG / auwG : 0;

  return {
    spec,
    material,
    motor,
    style,
    wheelbaseMm: round(wheelbaseMm),
    minWheelbaseMm,
    recommendedWheelbaseMm,
    referenceBand: band ? { min: band.min, max: band.max } : null,
    motors,
    minMotorSpacingMm,
    propDiaMm: round(propDiaMm),
    bodyWmm,
    bodyLmm,
    armLengthMm,
    rootRadiusMm: rootRadius,
    armOverlapMm,
    rootBoltMm: ROOT_BOLT,
    section,
    profiles,
    stock: {
      armDimMm: round(solved.armDimMm, 2),
      bottomPlateMm: round(bottomPlateMm, 2),
      topPlateMm: round(topPlateMm, 2),
      wallMm: round(wallMm, 2),
      referenceArmMm: round(refArmDim, 2),
      escalated: solved.escalated,
      autoChosen: autoArm,
      /** What the studio would choose on its own, and the arm that would give. */
      suggestedArmMm: round(suggested.armDimMm, 2),
      suggestedWidthMm: round(suggested.section.widthMm, 1),
      /** Widest the arm root may get before it stops being an arm. */
      widthCapMm: round(widthCap, 1),
    },
    mass: {
      frameG: round(frameG),
      hardwareG,
      motorsG: motor.massG * 4,
      batteryG: spec.battery.massG,
      electronicsG: spec.electronicsMassG,
      auwG: round(auwG),
    },
    thrustToWeight: round(thrustToWeight, 2),
    hoverThrustFraction: totalThrustG > 0 ? round(auwG / totalThrustG, 3) : 0,
    hoverThrottle: totalThrustG > 0 ? round(Math.min(1, Math.sqrt(auwG / totalThrustG)), 2) : 0,
  };
}

function sectionInput(spec: FrameSpec, material: Material, motor: MotorSpec, L: number, auwG: number, loadFactor: number, rootBolt: number, fixedDimMm: number, wallMm: number) {
  return {
    material,
    safetyFactor: spec.safetyFactor,
    armLengthMm: L,
    motorThrustG: spec.motorThrustG,
    auwG,
    loadFactor,
    motorPattern: motor.pattern,
    motorBolt: motor.bolt,
    rootBolt,
    fixedDimMm,
    wallMm,
  };
}

interface PlateGeom {
  motors: Pt[];
  rootRadius: number;
  armOverlapMm: number;
  rootBolt: number;
}

/**
 * Global positions of every arm root bolt. The arm's inboard tip sits at
 * `rootRadius - overlap` along its bearing, and its bolts step out from there.
 */
export function armRootHoles(g: PlateGeom): Hole[] {
  const offsets = rootBoltOffsets(g.rootBolt);
  const holes: Hole[] = [];
  for (const m of g.motors) {
    const a = Math.atan2(m[1], m[0]);
    const tip = g.rootRadius - g.armOverlapMm;
    for (const o of offsets) {
      const r = tip + o;
      holes.push({ c: [r * Math.cos(a), r * Math.sin(a)], r: g.rootBolt / 2 });
    }
  }
  return holes;
}

function buildProfiles(spec: FrameSpec, motor: MotorSpec, section: SectionResult, armLengthMm: number, bodyW: number, bodyL: number, g: PlateGeom, plates: PlateStock): Profile[] {
  // Plate thicknesses are resolved by the caller from the published reference
  // (and scaled for a printed material's much lower modulus), not guessed here.
  const bottomT = plates.bottomMm;
  const topT = plates.topMm;

  const arm = armProfile({
    cantileverMm: armLengthMm,
    overlapMm: g.armOverlapMm,
    rootWidthMm: section.widthMm,
    padWidthMm: section.padWidthMm,
    motorPattern: motor.pattern,
    motorBolt: motor.bolt,
    rootBolt: g.rootBolt,
    thicknessMm: section.heightMm,
    wallMm: section.hollow ? section.wallMm : 0,
    id: "arm",
    name: "Arm",
    qty: 4,
  });

  // Bottom plate: stack holes, arm root bolts, battery strap slots.
  const bottomHoles: Hole[] = [
    ...patternHoles([0, 0], spec.stackPattern, spec.stackBolt),
    ...armRootHoles(g),
  ];
  const fittedBottom = fitRoundedPlate(bodyW, bodyL, 6, bottomHoles);
  const bottomOutline = roundedRect(fittedBottom.w, fittedBottom.l, 6);
  const slotW = 4;
  const slotL = Math.min(bodyW * 0.55, 26);
  const slotY = bodyL / 2 - 10;
  const slots: Pt[][] = [
    roundedRect(slotL, slotW, slotW / 2).map((p) => [p[0], p[1] + slotY] as Pt),
    roundedRect(slotL, slotW, slotW / 2).map((p) => [p[0], p[1] - slotY] as Pt),
  ];
  const bottom: Profile = {
    id: "bottom-plate",
    name: "Bottom plate",
    qty: 1,
    outline: bottomOutline,
    holes: bottomHoles,
    slots,
    thicknessMm: bottomT,
    areaMm2: polygonArea(bottomOutline) - bottomHoles.reduce((s, h) => s + Math.PI * h.r * h.r, 0) - slots.reduce((s, p) => s + polygonArea(p), 0),
  };

  /*
    The top plate is the other half of the clamp, so it has to reach every arm
    root bolt with edge distance to spare — it cannot just be a smaller
    rectangle. Size it from the bolts it must cover, then trim to the bottom
    plate so it never overhangs.
  */
  const rootHoles = armRootHoles(g);
  const topHoles: Hole[] = [...patternHoles([0, 0], spec.stackPattern, spec.stackBolt), ...rootHoles];
  const seedW = 2 * (Math.max(...rootHoles.map((h) => Math.abs(h.c[0]))) + EDGE_DISTANCE_FACTOR * g.rootBolt);
  const seedL = 2 * (Math.max(...rootHoles.map((h) => Math.abs(h.c[1]))) + EDGE_DISTANCE_FACTOR * g.rootBolt);
  const fittedTop = fitRoundedPlate(seedW, seedL, 6, topHoles);
  const topW = fittedTop.w;
  const topL = fittedTop.l;
  const topOutline = roundedRect(topW, topL, 6);
  const top: Profile = {
    id: "top-plate",
    name: "Top plate",
    qty: 1,
    outline: topOutline,
    holes: topHoles,
    slots: [],
    thicknessMm: topT,
    areaMm2: polygonArea(topOutline) - topHoles.reduce((s, h) => s + Math.PI * h.r * h.r, 0),
  };

  return [bottom, top, arm];
}

/**
 * Frame mass, grams.
 *
 * Plates are prismatic, so plan area times thickness is exact. An arm is not:
 * a printed arm is a hollow box, and multiplying its plan area by its full
 * depth would charge it for a solid bar it is not made of. Its mass is taken
 * from the solved cross-section swept along its length instead, with the motor
 * pad and the clamped root counted as solid because they are.
 */
function frameMass(profiles: Profile[], material: Material, section: SectionResult, cantileverMm: number): number {
  let total = 0;
  for (const p of profiles) {
    if (p.id === "arm") {
      const spanMm = Math.max(0, cantileverMm - section.padWidthMm / 2);
      const solidEnds = p.areaMm2 - section.widthMm * spanMm;
      const volume = section.areaMm2 * spanMm + Math.max(0, solidEnds) * p.thicknessMm;
      total += massOf(volume, material.density) * p.qty;
      continue;
    }
    total += massOf(p.areaMm2 * p.thicknessMm, material.density) * p.qty;
  }
  return round(total);
}

export { TAU };
