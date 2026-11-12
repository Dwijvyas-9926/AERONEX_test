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
  CAMERA_SIDE_CLEARANCE_MM,
  cameraById,
  EDGE_DISTANCE_FACTOR,
  materialById,
  motorById,
  snapToStock,
  STACK_CLEARANCE_MM,
  STACK_PATTERNS,
  stackHeightFor,
  standoffAtLeast,
  styleById,
  thicknessReferenceFor,
  WHEELBASE_REFERENCE,
  type FlyingStyle,
  type Material,
  type CameraSpec,
  type MotorSpec,
} from "./catalog";
import { unibodyOutline } from "./unibody";
import { massOf, minRootWidth, motorPadWidth, PAD_EDGE_FACTOR, round, sizeArm, type SectionResult } from "./structure";

export type Layout = "true-x" | "stretched-x" | "h" | "deadcat";

export type Construction = "bolted" | "unibody";

export type BatteryMount = "top" | "bottom";

export const BATTERY_MOUNTS: { id: BatteryMount; name: string; blurb: string }[] = [
  { id: "bottom", name: "Underneath", blurb: "Lower frame, pack shielded from the props. Racers' choice." },
  { id: "top", name: "On top", blurb: "Mass near the thrust plane, so it rotates faster. Freestyle's choice." },
];

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
  /**
   * Which side of the frame the battery straps to.
   *
   * Not a cosmetic choice. On top the pack sits close to the plane the
   * propellers thrust in, so the aircraft rotates with less inertia and lands
   * on a wide flat base; it costs vertical area and drag, and a loose strap
   * puts the pack where a propeller can reach it. Underneath keeps the frame
   * low and shields the pack, at the price of swinging the mass further below
   * the thrust plane.
   */
  batteryMount: BatteryMount;
  /** FPV camera the frame carries, if any — sets the side-plate spacing. */
  cameraId: string;
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
  /**
   * Where the mass sits, relative to where the thrust acts.
   *
   * A mass-point sum, not an inertia tensor: each major item is placed at its
   * own centroid and the heights are added up. That is enough to answer the
   * question the battery-mount choice actually turns on — how far below the
   * propeller disc the weight hangs — and not enough to predict handling, so
   * it is reported as a height rather than dressed up as a simulation.
   *
   * Heights are measured from the top face of the bottom plate, positive up.
   */
  cg: {
    /** Height of the centre of gravity, mm. */
    zMm: number;
    /** Height of the propeller discs, where thrust acts, mm. */
    thrustPlaneZMm: number;
    /** How far the mass hangs below the thrust plane, mm. Larger is more pendulous. */
    belowThrustMm: number;
    /** Fore/aft offset from the thrust centroid, mm. Positive is forward. */
    offsetYMm: number;
  };
  /** Where the camera side plates stand, when a camera is fitted. */
  cameraMount: CameraMount["placement"] | null;
  /** False when a camera was asked for and no mount could be placed. */
  cameraFits: boolean;
  /**
   * Where each layer sits, mm above the underside of the arms.
   *
   * The single source for every height in the frame: the solid view, the
   * balance sum, validation and the hardware list all read this.
   */
  stackUp: {
    /** Underside of the top plate. */
    topPlateZMm: number;
    /** Standoffs under the top plate: zero when it rests on the arms. */
    topStandoffMm: number;
    /** Underside of the battery deck, or null when there is none. */
    deckZMm: number | null;
    /** Standoffs between the top plate and the deck, mm. */
    deckStandoffMm: number;
    /** Face the pack rests against: its underside on top, its top underneath. */
    packZMm: number;
    /** The part the pack is strapped to. */
    packOnPart: string;
    /** True when a top-mounted pack reaches under the propeller discs in plan. */
    packOverDiscs: boolean;
  };
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


/** How the plates above the arms are held, and how high. */
interface Cage {
  /** True when a bolted frame carries a battery deck above the clamp plate. */
  hasDeck: boolean;
  /** Standoffs between the clamp plate and that deck, mm. */
  deckStandoffMm: number;
  /** Standoffs under a unibody's top plate, mm. Zero on a bolted frame. */
  topStandoffMm: number;
}

/** Shortest cage worth building, mm: room for wiring to leave the stack. */
const MIN_CAGE_MM = 10;

/**
 * Air between the propellers' plane and the underside of a pack that
 * overlaps them in plan, mm. Blades cone upwards under load, most at the
 * tips — which is exactly the part of the disc a pack's corners reach.
 */
const PROP_CLEARANCE_MM = 6;

/** Does the pack's footprint reach under (or over) any propeller disc? */
export function packOverlapsDiscs(battery: FrameSpec["battery"], motors: Pt[], propDiaMm: number): boolean {
  const hw = battery.w / 2;
  const hl = battery.l / 2;
  const reach = propDiaMm / 2 + 3;
  return motors.some(([mx, my]) => {
    const dx = Math.max(Math.abs(mx) - hw, 0);
    const dy = Math.max(Math.abs(my) - hl, 0);
    return Math.hypot(dx, dy) < reach;
  });
}

/** A finite number inside [lo, hi], or the fallback when it is not a number at all. */
function bounded(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? clamp(v, lo, hi) : fallback;
}

/**
 * Make a spec safe to solve.
 *
 * The form limits what can be typed, but the form is not the only way a spec
 * arrives: a record saved by an older build, a hand-edited one, or a field
 * cleared mid-keystroke all reach the solver too. A sweep of hostile values
 * found that a single NaN — in the thrust, the clearance, a battery
 * dimension — did not fail: it produced an empty outline, holes "outside" a
 * plate with no area and a 433-page print job, each reported as though it
 * were a property of the design. Every number is therefore brought inside a
 * range the solver was written for before anything is computed from it, and
 * anything that is not a number falls back to a value that builds.
 *
 * The limits are wide. They are there to stop nonsense, not to second-guess
 * an unusual build — validation is what comments on those.
 */
