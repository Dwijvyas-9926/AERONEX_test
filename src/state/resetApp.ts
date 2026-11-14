/*
  "Reset app data": everything AERONEX keeps in this browser, and nothing else.

  Every key the app stores starts with "avion." or "aeronex." (profiles,
  settings, frame designs, the mission plan, map preferences and keys, the
  last aircraft's settings, the key-remember flag), in localStorage and in
  sessionStorage. Imported 3D models are in the IndexedDB database
  "avion.models.v1"; saved map tiles are in Cache Storage under
  "aeronex-…". Reset used to remove only the profiles and settings and leave
  the rest, including the map provider's key.

  Nothing on a flight controller is touched.
*/

const OURS = /^(avion|aeronex)[.-]/;

export const MODEL_DB = "avion.models.v1";

function clearStorage(s: Storage) {
  const keys: string[] = [];
  for (let i = 0; i < s.length; i++) {
    const k = s.key(i);
    if (k && OURS.test(k)) keys.push(k);
  }
  for (const k of keys) s.removeItem(k);
}

function deleteDb(name: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.deleteDatabase(name);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Removes the app's keys from localStorage and sessionStorage, synchronously. */
export function clearStoredKeys() {
  for (const s of [() => localStorage, () => sessionStorage]) {
    try {
      clearStorage(s());
    } catch {
      /* storage unavailable: nothing kept there */
    }
  }
}

/**
 * Removes every piece of data the app keeps in this browser, then reloads.
 * The stores still in memory would write their state back on their next
 * change, so the keys are cleared once more as the page goes away.
 */
export async function resetAppData(): Promise<void> {
  window.addEventListener("pagehide", clearStoredKeys);
  clearStoredKeys();
  if (typeof indexedDB !== "undefined") await deleteDb(MODEL_DB);
  if (typeof caches !== "undefined") {
    try {
      for (const name of await caches.keys()) if (OURS.test(name)) await caches.delete(name);
    } catch {
      /* no cache storage */
    }
  }
}
