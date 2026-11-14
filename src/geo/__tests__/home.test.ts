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
      vehicle: { sysid: 1, compid: 1, autopilot: 3, type: 2, armed: over.armed ?? false } as never,
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

describe("no mission for a real aircraft without a GPS position", () => {
  const gps = (fixType: number | null, virtual = false, satellites: number | null = 5, age = 0) =>
    useLink.setState({ status: "connected" as never, virtual, vehicle: { sysid: 1, compid: 1, autopilot: 3, type: 2, armed: false } as never, telemetry: (fixType === null ? {} : { gps: { at: Date.now() - age, value: { fixType, satellites, hdop: 2 } } }) as never });
  const mission = [{ seq: 0, frame: 0, command: 16, p1: 0, p2: 0, p3: 0, p4: 0, x: 1, y: 1, z: 0 }];

  it("asks for a GPS when none reports, and for patience when it has no fix", async () => {
    const { missionBlock } = await import("../../services/link/commandLink");
    gps(null);
    expect(missionBlock()?.title).toBe("Connect a GPS to fly a mission");
    gps(0);
    expect(missionBlock()?.title).toBe("Connect a GPS to fly a mission");
    gps(1);
    expect(missionBlock()?.title).toBe("Waiting for a GPS fix");
    gps(2, false, 1);
    expect(missionBlock()?.body).toContain("1 satellite so far");
    gps(3);
    expect(missionBlock()).toBeNull();
    gps(6);
    expect(missionBlock()).toBeNull();
    // A good fix that stopped arriving ten seconds ago is a GPS that has gone.
    gps(3, false, 12, 10000);
    expect(missionBlock()?.title).toBe("Connect a GPS to fly a mission");
  });

  it("lets the virtual aircraft fly without one, and says nothing when nothing is linked", async () => {
    const { missionBlock } = await import("../../services/link/commandLink");
    gps(0, true);
    expect(missionBlock()).toBeNull();
    useLink.setState({ status: "disconnected" as never, virtual: false });
    expect(missionBlock()).toBeNull();
  });

  it("refuses to send or start, whichever page asks", async () => {
    const { commandLink } = await import("../../services/link/commandLink");
    let wrote = 0;
    commandLink.attach(async () => void wrote++);
    gps(1);
    await expect(commandLink.uploadMission(mission)).rejects.toThrow(/Waiting for a GPS fix/);
    await expect(commandLink.startMission()).rejects.toThrow(/Waiting for a GPS fix/);
    gps(null);
    await expect(commandLink.uploadMission(mission)).rejects.toThrow(/Connect a GPS/);
    expect(wrote).toBe(0);
    commandLink.detach();
  });
});

describe("an armed real aircraft keeps its mission", () => {
  const set = (armed: boolean, virtual = false) =>
    useLink.setState({ status: "connected" as never, virtual, vehicle: { sysid: 1, compid: 1, autopilot: 3, type: 2, armed } as never, telemetry: { gps: { at: Date.now(), value: { fixType: 3, satellites: 12, hdop: 1 } } } as never });

  it("refuses a new mission while armed, and writes nothing", async () => {
    const { commandLink, armedBlock } = await import("../../services/link/commandLink");
    let wrote = 0;
    commandLink.attach(async () => void wrote++);
    set(true);
    expect(armedBlock()?.title).toBe("Disarm before changing the mission");
    await expect(commandLink.uploadMission([{ seq: 0, frame: 0, command: 16, p1: 0, p2: 0, p3: 0, p4: 0, x: 1, y: 1, z: 0 }])).rejects.toThrow(/Disarm before changing the mission/);
    expect(wrote).toBe(0);
    set(false);
    expect(armedBlock()).toBeNull();
    // The virtual aircraft is re-tasked in the air by the simulator page.
    set(true, true);
    expect(armedBlock()).toBeNull();
    commandLink.detach();
  });
});

describe("settings from firmware that renamed them", () => {
  it("gives the app its own names and units from ArduCopter 4.7's", async () => {
    const { withOlderNames, usesNewerNames } = await import("../../sim/firmwareParams");
    const v47 = { RTL_ALT_M: 30, WP_SPD: 8, WP_SPD_UP: 2.5, WP_SPD_DN: 1.5, LAND_SPD_MS: 0.5, ATC_ANGLE_MAX: 35, PSC_D_ACC_P: 0.05, PSC_NE_VEL_P: 2, ARMING_SKIPCHK: 0, MAV_SYSID: 1, FENCE_RADIUS: 300 };
    const out = withOlderNames(v47);
    expect(usesNewerNames(v47)).toBe(true);
    expect(out.RTL_ALT).toBe(3000);
    expect(out.WPNAV_SPEED).toBe(800);
    expect(out.WPNAV_SPEED_UP).toBe(250);
    expect(out.WPNAV_SPEED_DN).toBe(150);
    expect(out.LAND_SPEED).toBe(50);
    expect(out.ANGLE_MAX).toBe(3500);
    expect(out.PSC_ACCZ_P).toBeCloseTo(0.5);
    expect(out.PSC_VELXY_P).toBe(2);
    expect(out.ARMING_CHECK).toBe(1);
    expect(withOlderNames({ ARMING_SKIPCHK: -1 }).ARMING_CHECK).toBe(0);
    expect(out.SYSID_THISMAV).toBe(1);
    // Untouched names stay as they are.
    expect(out.FENCE_RADIUS).toBe(300);
    expect(out.RTL_ALT_M).toBe(30);
  });

  it("leaves older firmware exactly as it is", async () => {
    const { withOlderNames, usesNewerNames } = await import("../../sim/firmwareParams");
    const v46 = { RTL_ALT: 1500, WPNAV_SPEED: 1000, ANGLE_MAX: 3000, ARMING_CHECK: 1 };
    expect(withOlderNames(v46)).toEqual(v46);
    expect(usesNewerNames(v46)).toBe(false);
  });

  it("is what the route profile's return height is taken from", async () => {
    const { modelledParams } = await import("../../sim/firmwareParams");
    expect(modelledParams({ RTL_ALT_M: 40, WP_SPD: 6 })).toMatchObject({ RTL_ALT: 4000, WPNAV_SPEED: 600 });
    expect(modelledParams({ RTL_ALT: 2500 })).toMatchObject({ RTL_ALT: 2500 });
  });
});
