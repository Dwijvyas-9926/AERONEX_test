import * as THREE from "three";
import type { Terrain } from "../../../sim/terrain";

/*
  Geometry and textures for the landscape, built once per terrain.

  Everything is generated: there are no image or model files to download, so
  the world appears at once and works with no connection. World axes are the
  app's: +X east, +Y up, −Z north.
*/

const C = (hex: string) => new THREE.Color(hex);
/*
  Colours taken from temperate grassland in clear afternoon light: grass is
  olive and yellow-green rather than emerald, and it dries toward straw on
  higher ground. Saturated greens are what make a generated landscape look
  like a toy, so nothing here is far from grey.
*/
const GRASS = [C("#5d6b3c"), C("#737c46"), C("#888a52")];
const DRY = C("#a59a68");
const ROCK = C("#7f786d");
const ROCK_HI = C("#8e8c8a");
const SAND = C("#b3a680");
const BED = C("#4a544a");

function shade(terrain: Terrain, n: number, e: number, h: number, slope: number, out: THREE.Color) {
  // Patchy grass: two scales of variation so no large area is one flat colour.
  const v = 0.5 + 0.5 * Math.sin(n * 0.011 + Math.sin(e * 0.017) * 2.1) * Math.cos(e * 0.013 - Math.sin(n * 0.009) * 1.7);
  const fine = 0.5 + 0.5 * Math.sin(n * 0.19 + e * 0.07) * Math.sin(e * 0.23 - n * 0.05);
  out.copy(GRASS[0]).lerp(GRASS[1], v).lerp(GRASS[2], fine * 0.35);
  out.lerp(DRY, Math.min(0.55, Math.max(0, (h - 14) / 60)) + (1 - terrain.forest(n, e)) * 0.08);
  const rock = Math.min(1, Math.max(0, (slope - 0.42) / 0.3));
  out.lerp(ROCK, rock);
  out.lerp(ROCK_HI, Math.min(1, Math.max(0, (h - 230) / 260)));
  const shore = h - terrain.waterLevel;
  if (shore < 1.4) out.lerp(SAND, Math.min(1, Math.max(0, 1 - shore / 1.4)));
  if (shore < 0) out.lerp(BED, Math.min(1, -shore / 1.5));
}

/**
 * A square patch of terrain. `skipInside` leaves a hole for a finer patch to
 * fill, so two resolutions never fight for the same pixels.
 */
/** The near ground mesh: how far it reaches from home and how finely it is cut. */
export const NEAR_HALF = 780;
export const NEAR_SEGS = 230;
export const FAR_HALF = 7000;
export const FAR_SEGS = 190;
/** The far mesh sits a little low so the near one always wins where they overlap. */
export const FAR_DROP = 0.7;

function cellHeight(terrain: Terrain, n: number, e: number, half: number, segs: number): number {
  const step = (half * 2) / segs;
  const i = Math.max(0, Math.min(segs - 1, Math.floor((e + half) / step)));
  const j = Math.max(0, Math.min(segs - 1, Math.floor((half - n) / step)));
  const e0 = -half + i * step;
  const n0 = half - j * step;
  const u = Math.max(0, Math.min(1, (e - e0) / step));
  const v = Math.max(0, Math.min(1, (n0 - n) / step));
  const tl = terrain.land(n0, e0);
  const tr = terrain.land(n0, e0 + step);
  const bl = terrain.land(n0 - step, e0);
  const br = terrain.land(n0 - step, e0 + step);
  // The same two triangles terrainGeometry cuts each square into.
  return u + v <= 1 ? tl + u * (tr - tl) + v * (bl - tl) : br + (1 - u) * (bl - br) + (1 - v) * (tr - br);
}

/**
 * The height of the ground as it is drawn, which is flat triangles between
 * the points the terrain was sampled at, and so not quite the terrain itself.
 * Anything laid on the ground must follow this, or the ground cuts through it.
 */
export function drawnGround(terrain: Terrain, n: number, e: number): number {
  return Math.max(Math.abs(n), Math.abs(e)) < NEAR_HALF ? cellHeight(terrain, n, e, NEAR_HALF, NEAR_SEGS) : cellHeight(terrain, n, e, FAR_HALF, FAR_SEGS) - FAR_DROP;
}

