import type { Terrain } from "../sim/terrain";
import { tileX, tileY, toGlobal, type LatLon } from "./geo";

/*
  Real ground heights.

  The heights come as "Terrarium" tiles: ordinary map tiles whose colours are
  numbers, one height per pixel. A patch of them around home is turned into a
  plain grid in metres north and east, and from then on the app asks that grid
  — the planner for clearance, the simulator for what the aircraft hits, the
  3D view for the shape of the land. One source, so they cannot disagree.

  What the data is: a satellite radar survey of roughly 30 m detail across
  most of the world. It is the bare shape of the land, typically right to
  about 10 m, and it knows nothing of trees, buildings, masts or wires.
*/

/** Height in metres from one Terrarium pixel. */
export const terrarium = (r: number, g: number, b: number) => r * 256 + g + b / 256 - 32768;

/** The pixels of one tile, RGBA, row by row from the north-west corner. */
export interface TilePixels {
  size: number;
  data: ArrayLike<number>;
}

export type TileLoader = (z: number, x: number, y: number) => Promise<TilePixels>;

export interface DemPatch {
  home: LatLon;
  /** The patch reaches this far from home in each direction, m. */
  half: number;
  /** Spacing of the grid, m. */
  step: number;
  /** Points along each side. */
  size: number;
  /** Heights above sea level, m. Row 0 is the south edge; column 0 the west. */
  heights: Float32Array;
  /** Height of the ground at home, m above sea level. */
  base: number;
  min: number;
  max: number;
  zoom: number;
}

/** The tile zoom and grid spacing that suit a patch of this reach. */
export function demDetail(half: number): { zoom: number; step: number } {
  // The survey is about 30 m, so finer tiles than zoom 13 (19 m a pixel) add nothing.
  if (half <= 4000) return { zoom: 13, step: 20 };
  if (half <= 9000) return { zoom: 12, step: 40 };
  return { zoom: 11, step: 80 };
}

/**
 * Loads the ground around home, out to `half` metres each way.
 * Rejects if any tile it needs cannot be had.
 */
export async function loadDem(home: LatLon, half: number, load: TileLoader): Promise<DemPatch> {
  const { zoom, step } = demDetail(half);
  const size = Math.round((2 * half) / step) + 1;
  const sw = toGlobal(home, -half, -half);
  const ne = toGlobal(home, half, half);

  // Whole-tile range, with a pixel to spare for the blend at the edges.
  const tx0 = Math.floor(tileX(sw.lon, zoom) - 0.01);
  const tx1 = Math.floor(tileX(ne.lon, zoom) + 0.01);
  const ty0 = Math.floor(tileY(ne.lat, zoom) - 0.01);
  const ty1 = Math.floor(tileY(sw.lat, zoom) + 0.01);
  const wrap = 2 ** zoom;
  const tiles = new Map<string, TilePixels>();
  const jobs: Promise<void>[] = [];
  for (let x = tx0; x <= tx1; x++) {
    for (let y = Math.max(0, ty0); y <= Math.min(wrap - 1, ty1); y++) {
      const wx = ((x % wrap) + wrap) % wrap;
      jobs.push(load(zoom, wx, y).then((t) => void tiles.set(`${x}/${y}`, t)));
    }
  }
  await Promise.all(jobs);

  const first = tiles.values().next().value;
  if (!first) throw new Error("No elevation tiles cover this place.");
  const px = first.size;

  /** Height at a whole pixel, counted across the whole world at this zoom. */
  const at = (gx: number, gy: number): number => {
    let tx = Math.floor(gx / px);
    let ty = Math.floor(gy / px);
    // Past the loaded edge, repeat the edge.
    tx = Math.max(tx0, Math.min(tx1, tx));
    ty = Math.max(Math.max(0, ty0), Math.min(Math.min(wrap - 1, ty1), ty));
    const t = tiles.get(`${tx}/${ty}`)!;
    const ix = Math.max(0, Math.min(px - 1, gx - tx * px));
    const iy = Math.max(0, Math.min(px - 1, gy - ty * px));
    const k = (iy * px + ix) * 4;
    return terrarium(t.data[k], t.data[k + 1], t.data[k + 2]);
  };

  const heights = new Float32Array(size * size);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const p = toGlobal(home, -half + j * step, -half + i * step);
      // Pixel centres sit at the half.
      const fx = tileX(p.lon, zoom) * px - 0.5;
      const fy = tileY(p.lat, zoom) * px - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const ux = fx - x0;
      const uy = fy - y0;
      const h = at(x0, y0) * (1 - ux) * (1 - uy) + at(x0 + 1, y0) * ux * (1 - uy) + at(x0, y0 + 1) * (1 - ux) * uy + at(x0 + 1, y0 + 1) * ux * uy;
      heights[j * size + i] = h;
      if (h < min) min = h;
      if (h > max) max = h;
    }
  }
  const patch: DemPatch = { home: { lat: home.lat, lon: home.lon }, half, step, size, heights, base: 0, min, max, zoom };
  patch.base = sampleDem(patch, 0, 0);
  return patch;
}

/** Height above sea level at a point, m. Outside the patch, the nearest edge. */
export function sampleDem(p: DemPatch, n: number, e: number): number {
  const last = p.size - 1;
  const fj = Math.max(0, Math.min(last, (n + p.half) / p.step));
  const fi = Math.max(0, Math.min(last, (e + p.half) / p.step));
  const j = Math.min(last - 1, Math.floor(fj));
  const i = Math.min(last - 1, Math.floor(fi));
  const uj = fj - j;
  const ui = fi - i;
  const h = p.heights;
  const s = p.size;
  return h[j * s + i] * (1 - ui) * (1 - uj) + h[j * s + i + 1] * ui * (1 - uj) + h[(j + 1) * s + i] * (1 - ui) * uj + h[(j + 1) * s + i + 1] * ui * uj;
}

/** Does this patch serve a plan with this home and this reach? */
export function covers(p: DemPatch | null, home: LatLon, half: number): p is DemPatch {
  return !!p && Math.abs(p.home.lat - home.lat) < 1e-5 && Math.abs(p.home.lon - home.lon) < 1e-5 && p.half >= half;
}

/**
 * The patch as a landscape for the simulator: heights above home, as the
 * physics and the views expect.
 *
 * The data cannot tell water from land, so there is no water here, and no
 * trees are planted: nothing is drawn that the data does not know.
 */
export function realTerrain(p: DemPatch): Terrain {
  const land = (n: number, e: number) => sampleDem(p, n, e) - p.base;
  return {
    kind: "real",
    land,
    surface: land,
    isWater: () => false,
    // Out of sight beneath the lowest ground.
    waterLevel: p.min - p.base - 80,
    forest: () => 0,
    reach: p.half,
  };
}
