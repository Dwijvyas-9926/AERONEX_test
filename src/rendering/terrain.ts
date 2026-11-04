/*
  Procedural terrain: deterministic value-noise fBm with a carved river valley.
  The same `heightAt` drives mesh vertices and object placement, so anything
  standing on the ground (trees, markers, the aircraft's AGL readout) agrees
  with what is rendered.
*/

function hash(x: number, y: number, seed: number) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967295;
}

const smooth = (t: number) => t * t * (3 - 2 * t);

function valueNoise(x: number, y: number, seed: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = smooth(x - xi);
  const yf = smooth(y - yi);
  const a = hash(xi, yi, seed);
  const b = hash(xi + 1, yi, seed);
  const c = hash(xi, yi + 1, seed);
  const d = hash(xi + 1, yi + 1, seed);
  return a + (b - a) * xf + (c - a) * yf + (a - b - c + d) * xf * yf;
}

export function fbm(x: number, y: number, octaves = 5, seed = 7) {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq, y * freq, seed + i * 13);
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

/** Centre line of the river, x as a function of z. */
export const riverX = (z: number) => 14 * Math.sin(z * 0.028) + 6 * Math.sin(z * 0.071 + 1.3);

export const RIVER_LEVEL = -1.2;

export function heightAt(x: number, z: number): number {
  // Rolling hills that rise away from the valley floor
  const base = fbm(x * 0.012, z * 0.012, 5) * 30 - 6;
  const ridges = Math.pow(fbm(x * 0.03 + 40, z * 0.03 - 17, 4), 2) * 14;
  const dist = Math.abs(x - riverX(z));
  const valley = 1 - Math.exp(-(dist * dist) / (2 * 22 * 22)); // 0 in the river, 1 on the hills
  const banks = Math.min(1, Math.max(0, (dist - 4) / 6));
  const h = (base + ridges) * valley + 2.5 * valley;
  return h * banks + (RIVER_LEVEL - 1.2) * (1 - banks);
}