export function sanitizeSpec(raw: FrameSpec): FrameSpec {
  const layout = LAYOUTS.some((l) => l.id === raw.layout) ? raw.layout : "true-x";
  const propIn = bounded(raw.propIn, 2, 10, 5);
  const stack = STACK_PATTERNS.reduce((best, p) =>
    Math.abs(p.pattern - raw.stackPattern) < Math.abs(best.pattern - raw.stackPattern) ? p : best,
  STACK_PATTERNS.find((p) => p.pattern === 30.5) ?? STACK_PATTERNS[0]);
  const stackPattern = Number.isFinite(raw.stackPattern) ? stack.pattern : 30.5;
  const stackBolt = raw.stackBolt === 2 || raw.stackBolt === 3 ? raw.stackBolt : stackPattern <= 20 ? 2 : 3;
  const motor = motorById(raw.motorId);
  const b = raw.battery ?? ({} as FrameSpec["battery"]);
  const optional = (v: number | null, lo: number, hi: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? clamp(v, lo, hi) : null;
  return {
    ...raw,
    layout,
    propIn,
    clearanceMm: bounded(raw.clearanceMm, 0, 80, 10),
    wheelbaseMm: optional(raw.wheelbaseMm, 40, 900),
    motorThrustG: bounded(raw.motorThrustG, 1, 20000, motor.thrustG),
    stackPattern,
    stackBolt,
    stackHeightMm: bounded(raw.stackHeightMm, 4, 60, stackHeightFor(stackPattern)),
    battery: {
      l: bounded(b.l, 20, 300, 105),
      w: bounded(b.w, 10, 150, 35),
      h: bounded(b.h, 5, 120, 30),
      massG: bounded(b.massG, 0, 5000, 180),
    },
    electronicsMassG: bounded(raw.electronicsMassG, 0, 5000, 120),
    construction: raw.construction === "unibody" ? "unibody" : "bolted",
    fixedDimMm: optional(raw.fixedDimMm, 1, 40),
    plateThicknessMm: optional(raw.plateThicknessMm, 1, 12),
    wallMm: bounded(raw.wallMm, 0.8, 10, 2.5),
    lightenPlates: raw.lightenPlates !== false,
    batteryMount: raw.batteryMount === "top" ? "top" : "bottom",
    safetyFactor: bounded(raw.safetyFactor, 1, 10, 2),
  };
}

export function designFrame(inputSpec: FrameSpec): FrameDesign {
  const rawSpec = sanitizeSpec(inputSpec);
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
  const camera = cameraById(spec.cameraId);
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
  /*
    A camera lengthens the frame, which is not a side effect — it is why
    frames built around a camera are longer than racing frames of the same
    wheelbase. The mount itself stands on the clamp plate, so that is the
    plate whose length `cameraDeckHalfL` budgets; the bottom plate has to be
    at least as long again, because the clamp plate must not overhang it.
  */
  const cameraHalfL = camera.widthMm > 0 ? cameraDeckHalfL(spec, camera) + 2 : 0;
  const bodyLmm = round(2 * Math.max(rootHalfL + edgeMargin, stackSpan / 2 + 12, spec.battery.l * 0.325, wheelbaseMm * 0.17, cameraHalfL, 28));

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
  // A battery deck adds four standoffs and four more screws.
  // M2 hardware weighs well under half what M3 does, which matters most on
  // exactly the frames it is used on: 25 g of bolts was a seventh of a 2"
  // build's whole weight.
  const hardwareScale = ROOT_BOLT <= 2 ? 0.4 : 1;
  const hardwareG = round(hardwareScale * ((spec.construction === "unibody" ? 15 : 25)
    + (spec.batteryMount === "top" && spec.construction === "bolted" ? 8 : 0)), 1);
  // The camera is carried mass like any other, so it belongs in the figure
  // the arms are sized against, not bolted on after the solve.
  const fixedMass = motor.massG * 4 + spec.battery.massG + spec.electronicsMassG + hardwareG + camera.massG;
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
  /*
    The camera mount is settled once, before the mass loop. Nothing it
    depends on — the spec, the plate thickness, the clamp plate's size and
    bolt pattern — changes while the arm section converges, and its placement
    search is the most expensive thing in the build.

    It is fitted to the clamp plate, not the bottom plate. The side plates
    stand 35 mm tall for a micro camera, which is five times the gap between
    the plates, so standing them on the bottom plate ran them straight up
    through the clamp plate — visible in the solid view as the mount passing
    through the deck and brushing an arm root. Real frames bolt the camera
    cage to the middle plate and let the camera sit above it, which is what
    this does: nothing the frame carries is above that plate, so the mount
    cannot foul anything.
  */
  const deck = topPlateGeom(spec, plateGeom, camera, bodyLmm, bodyWmm);

  /*
    How the layers stack, settled once.

    A top-mounted pack cannot simply be strapped to the plate above the arms.
    On a bolted frame that plate is the arm clamp: the stack stands through
    the opening in it, so there is nothing flat to strap to, and it sits
    level with the propellers — which is why every top-mounted pack was once
    reported as standing in the discs, on every frame. What a real frame has
    is a deck on standoffs above the stack, and the pack goes on that. So a
    bolted frame with the pack on top gains that deck, held on standoffs that
    ride on four of the arm clamp bolts, and its height is whichever is the
    tallest of three needs: clearing the stack, clearing the camera, and
    lifting the pack out of the propellers' plane where the two overlap in
    plan. A unibody already has such a deck — its top plate — so only the
    standoff height is at stake there.

    The arm's thickness is taken from the first solve. It can step up a stock
    size as the mass converges, which leaves the cage a millimetre or two
    more generous than it needs to be and never less.
  */
  const motorHMm = 8 + motor.massG * 0.25;
  const topMounted = spec.batteryMount === "top";
  const packOverDiscs = topMounted && packOverlapsDiscs(spec.battery, motors, propDiaMm);
  const propNeed = packOverDiscs ? motorHMm + PROP_CLEARANCE_MM - 2 * plates.topMm : 0;
  const hasDeck = topMounted && spec.construction === "bolted";
  const cameraNeed = cameraPlateHeightMm(camera);
  const deckStandoffMm = hasDeck
    ? standoffAtLeast(Math.max(
        MIN_CAGE_MM,
        spec.stackHeightMm + STACK_CLEARANCE_MM - solved.section.heightMm - plates.topMm,
        propNeed,
        cameraNeed,
      ))
    : 0;
  const topStandoffMm = spec.construction === "unibody"
    ? standoffAtLeast(Math.max(spec.stackHeightMm + STACK_CLEARANCE_MM, propNeed + plates.topMm))
    : 0;
  const cage: Cage = { hasDeck, deckStandoffMm, topStandoffMm };

  const fittedMount = cameraMount(
    camera,
    plates.topMm,
    deck.l,
    deck.holes,
    stackOpening(spec, deck.w, deck.l, deck.holes),
    deck.outline,
    hasDeck ? { bodyHeightMm: deckStandoffMm, topTabMm: plates.topMm + 1.5 } : {},
  );
  /*
    A mount that could not be placed is left off rather than cut where it
    does not fit; validation reports it. The camera's mass stays in the
    weight the arms are sized for, since the user still means to carry one.
  */
  const cameraFits = !fittedMount || fittedMount.fitted;
  const mount = cameraFits ? fittedMount : null;
  let profiles = buildProfiles(spec, motor, solved.section, bodyWmm, bodyLmm, plateGeom, plates, mount, deck, cage);
  let frameG = frameMass(profiles, material, solved.section);
  for (let i = 0; i < 5; i++) {
    auwG = fixedMass + frameG;
    solved = solveSection(auwG);
    suggested = autoArm ? solved : solveSection(auwG, true);
    profiles = buildProfiles(spec, motor, solved.section, bodyWmm, bodyLmm, plateGeom, plates, mount, deck, cage);
    const next = frameMass(profiles, material, solved.section);
    if (Math.abs(next - frameG) < 0.5) { frameG = next; break; }
    frameG = next;
  }
  auwG = fixedMass + frameG;
  const section = solved.section;

  /*
    Heights, measured up from the underside of the arms — the top face of a
    bolted frame's bottom plate, or the underside of a unibody chassis. One
    table, read by the solid view, the centre-of-gravity sum, validation and
    the hardware list, so that none of them can hold its own opinion of where
    a plate is. They used to: the hardware list stood a unibody's top plate
    on stack-clearing standoffs while the solid view drew it a few
    millimetres above the chassis and the balance sum put the pack lower
    still.
  */
  const topPlateZMm = section.heightMm + topStandoffMm;
  const deckZMm = hasDeck ? topPlateZMm + plates.topMm + deckStandoffMm : null;
  const stackUp: FrameDesign["stackUp"] = {
    topPlateZMm: round(topPlateZMm, 2),
    topStandoffMm,
    deckZMm: deckZMm === null ? null : round(deckZMm, 2),
    deckStandoffMm,
    packZMm: round(
      topMounted
        ? (deckZMm ?? topPlateZMm) + plates.topMm
        : spec.construction === "unibody" ? 0 : -plates.bottomMm,
      2,
    ),
    packOnPart: topMounted ? (hasDeck ? "deck-plate" : "top-plate") : spec.construction === "unibody" ? "chassis" : "bottom-plate",
    packOverDiscs: topMounted && packOverDiscs,
  };

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
    cameraMount: mount?.placement ?? null,
    cameraFits,
    stackUp,
    cg: (() => {
      /*
        Heights from the top face of the bottom plate, positive up.

        Motor height is taken from its mass rather than carried as another
        catalogue column: stator mass and stator height track each other
        closely enough across this range, and a column of numbers nobody can
        check is worse than one honest approximation.
      */
      const armT = section.heightMm;
      const propZ = armT + motorHMm;
      // The pack sits where the stack-up puts it, not on the plate above the
      // arms — which is the clamp plate, with the stack standing through it.
      const batteryZ = topMounted
        ? stackUp.packZMm + spec.battery.h / 2
        : stackUp.packZMm - spec.battery.h / 2;

      const items: { m: number; z: number; y: number }[] = [
        // The plate sandwich, taken at its own mid-height.
        { m: frameG, z: armT / 2, y: 0 },
        { m: motor.massG * motors.length, z: armT + motorHMm / 2, y: 0 },
        { m: spec.battery.massG, z: batteryZ, y: 0 },
        // Stack and wiring, sitting on the bottom plate.
        { m: spec.electronicsMassG, z: spec.stackHeightMm / 2, y: 0 },
        ...(camera.massG > 0
          ? [{ m: camera.massG, z: stackUp.topPlateZMm + plates.topMm + camera.widthMm / 2 + 12, y: mount?.placement.centreYMm ?? bodyLmm / 2 }]
          : []),
      ];
      const total = items.reduce((s, i) => s + i.m, 0) || 1;
      const zMm = items.reduce((s, i) => s + i.m * i.z, 0) / total;
      const offsetYMm = items.reduce((s, i) => s + i.m * i.y, 0) / total;

      return {
        zMm: round(zMm, 1),
        thrustPlaneZMm: round(propZ, 1),
        belowThrustMm: round(propZ - zMm, 1),
        offsetYMm: round(offsetYMm, 1),
      };
    })(),
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
      const gapMm = round(spec.construction === "unibody" ? topStandoffMm : section.heightMm, 2);
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
/** Every hole the bottom plate carries: the stack's four, and the arm bolts. */
export function bottomPlateHoles(spec: FrameSpec, g: PlateGeom): Hole[] {
  return [...patternHoles([0, 0], spec.stackPattern, spec.stackBolt), ...armRootHoles(g)];
}

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

/** The clamp plate's size, outline and bolts. */
export interface DeckGeom {
  w: number;
  l: number;
  holes: Hole[];
  outline: Pt[];
}

/**
 * Size the clamp plate.
 *
 * Hoisted out of the part builder because the camera mount has to be fitted
 * against this plate — it is what the side plates stand on — and the mount is
 * settled once, before the arm section converges. Derived in two places they
 * drift, and the symptom is a mount whose feet were fitted to one plate and
 * cut into another.
 *
 * The plate is the other half of the arm clamp, so it has to reach every arm
 * root bolt with edge distance to spare, and long enough to carry the camera
 * mount if there is one. `maxL` holds it inside the bottom plate so it never
 * overhangs.
 */
export function topPlateGeom(spec: FrameSpec, g: PlateGeom, camera: CameraSpec, maxL: number, bodyW = maxL): DeckGeom {
  if (spec.construction === "unibody") {
    /*
      A unibody's top plate stands on four standoffs of its own, in the gaps
      between the arms, and is sized from those. It carries the camera and a
      top-mounted pack exactly as the clamp plate does on a bolted frame, so
      it has to be settled here for the same reason — the mount was once
      fitted to the bolted frame's clamp plate and its slots then never cut
      in the plate a unibody actually has.
    */
    const fitted = fitRoundedPlate(bodyW, maxL, 6, bottomPlateHoles(spec, g));
    const standoffs = standoffHoles(g.motors, fitted.w, fitted.l, g.rootBolt);
    const reachOf = (axis: 0 | 1) => Math.max(...standoffs.map((h) => Math.abs(h.c[axis])));
    const fit = fitRoundedPlate(
      2 * (reachOf(0) + EDGE_DISTANCE_FACTOR * g.rootBolt),
      2 * (reachOf(1) + EDGE_DISTANCE_FACTOR * g.rootBolt),
      6,
      standoffs,
    );
    return { w: fit.w, l: fit.l, holes: standoffs, outline: roundedRect(fit.w, fit.l, 6) };
  }
  const holes = armRootHoles(g);
  const reach = (axis: 0 | 1) => Math.max(...holes.map((h) => Math.abs(h.c[axis])));
  const seedW = 2 * (reach(0) + EDGE_DISTANCE_FACTOR * g.rootBolt);
  const seedL = Math.min(
    maxL,
    Math.max(2 * (reach(1) + EDGE_DISTANCE_FACTOR * g.rootBolt), 2 * cameraDeckHalfL(spec, camera)),
  );
  const fitted = fitRoundedPlate(seedW, seedL, 6, holes);
  const l = Math.min(fitted.l, maxL);
  return { w: fitted.w, l, holes, outline: roundedRect(fitted.w, l, 6) };
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

/** Clear material any slot must leave to a bolt or an edge, mm. */
const MIN_SLOT_CLEARANCE = 1.6;

/**
 * Clearance each side where the camera plates pass through the clamp plate.
 *
 * A fixed amount rather than a scale factor: the frame's length has to be
 * budgeted for this notch, and a budget cannot be written against a
 * proportion of something that is itself still being sized.
 */
const CAMERA_CLEARANCE_MM = 0.8;

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

  /*
    Reject by bounding box first.

    Most obstacles are nowhere near most candidates, and the exact test walks
    every point of one against every edge of the other. The search below runs
    this thousands of times per design, and without the cheap rejection a
    single keystroke in the spec panel took the best part of a tenth of a
    second to re-solve.
  */
  let loX = Infinity;
  let loY = Infinity;
  let hiX = -Infinity;
  let hiY = -Infinity;
  for (const [x, y] of poly) {
    loX = Math.min(loX, x);
    loY = Math.min(loY, y);
    hiX = Math.max(hiX, x);
    hiY = Math.max(hiY, y);
  }
  const far = (bx0: number, by0: number, bx1: number, by1: number) =>
    bx0 - hiX > need || loX - bx1 > need || by0 - hiY > need || loY - by1 > need;

  for (const h of holes) {
    if (far(h.c[0] - h.r, h.c[1] - h.r, h.c[0] + h.r, h.c[1] + h.r)) continue;
    // A hole swallowed by the cut-out is not a clearance, it is a collision.
    if (pointInPolygon(h.c, poly)) return false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (distanceToSegment(h.c, poly[j], poly[i]) - h.r < need) return false;
    }
  }
  for (const s of slots) {
    let sx0 = Infinity;
    let sy0 = Infinity;
    let sx1 = -Infinity;
    let sy1 = -Infinity;
    for (const [x, y] of s) {
      sx0 = Math.min(sx0, x);
      sy0 = Math.min(sy0, y);
      sx1 = Math.max(sx1, x);
      sy1 = Math.max(sy1, y);
    }
    if (far(sx0, sy0, sx1, sy1)) continue;
    /*
      Both directions. Measuring only the candidate's corners against the
      obstacle's edges misses the case where the obstacle has a corner near
      the middle of one of the candidate's edges — which is exactly what the
      validator then reported, at 1.4 mm where this had decided it had 3.
    */
    for (const p of poly) {
      if (pointInPolygon(p, s)) return false;
      for (let i = 0, j = s.length - 1; i < s.length; j = i++) {
        if (distanceToSegment(p, s[j], s[i]) < need) return false;
      }
    }
    for (const p of s) {
      if (pointInPolygon(p, poly)) return false;
      for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        if (distanceToSegment(p, poly[j], poly[i]) < need) return false;
      }
    }
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

/* ------------------------------------------------------------ camera mount */

/**
 * The pair of side plates a camera pivots between, and the slots in the
 * bottom plate they stand in.
 *
 * Two vertical plates with the camera bolted between them is how this is
 * done — published guidance names "a pair of vertical mounting plates or a
 * 3D printed mount" — and it is the only version that falls out of flat
 * stock, which is what this studio cuts. They locate in the bottom plate by
 * tab and slot, the standard joint for a laser-cut assembly: the tabs are
 * part of the side plate's outline and the matching slots are cut in the
 * plate it stands on.
 *
 * Each side plate carries a fixed pivot hole and an arc of holes below it.
 * Moving the lower screw from one hole to the next tilts the camera, which
 * is how a real mount is adjusted and is far easier to cut accurately than a
 * curved slot.
 */
/*
  Tilt positions, degrees.

  Spaced wide enough that the holes do not run into each other. The first
  attempt put five positions on a 15°-ish pitch around an 11 mm radius, which
  puts their centres 2-3 mm apart for a 2 mm screw — the validator reported
  them as overlapping, which they were. Three usable angles on a generous
  radius beats five that cannot be drilled.
*/
const CAMERA_TILTS = [0, 20, 40];

/** Smallest arc radius that keeps those positions apart for a given screw. */
function tiltArcRadius(camera: CameraSpec): number {
  const stepRad = deg2rad(CAMERA_TILTS[1] - CAMERA_TILTS[0]);
  // Centre spacing must clear one diameter plus a wall of material.
  const needed = (camera.bolt + 1.8) / stepRad;
  return Math.max(camera.widthMm * 0.6, needed);
}

export interface CameraMount {
  /** The side plate, cut twice. */
  plate: Profile;
  /**
   * Where the two side plates stand, so the 3D view can place them from the
   * same numbers the plate below is cut with rather than deriving its own.
   */
  placement: {
    /** Distance between the two plates' mid-planes, mm. */
    spacingMm: number;
    /** Fore-aft centre of the plates, mm from the frame centre. */
    centreYMm: number;
    /**
     * Full height of the side plate's body, mm — the tabs hang below it.
     * Placing the body's midpoint at half this above the plate puts the tab
     * bottoms exactly at the plate's top face, which is where the slots are.
     */
    heightMm: number;
  };
  /** Slots to cut in the plate the side plates stand on. */
  footSlots: Pt[][];
  /**
   * Slots for the tabs on the plates' top edge, when a deck sits on them.
   * Empty when nothing is above the mount.
   */
  topSlots: Pt[][];
  /**
   * False when no position on the deck cleared its bolts and openings.
   *
   * The geometry returned in that case is the best-effort placement and must
   * not be cut: the caller drops the mount and validation says why, instead
   * of a slot being quietly drawn through a bolt hole — which is what an
   * unchecked fallback did on the smallest frames.
   */
  fitted: boolean;
  /**
   * How far back from the frame's centreline the mount reaches, mm.
   *
   * The camera lives at the very front and the battery sits behind it, so
   * everything else at the front of the plate — the strap slots above all —
   * has to start inboard of this. Placing them independently put a strap
   * slot straight through the camera's tab slots.
   */
  rearYMm: number;
}

/**
 * Fore-aft dimensions of the mount, in one place.
 *
 * Shared by the part and by the frame-length calculation that has to make
 * room for it. Derived twice, they drift, and the symptom is a mount that
 * the plate was grown for but which still lands on the stack bolts.
 */
/**
 * How much wider than the tab a foot slot is cut, mm.
 *
 * A sliding fit, not a press fit: the plates are cut to a tolerance and a
 * tab that needs persuading into its slot is a tab that cracks a laminate.
 */
const SLOT_OVERSIZE = 0.3;

function cameraDims(camera: CameraSpec, spread = TAB_SPREAD[0]) {
  const w = camera.widthMm + 10;
  /*
    Shorten the feet as they are drawn closer together, so the plate's own
    two slots keep a wall between them. Narrowing the spread alone brought
    them to 1.4 mm apart on a 3" — the generator was happy and the validator
    was not, which is the validator being right.

    The wall is sized a little over the minimum rather than exactly on it.
    Solved to land on 1.6 mm it came out at 1.5999999999999996, and the fit
    check — which asks for 1.6 — then rejected its own arithmetic, walked
    every remaining position and gave up, leaving the placement to an
    unchecked fallback. A tenth of a millimetre of headroom costs nothing and
    keeps the two sides of that comparison on speaking terms.
  */
  const room = 2 * w * spread - MIN_SLOT_CLEARANCE - SLOT_OVERSIZE - 0.1;
  const tabW = Math.min(Math.max(6, w * 0.3), room);
  // Half the distance from the outer edge of the forward tab slot to the
  // outer edge of the rear one.
  const tabReach = w * spread + tabW / 2 + SLOT_OVERSIZE / 2;
  return { w, tabW, tabReach, tabX: [-w * spread, w * spread], usable: tabW >= 5 };
}

/*
  How far apart the two feet sit, as a fraction of the plate's length.

  A quarter of the length is the stable choice and the one to prefer. The
  narrower options exist for small frames: on a 3" the arm root bolts sit on
  the diagonal right where the rear foot wants to go, and no fore-aft shift
  helps because moving aft walks further onto them while forward runs off the
  plate. Drawing the feet closer together is what fits, at some cost in how
  firmly the mount is held.
*/
const TAB_SPREAD = [0.25, 0.18, 0.12];

/** Fore-aft length of plate the mount's tab slots occupy, mm. */
export function cameraFootprintL(camera: CameraSpec, spread = TAB_SPREAD[0]): number {
  // The widest spread by default, so a frame's length budget is conservative.
  return camera.widthMm > 0 ? 2 * cameraDims(camera, spread).tabReach : 0;
}

/**
 * Height of a camera side plate's body, mm.
 *
 * Room for the camera, the pivot above its centre and the tilt arc below —
 * taken up to the next stocked standoff length, because when a deck goes
 * over the cage the standoffs beside these plates have to be the same height
 * and nobody stocks a 37 mm standoff.
 */
export function cameraPlateHeightMm(camera: CameraSpec): number {
  return camera.widthMm > 0 ? standoffAtLeast(camera.widthMm + 16) : 0;
}

/** Plate left between a camera foot slot and the stack opening, mm. */
const CAMERA_DECK_LIGAMENT = 3;
/** Plate left between a camera foot slot and the deck's own edge, mm. */
const CAMERA_DECK_EDGE = 2;

/**
 * Half-length of clamp plate a camera mount needs, mm.
 *
 * The mount stands on the clamp plate, so it is that plate — not the bottom
 * plate — whose length has to be budgeted for it. The feet have to sit
 * entirely forward of the stack opening and still leave a rim of plate ahead
 * of them, and on a plate sized only from the arm root bolts there is no such
 * band at all: an 78.6 mm clamp plate with a 30.5 mm stack has 18 mm of
 * usable length between the opening and the nose, where a micro mount's feet
 * want 19. So the plate grows to carry the mount, which is exactly why frames
 * built around a camera carry a longer middle plate than racing frames of the
 * same wheelbase.
 *
 * Budgeted at the middle foot spread rather than the widest: the widest is
 * preferred and tried first, but growing every camera frame's clamp plate to
 * guarantee it costs more plate than the extra rigidity is worth, and the
 * placement search narrows the spread when it has to.
 */
export function cameraDeckHalfL(spec: FrameSpec, camera: CameraSpec): number {
  if (camera.widthMm <= 0) return 0;
  return stackOpeningSize(spec) / 2
    + CAMERA_DECK_LIGAMENT
    + cameraFootprintL(camera, TAB_SPREAD[1])
    + CAMERA_DECK_EDGE;
}

/**
 * The side plates, and the slots in the deck they stand in.
 *
 * `deck` is the plate the mount bolts to — the clamp plate, whose outline,
 * bolts and stack opening the feet all have to miss.
 */
export function cameraMount(
  camera: CameraSpec,
  plateThicknessMm: number,
  deckL: number,
  deckHoles: Hole[] = [],
  deckBusy: Pt[][] = [],
  deckOutline: Pt[] | null = null,
  opts: { bodyHeightMm?: number; topTabMm?: number } = {},
): CameraMount | null {
  if (camera.widthMm <= 0) return null;

  /*
    The side plate, drawn as one explicit closed loop: bottom edge with two
    tabs hanging below it, then up the right side, round the two top corners,
    and back down the left. Built point by point rather than by splicing tabs
    into a rounded rectangle, because where a rounded outline puts its
    straight bottom run depends on how it was generated, and a tab spliced
    into the wrong edge is a part that silently comes out inside out.
  */
  /*
    Tall enough for the camera, its pivot and the tilt arc — and exactly as
    tall as the cage when a deck sits on top, because then the side plates
    are also what the deck's front edge rests on. The pivot is measured up
    from the foot either way, so a taller cage leaves the camera where it was
    rather than carrying it up towards the deck.
  */
  const h = Math.max(cameraPlateHeightMm(camera), opts.bodyHeightMm ?? 0);
  const base = -h / 2;
  const top = h / 2;
  const r = 3;
  const tabH = plateThicknessMm + 1.5;
  const topTabH = opts.topTabMm ?? 0;
  const pivot: Pt = [0, base + camera.widthMm / 2 + 12];
  const gap = camera.widthMm + 2 * CAMERA_SIDE_CLEARANCE_MM;

  /*
    Choose where the feet go before drawing anything.

    Two things vary: how far apart the feet sit, and how far forward the
    whole mount does. A fixed choice of both fitted a 5" and ran the rear
    foot straight through the arm root bolts of a 3". The widest spread at
    the most forward position is tried first — that is the stable one — and
    the search only narrows or moves aft when it has to.
  */
  const slotsFor = (dims: ReturnType<typeof cameraDims>, y: number): Pt[][] => {
    const out: Pt[][] = [];
    for (const side of [-1, 1]) {
      for (const cx of dims.tabX) {
        out.push(
          roundedRect(plateThicknessMm + SLOT_OVERSIZE, dims.tabW + SLOT_OVERSIZE, 0.4).map(
            ([x, yy]) => [x + (side * (gap + plateThicknessMm)) / 2, yy + y + cx] as Pt,
          ),
        );
      }
    }
    return out;
  };

  /*
    Every foot has to clear the deck's bolts, the deck's edge, whatever is
    already cut in it — the stack opening above all — and the other three
    feet. `clearsBy` tests all four symmetrically and bails on the first
    thing too close.

    It is not what the walk below leans on, though. `clearsBy` measures
    containment first, against a thirty-odd point outline, and the thing that
    actually rejects nearly every position tried is the stack opening — which
    it only reaches last. So each candidate is boxed off against the openings
    first, which for the axis-aligned feet and the centred opening they have
    to stay forward of is the same answer for a fraction of the work.
  */
  const box = (poly: Pt[]) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const [x, y] of poly) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
    return [x0, y0, x1, y1] as const;
  };
  /** Do two boxes stand at least `need` apart? Exact for axis-aligned cuts. */
  const apart = (b: readonly number[], q: readonly number[], need: number) =>
    q[0] - b[2] >= need || b[0] - q[2] >= need || q[1] - b[3] >= need || b[1] - q[3] >= need;

  const busyBoxes = deckBusy.map(box);
  const half = deckL / 2 - MIN_SLOT_CLEARANCE;
  const roughlyClear = (slots: Pt[][]) =>
    slots.every((slot) => {
      const b = box(slot);
      if (b[1] < -half || b[3] > half) return false;
      return busyBoxes.every((q) => apart(b, q, MIN_SLOT_CLEARANCE));
    });

  const boundary = deckOutline ?? roundedRect(deckL, deckL, 6);
  const fits = (slots: Pt[][]) =>
    roughlyClear(slots)
    && slots.every((slot) => clearsBy(slot, boundary, deckHoles, deckBusy, MIN_SLOT_CLEARANCE));

  let dims = cameraDims(camera);
  let frontY = deckL / 2 - dims.tabReach - CAMERA_DECK_EDGE;
  let fitted = !(deckHoles.length > 0 || deckBusy.length > 0);
  if (deckHoles.length > 0 || deckBusy.length > 0) {
    search: for (const spread of TAB_SPREAD) {
      const d = cameraDims(camera, spread);
      if (!d.usable) continue;
      /*
        The four feet move together, so how far they stand from each other
        never changes as the mount slides fore and aft. Settle it once for
        the spread instead of re-asking it at every position along the walk —
        and reject the spread outright when its own feet are too close, which
        is the honest reading of a spread that cannot be cut.
      */
      const boxes = slotsFor(d, 0).map(box);
      if (!boxes.every((b, i) => boxes.every((q, j) => i === j || apart(b, q, MIN_SLOT_CLEARANCE)))) continue;

      const front = deckL / 2 - d.tabReach - CAMERA_DECK_EDGE;
      const floor = d.tabReach + CAMERA_CLEARANCE_MM + MIN_SLOT_CLEARANCE;
      for (let y = front; y >= floor; y -= 1) {
        if (fits(slotsFor(d, y))) {
          dims = d;
          frontY = y;
          fitted = true;
          break search;
        }
      }
    }
  }
  const { w, tabW, tabX } = dims;

  const outline: Pt[] = [[-w / 2, base]];
  for (const cx of tabX) {
    outline.push([cx - tabW / 2, base], [cx - tabW / 2, base - tabH], [cx + tabW / 2, base - tabH], [cx + tabW / 2, base]);
  }
  if (topTabH > 0) {
    // Square shoulders and a second pair of tabs, for the deck to drop onto.
    outline.push([w / 2, base], [w / 2, top]);
    for (const cx of [...tabX].reverse()) {
      outline.push([cx + tabW / 2, top], [cx + tabW / 2, top + topTabH], [cx - tabW / 2, top + topTabH], [cx - tabW / 2, top]);
    }
    outline.push([-w / 2, top]);
  } else {
    outline.push([w / 2, base], [w / 2, top - r]);
    outline.push(...arcPoints([w / 2 - r, top - r], r, 0, 90, 4));
    outline.push([-w / 2 + r, top]);
    outline.push(...arcPoints([-w / 2 + r, top - r], r, 90, 90, 4));
  }
  outline.push([-w / 2, base]);

  /*
    A fixed pivot at the top and an arc of holes below it. Moving the lower
    screw from one hole to the next tilts the camera — how a real mount is
    adjusted, and far easier to cut accurately than a curved slot.
  */
  const R = tiltArcRadius(camera);
  const holes: Hole[] = [
    { c: pivot, r: camera.bolt / 2 },
    ...CAMERA_TILTS.map((deg) => {
      const a = deg2rad(deg);
      return { c: [pivot[0] + R * Math.sin(a), pivot[1] - R * Math.cos(a)] as Pt, r: camera.bolt / 2 };
    }),
  ];

  const plate: Profile = {
    id: "camera-plate",
    name: "Camera side plate",
    qty: 2,
    outline,
    holes,
    slots: [],
    thicknessMm: plateThicknessMm,
    areaMm2: polygonArea(outline) - holes.reduce((s, x) => s + Math.PI * x.r * x.r, 0),
  };

  /*
    The slots the tabs drop into. Each side plate stands in the Y-Z plane, so
    seen from above it is a thin strip: the plate's thickness across, and the
    tab's width along the frame. Two plates, two tabs each, four slots.
  */
  const footSlots = slotsFor(dims, frontY);

  const rearYMm = Math.min(...footSlots.flat().map((p) => p[1]));
  return {
    plate,
    footSlots,
    topSlots: topTabH > 0 ? footSlots.map((slot) => slot.map((q) => [q[0], q[1]] as Pt)) : [],
    fitted,
    rearYMm,
    placement: { spacingMm: gap + plateThicknessMm, centreYMm: frontY, heightMm: h },
  };
}

