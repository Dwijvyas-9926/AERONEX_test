/*
  Frame Studio — parametric geometry.

  Produces manufacturable 2D profiles (closed outlines + circular holes, in mm)
  for every part of a multirotor frame, derived entirely from the user's
  components. Nothing here is drawn by hand: motor positions come from the
  layout, the wheelbase comes from propeller clearance, and arm sections come
  from the structural solver.
*/

import {
  BOLT_HEAD_DIA,
  EDGE_DISTANCE_FACTOR,
  materialById,
  motorById,
  snapToStock,
  STACK_CLEARANCE_MM,
  styleById,
  thicknessReferenceFor,
  WHEELBASE_REFERENCE,
  type FlyingStyle,
  type Material,
  type MotorSpec,
} from "./catalog";
import { unibodyOutline } from "./unibody";
import { massOf, minRootWidth, motorPadWidth, PAD_EDGE_FACTOR, round, sizeArm, type SectionResult } from "./structure";

export type Layout = "true-x" | "stretched-x" | "h" | "deadcat";

export type Construction = "bolted" | "unibody";

export const CONSTRUCTIONS: { id: Construction; name: string; blurb: string }[] = [
  { id: "bolted", name: "Bolted arms", blurb: "Arms clamped between two plates. Stiffer, and a broken arm swaps out on its own." },
  { id: "unibody", name: "Unibody", blurb: "Arms and bottom plate cut as one piece. Far simpler to build, with much less hardware — but the centre is cut at arm thickness, and a broken arm is a new plate." },
];

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
  /**
   * Index into `slots` where lightening cut-outs begin; everything before it
   * is a functional opening — a strap slot, or the stack's clearance hole.
   *
   * Recorded rather than inferred from position. Counting "every slot after
   * the second" credited the top plate's stack opening as weight saved by
   * lightening, which over-reported the saving by more than it saved.
   */
  lightenedFrom?: number;
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
  /** Arms only: exposed length of this arm, mm. Arms of different length are separate parts. */
  cantileverMm?: number;
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
  /**
   * How tall the assembled flight-controller stack stands above the plate it
   * bolts to, mm.
   *
   * Collected because it decides two things nothing else can: how long the
   * stack bolts have to be, and whether the stack fits under the top plate at
   * all. It almost never does — the plates are only an arm's thickness apart
   * — so the top plate is opened up to clear it. See `stackClearance`.
   */
  stackHeightMm: number;
  battery: { l: number; w: number; h: number; massG: number };
  /** FC, ESC, VTX, camera, RX, wiring — everything that isn't frame or battery. */
  electronicsMassG: number;
  /**
   * How the frame goes together.
   *
   * "bolted" clamps separate arms between two plates — stiffer, and a broken
   * arm is a two-minute swap. "unibody" cuts the arms and the bottom plate as
   * one piece — lighter, cheaper and simpler to build, but a broken arm means
   * a whole new plate. Small frames are usually unibody; 5" and up usually
   * bolted.
   */
  construction: Construction;
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
  /**
   * Cut material out of the plates where it does no work.
   *
   * Every production frame does this, for weight and for looks. Optional
   * because it is a rule rather than an analysis: the studio places the
   * cut-outs conservatively, in the sectors between the arms where no load
   * path runs, but it does not run FEA and a user who wants solid plates
   * should be able to have them.
   */
  lightenPlates: boolean;
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
  /** The arm parts and the bearings each is fitted at. */
  armGroups: ArmGroup[];
  /** Diameter of the arm clamp bolts, mm. */
  rootBoltMm: number;
  /**
   * True when the frame had to grow past its propeller-clearance minimum just
   * to fit the stack and the arm roots.
   */
  wheelbaseCrowded: boolean;
  /** Smallest wheelbase the propellers alone would allow, mm. */
  propMinWheelbaseMm: number;
  /** Length of each battery strap slot, mm — the widest strap that fits. */
  strapSlotMm: number;
  /**
   * How the flight-controller stack and the top plate get out of each other's
   * way.
   *
   * The two plates are only as far apart as the arm is thick — 2.5 mm on a 2"
   * frame, 7.5 mm on a 10" — while an assembled stack is 10 to 15 mm tall.
   * The stack therefore does not fit between them on any frame the studio can
   * draw, which is why real frames do not put one there: a Mark4's middle
   * plate is a ring that clamps the arm roots and leaves the centre open, and
   * the deck that covers the stack is a separate plate on tall standoffs.
   *
   * The studio follows that: the stack bolts to the bottom plate and the top
   * plate carries an opening for it to pass through.
   */
  /** What the plate cut-outs removed, if any were cut. */
  lightening: {
    count: number;
    areaMm2: number;
    savedG: number;
  };
  stackClearance: {
    /** Clear height between the plates, mm — an arm's thickness. */
    gapMm: number;
    /** How far the stack stands proud of the top plate, mm. */
    protrudesMm: number;
    /** Side of the square opening cut in the top plate, mm. Zero if it fits. */
    openingMm: number;
  };
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
    /** The published reference plate thickness, before any user override. */
    referenceBottomMm: number;
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

