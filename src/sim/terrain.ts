/*
  The landscape the simulator flies over.

  One function gives the height of the ground at any point, and both the
  physics and the 3D view read it, so what the aircraft hits is what the
  picture shows. Heights are metres above home; north and east are metres
  from home.

  The take-off area is always level — home sits on a flat pad that blends
  into the terrain over a couple of hundred metres — and the distant
  mountains are far enough out to be scenery for any ordinary mission.

  The autopilot knows nothing of this, exactly as ArduCopter knows nothing of
  terrain without a rangefinder or terrain data: it flies heights above home.
  A waypoint 20 m up over a 30 m hill is a crash, and the simulator will say so.
*/
/** "real" is the measured ground around a real home point; see geo/elevation. */
export type TerrainKind = "flat" | "hills" | "highlands" | "real";

export const TERRAIN_LABEL: Record<TerrainKind, { name: string; detail: string }> = {
  flat: { name: "Open field", detail: "Level ground out to more than a kilometre, with mountains on the horizon." },
  hills: { name: "Rolling hills and a lake", detail: "Level at home, rising to hills of 30 to 40 m within a few hundred metres." },
  highlands: { name: "Highlands", detail: "Steep ground: ridges of 80 m and more close to home." },
  real: { name: "The real ground around home", detail: "Measured heights for the place home is set to, about 30 m in detail. Needs the internet once, or an area saved in Mission Planning." },
};

export interface Terrain {
  kind: TerrainKind;
  /** Height of the land, m above home. Can be below the water. */
  land(n: number, e: number): number;
  /** Height of whatever the aircraft would touch: land, or the water's surface. */
  surface(n: number, e: number): number;
  isWater(n: number, e: number): boolean;
  waterLevel: number;
  /** 0–1: how wooded this spot is. The view plants trees by it. */
  forest(n: number, e: number): number;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function hash(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) ^ Math.imul(iy, 668265263) ^ Math.imul(seed, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise, 0–1. */
function noise(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, seed);
  const b = hash(ix + 1, iy, seed);
  const c = hash(ix, iy + 1, seed);
  const d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x: number, y: number, seed: number, octaves: number): number {
  let v = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    v += amp * noise(x, y, seed + i * 17);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return v / norm;
}

const SHAPE: Record<Exclude<TerrainKind, "real">, { near: number; padIn: number; padOut: number; scale: number; far: number; lake: { n: number; e: number; r: number } | null }> = {
  flat: { near: 0, padIn: 0, padOut: 1, scale: 400, far: 190, lake: null },
  hills: { near: 46, padIn: 55, padOut: 300, scale: 430, far: 280, lake: { n: -170, e: 250, r: 120 } },
  highlands: { near: 150, padIn: 70, padOut: 420, scale: 520, far: 520, lake: { n: 260, e: -330, r: 140 } },
};

/**
 * A generated landscape. Real ground is not made here but loaded (see
 * geo/elevation); asked for it, this gives the open field, which is what the
 * simulator falls back to when the real heights cannot be had.
 */
export function makeTerrain(asked: TerrainKind, seed = 11): Terrain {
  const kind = asked === "real" ? "flat" : asked;
  const s = SHAPE[kind];
  const waterLevel = -0.8;
  const land = (n: number, e: number): number => {
    const r = Math.hypot(n, e);
    let h = 0;
    if (s.near > 0 && r > s.padIn) {
      const base = fbm(n / s.scale + 31.7, e / s.scale - 12.4, seed, 5);
      h += s.near * Math.max(0, (base - 0.3) / 0.7) ** 1.5 * smooth(s.padIn, s.padOut, r) * 2.1;
    }
    if (r > 1300) {
      // The horizon: ridged mountains, a long way off.
      const ridge = 1 - Math.abs(2 * fbm(n / 1700 - 4.2, e / 1700 + 9.1, seed + 99, 4) - 1);
      h += s.far * ridge * ridge * smooth(1300, 4200, r) * 2.2;
    }
    if (s.lake) {
      const d = Math.hypot(n - s.lake.n, e - s.lake.e) / s.lake.r;
      // An uneven shoreline, so it reads as a lake and not a disc.
      const edge = d + 0.22 * (noise(n / 60, e / 60, seed + 5) - 0.5);
      if (edge < 1.5) h = h * smooth(0.95, 1.5, edge) - 3.2 * (1 - smooth(0.55, 1.05, edge));
    }
    return h;
  };
  return {
    kind,
    land,
    waterLevel,
    surface: (n, e) => Math.max(land(n, e), waterLevel),
    isWater: (n, e) => land(n, e) < waterLevel - 0.05,
    forest: (n, e) => {
      const r = Math.hypot(n, e);
      if (r < 75) return 0;
      return fbm(n / 260 + 5.5, e / 260 - 3.3, seed + 41, 3) * smooth(75, 160, r);
    },
  };
}