const deg2rad = (d: number) => (d * Math.PI) / 180;

function buildProfiles(spec: FrameSpec, motor: MotorSpec, section: SectionResult, bodyW: number, bodyL: number, g: PlateGeom, plates: PlateStock, mount: CameraMount | null, deck: DeckGeom, cage: Cage): Profile[] {
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
  const bottomHoles: Hole[] = bottomPlateHoles(spec, g);
  const fittedBottom = fitRoundedPlate(bodyW, bodyL, 6, bottomHoles);
  const bottomOutline = roundedRect(fittedBottom.w, fittedBottom.l, 6);
  /*
    Strap slots go in whichever plate the pack straps to. A pack on top is
    strapped through the top plate; one underneath is strapped through the
    bottom. Cutting them in the bottom plate regardless, as this used to,
    described a top-mounted pack held on by a strap passing under the frame
    and round the outside of everything.
  */
  const slotW = 4;
  const slotL = Math.min(bodyW * 0.55, 26);
  const slotY = bodyL / 2 - 10;
  /*
    Front and rear placed separately, because only the front one is hemmed
    in. A camera mount occupies the nose, and clamping both slots to clear it
    pulled them together into the middle of the plate — two slots 24 mm apart
    on a frame carrying a 105 mm pack, which is a strap round the plate
    rather than round the battery. The rear slot has nothing in its way and
    belongs at the back edge where it can do its job.
  */
  const strapSlotAt = (y: number): Pt[] => roundedRect(slotL, slotW, slotW / 2).map((p) => [p[0], p[1] + y] as Pt);

  /**
   * Walk a strap slot inboard from `startY` until it clears the plate's own
   * bolts, or give up on it.
   *
   * Placed by search rather than by arithmetic because what it has to miss
   * depends on the frame: on a camera-carrying 5" the front slot gets pushed
   * back until it is level with the stack's bolts, and a fixed offset that
   * cleared them on one size sat 1.4 mm from them on another.
   */
  const fitStrapSlot = (startY: number, holes: Hole[], outline: Pt[], busy: Pt[][]): Pt[] | null => {
    for (let y = startY; y > slotW; y -= 1) {
      const poly = strapSlotAt(y);
      if (clearsBy(poly, outline, holes, busy, MIN_SLOT_CLEARANCE)) return poly;
    }
    return null;
  };

  /*
    `busy` is what is already cut in this plate. Leaving it out meant the
    strap slots were fitted against the bolts alone and walked straight into
    the camera's foot slots on a small frame.
  */
  const strapSlotPair = (frontY: number, rearY: number, holes: Hole[], outline: Pt[], busy: Pt[][] = []): Pt[][] => {
    const front = fitStrapSlot(frontY, holes, outline, busy);
    /*
      The rear slot is fitted in the front half and then mirrored aft, so it
      has to be fitted against the plate as it looks from behind. Fitting it
      against the front's bolts was right for every layout that is the same
      fore and aft and wrong for a dead cat, whose rear arms meet the plate
      somewhere else — it put the rear slot a millimetre from two clamp
      bolts.
    */
    const flip = ([x, y]: Pt): Pt => [x, -y];
    const rear = fitStrapSlot(
      rearY,
      holes.map((h) => ({ ...h, c: flip(h.c) })),
      outline.map(flip).reverse(),
      [...busy, ...(front ? [front] : [])].map((poly) => poly.map(flip)),
    );
    return [
      ...(front ? [front] : []),
      ...(rear ? [rear.map(([x, y]) => [x, -y] as Pt)] : []),
    ];
  };
  const strapsOnTop = spec.batteryMount === "top";
  /*
    The camera's feet are in the clamp plate, not here, so the bottom plate's
    strap slots have nothing at the nose to dodge any more and the front one
    goes back to the edge where it belongs.
  */
  const slots: Pt[][] = strapsOnTop ? [] : strapSlotPair(slotY, slotY, bottomHoles, bottomOutline);
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
    rectangle. It is sized by `topPlateGeom`, which the caller runs before the
    mass loop because the camera mount is fitted against it.

    It does not carry the stack. The stack bolts to the bottom plate, and
    since it stands far taller than the gap between the plates, the top plate
    is opened up to let it through — the same thing a Mark4's middle plate
    does. Putting the stack's bolt pattern in both plates, as this once did,
    described a stack squashed into a 5 mm gap.

    It does carry the camera: the side plates stand in slots cut here and the
    camera sits above, clear of everything, which is how a real frame mounts a
    camera cage.
  */
  const topHoles = deck.holes;
  const topW = deck.w;
  const topL = deck.l;
  const topOutline = deck.outline;
  const opening = stackOpening(spec, topW, topL, topHoles);
  const feet = mount ? mount.footSlots : [];
  /*
    Straps last, and only after the camera. The side plates have to stand at
    the very front; a strap slot can move inboard, and the lightening runs
    last of all so it sees both and keeps away from them.
  */
  const topStrapFrontY = mount
    ? Math.min(topL / 2 - 8, mount.rearYMm - slotW / 2 - 4)
    : topL / 2 - 8;
  // On a bolted frame the pack straps to the deck above; on a unibody this
  // plate is that deck, and is built further down.
  const topSlots = [...opening, ...feet];
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

  if (spec.construction === "bolted") {
    if (!cage.hasDeck) return [bottom, top, ...arms, ...(mount ? [mount.plate] : [])];

    /*
      The battery deck. The same outline as the clamp plate beneath it, since
      its standoffs ride on the outer clamp bolt of each arm and it has to
      reach all four. No stack opening — the standoffs were chosen to clear
      the stack — but slots for the strap, and for the tabs on top of the
      camera's side plates when there are any, which is what stops the cage
      racking at the front.
    */
    const perArm = rootBoltOffsets(g.rootBolt).length;
    const deckHoles = topHoles.filter((_, i) => i % perArm === perArm - 1);
    const tabSlots = mount ? mount.topSlots : [];
    const deckFunctional = [
      ...tabSlots,
      ...strapSlotPair(topStrapFrontY, topL / 2 - 8, deckHoles, topOutline, tabSlots),
    ];
    const deckSlots = spec.lightenPlates
      ? [
          ...deckFunctional,
          ...lighteningCutouts({
            outline: topOutline,
            holes: deckHoles,
            slots: deckFunctional,
            bearings: bottomBearings,
            boltMm: g.rootBolt,
          }),
        ]
      : deckFunctional;
    const deckPlate: Profile = {
      id: "deck-plate",
      name: "Battery deck",
      qty: 1,
      outline: topOutline,
      holes: deckHoles,
      slots: deckSlots,
      lightenedFrom: deckFunctional.length,
      thicknessMm: topT,
      areaMm2:
        polygonArea(topOutline)
        - deckHoles.reduce((sum, h) => sum + Math.PI * h.r * h.r, 0)
        - deckSlots.reduce((sum, p) => sum + polygonArea(p), 0),
    };
    return [bottom, top, deckPlate, ...arms, ...(mount ? [mount.plate] : [])];
  }

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
  /*
    Sized by `topPlateGeom`, which the camera mount was fitted against. It
    used to be worked out again here, separately, and the mount's foot slots
    — fitted to a different plate — were then never cut in this one, so a
    unibody's side plates had tabs and nowhere to put them. A top-mounted
    pack had the same problem: its strap slots were taken out of the chassis
    and not put anywhere.
  */
  const uniTopHoles: Hole[] = deck.holes;
  const uniFit = { w: deck.w, l: deck.l };
  const uniTopOutline = deck.outline;
  const uniOpening = stackOpening(spec, uniFit.w, uniFit.l, uniTopHoles);
  const uniTopSlots = [
    ...uniOpening,
    ...feet,
    ...(strapsOnTop
      ? strapSlotPair(
          mount ? Math.min(uniFit.l / 2 - 8, mount.rearYMm - slotW / 2 - 4) : uniFit.l / 2 - 8,
          uniFit.l / 2 - 8,
          uniTopHoles,
          uniTopOutline,
          [...uniOpening, ...feet],
        )
      : []),
  ];
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

  return [chassis, uniTop, ...(mount ? [mount.plate] : [])];
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