export function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
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
  /*
    Blend the root into the motor pad with a smoothstep rather than a straight
    taper. A straight taper leaves a hard angle at each end, and hard angles in
    carbon are where cracks start — the same reason production frames use
    curves and rounded cut-outs rather than faceted ones. Smoothstep is
    tangent-continuous at both ends, so the section changes without a corner
    anywhere along it.
  */
  const taperPts = (sign: number): Pt[] => {
    const steps = 16;
    const pts: Pt[] = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const blend = t * t * (3 - 2 * t); // smoothstep
      const x = taperStart + (taperEnd - taperStart) * t;
      const y = wr / 2 + (padR - wr / 2) * blend;
      pts.push([x, sign * y]);
    }
    return pts;
  };

  outline.push(...taperPts(-1));
  // Semicircular motor pad, swept from -90° up through 0° to +90°.
  outline.push(...arcPoints([motorX, 0], padR, -90, 180, 24));
  outline.push(...taperPts(1).reverse());
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
    /*
      Inset from the SAME curve the outline uses.

      The outline blends root to pad with a smoothstep; insetting from a
      straight line instead leaves the wall thinnest where the two diverge —
      up to 10% of (padR − wr/2), which on a thin-walled arm took a nominal
      1.2 mm wall down to 0.46 mm. That is under one extrusion width, so the
      slicer leaves a gap rather than a wall.
    */
    const halfWidthAt = (x: number) => {
      if (x <= taperStart) return wr / 2;
      if (x >= taperEnd) return padR;
      const t = (x - taperStart) / Math.max(1e-6, taperEnd - taperStart);
      const blend = t * t * (3 - 2 * t);
      return wr / 2 + (padR - wr / 2) * blend;
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
    cantileverMm,
    areaMm2: polygonArea(outline) - holeArea,
  };
}

export function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  return Math.abs(a / 2);
}

/* ------------------------------------------------------------ main design */

/**
 * Shortest exposed arm worth building, mm.
 * Below this the "arm" is a stub and the motor pad is effectively part of the
 * plate — and, more practically, there is nowhere to route the motor wires.
 */
export const MIN_CANTILEVER_MM = 25;

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

/** One arm part: its exposed length and how many of it the frame needs. */
export interface ArmGroup {
  cantileverMm: number;
  bearings: number[];
  qty: number;
  id: string;
  name: string;
}

/**
 * Split the motors into arm parts by radius.
 *
 * Radii within a tenth of a millimetre are the same part — floating point
 * noise should not turn a symmetric frame into four bespoke arms.
 */
export function groupArmsByRadius(motors: Pt[], rootRadius: number): ArmGroup[] {
  const byRadius = new Map<number, number[]>();
  for (const m of motors) {
    const key = Math.round(Math.hypot(m[0], m[1]) * 10) / 10;
    byRadius.set(key, [...(byRadius.get(key) ?? []), Math.atan2(m[1], m[0])]);
  }
  const sorted = [...byRadius.entries()].sort((a, b) => b[0] - a[0]);
  return sorted.map(([radius, bearings], i) => ({
    cantileverMm: round(Math.max(25, radius - rootRadius)),
    bearings,
    qty: bearings.length,
    id: sorted.length === 1 ? "arm" : i === 0 ? "arm-long" : "arm-short",
    name: sorted.length === 1 ? "Arm" : i === 0 ? "Front arm" : "Rear arm",
  }));
}

/** Thickness of each plate, and the wall of a printed arm. */
export interface PlateStock {
  bottomMm: number;
  topMm: number;
  wallMm: number;
}


