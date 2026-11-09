/*
  Frame Studio — engineering catalogue.

  Every number here is referenced data, not invention. Units are explicit and
  consistent throughout the studio:
    length mm · mass g · force N · stress MPa · modulus GPa · density g/cm³

  Sources:
   - Motor mount and flight-controller mounting patterns are industry standards
     (9×9, 12×12, 16×16, 19×19, 25×25 mm motors; 16, 20, 25.5, 30.5 mm stacks).
   - Carbon plate properties: Rock West Composites twill standard-modulus
     laminate (≈64 GPa in-plane modulus, 1.45–1.5 g/cm³).
   - Prop ↔ wheelbase ranges from published frame-size charts, cross-checked
     against the geometric clearance rule in geometry.ts.
   - Printed-material strengths carry an anisotropy knockdown (see `knockdown`)
     because FDM parts are weaker across layer lines than along them.
*/

export type MakeMethod = "cut" | "print";

export interface Material {
  id: string;
  name: string;
  method: MakeMethod;
  /** g/cm³ */
  density: number;
  /** Ultimate bending/flexural strength, MPa (before safety factor). */
  strength: number;
  /** Young's / flexural modulus, GPa. */
  modulus: number;
  /**
   * Multiplier applied to `strength` for real parts. Printed parts are
   * anisotropic, so we de-rate them; cut laminates are used as published.
   */
  knockdown: number;
  /** Sheet thicknesses commonly stocked, mm (cut materials only). */
  stock?: number[];
  /** Shown to the user — honest guidance, not marketing. */
  note: string;
  /** Discouraged for load-bearing arms; the UI warns. */
  structural: boolean;
}

export const MATERIALS: Material[] = [
  {
    id: "cf-plate",
    name: "Carbon fibre plate (3K twill)",
    method: "cut",
    density: 1.5,
    strength: 600,
    modulus: 64,
    knockdown: 1,
    stock: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 10],
    structural: true,
    note: "The industry standard for frames — stiffest per gram by a wide margin. Must be cut by a service or a shop with proper extraction: carbon dust is a respiratory hazard and is electrically conductive.",
  },
  {
    id: "g10",
    name: "G10 / FR4 glass laminate",
    method: "cut",
    density: 1.85,
    strength: 400,
    modulus: 20,
    knockdown: 1,
    stock: [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8],
    structural: true,
    note: "Tougher and far cheaper than carbon, and safe to cut on a hobby laser or router. Heavier and about a third as stiff, so arms come out wider.",
  },
  {
    id: "alu-6061",
    name: "Aluminium 6061-T6",
    method: "cut",
    density: 2.7,
    strength: 276,
    modulus: 69,
    knockdown: 1,
    stock: [1.5, 2, 2.5, 3, 4, 5, 6, 8, 10],
    structural: true,
    note: "Stiff and ductile — it bends rather than shatters in a crash. Heavy, and needs a router or waterjet rather than a laser.",
  },
  {
    id: "ply-birch",
    name: "Birch plywood",
    method: "cut",
    density: 0.68,
    strength: 60,
    modulus: 10,
    knockdown: 1,
    stock: [2, 3, 4, 5, 6, 8],
    structural: true,
    note: "Light, cheap and laser-friendly — a good choice for a first build or a classroom. Weak and moisture-sensitive, so expect wide arms and treat it as a learning frame.",
  },
  {
    id: "acrylic",
    name: "Acrylic (PMMA)",
    method: "cut",
    density: 1.18,
    strength: 100,
    modulus: 3.2,
    knockdown: 1,
    stock: [2, 3, 4, 5, 6],
    structural: false,
    note: "Looks superb and lasers cleanly, but it is brittle and shatters on impact. Use it for canopies and decorative plates, never for arms.",
  },
  {
    id: "pa-cf",
    name: "PA-CF — carbon-filled nylon (printed)",
    method: "print",
    density: 1.2,
    strength: 120,
    modulus: 6,
    knockdown: 0.6,
    structural: true,
    note: "The strongest practical printed option — nylon toughness with carbon stiffness. Dry the filament, print hot and slow, and anneal for a real strength gain.",
  },
  {
    id: "pa12-cf",
    name: "PA12-CF (printed)",
    method: "print",
    density: 1.06,
    strength: 95,
    modulus: 4.5,
    knockdown: 0.6,
    structural: true,
    note: "Absorbs far less moisture than PA6, so it holds its stiffness in humid conditions. Slightly weaker than PA-CF and can be fussy about layer adhesion.",
  },
  {
    id: "petg",
    name: "PETG (printed)",
    method: "print",
    density: 1.27,
    strength: 70,
    modulus: 2,
    knockdown: 0.6,
    structural: true,
    note: "Prints on any machine without an enclosure and is pleasantly tough. Soft and flexible, so arms come out deep — best for light builds and accessories.",
  },
  {
    id: "pla",
    name: "PLA (printed)",
    method: "print",
    density: 1.24,
    strength: 85,
    modulus: 3.5,
    knockdown: 0.5,
    structural: false,
    note: "Stiff on the bench but brittle on impact, and it softens in a hot car or direct sun. Fine for mock-ups and jigs — not for anything that must survive a landing.",
  },
];

