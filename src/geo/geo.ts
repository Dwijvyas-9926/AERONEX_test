/*
  Places on the Earth, and the two ways the app talks about them.

  The autopilot and the map use latitude and longitude. The simulator and the
  plan use metres north and east of home, which is what a pilot thinks in and
  what the physics needs. Over the few kilometres a multirotor flies, treating
  the ground as flat about home is good to well under a metre, and it is the
  same arithmetic the virtual autopilot uses, so the two can never disagree.
*/
export const M_PER_DEG = 111319.5;

export interface LatLon {
  lat: number;
  lon: number;
}

const rad = (d: number) => (d * Math.PI) / 180;

/** Metres north and east of `home`. */
export function toLocal(home: LatLon, lat: number, lon: number): { n: number; e: number } {
  return { n: (lat - home.lat) * M_PER_DEG, e: (lon - home.lon) * M_PER_DEG * Math.cos(rad(home.lat)) };
}

export function toGlobal(home: LatLon, n: number, e: number): LatLon {
  return { lat: home.lat + n / M_PER_DEG, lon: home.lon + e / (M_PER_DEG * Math.cos(rad(home.lat))) };
}

/** Great-circle distance, m. */
export function distanceM(a: LatLon, b: LatLon): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export const fmtLatLon = (p: LatLon, places = 5) => `${p.lat.toFixed(places)}, ${p.lon.toFixed(places)}`;

/**
 * Reads "23.0225, 72.5714" or "23.0225 72.5714", as pasted from a map or a
 * phone. Null when it is not a place on Earth.
 */
export function parseLatLon(text: string): LatLon | null {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lon = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 85 || Math.abs(lon) > 180) return null;
  return { lat, lon };
}

/* --------------------------------------------------------------- map tiles */

/** Web-mercator tile column, fractional, at zoom z. */
export const tileX = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;

/** Web-mercator tile row, fractional, at zoom z. Row 0 is the north edge. */
export function tileY(lat: number, z: number): number {
  const r = rad(Math.max(-85.0511, Math.min(85.0511, lat)));
  return ((1 - Math.asinh(Math.tan(r)) / Math.PI) / 2) * 2 ** z;
}

export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface TileId {
  z: number;
  x: number;
  y: number;
}

/** Every tile at zoom z that touches the bounds. */
export function tilesIn(b: Bounds, z: number): TileId[] {
  const max = 2 ** z - 1;
  const clamp = (v: number) => Math.max(0, Math.min(max, Math.floor(v)));
  const x0 = clamp(tileX(b.west, z));
  const x1 = clamp(tileX(b.east, z));
  const y0 = clamp(tileY(b.north, z));
  const y1 = clamp(tileY(b.south, z));
  const out: TileId[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ z, x, y });
  return out;
}

/** Fills {z}, {x} and {y} in a tile address. */
export const tileUrl = (template: string, t: TileId) => template.replace("{z}", String(t.z)).replace("{x}", String(t.x)).replace("{y}", String(t.y));