export function designFrame(rawSpec: FrameSpec): FrameDesign {
  const material = materialById(rawSpec.materialId);
  /*
    Unibody is a cut-only construction here, and deliberately so.

    The chassis is one extrusion at one thickness, and its thickness is set by
    the arms. On a cut frame that is exactly right — a unibody IS a single
    sheet at arm thickness. Printed, the same rule gives a centre plate as
    thick as a printed arm is deep: a 21 mm solid slab on a 10" frame, four
    times the weight of the bolted equivalent and nothing anyone would print.
    Modelling it properly needs a variable-thickness solid, which the
    extrusion-based pipeline cannot express, so rather than quietly export
    something unbuildable the studio builds it bolted.
  */
  const spec: FrameSpec =
    material.method === "print" && rawSpec.construction === "unibody"
      ? { ...rawSpec, construction: "bolted" }
      : rawSpec;
  const motor = motorById(spec.motorId);
  const style = styleById(spec.styleId);
  const propDiaMm = spec.propIn * IN_TO_MM;

  const propMinWheelbaseMm = minWheelbaseFor(spec.layout, propDiaMm, spec.clearanceMm);
  const band = WHEELBASE_REFERENCE.find((w) => Math.abs(w.prop - spec.propIn) < 0.01) ?? null;

  /*
    Plate sizing works outward from what has to fit on it.

    On a bolted frame the arms are not butted against the plate edge — they
    reach inboard and are clamped between the two plates, which is how every
    production frame does it and the only way the root bolts land in material:

      root radius ≥ stack hole outer edge + clearance + arm overlap

    A unibody needs no overlap, because there is nothing to clamp. That is not
    a detail — the overlap is exactly what makes a bolted 2" or 3" frame
    geometrically impossible, since the stack and two clamp bolts already
    reach further out than the motors do.
  */
  // Arm bolts match the class of hardware the build already uses: micro frames
  // run M2 throughout, full-size frames M3. Using M3 on a 3" frame would force
  // an overlap — and therefore a centre plate — far larger than it needs.
  const ROOT_BOLT = spec.stackPattern <= 20 || motor.bolt <= 2 ? 2 : 3;
  const armOverlapMm = spec.construction === "unibody" ? 0 : armOverlap(ROOT_BOLT);
  const stackSpan = spec.stackPattern + 2 * EDGE_DISTANCE_FACTOR * spec.stackBolt;
  // Stack holes sit on a square; its corners are the furthest out.
  const stackHoleEdgeR = spec.stackPattern * Math.SQRT1_2 + spec.stackBolt / 2;
  const rootRadius = round(stackHoleEdgeR + ROOT_BOLT + 2 + armOverlapMm);

  /*
    The frame has a geometric minimum as well as a propeller one: the motors
    cannot sit closer in than the arm roots plus a usable length of arm.

    Getting this wrong was silent and nasty. The cantilever used to be clamped
    at 25 mm instead, which drew the motor pads further out than the layout
    said they were — a nominal 2" frame came out with a real 136 mm wheelbase
    while every readout, the clearance check and the exported drawing's title
    block all still said 86 mm.
  */
  const geometricMinWheelbaseMm = Math.ceil(2 * (rootRadius + MIN_CANTILEVER_MM));
  const minWheelbaseMm = Math.max(propMinWheelbaseMm, geometricMinWheelbaseMm);
  const wheelbaseCrowded = geometricMinWheelbaseMm > propMinWheelbaseMm;

  // Bare clearance is the hard floor, but production frames in each prop class
  // run a little larger, so default into the published band when one exists.
  const recommendedWheelbaseMm = Math.max(minWheelbaseMm, band?.min ?? 0);
  const wheelbaseMm = Math.max(spec.wheelbaseMm ?? recommendedWheelbaseMm, minWheelbaseMm);
  const motors = motorPositions(spec.layout, wheelbaseMm);
  const minMotorSpacingMm = round(minSpacing(motors));

  /*
    Arms are grouped by how far out their motor sits.

    For every symmetric layout all four are identical, but a dead cat sweeps
    its front motors further out than its rear ones. Drawing one arm and
    fitting it four times would put all four motors at the same radius — which
    is a true X with crooked bearings, not a dead cat. Each distinct radius is
    therefore its own part.
  */
  const armGroups = groupArmsByRadius(motors, rootRadius);
  const armLengthMm = Math.max(...armGroups.map((a) => a.cantileverMm));

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
  /*
    Clamp the inputs the solver cannot survive.
    A safety factor of zero divides the allowable stress to Infinity, which
    then compares false against every check and reports "23.9 of Infinity MPa"
    rather than failing. The UI limits these too, but the UI is not the only
    way a spec arrives here — a stale localStorage record is another.
  */
  const safetyFactor = clamp(Number.isFinite(spec.safetyFactor) ? spec.safetyFactor : 2, 1, 10);
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
    const inputAt = (dim: number) => sectionInput(safetyFactor, spec, material, motor, armLengthMm, auw, style.loadFactor, ROOT_BOLT, dim, wallMm, widthCap);
    if (!isCut) {
      const dim = auto ? refArmDim : spec.fixedDimMm!;
      return { section: sizeArm(inputAt(dim)), armDimMm: dim, escalated: false };
    }
    const start = auto ? refArmDim : spec.fixedDimMm!;
    // Step up through stocked thicknesses until the arm stops being a plate.
    const candidates = auto ? stock.filter((t) => t >= start - 1e-6) : [start];
    /*
      Judge each candidate on what the stiffness calculation DEMANDED, not on
      the width that was built. sizeArm clamps the built width to the cap so
      the drawing stays sane, which means testing the built width would pass
      on the first candidate every time and the step-up would never happen.
    */
    let fallback = { section: sizeArm(inputAt(start)), armDimMm: start, escalated: false };
    for (const t of candidates) {
      const section = sizeArm(inputAt(t));
      fallback = { section, armDimMm: t, escalated: t > start + 1e-6 };
      const demanded = Math.max(...Object.values(section.required));
      if (demanded <= widthCap) return fallback;
    }
    return fallback;
  };

  // Arm section and all-up weight are mutually dependent (a heavier aircraft
  // needs stronger arms, which are heavier). Converge in a few passes.
  // Fasteners and standoffs: small but not negligible on a light airframe.
  /*
    Fasteners and standoffs. A unibody deletes eight clamp bolts, eight nuts
    and four standoffs and adds four longer standoffs, so it carries roughly
    ten grams less ironmongery than the bolted equivalent.
  */
  const hardwareG = spec.construction === "unibody" ? 15 : 25;
  const fixedMass = motor.massG * 4 + spec.battery.massG + spec.electronicsMassG + hardwareG;
  let auwG = fixedMass + 120; // first guess at frame mass
  let solved = solveSection(auwG);
  /*
    Always work out what the studio *would* have chosen, even when the user has
    fixed the thickness. That is what lets the review panel say "this would
    need 7 mm stock" instead of silently drawing an arm as wide as the plate.
  */
  let suggested = autoArm ? solved : solveSection(auwG, true);
  const plateGeom: PlateGeom = { motors, rootRadius, armOverlapMm, rootBolt: ROOT_BOLT, armGroups };
  const plates: PlateStock = { bottomMm: bottomPlateMm, topMm: topPlateMm, wallMm };
  let profiles = buildProfiles(spec, motor, solved.section, bodyWmm, bodyLmm, plateGeom, plates);
  let frameG = frameMass(profiles, material, solved.section);
  for (let i = 0; i < 5; i++) {
    auwG = fixedMass + frameG;
    solved = solveSection(auwG);
    suggested = autoArm ? solved : solveSection(auwG, true);
    profiles = buildProfiles(spec, motor, solved.section, bodyWmm, bodyLmm, plateGeom, plates);
    const next = frameMass(profiles, material, solved.section);
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
    armGroups,
    rootBoltMm: ROOT_BOLT,
    wheelbaseCrowded,
    propMinWheelbaseMm,
    strapSlotMm: round(Math.min(bodyWmm * 0.55, 26)),
    lightening: (() => {
      /*
        Count only what the lightening added, not the strap slots or the
        stack opening, which would be there regardless. Each profile records
        where its lightening begins.
      */
      let count = 0;
      let areaMm2 = 0;
      let savedG = 0;
      if (spec.lightenPlates) {
        for (const p of profiles) {
          const extra = p.slots.slice(p.lightenedFrom ?? p.slots.length);
          const a = extra.reduce((s, poly) => s + polygonArea(poly), 0);
          count += extra.length * p.qty;
          areaMm2 += a * p.qty;
          savedG += massOf(a * p.thicknessMm, material.density) * p.qty;
        }
      }
      return { count, areaMm2: round(areaMm2), savedG: round(savedG, 1) };
    })(),
    stackClearance: (() => {
      // The clear gap between the plates is whatever the arm is thick, since
      // the standoffs that hold the top plate up are sized to match the arm.
      const gapMm = round(spec.construction === "unibody" ? spec.stackHeightMm + STACK_CLEARANCE_MM : section.heightMm, 2);
      const top = profiles.find((p) => p.id === "top-plate");
      return {
        gapMm,
        protrudesMm: round(Math.max(0, spec.stackHeightMm - gapMm), 2),
        openingMm: top && top.slots.length > 0 && spec.stackHeightMm > gapMm ? round(stackOpeningSize(spec), 2) : 0,
      };
    })(),
    section,
    profiles,
    stock: {
      armDimMm: round(solved.armDimMm, 2),
      // A unibody has no separate bottom plate; the chassis is the arm stock.
      bottomPlateMm: round(spec.construction === "unibody" ? solved.armDimMm : bottomPlateMm, 2),
      topPlateMm: round(topPlateMm, 2),
      wallMm: round(wallMm, 2),
      referenceArmMm: round(refArmDim, 2),
      referenceBottomMm: round(isCut ? snapToStock(ref.bottomMm, stock) : clamp(ref.bottomMm * modulusScale, 3, 12), 2),
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

function sectionInput(safetyFactor: number, spec: FrameSpec, material: Material, motor: MotorSpec, L: number, auwG: number, loadFactor: number, rootBolt: number, fixedDimMm: number, wallMm: number, maxWidthMm: number) {
  return {
    material,
    safetyFactor,
    armLengthMm: L,
    motorThrustG: spec.motorThrustG,
    auwG,
    loadFactor,
    motorPattern: motor.pattern,
    motorBolt: motor.bolt,
    rootBolt,
    fixedDimMm,
    wallMm,
    maxWidthMm,
  };
}

interface PlateGeom {
  motors: Pt[];
  rootRadius: number;
  armOverlapMm: number;
  rootBolt: number;
  armGroups: ArmGroup[];
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

/**
 * Standoff positions for a unibody frame, on the bisectors between arms.
 *
 * A bolted frame gets its standoffs free — they ride on the arm clamp bolts.
 * A unibody has no such bolts, so the top plate needs its own, and the only
 * clear places for them are the gaps between the arms.
 */
export function standoffHoles(motors: Pt[], bodyW: number, bodyL: number, bolt: number): Hole[] {
  const bearings = motors.map((m) => Math.atan2(m[1], m[0])).sort((a, b) => a - b);
  const edge = EDGE_DISTANCE_FACTOR * bolt + bolt / 2;
  return bearings.map((b, i) => {
    const next = i === bearings.length - 1 ? bearings[0] + TAU : bearings[i + 1];
    const mid = (b + next) / 2;
    const cos = Math.cos(mid);
    const sin = Math.sin(mid);
    // Furthest point on this bisector that still clears the plate edge.
    const r = Math.min(
      Math.abs(cos) < 1e-6 ? Infinity : (bodyW / 2 - edge) / Math.abs(cos),
      Math.abs(sin) < 1e-6 ? Infinity : (bodyL / 2 - edge) / Math.abs(sin),
    );
    return { c: [r * cos, r * sin] as Pt, r: bolt / 2 };
  });
}

/**
 * Side of the opening the stack needs in the top plate, mm.
 *
 * Sized from the bolt pattern rather than a board outline, because the pattern
 * is what the studio knows and a board always overhangs its own bolts by a few
 * millimetres. One bolt head of margin on each side covers that overhang and
 * the wiring that leaves the stack's corners.
 */
export function stackOpeningSize(spec: FrameSpec): number {
  const head = BOLT_HEAD_DIA[spec.stackBolt] ?? spec.stackBolt * 1.8;
  return spec.stackPattern + 2 * head;
}

/** Roughly where the stack's own boards end — its bolts plus their overhang. */
const stackFootprint = (spec: FrameSpec) => spec.stackPattern + 6;

/**
 * Corner radius of the stack opening, as a fraction of its side.
 *
 * Not cosmetic. The arm root bolts sit on the frame's diagonals, which is
 * exactly where a square opening points its corners, so a sharp opening runs
 * its worst feature straight at the bolts it most needs to stay away from.
 * Rounding pulls the corners back along the diagonal and buys the ligament,
 * while a generous radius is what the cut wants anyway — a sharp internal
 * corner is where a laminate starts cracking.
 */
const OPENING_CORNER_FRACTION = 0.15;

/**
 * The clearance opening in the top plate, as a slot.
 *
 * Returns nothing when the stack genuinely fits in the gap between the plates
 * — which no frame the studio draws manages, but the arithmetic is done
 * honestly rather than assumed — or when the plate is too small to give the
 * opening a sane ligament, in which case validation reports it rather than a
 * drawing being quietly spoiled.
 */
function stackOpening(spec: FrameSpec, plateW: number, plateL: number, holes: Hole[]): Pt[][] {
  const size = stackOpeningSize(spec);
  const r = clamp(size * OPENING_CORNER_FRACTION, 2, 8);
  const poly = roundedRect(size, size, r);

  /*
    Measure against the polygon that will actually be cut, not against the
    square it was derived from. Measuring the idealised square treated the
    corner as reaching a full half-side out along the diagonal, which is
    where the rounding has just taken material away — it under-reported the
    ligament by several millimetres and refused openings that fit perfectly
    well.
  */
  const minLigament = Math.max(2.5, spec.stackBolt * 1.5);
  for (const h of holes) {
    let d = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      d = Math.min(d, distanceToSegment(h.c, poly[j], poly[i]));
    }
    if (d - h.r < minLigament) return [];
  }

  // And it must leave a rim of plate around itself.
  const reach = Math.max(...poly.map((p) => Math.abs(p[0])));
  if (reach + minLigament > plateW / 2 || reach + minLigament > plateL / 2) return [];

  /*
    Last check: having rounded the corners, the opening must still pass the
    stack. A radius that clears the arm bolts but clips the ESC board is a
    plate that cannot be assembled.
  */
  const corner = (stackFootprint(spec) / 2) * Math.SQRT2;
  const openingAtCorner = ((size / 2 - r) * Math.SQRT2) + r;
  if (openingAtCorner < corner) return [];

  return [poly];
}

/* ------------------------------------------------------- lightening holes */

/*
  Removing plate material where it does no work.

  There is no published numeric rule for this and it would be dishonest to
  invent one — machining guidance is explicit that diameter-based rules are
  not universal acceptance criteria. What is agreed is the principle, and it
  is all this follows:

    - take material from low-stress areas, never from a direct load path
      between mounts;
    - stay well clear of fasteners;
    - use generous radii, since a sharp internal corner is where a laminate
      begins to crack;
    - avoid narrow ligament patterns that make load weave between holes
      instead of flowing through continuous material.

  So cut-outs are placed only in the sectors between adjacent arms, which is
  where no arm's load crosses on its way to the stack or to another arm, and
  each one is shrunk until it clears every hole, slot and edge by a real
  margin. Nothing is cut from an arm: the arm is the load path, its section
  was solved by beam theory, and a hole in it invalidates that solve.

  This is a rule, not an optimisation. The studio does not run FEA, and the
  result should be read as a conservative tidy-up rather than a minimum-mass
  plate.
*/

/**
 * Clear material a cut-out must leave to anything else, mm.
 *
 * Two terms, and deliberately neither of them is plate thickness. An earlier
 * version demanded twice the thickness, which has it backwards: a ligament
 * gets stronger as the plate gets thicker, not weaker, and the rule quietly
 * refused every cut-out on printed plates — a 5.5 mm plate was asked for an
 * 11 mm ligament and never got one, so printed frames were silently never
 * lightened at all.
 *
 * What actually sets the floor is bolt bearing — 1.5 diameters of material
 * so a loaded hole cannot tear out towards the opening — and the least
 * material worth leaving in a laminate at all.
 */
function lighteningLigament(boltMm: number): number {
  return Math.max(3, 1.5 * boltMm);
}

/**
 * Does `poly` clear everything around it by at least `need` millimetres?
 *
 * A predicate rather than a measurement, and it bails the moment anything
 * comes too close. The search below rejects most of what it tries, so the
 * common path is an early exit — measuring the true minimum first and
 * comparing afterwards made the whole sweep time out.
 */
function clearsBy(poly: Pt[], outline: Pt[], holes: Hole[], slots: Pt[][], need: number): boolean {
  for (const p of poly) {
    if (!pointInPolygon(p, outline)) return false;
    if (distanceToBoundary(p, outline) < need) return false;
  }
  for (const h of holes) {
    // A hole swallowed by the cut-out is not a clearance, it is a collision.
    if (pointInPolygon(h.c, poly)) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (distanceToSegment(h.c, poly[j], poly[i]) - h.r < need) return false;
    }
  }
  for (const s of slots) {
    for (const p of poly) {
      if (pointInPolygon(p, s)) return false;
      for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
        if (distanceToSegment(p, s[j], s[i]) < need) return false;
      }
    }
    for (const p of s) if (pointInPolygon(p, poly)) return false;
  }
  return true;
}