export const materialById = (id: string) => MATERIALS.find((m) => m.id === id) ?? MATERIALS[0];

/** Motor stator sizes with their standard mount pattern and a representative peak thrust. */
export interface MotorSpec {
  id: string;
  /** Stator size, e.g. "2207". */
  size: string;
  /** Bolt circle pattern, square side in mm. */
  pattern: number;
  /** Mount bolt thread diameter, mm. */
  bolt: number;
  /** Representative peak thrust per motor, grams — a default the user can override. */
  thrustG: number;
  /** Typical motor mass, grams (contributes to all-up weight). */
  massG: number;
  /** Props this stator usually turns, inches. */
  props: number[];
}

/*
  Peak thrust values are representative of the size class on its usual prop and
  cell count. They are defaults only — every motor ships a thrust table, and the
  studio asks the user to enter theirs for a real design.
*/
export const MOTORS: MotorSpec[] = [
  { id: "1103", size: "1103", pattern: 9, bolt: 2, thrustG: 130, massG: 6, props: [2, 2.5] },
  { id: "1404", size: "1404", pattern: 12, bolt: 2, thrustG: 350, massG: 10, props: [3, 3.5, 4] },
  { id: "1806", size: "1806", pattern: 12, bolt: 2, thrustG: 450, massG: 19, props: [4] },
  { id: "2204", size: "2204", pattern: 16, bolt: 3, thrustG: 500, massG: 25, props: [4, 5] },
  { id: "2206", size: "2206", pattern: 16, bolt: 3, thrustG: 850, massG: 30, props: [5] },
  { id: "2207", size: "2207", pattern: 16, bolt: 3, thrustG: 1350, massG: 32, props: [5, 6] },
  { id: "2306", size: "2306", pattern: 16, bolt: 3, thrustG: 1250, massG: 31, props: [5, 6] },
  { id: "2407", size: "2407", pattern: 16, bolt: 3, thrustG: 1500, massG: 36, props: [6] },
  { id: "2806", size: "2806", pattern: 19, bolt: 3, thrustG: 1800, massG: 50, props: [7, 8] },
  { id: "3110", size: "3110", pattern: 19, bolt: 3, thrustG: 2600, massG: 85, props: [8, 9, 10] },
];

export const motorById = (id: string) => MOTORS.find((m) => m.id === id) ?? MOTORS[5];

/** Flight-controller / stack mounting patterns (square side, mm). */
export const STACK_PATTERNS = [
  { id: "16", pattern: 16, bolt: 2, label: "16 × 16 mm (M2) — whoop / micro" },
  { id: "20", pattern: 20, bolt: 2, label: "20 × 20 mm (M2) — most modern stacks" },
  { id: "25.5", pattern: 25.5, bolt: 3, label: "25.5 × 25.5 mm (M3)" },
  { id: "30.5", pattern: 30.5, bolt: 3, label: "30.5 × 30.5 mm (M3) — full size / Pixhawk-class" },
];

/**
 * Published frame-size reference: prop diameter → typical wheelbase window.
 * Used as a sanity band against the computed clearance minimum.
 */
export const WHEELBASE_REFERENCE: { prop: number; min: number; max: number }[] = [
  { prop: 2, min: 80, max: 100 },
  { prop: 2.5, min: 95, max: 120 },
  { prop: 3, min: 110, max: 140 },
  { prop: 3.5, min: 140, max: 160 },
  { prop: 4, min: 160, max: 180 },
  { prop: 5, min: 210, max: 230 },
  { prop: 6, min: 240, max: 260 },
  { prop: 7, min: 280, max: 300 },
  { prop: 8, min: 320, max: 360 },
  { prop: 9, min: 360, max: 400 },
  { prop: 10, min: 400, max: 450 },
];

export const PROP_SIZES = WHEELBASE_REFERENCE.map((w) => w.prop);

/**
 * Published part thicknesses from production frames, by prop class.
 *
 * The single most important thing this table encodes is that **arms and plates
 * are not the same thickness**. Every commercial frame cuts its arms from thick
 * stock and its plates from thin stock, because the arm is a cantilever and the
 * plates are only a clamp and a mounting surface. Treating a frame as one
 * uniform sheet is what produces either absurdly wide arms or absurdly heavy
 * plates, depending on which thickness you pick.
 *
 * Measured reference points:
 *   Apex 5"      225 mm   arm 5.5   bottom 2.5   top 2.0   138 g
 *   Mark4 7"     295 mm   arm 5.0   bottom 2.5   top 2.5   140 g
 *   Mark4 V2 10" 427 mm   arm 7.5   bottom 3.0   top 2.0
 *   LiftChuang LX10 V2  405 mm   arm 7.0
 *
 * Note how little the plates change across the range (2–3 mm from a 5" to a
 * 10") while the arms nearly double. Arm thickness is the lever; plate
 * thickness barely moves.
 */
