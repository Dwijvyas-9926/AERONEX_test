import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { onRememberChange, secretSplitStorage } from "./secretStorage";
import { covers, loadDem, realTerrain, type DemPatch } from "../geo/elevation";
import { tileUrl, type LatLon } from "../geo/geo";
import { ELEVATION, type KeyKind } from "../geo/sources";
import { loadTilePixels } from "../geo/tileCache";
import type { Terrain } from "../sim/terrain";

/* How the real map is shown, kept in this browser. Provider keys go nowhere
   but to the provider they belong to, and are kept for this session unless
   the user chooses to have keys remembered (secretStorage). */
interface MapPrefs {
  imagery: string;
  keys: Partial<Record<KeyKind, string>>;
  customUrl: string;
  /** Tilt the map and raise the ground. */
  relief3d: boolean;
  /** Shade the slopes on the flat map. */
  shading: boolean;
  set: <K extends keyof Omit<MapPrefs, "set">>(k: K, v: MapPrefs[K]) => void;
}

export const useMapPrefs = create<MapPrefs>()(
  persist(
    (set) => ({
      imagery: "s2-2016",
      keys: {},
      customUrl: "",
      relief3d: false,
      shading: true,
      set: (k, v) => set({ [k]: v } as Partial<MapPrefs>),
    }),
    { name: "aeronex.map.v1", storage: createJSONStorage(() => secretSplitStorage(["keys"])), version: 1 },
  ),
);
onRememberChange(() => useMapPrefs.setState({}));

/* The real ground around home, once loaded. Not kept across reloads: the
   tiles it is built from are, so building it again needs no network. */
interface DemState {
  patch: DemPatch | null;
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
}

export const useDem = create<DemState>(() => ({ patch: null, status: "idle", error: null }));

let pending: { home: LatLon; half: number; job: Promise<DemPatch> } | null = null;

/**
 * Makes sure the ground around `home` is loaded out to `half` metres.
 * Asking again for what is loaded, or loading, costs nothing.
 */
export function ensureDem(home: LatLon, half: number): Promise<DemPatch> {
  const have = useDem.getState().patch;
  if (covers(have, home, half)) return Promise.resolve(have);
  if (pending && Math.abs(pending.home.lat - home.lat) < 1e-5 && Math.abs(pending.home.lon - home.lon) < 1e-5 && pending.half >= half) return pending.job;
  useDem.setState({ status: "loading", error: null });
  const mine = { home: { lat: home.lat, lon: home.lon }, half, job: null as unknown as Promise<DemPatch> };
  mine.job = loadDem(home, half, (z, x, y) => loadTilePixels(tileUrl(ELEVATION.url, { z, x, y }))).then(
    (patch) => {
      // A later request may have overtaken this one.
      if (pending === mine) {
        pending = null;
        useDem.setState({ patch, status: "ready", error: null });
      }
      return patch;
    },
    (err: Error) => {
      if (pending === mine) {
        pending = null;
        useDem.setState({ status: "error", error: navigator.onLine === false ? "There is no internet, and this area has not been saved." : err instanceof TypeError ? "The elevation server could not be reached. Check the internet connection." : err.message || "The elevation data did not arrive." });
      }
      throw err;
    },
  );
  pending = mine;
  return mine.job;
}

/** How far the ground must reach to cover a plan whose farthest point is this far out. */
export const demReach = (farthest: number) => Math.min(15000, Math.max(2000, Math.ceil((farthest + 800) / 1000) * 1000));

/** The real landscape at home for the simulator, or null if it cannot be had. */
export async function realTerrainAt(home: LatLon, half = 3000): Promise<Terrain | null> {
  try {
    return realTerrain(await ensureDem(home, half));
  } catch {
    return null;
  }
}