/**
 * Lightening cut-outs for one plate.
 *
 * One candidate per gap between adjacent arms, centred on the bisector where
 * no arm's load path runs, then scaled down until it clears everything. A
 * candidate that will not grow past a useful size is dropped rather than cut,
 * because a token hole costs a stress raiser and saves nothing.
 */
export function lighteningCutouts(opts: {
  outline: Pt[];
  holes: Hole[];
  slots: Pt[][];
  /** Bearings of the arms, radians — cut-outs go between them. */
  bearings: number[];
  boltMm: number;
}): Pt[][] {
  const { outline, holes, slots, bearings, boltMm } = opts;
  const ligament = lighteningLigament(boltMm);
  const sorted = [...bearings].sort((a, b) => a - b);
  const reach = Math.max(...outline.map((p) => Math.hypot(p[0], p[1])));
  /*
    Below this a cut-out is not worth the stress raiser it introduces. Judged
    by size alone rather than by plate thickness, for the same reason the
    ligament is: a thick plate has no more reason to carry a big hole than a
    thin one does.
  */
  const minSide = 8;

  const cut: Pt[][] = [];
  for (let i = 0; i < sorted.length; i++) {
    const next = i === sorted.length - 1 ? sorted[0] + TAU : sorted[i + 1];
    const mid = (sorted[i] + next) / 2;
    const cos = Math.cos(mid);
    const sin = Math.sin(mid);

    /*
      Where along the bisector, and how big.

      The widest clear space is rarely at the plate centre — it is out
      towards the rim, past the stack and inboard of the arm bolts — so a few
      positions are tried. Size is found by bisection rather than by stepping
      down, which is valid because the candidate is scaled about a fixed
      centre: growing it can only reduce its clearance, never increase it.
    */
    const candidate = (r: number, side: number): Pt[] =>
      roundedRect(side, side * 0.75, Math.min(side, side * 0.75) * 0.3, 6).map(([x, y]) => {
        // Laid along the bisector rather than axis-aligned, so the cut-out
        // follows the shape of the space it is filling.
        const X = x + r;
        return [X * cos - y * sin, X * sin + y * cos] as Pt;
      });

    let best: Pt[] | null = null;
    let bestArea = 0;
    const obstacles = [...slots, ...cut];
    for (const f of [0.6, 0.45]) {
      const r = reach * f;
      if (!clearsBy(candidate(r, minSide), outline, holes, obstacles, ligament)) continue;
      let lo = minSide;
      let hi = reach;
      for (let k = 0; k < 8; k++) {
        const mid = (lo + hi) / 2;
        if (clearsBy(candidate(r, mid), outline, holes, obstacles, ligament)) lo = mid;
        else hi = mid;
      }
      const poly = candidate(r, lo);
      const a = polygonArea(poly);
      if (a > bestArea) {
        bestArea = a;
        best = poly;
      }
    }
    if (best) cut.push(best);
  }
  return cut;
}