/**
 * A disc or ring that lies on the drawn ground, following its slope, centred
 * n metres north and e east of home. A flat disc on sloping ground is half
 * buried; this one is whole wherever it is put. Its picture, if it has one,
 * maps as on a flat disc.
 */
export function drapedRing(terrain: Terrain, n: number, e: number, inner: number, outer: number, lift = 0.06, around = 64, across = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let r = 0; r <= across; r++) {
    const rad = inner + ((outer - inner) * r) / across;
    for (let a = 0; a <= around; a++) {
      const t = (a / around) * Math.PI * 2;
      const de = Math.cos(t) * rad;
      const dn = Math.sin(t) * rad;
      pos.push(e + de, drawnGround(terrain, n + dn, e + de) + lift, -(n + dn));
      uv.push(0.5 + de / (2 * outer), 0.5 + dn / (2 * outer));
    }
  }
  const row = around + 1;
  for (let r = 0; r < across; r++) {
    for (let a = 0; a < around; a++) {
      const k = r * row + a;
      idx.push(k, k + 1, k + row, k + 1, k + row + 1, k + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function terrainGeometry(terrain: Terrain, half: number, segs: number, uvMetres: number, skipInside = 0): THREE.BufferGeometry {
  const side = segs + 1;
  const pos = new Float32Array(side * side * 3);
  const col = new Float32Array(side * side * 3);
  const uv = new Float32Array(side * side * 2);
  const step = (half * 2) / segs;
  const c = new THREE.Color();
  for (let j = 0; j < side; j++) {
    for (let i = 0; i < side; i++) {
      const e = -half + i * step;
      const n = half - j * step;
      const h = terrain.land(n, e);
      const k = j * side + i;
      pos[k * 3] = e;
      pos[k * 3 + 1] = h;
      pos[k * 3 + 2] = -n;
      const d = Math.max(2, step * 0.5);
      const slope = Math.hypot(terrain.land(n + d, e) - terrain.land(n - d, e), terrain.land(n, e + d) - terrain.land(n, e - d)) / (2 * d);
      shade(terrain, n, e, h, slope, c);
      col[k * 3] = c.r;
      col[k * 3 + 1] = c.g;
      col[k * 3 + 2] = c.b;
      uv[k * 2] = e / uvMetres;
      uv[k * 2 + 1] = n / uvMetres;
    }
  }
  const idx: number[] = [];
  for (let j = 0; j < segs; j++) {
    for (let i = 0; i < segs; i++) {
      if (skipInside > 0) {
        const e0 = -half + i * step;
        const n0 = half - j * step;
        if (Math.abs(e0) < skipInside && Math.abs(e0 + step) < skipInside && Math.abs(n0) < skipInside && Math.abs(n0 - step) < skipInside) continue;
      }
      const a = j * side + i;
      idx.push(a, a + side, a + 1, a + 1, a + side, a + side + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.BufferAttribute(col, 3));
  g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function canvasTexture(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = false): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Tiling ground detail: multiplied over the vertex colours, so it only adds grain. */
export function groundDetail(): THREE.CanvasTexture {
  return canvasTexture(
    256,
    (ctx, s) => {
      ctx.fillStyle = "#e6e6e6";
      ctx.fillRect(0, 0, s, s);
      let seed = 7;
      const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 5200; i++) {
        const x = r() * s;
        const y = r() * s;
        const l = 150 + r() * 105;
        ctx.fillStyle = `rgba(${l},${l},${l * 0.96},${0.25 + r() * 0.4})`;
        ctx.fillRect(x, y, 1 + r() * 2.2, 1 + r() * 2.2);
      }
      for (let i = 0; i < 26; i++) {
        const x = r() * s;
        const y = r() * s;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 20 + r() * 34);
        const d = r() > 0.5 ? 255 : 120;
        g.addColorStop(0, `rgba(${d},${d},${d},0.06)`);
        g.addColorStop(1, `rgba(${d},${d},${d},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, s, s);
      }
    },
    true,
  );
}

/** The take-off pad: weathered concrete with a painted circle and H. */
export function padTexture(): THREE.CanvasTexture {
  return canvasTexture(512, (ctx, s) => {
    ctx.fillStyle = "#8d8a84";
    ctx.fillRect(0, 0, s, s);
    let seed = 3;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 9000; i++) {
      const l = 110 + r() * 70;
      ctx.fillStyle = `rgba(${l},${l},${l},0.35)`;
      ctx.fillRect(r() * s, r() * s, 2, 2);
    }
    ctx.strokeStyle = "#f3efe4";
    ctx.lineWidth = 22;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.37, 0, Math.PI * 2);
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.lineWidth = 34;
    ctx.beginPath();
    ctx.moveTo(s * 0.37, s * 0.3);
    ctx.lineTo(s * 0.37, s * 0.7);
    ctx.moveTo(s * 0.63, s * 0.3);
    ctx.lineTo(s * 0.63, s * 0.7);
    ctx.moveTo(s * 0.37, s * 0.5);
    ctx.lineTo(s * 0.63, s * 0.5);
    ctx.stroke();
    // North tick, so the pad itself shows which way the aircraft starts facing.
    ctx.fillStyle = "#f28c38";
    ctx.beginPath();
    ctx.moveTo(s / 2, s * 0.03);
    ctx.lineTo(s * 0.53, s * 0.1);
    ctx.lineTo(s * 0.47, s * 0.1);
    ctx.fill();
  });
}

/** A soft white puff for clouds. */
export function cloudTexture(): THREE.CanvasTexture {
  return canvasTexture(256, (ctx, s) => {
    let seed = 21;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 26; i++) {
      const x = s * (0.2 + r() * 0.6);
      const y = s * (0.36 + r() * 0.28);
      const rad = s * (0.1 + r() * 0.16);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,0.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}

/** A dense, ragged puff for smoke, dust and spray. */
export function smokeTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, s) => {
    let seed = 77;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 14; i++) {
      const x = s * (0.3 + r() * 0.4);
      const y = s * (0.3 + r() * 0.4);
      const rad = s * (0.16 + r() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, "rgba(255,255,255,0.5)");
      g.addColorStop(0.6, "rgba(255,255,255,0.22)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}

/** A soft dark disc: the aircraft's shadow on the ground. */
export function blobTexture(): THREE.CanvasTexture {
  return canvasTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, "rgba(0,0,0,0.75)");
    g.addColorStop(0.55, "rgba(0,0,0,0.35)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

/** A text label as a texture, for a sprite. */
export function labelTexture(text: string, fg = "#14213d", bg = "#f28c38"): { tex: THREE.CanvasTexture; aspect: number } {
  const c = document.createElement("canvas");
  const ctx = c.getContext("2d")!;
  const font = "700 46px 'Saira Semi Condensed', 'Arial Narrow', sans-serif";
  ctx.font = font;
  const w = Math.max(72, Math.ceil(ctx.measureText(text).width) + 44);
  c.width = w;
  c.height = 72;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect(2, 2, w - 4, 68, 34);
  ctx.fill();
  ctx.font = font;
  ctx.fillStyle = fg;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, w / 2, 39);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { tex, aspect: w / 72 };
}

export interface Tree {
  x: number;
  y: number;
  z: number;
  h: number;
  w: number;
  tint: number;
  kind: 0 | 1;
}

/** Where the trees stand: woods and scattered singles, clear of the pad and the water. */
export function plantTrees(terrain: Terrain, reach: number, spacing: number, max: number): Tree[] {
  const out: Tree[] = [];
  // Measured ground says nothing of what grows on it, so nothing is planted.
  if (terrain.kind === "real") return out;
  let seed = 99;
  const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let n = -reach; n <= reach && out.length < max; n += spacing) {
    for (let e = -reach; e <= reach && out.length < max; e += spacing) {
      const jn = n + (r() - 0.5) * spacing;
      const je = e + (r() - 0.5) * spacing;
      const f = terrain.forest(jn, je);
      const roll = r();
      // Dense inside a wood, the odd tree in open ground.
      if (!(f > 0.56 ? roll < 0.85 : f > 0.46 ? roll < 0.16 : roll < 0.012 && Math.hypot(jn, je) > 110)) continue;
      const h = terrain.land(jn, je);
      if (h < terrain.waterLevel + 0.6 || h > 200) continue;
      const slope = Math.abs(terrain.land(jn + 3, je) - h) + Math.abs(terrain.land(jn, je + 3) - h);
      if (slope > 2.6) continue;
      const tall = 6 + r() * 8;
      out.push({ x: je, y: h, z: -jn, h: tall, w: tall * (0.28 + r() * 0.14), tint: r(), kind: r() < 0.62 ? 0 : 1 });
    }
  }
  return out;
}
