import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { PRESETS, type Airframe } from "../sim/airframe";
import { CMD, type Home, type MissionItem } from "../sim/autopilot";

/* What the simulator flies and where, and the mission being planned. Kept in
   this browser, so a plan survives a reload. */

export interface PlanPoint {
  id: string;
  /** Metres north and east of home. */
  n: number;
  e: number;
  alt: number;
  /** Seconds to wait there. */
  holdS: number;
}

export type Ending = "rtl" | "land" | "hold";

interface SimState {
  airframe: Airframe;
  home: Home;
  /** Battery at the start, 0–1. */
  soc: number;
  /** Start from the parameters last read from a real aircraft, where there are any. */
  useAircraftParams: boolean;
  takeoffAlt: number;
  points: PlanPoint[];
  ending: Ending;
  set: <K extends keyof Omit<SimState, "set" | "addPoint" | "updatePoint" | "removePoint" | "clearPoints">>(k: K, v: SimState[K]) => void;
  addPoint: (n: number, e: number) => void;
  updatePoint: (id: string, patch: Partial<PlanPoint>) => void;
  removePoint: (id: string) => void;
  clearPoints: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 9);

export const useSim = create<SimState>()(
  persist(
    (set) => ({
      airframe: PRESETS[0],
      home: { lat: 23.0225, lon: 72.5714, altMsl: 53 },
      soc: 1,
      useAircraftParams: true,
      takeoffAlt: 20,
      points: [],
      ending: "rtl",
      set: (k, v) => set({ [k]: v } as Partial<SimState>),
      addPoint: (n, e) => set((s) => ({ points: [...s.points, { id: uid(), n: Math.round(n), e: Math.round(e), alt: s.points.at(-1)?.alt ?? s.takeoffAlt, holdS: 0 }] })),
      updatePoint: (id, patch) => set((s) => ({ points: s.points.map((p) => (p.id === id ? { ...p, ...patch } : p)) })),
      removePoint: (id) => set((s) => ({ points: s.points.filter((p) => p.id !== id) })),
      clearPoints: () => set({ points: [] }),
    }),
    { name: "aeronex.sim.v1", storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

const M_PER_DEG = 111319.5;

/**
 * The plan as MAVLink mission items.
 *
 * Item 0 is home, as ArduPilot expects; then a take-off, the waypoints, and
 * the ending. Altitudes are relative to home (frame 3).
 */
export function planToMission(home: Home, takeoffAlt: number, points: PlanPoint[], ending: Ending): MissionItem[] {
  const ll = (n: number, e: number) => ({
    x: Math.round((home.lat + n / M_PER_DEG) * 1e7),
    y: Math.round((home.lon + e / (M_PER_DEG * Math.cos((home.lat * Math.PI) / 180))) * 1e7),
  });
  const z = { p1: 0, p2: 0, p3: 0, p4: 0 };
  const items: MissionItem[] = [
    { seq: 0, frame: 0, command: CMD.WAYPOINT, ...z, ...ll(0, 0), z: home.altMsl },
    { seq: 1, frame: 3, command: CMD.TAKEOFF, ...z, x: 0, y: 0, z: takeoffAlt },
  ];
  for (const p of points) items.push({ seq: items.length, frame: 3, command: CMD.WAYPOINT, ...z, p1: p.holdS, ...ll(p.n, p.e), z: p.alt });
  if (ending === "rtl") items.push({ seq: items.length, frame: 3, command: CMD.RTL, ...z, x: 0, y: 0, z: 0 });
  if (ending === "land") items.push({ seq: items.length, frame: 3, command: CMD.LAND, ...z, x: 0, y: 0, z: 0 });
  return items;
}

/** Length of the route over the ground, including the leg home, in metres. */
export function routeLength(points: PlanPoint[], ending: Ending): number {
  let d = 0;
  let at = { n: 0, e: 0 };
  for (const p of points) {
    d += Math.hypot(p.n - at.n, p.e - at.e);
    at = p;
  }
  if (ending === "rtl") d += Math.hypot(at.n, at.e);
  return d;
}