export interface ThicknessReference {
  prop: number;
  /** Arm stock thickness, mm. */
  armMm: number;
  /** Bottom plate, mm — carries the arms and the battery. */
  bottomMm: number;
  /** Top plate, mm — a clamp, so it can be thinner. */
  topMm: number;
}

export const THICKNESS_REFERENCE: ThicknessReference[] = [
  { prop: 2, armMm: 2.5, bottomMm: 1.5, topMm: 1.5 },
  { prop: 2.5, armMm: 3, bottomMm: 1.5, topMm: 1.5 },
  { prop: 3, armMm: 3, bottomMm: 2, topMm: 1.5 },
  { prop: 3.5, armMm: 3, bottomMm: 2, topMm: 1.5 },
  { prop: 4, armMm: 4, bottomMm: 2, topMm: 2 },
  { prop: 5, armMm: 5, bottomMm: 2.5, topMm: 2 },
  { prop: 6, armMm: 5, bottomMm: 2.5, topMm: 2 },
  { prop: 7, armMm: 5.5, bottomMm: 2.5, topMm: 2 },
  { prop: 8, armMm: 6, bottomMm: 3, topMm: 2 },
  { prop: 9, armMm: 7, bottomMm: 3, topMm: 2 },
  { prop: 10, armMm: 7.5, bottomMm: 3, topMm: 2 },
];

/** Interpolate the reference table, clamping outside its range. */
export function thicknessReferenceFor(propIn: number): ThicknessReference {
  const t = THICKNESS_REFERENCE;
  if (propIn <= t[0].prop) return t[0];
  if (propIn >= t[t.length - 1].prop) return t[t.length - 1];
  for (let i = 1; i < t.length; i++) {
    if (propIn <= t[i].prop) {
      const a = t[i - 1];
      const b = t[i];
      const f = (propIn - a.prop) / (b.prop - a.prop);
      const lerp = (x: number, y: number) => x + (y - x) * f;
      return { prop: propIn, armMm: lerp(a.armMm, b.armMm), bottomMm: lerp(a.bottomMm, b.bottomMm), topMm: lerp(a.topMm, b.topMm) };
    }
  }
  return t[t.length - 1];
}

/**
 * Nearest stocked thickness, preferring the thinner one on a tie.
 *
 * Rounding up would be the cautious choice, but the reference values sit
 * deliberately between stock sizes (5.5 mm for a 7", 7.5 mm for a 10") because
 * real frames are cut from custom stock. Rounding to nearest lands on the
 * 5 mm and 7 mm that production frames in those classes actually use; rounding
 * up lands a size heavier on every single frame.
 */
export function snapToStock(mm: number, stock: number[] | undefined): number {
  if (!stock || stock.length === 0) return mm;
  let best = stock[0];
  for (const s of stock) {
    const d = Math.abs(s - mm);
    const bd = Math.abs(best - mm);
    if (d < bd - 1e-9 || (Math.abs(d - bd) < 1e-9 && s < best)) best = s;
  }
  return best;
}

/**
 * Printed arms are hollow box sections; this is the default wall, mm.
 * Published guidance for printed arms is a 2–3 mm wall with generous internal
 * fillets, which is also about as thin as a wall can be and still be made of
 * whole perimeters rather than thin-wall gap fill.
 */
export const DEFAULT_WALL_MM = 2.5;

/** How hard the aircraft will be flown — drives the crash/landing load case. */
export interface FlyingStyle {
  id: string;
  label: string;
  /** Landing/impact load factor applied to all-up weight at the arm. */
  loadFactor: number;
  note: string;
}

export const FLYING_STYLES: FlyingStyle[] = [
  { id: "gentle", label: "Gentle / camera work", loadFactor: 6, note: "Smooth flying, careful landings." },
  { id: "freestyle", label: "Freestyle", loadFactor: 10, note: "Hard manoeuvres and the occasional bad landing." },
  { id: "racing", label: "Racing / bando", loadFactor: 15, note: "Expect contact. Built to survive crashes." },
];

export const styleById = (id: string) => FLYING_STYLES.find((s) => s.id === id) ?? FLYING_STYLES[1];

/** Standard metric hardware the studio specifies in the bill of materials. */
export const BOLT_HEAD_DIA: Record<number, number> = { 2: 3.8, 2.5: 4.5, 3: 5.5, 4: 7 };
/** Minimum material between a hole edge and the part edge, as a multiple of hole diameter. */
export const EDGE_DISTANCE_FACTOR = 1.5;
