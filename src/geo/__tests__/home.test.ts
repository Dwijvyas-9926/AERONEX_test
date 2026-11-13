import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Toasts set a timer on the window; there is none here.
vi.stubGlobal("window", globalThis);
import { aircraftHome, startHomeFollow, useHomeSource, type AircraftView } from "../../services/link/homeFollow";
import { useLink } from "../../state/linkStore";
import { forgetHistory, useSim } from "../../state/simStore";
import { distanceM, toGlobal } from "../geo";

const DESK = { lat: 23.0225, lon: 72.5714, altMsl: 53 };
const FIELD = { lat: 22.2987, lon: 73.2268 };
const view = (over: Partial<AircraftView>): AircraftView => ({ connected: true, virtual: false, armed: false, fix: 3, position: FIELD, home: null, ...over });

describe("where the aircraft's home is", () => {
  it("is the aircraft's own report when there is one", () => {
    const reported = { lat: 22.3, lon: 73.2, altMsl: 40 };
    expect(aircraftHome(view({ home: reported }), null).home).toEqual(reported);
  });

  it("is where the GPS first had a position, until the aircraft says otherwise", () => {
    const a = aircraftHome(view({}), null);
    expect(a.home).toEqual(FIELD);
    // The aircraft is carried 50 m: home does not go with it.
    const b = aircraftHome(view({ position: toGlobal(FIELD, 50, 0) }), a.first);
    expect(b.home).toEqual(FIELD);
  });

  it("waits for a real 3D position", () => {
    expect(aircraftHome(view({ fix: 2 }), null).home).toBeNull();
    expect(aircraftHome(view({ fix: null }), null).home).toBeNull();
    expect(aircraftHome(view({ position: { lat: 0, lon: 0 } }), null).home).toBeNull();
    expect(aircraftHome(view({ position: null }), null).home).toBeNull();
  });

  it("assumes nothing about an aircraft that is already armed", () => {
    expect(aircraftHome(view({ armed: true }), null).home).toBeNull();
  });

  it("never follows the virtual aircraft, or nothing at all", () => {
    expect(aircraftHome(view({ virtual: true }), FIELD)).toEqual({ home: null, first: null });
    expect(aircraftHome(view({ connected: false }), FIELD)).toEqual({ home: null, first: null });
  });

  it("ignores a report of nowhere", () => {
    expect(aircraftHome(view({ home: { lat: 0, lon: 0, altMsl: 0 } }), null).home).toEqual(FIELD);
  });
});

describe("home follows a linked aircraft", () => {
  const link = (over: { virtual?: boolean; armed?: boolean; fix?: number; at?: { lat: number; lon: number } | null; home?: { lat: number; lon: number; altMsl: number } | null; status?: string }) => {
    const at = over.at === undefined ? FIELD : over.at;
    useLink.setState({
      status: (over.status ?? "connected") as never,
      virtual: over.virtual ?? false,
      vehicle: { sysid: 1, compid: 1, armed: over.armed ?? false } as never,
      telemetry: {
        gps: { at: 0, value: { fixType: over.fix ?? 3, satellites: 12, hdop: 0.8 } },
        ...(at ? { position: { at: 0, value: { lat: at.lat, lon: at.lon, altMsl: 40, altRel: 0, heading: 0 } } } : {}),
        ...(over.home ? { home: { at: 0, value: over.home } } : {}),
      } as never,
    });
  };
  beforeAll(() => startHomeFollow());
  beforeEach(() => {
    useLink.setState({ status: "disconnected" as never, virtual: false, telemetry: {} as never });
    useSim.setState({ home: DESK, points: [], takeoffAlt: 20, ending: "rtl" });
    forgetHistory();
  });

  it("stays where it was put while nothing is linked", () => {
    expect(useHomeSource.getState().source).toBe("you");
    expect(useSim.getState().home).toEqual(DESK);
  });

  it("goes to the aircraft when its GPS has a position, and is not a step to undo", () => {
    link({ fix: 1 });
    expect(useHomeSource.getState().source).toBe("waiting");
    expect(useSim.getState().home).toEqual(DESK);
    link({});
    expect(useHomeSource.getState().source).toBe("aircraft");
    expect(distanceM(useSim.getState().home, FIELD)).toBeLessThan(0.5);
    expect(useSim.getState().canUndo).toBe(false);
  });

  it("leaves the waypoints where they are on the ground", () => {
    useSim.setState({ home: { ...FIELD, altMsl: 35 } });
    useSim.getState().addPoint(200, 100);
    const where = toGlobal(FIELD, 200, 100);
    link({ at: toGlobal(FIELD, 60, -40) });
    const s = useSim.getState();
    expect(distanceM(toGlobal(s.home, s.points[0].n, s.points[0].e), where)).toBeLessThan(1.5);
    expect(s.points[0].n).toBe(140);
  });

  it("does not chase GPS wander, but follows the aircraft's own home when it arms somewhere else", () => {
    link({});
    const before = useSim.getState().home;
    link({ at: toGlobal(FIELD, 1.5, 1) });
    expect(useSim.getState().home).toEqual(before);
    const armedAt = { ...toGlobal(FIELD, 25, 10), altMsl: 41 };
    link({ armed: true, at: toGlobal(FIELD, 80, 80), home: armedAt });
    expect(distanceM(useSim.getState().home, armedAt)).toBeLessThan(0.5);
    expect(useSim.getState().home.altMsl).toBe(41);
  });

  it("does not follow the virtual aircraft, and lets go when the aircraft is unlinked", () => {
    link({ virtual: true });
    expect(useHomeSource.getState().source).toBe("you");
    expect(useSim.getState().home).toEqual(DESK);
    link({});
    expect(useHomeSource.getState().source).toBe("aircraft");
    link({ status: "disconnected" });
    expect(useHomeSource.getState().source).toBe("you");
    // Home stays at the field: that is where the plan now is.
    expect(distanceM(useSim.getState().home, FIELD)).toBeLessThan(0.5);
  });
});