function buildProfiles(spec: FrameSpec, motor: MotorSpec, section: SectionResult, bodyW: number, bodyL: number, g: PlateGeom, plates: PlateStock): Profile[] {
  // Plate thicknesses are resolved by the caller from the published reference
  // (and scaled for a printed material's much lower modulus), not guessed here.
  const bottomT = plates.bottomMm;
  const topT = plates.topMm;

  // One arm part per distinct motor radius. All share the solved section,
  // which was sized against the longest of them.
  const arms = g.armGroups.map((group) =>
    armProfile({
      cantileverMm: group.cantileverMm,
      overlapMm: g.armOverlapMm,
      rootWidthMm: section.widthMm,
      padWidthMm: section.padWidthMm,
      motorPattern: motor.pattern,
      motorBolt: motor.bolt,
      rootBolt: g.rootBolt,
      thicknessMm: section.heightMm,
      wallMm: section.hollow ? section.wallMm : 0,
      id: group.id,
      name: group.name,
      qty: group.qty,
    }),
  );

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
  const bottomBearings = g.motors.map((m) => Math.atan2(m[1], m[0]));
  const bottomSlots = spec.lightenPlates
    ? [
        ...slots,
        ...lighteningCutouts({
          outline: bottomOutline,
          holes: bottomHoles,
          slots,
          bearings: bottomBearings,
          boltMm: g.rootBolt,
        }),
      ]
    : slots;
  const bottom: Profile = {
    id: "bottom-plate",
    name: "Bottom plate",
    qty: 1,
    outline: bottomOutline,
    holes: bottomHoles,
    slots: bottomSlots,
    lightenedFrom: slots.length,
    thicknessMm: bottomT,
    areaMm2: polygonArea(bottomOutline) - bottomHoles.reduce((s, h) => s + Math.PI * h.r * h.r, 0) - bottomSlots.reduce((s, p) => s + polygonArea(p), 0),
  };

  /*
    The top plate is the other half of the clamp, so it has to reach every arm
    root bolt with edge distance to spare — it cannot just be a smaller
    rectangle. Size it from the bolts it must cover, then trim to the bottom
    plate so it never overhangs.

    It does not carry the stack. The stack bolts to the bottom plate, and
    since it stands far taller than the gap between the plates, the top plate
    is opened up to let it through — the same thing a Mark4's middle plate
    does. Putting the stack's bolt pattern in both plates, as this once did,
    described a stack squashed into a 5 mm gap.
  */
  const rootHoles = armRootHoles(g);
  const topHoles: Hole[] = [...rootHoles];
  const seedW = 2 * (Math.max(...rootHoles.map((h) => Math.abs(h.c[0]))) + EDGE_DISTANCE_FACTOR * g.rootBolt);
  const seedL = 2 * (Math.max(...rootHoles.map((h) => Math.abs(h.c[1]))) + EDGE_DISTANCE_FACTOR * g.rootBolt);
  const fittedTop = fitRoundedPlate(seedW, seedL, 6, topHoles);
  const topW = fittedTop.w;
  const topL = fittedTop.l;
  const topOutline = roundedRect(topW, topL, 6);
  const topSlots = stackOpening(spec, topW, topL, topHoles);
  const top: Profile = {
    id: "top-plate",
    name: "Top plate",
    qty: 1,
    outline: topOutline,
    holes: topHoles,
    slots: topSlots,
    lightenedFrom: topSlots.length,
    thicknessMm: topT,
    areaMm2:
      polygonArea(topOutline)
      - topHoles.reduce((s, h) => s + Math.PI * h.r * h.r, 0)
      - topSlots.reduce((s, p) => s + polygonArea(p), 0),
  };

  if (spec.construction === "bolted") return [bottom, top, ...arms];

  /*
    Unibody: the chassis is the plate and the arms as one piece.

    The arms are placed exactly as they would be bolted on, then unioned with
    the plate, so the cantilever the solver sized is the cantilever that gets
    cut. What changes is the hardware: there are no arm clamp bolts, so the
    top plate needs standoffs of its own, and the whole piece is cut from the
    arm stock because the arms are what set the thickness.
  */
  const shift = g.rootRadius - g.armOverlapMm;
  const placedArms: Pt[][] = [];
  for (const [i, group] of g.armGroups.entries()) {
    for (const bearing of group.bearings) {
      const cos = Math.cos(bearing);
      const sin = Math.sin(bearing);
      placedArms.push(
        arms[i].outline.map(([x, y]) => {
          const X = x + shift;
          return [X * cos - y * sin, X * sin + y * cos] as Pt;
        }),
      );
    }
  }

  const chassisOutline = unibodyOutline(bottomOutline, placedArms);
  const standoffs = standoffHoles(g.motors, fittedBottom.w, fittedBottom.l, g.rootBolt);
  const motorHoles: Hole[] = g.motors.flatMap((m) =>
    patternHoles(m, motor.pattern, motor.bolt, PAD_EDGE_FACTOR),
  );
  const chassisHoles: Hole[] = [
    ...patternHoles([0, 0], spec.stackPattern, spec.stackBolt),
    ...standoffs,
    ...motorHoles,
  ];
  /*
    A unibody chassis carries the arms, so its sectors are the only safe
    place to take material from — and the ligament is measured against the
    arm roots, which on this part are structure rather than bolt holes.
  */
  const chassisSlots = spec.lightenPlates
    ? [
        ...slots,
        ...lighteningCutouts({
          outline: bottomOutline,
          holes: chassisHoles,
          slots,
          bearings: g.motors.map((m) => Math.atan2(m[1], m[0])),
          boltMm: g.rootBolt,
        }),
      ]
    : slots;
  const chassis: Profile = {
    id: "chassis",
    name: "Chassis",
    qty: 1,
    outline: chassisOutline,
    holes: chassisHoles,
    slots: chassisSlots,
    lightenedFrom: slots.length,
    thicknessMm: section.heightMm,
    areaMm2:
      polygonArea(chassisOutline)
      - chassisHoles.reduce((sum, h) => sum + Math.PI * h.r * h.r, 0)
      - chassisSlots.reduce((sum, pts) => sum + polygonArea(pts), 0),
  };

  /*
    The unibody's top plate is the one case where the stack can genuinely sit
    underneath: its standoffs are sized to clear the stack (see the BOM), not
    to match an arm, so the plate stands well clear of it. It keeps its own
    opening anyway — wiring has to leave the stack somewhere, and a closed
    deck over a stack is a deck you have to remove to reach anything.
  */
  const uniTopHoles: Hole[] = [...standoffs];
  const uniFit = fitRoundedPlate(
    2 * (Math.max(...standoffs.map((h) => Math.abs(h.c[0]))) + EDGE_DISTANCE_FACTOR * g.rootBolt),
    2 * (Math.max(...standoffs.map((h) => Math.abs(h.c[1]))) + EDGE_DISTANCE_FACTOR * g.rootBolt),
    6,
    uniTopHoles,
  );
  const uniTopOutline = roundedRect(uniFit.w, uniFit.l, 6);
  const uniTopSlots = stackOpening(spec, uniFit.w, uniFit.l, uniTopHoles);
  const uniTop: Profile = {
    id: "top-plate",
    name: "Top plate",
    qty: 1,
    outline: uniTopOutline,
    holes: uniTopHoles,
    slots: uniTopSlots,
    lightenedFrom: uniTopSlots.length,
    thicknessMm: topT,
    areaMm2:
      polygonArea(uniTopOutline)
      - uniTopHoles.reduce((sum, h) => sum + Math.PI * h.r * h.r, 0)
      - uniTopSlots.reduce((sum, p) => sum + polygonArea(p), 0),
  };

  return [chassis, uniTop];
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
function frameMass(profiles: Profile[], material: Material, section: SectionResult): number {
  let total = 0;
  for (const p of profiles) {
    if (p.cantileverMm !== undefined) {
      const spanMm = Math.max(0, p.cantileverMm - section.padWidthMm / 2);
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
