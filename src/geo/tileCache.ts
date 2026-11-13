import type { TilePixels } from "./elevation";

/*
  Map tiles kept on this computer.

  A flying field rarely has the internet. Every tile from a source that allows
  it is stored as it is first seen, and an area can be saved on purpose before
  leaving for the field. After that the map and the ground heights for that
  area work with no connection at all.

  Tiles for a place do not change, so a stored tile is used without asking
  the network again.
*/
const STORE = "aeronex-map-tiles-v1";

const hasStore = () => typeof caches !== "undefined";

export async function keptFetch(url: string, signal?: AbortSignal): Promise<Response> {
  if (!hasStore()) return fetch(url, { signal });
  const store = await caches.open(STORE);
  const hit = await store.match(url);
  if (hit) return hit;
  const res = await fetch(url, { signal, mode: "cors" });
  // Storing is a convenience: a full disk must not cost the tile itself.
  if (res.ok) void store.put(url, res.clone()).catch(() => undefined);
  return res;
}

export async function keptCount(): Promise<number> {
  if (!hasStore()) return 0;
  return (await (await caches.open(STORE)).keys()).length;
}

export async function clearKept(): Promise<void> {
  if (hasStore()) await caches.delete(STORE);
}

/**
 * Fetches and stores every address, a few at a time. Returns how many failed.
 * Already-stored tiles cost nothing.
 */
export async function saveTiles(urls: string[], onProgress: (done: number, total: number) => void, signal?: AbortSignal): Promise<number> {
  let next = 0;
  let done = 0;
  let failed = 0;
  const worker = async () => {
    while (next < urls.length && !signal?.aborted) {
      const url = urls[next++];
      try {
        const res = await keptFetch(url, signal);
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return failed;
}

/** Reads one elevation tile into pixels, through the store. */
export async function loadTilePixels(url: string): Promise<TilePixels> {
  const res = await keptFetch(url);
  if (!res.ok) throw new Error(`The elevation server answered ${res.status}.`);
  // The colours are numbers: nothing may adjust them on the way in.
  const bmp = await createImageBitmap(await res.blob(), { premultiplyAlpha: "none", colorSpaceConversion: "none" });
  const c = document.createElement("canvas");
  c.width = bmp.width;
  c.height = bmp.height;
  const ctx = c.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  return { size: c.width, data: ctx.getImageData(0, 0, c.width, c.height).data };
}
