/*
  Stores the raw bytes of an imported model, keyed by vehicle-profile id, in
  IndexedDB so the model survives a page reload. localStorage can't hold a
  multi-megabyte assembly, so only the small descriptor (name, orientation,
  scale) lives on the profile; the bytes live here.
*/

const DB = "avion.models.v1"; // also named in state/resetApp.ts
const STORE = "files";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
    t.oncomplete = () => db.close();
  });
}

export interface StoredModel {
  bytes: ArrayBuffer;
  filename: string;
}

export const putModel = (profileId: string, m: StoredModel) => tx<void>("readwrite", (s) => s.put(m, profileId));
export const getModel = (profileId: string) => tx<StoredModel | undefined>("readonly", (s) => s.get(profileId));
export const deleteModel = (profileId: string) => tx<void>("readwrite", (s) => s.delete(profileId));

export const idbAvailable = () => typeof indexedDB !== "undefined";
