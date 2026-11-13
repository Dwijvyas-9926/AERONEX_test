import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decode, MavlinkParser } from "../../mavlink/parser";
import { commandLink, compareMissions } from "../../services/link/commandLink";
import { PRESETS } from "../../sim/airframe";
import type { MissionItem } from "../../sim/autopilot";
import { defaultParams } from "../../sim/params";
import { VirtualVehicle } from "../../sim/vehicle";
import { useLink } from "../../state/linkStore";
import { forgetHistory, missionToPlan, planToMission, useSim, type PlanPoint } from "../../state/simStore";
import { toGlobal } from "../geo";
import { checkPlan, flightSeconds, hoverMinutes } from "../planCheck";
import { fromWaypointFile, toWaypointFile } from "../planFile";
import { routeProfile } from "../profile";

const HOME = { lat: 23.0225, lon: 72.5714, altMsl: 53 };
const pt = (n: number, e: number, alt = 30, holdS = 0, id = `${n}/${e}`): PlanPoint => ({ id, n, e, alt, holdS });
const item = (seq: number, command: number, n: number, e: number, z: number, frame = 3, p1 = 0): MissionItem => {
  const g = n || e ? toGlobal(HOME, n, e) : { lat: 0, lon: 0 };
  return { seq, frame, command, p1, p2: 0, p3: 0, p4: 0, x: Math.round(g.lat * 1e7), y: Math.round(g.lon * 1e7), z };
};
const homeItem: MissionItem = { seq: 0, frame: 0, command: 16, p1: 0, p2: 0, p3: 0, p4: 0, x: Math.round(HOME.lat * 1e7), y: Math.round(HOME.lon * 1e7), z: 53 };

describe("reading a mission back into a plan", () => {
  it("gives back the plan that made it", () => {
    for (const ending of ["rtl", "land", "hold"] as const) {
      const pts = [pt(300, 100, 30, 0), pt(350, -250, 40, 5), pt(-100, -200, 25, 0)];
      const back = missionToPlan(planToMission(HOME, 18, pts, ending), { lat: 0, lon: 0, altMsl: 0 });
      expect(back.notes).toEqual([]);
      expect(back.home).toEqual(HOME);
      expect(back.takeoffAlt).toBe(18);
      expect(back.ending).toBe(ending);
      expect(back.points.map((p) => [p.n, p.e, p.alt, p.holdS])).toEqual(pts.map((p) => [p.n, p.e, p.alt, p.holdS]));
    }
  });

  it("names what it cannot show instead of dropping it quietly", () => {
    const m = [homeItem, item(1, 22, 0, 0, 20), item(2, 178, 0, 0, 0), item(3, 16, 200, 0, 30), item(4, 201, 0, 0, 0), item(5, 178, 0, 0, 0), item(6, 20, 0, 0, 0)];
    const back = missionToPlan(m, HOME);
    expect(back.points).toHaveLength(1);
    expect(back.ending).toBe("rtl");
    expect(back.notes).toHaveLength(1);
    expect(back.notes[0]).toContain("3 commands were left out");
    expect(back.notes[0]).toContain("change speed (2)");
    expect(back.notes[0]).toContain("region of interest");
  });

  it("turns heights above sea level into heights above home, and says so", () => {
    const back = missionToPlan([homeItem, item(1, 22, 0, 0, 20), item(2, 16, 200, 0, 93, 0), item(3, 20, 0, 0, 0)], HOME);
    expect(back.points[0].alt).toBe(40);
    expect(back.notes.join(" ")).toContain("above sea level");
  });

  it("warns that heights above the ground are not heights above home", () => {
    const back = missionToPlan([homeItem, item(1, 22, 0, 0, 20), item(2, 16, 200, 0, 60, 10), item(3, 20, 0, 0, 0)], HOME);
    expect(back.points[0].alt).toBe(60);
    expect(back.notes.join(" ")).toContain("above the ground");
  });

  it("keeps a timed loiter as a wait and a landing elsewhere as a flight there", () => {
    const back = missionToPlan([homeItem, item(1, 22, 0, 0, 20), item(2, 19, 100, 0, 30, 3, 12), item(3, 21, 100, 150, 0)], HOME);
    expect(back.points.map((p) => [p.n, p.e, p.alt, p.holdS])).toEqual([[100, 0, 30, 12], [100, 150, 30, 0]]);
    expect(back.ending).toBe("land");
  });

  it("copes with nothing, and with a mission that never says where home is", () => {
    expect(missionToPlan([], HOME)).toMatchObject({ home: null, points: [], ending: "rtl" });
    const noHome = missionToPlan([{ ...homeItem, x: 0, y: 0 }, item(1, 22, 0, 0, 15), item(2, 16, 80, 60, 20)], HOME);
    expect(noHome.home).toBeNull();
    expect(noHome.points[0]).toMatchObject({ n: 80, e: 60 });
    expect(noHome.ending).toBe("hold");
  });
});

describe("plan files", () => {
  it("writes the format other ground stations read", () => {
    const text = toWaypointFile(planToMission(HOME, 20, [pt(300, 100, 30, 5)], "rtl"));
    const lines = text.trim().split("\n");
    expect(lines[0]).toBe("QGC WPL 110");
    expect(lines).toHaveLength(5);
    expect(lines[1].split("\t")).toEqual(["0", "1", "0", "16", "0", "0", "0", "0", "23.0225000", "72.5714000", "53", "1"]);
    expect(lines[2].split("\t").slice(0, 4)).toEqual(["1", "0", "3", "22"]);
    expect(lines[3].split("\t")[4]).toBe("5");
  });

  it("comes back as the same plan", () => {
    const pts = [pt(300, 100, 30, 5), pt(-420, 615, 47.5, 0)];
    const back = missionToPlan(fromWaypointFile(toWaypointFile(planToMission(HOME, 20, pts, "land"))), HOME);
    expect(back.points.map((p) => [p.n, p.e, p.alt, p.holdS])).toEqual(pts.map((p) => [p.n, p.e, p.alt, p.holdS]));
    expect(back.ending).toBe("land");
    expect(back.takeoffAlt).toBe(20);
  });

  it("reads a file from Mission Planner, spaces, Windows line ends and all", () => {
    const text = "QGC WPL 110\r\n0\t1\t0\t16\t0\t0\t0\t0\t22.2987200\t73.2267900\t35.000000\t1\r\n1 0 3 22 0.0 0.0 0.0 0.0 0.0 0.0 10.0 1\r\n2\t0\t3\t16\t0\t0\t0\t0\t22.2996000\t73.2280900\t40.000000\t1\r\n3\t0\t3\t20\t0\t0\t0\t0\t0\t0\t0\t1\r\n";
    const back = missionToPlan(fromWaypointFile(text), HOME);
    expect(back.home).toMatchObject({ lat: 22.29872, lon: 73.22679, altMsl: 35 });
    expect(back.takeoffAlt).toBe(10);
    expect(back.points).toHaveLength(1);
    expect(back.points[0].alt).toBe(40);
    expect(back.ending).toBe("rtl");
  });

  it("says what is wrong with a file it cannot read", () => {
    expect(() => fromWaypointFile("hello")).toThrow(/not a waypoint file/);
    expect(() => fromWaypointFile('{"fileType":"Plan"}')).toThrow(/QGroundControl .plan/);
    expect(() => fromWaypointFile("QGC WPL 110\n0\t1\t0\t16\tx\t0\t0\t0\t1\t2\t3\t1")).toThrow(/Line 2/);
    expect(() => fromWaypointFile("QGC WPL 110\n0\t1\t0\t16\t0\t0\t0\t0\t123\t2\t3\t1")).toThrow(/not on the Earth/);
    expect(() => fromWaypointFile("QGC WPL 110\n")).toThrow(/no mission items/);
  });
});

describe("undo", () => {
  beforeEach(() => {
    useSim.setState({ points: [], takeoffAlt: 20, ending: "rtl", home: HOME });
    forgetHistory();
  });

  it("steps back and forward through changes to the plan", () => {
    const s = () => useSim.getState();
    s().addPoint(100, 0);
    s().addPoint(200, 50);
    s().set("ending", "land");
    expect(s().canUndo).toBe(true);
    s().undo();
    expect(s().ending).toBe("rtl");
    s().undo();
    expect(s().points).toHaveLength(1);
    s().redo();
    expect(s().points).toHaveLength(2);
    s().redo();
    expect(s().ending).toBe("land");
    expect(s().canRedo).toBe(false);
  });

  it("treats typing in one box as one step", () => {
    const s = () => useSim.getState();
    s().addPoint(100, 0);
    const id = s().points[0].id;
    s().updatePoint(id, { alt: 1 });
    s().updatePoint(id, { alt: 12 });
    s().updatePoint(id, { alt: 120 });
    s().undo();
    expect(s().points[0].alt).toBe(20);
  });

  it("puts back a cleared plan and a moved home, waypoints and all", () => {
    const s = () => useSim.getState();
    s().addPoint(500, 200);
    s().moveHome(toGlobal(HOME, 100, 0));
    expect(s().points[0].n).toBe(400);
    s().undo();
    expect(s().home).toEqual(HOME);
    expect(s().points[0].n).toBe(500);
    s().clearPoints();
    expect(s().points).toHaveLength(0);
    s().undo();
    expect(s().points).toHaveLength(1);
  });

  it("reorders and levels waypoints", () => {
    const s = () => useSim.getState();
    s().loadPlan({ takeoffAlt: 10, ending: "rtl", points: [pt(1, 0, 10, 0, "a"), pt(2, 0, 20, 0, "b"), pt(3, 0, 30, 0, "c")] });
    s().shiftPoint("c", -1);
    expect(s().points.map((p) => p.id)).toEqual(["a", "c", "b"]);
    s().shiftPoint("a", -1);
    expect(s().points.map((p) => p.id)).toEqual(["a", "c", "b"]);
    s().setAllHeights(45);
    expect(s().points.every((p) => p.alt === 45)).toBe(true);
    s().undo();
    expect(s().points.map((p) => p.alt)).toEqual([10, 30, 20]);
  });
});

describe("plan check", () => {
  const af = PRESETS[0];
  const P = defaultParams(af);
  const check = (points: PlanPoint[], over: Partial<Parameters<typeof checkPlan>[0]> = {}, ground: (n: number, e: number) => number = () => 0) => {
    const base = { points, takeoffAlt: 20, ending: "rtl" as const, params: P, airframe: af, groundKnown: true, real: false, groundReach: null, ...over };
    return checkPlan({ ...base, profile: routeProfile(points, base.takeoffAlt, base.ending, base.params.RTL_ALT / 100, ground) });
  };
  const has = (items: { sev: string; text: string }[], sev: string, re: RegExp) => items.some((i) => i.sev === sev && re.test(i.text));

  it("says nothing about an empty plan", () => {
    expect(check([])).toEqual([]);
  });

  it("flags a route through the ground and one close to it", () => {
    const ridge = (_n: number, e: number) => 60 * Math.exp(-((e - 300) ** 2) / 3200);
    expect(has(check([pt(0, 100), pt(0, 500)], {}, ridge), "bad", /below the ground/)).toBe(true);
    expect(has(check([pt(0, 100, 70), pt(0, 500, 70)], {}, ridge), "warn", /within 1\d m of the ground/)).toBe(true);
  });

  it("flags waypoints outside an enabled fence, and not a disabled one", () => {
    const fenced = { ...P, FENCE_ENABLE: 1, FENCE_TYPE: 3, FENCE_RADIUS: 300, FENCE_ALT_MAX: 100 };
    const r = check([pt(400, 0, 120)], { params: fenced });
    expect(has(r, "bad", /outside the 300 m fence/)).toBe(true);
    expect(has(r, "bad", /fence ceiling/)).toBe(true);
    expect(check([pt(400, 0, 120)]).some((i) => /fence/.test(i.text))).toBe(false);
  });

  it("compares the flight time with what the battery can give", () => {
    const mins = hoverMinutes(af);
    expect(mins).toBeGreaterThan(8);
    expect(mins).toBeLessThan(30);
    const long = [pt(0, mins * 60 * 10 * 0.6)];
    expect(has(check(long), "bad", /cannot finish/)).toBe(true);
    const tight = [pt(0, mins * 60 * 10 * 0.4)];
    expect(has(check(tight), "warn", /leaves little/)).toBe(true);
    expect(flightSeconds({ points: [pt(0, 1000, 20, 30)], takeoffAlt: 20, ending: "rtl", params: P, profile: routeProfile([pt(0, 1000, 20, 30)], 20, "rtl", 15, () => 0) })).toBeGreaterThan(230);
  });

  it("points out a route beyond the loaded ground", () => {
    const r = check([pt(20000, 0)], { real: true, groundReach: 15000 });
    expect(has(r, "bad", /only loaded out to 15.0 km/)).toBe(true);
    expect(r.some((i) => /below the ground|within/.test(i.text))).toBe(false);
  });

  it("mentions height limits, sight, a hover ending and a missing battery failsafe", () => {
    const r = check([pt(800, 0, 150)], { ending: "hold", params: { ...P, BATT_FS_LOW_ACT: 0 } });
    expect(has(r, "warn", /120 m/)).toBe(true);
    expect(has(r, "note", /hard to see/)).toBe(true);
    expect(has(r, "warn", /Nothing lands/)).toBe(true);
    expect(has(r, "warn", /low-battery failsafe/)).toBe(true);
    const safe = check([pt(100, 0)], { params: { ...P, BATT_FS_LOW_ACT: 2, BATT_LOW_VOLT: 10.5 } });
    expect(safe.some((i) => /failsafe/.test(i.text))).toBe(false);
  });
});

describe("mission transfer over a poor link", () => {
  /** The app's command link wired to a virtual aircraft, with a link that loses messages. */
  function wire(lose: { toVehicle: (n: number) => boolean; toApp: (name: string, n: number) => boolean }) {
    const v = new VirtualVehicle({ airframe: PRESETS[0], home: HOME });
    const parser = new MavlinkParser();
    let sent = 0;
    const seen: Record<string, number> = {};
    useLink.setState({ vehicle: { sysid: 1, compid: 1 } as never });
    commandLink.attach(async (bytes) => {
      if (!lose.toVehicle(sent++)) v.receive(bytes);
    });
    const tick = () => {
      v.advance(0.02, 0.02);
      for (const f of parser.push(v.drain())) {
        if (!f.name.startsWith("MISSION_")) continue;
        seen[f.name] = (seen[f.name] ?? 0) + 1;
        if (lose.toApp(f.name, seen[f.name])) continue;
        commandLink.handle(f.name, decode(f)!);
      }
    };
    const run = async <T>(job: Promise<T>): Promise<T> => {
      let done = false;
      const settled = job.finally(() => (done = true));
      settled.catch(() => undefined);
      for (let i = 0; i < 3000 && !done; i++) {
        tick();
        await vi.advanceTimersByTimeAsync(20);
      }
      return settled;
    };
    return { v, run };
  }
  const mission = planToMission(HOME, 20, [pt(300, 100, 30, 5), pt(350, -250, 40), pt(-100, -200, 30)], "rtl");

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    commandLink.detach();
    vi.useRealTimers();
  });

  it("sends and reads back on a clean link", async () => {
    const w = wire({ toVehicle: () => false, toApp: () => false });
    await w.run(commandLink.uploadMission(mission));
    expect(w.v.ap.mission).toHaveLength(mission.length);
    expect(await w.run(commandLink.verifyMission(mission))).toBeNull();
  });

  it("reads the whole mission when every third answer is lost", async () => {
    const w = wire({ toVehicle: () => false, toApp: () => false });
    await w.run(commandLink.uploadMission(mission));
    const lossy = wire({ toVehicle: () => false, toApp: (name, n) => name === "MISSION_ITEM_INT" && n % 3 === 1 });
    lossy.v.ap.mission = w.v.ap.mission;
    const got = await lossy.run(commandLink.downloadMission());
    expect(got).toHaveLength(mission.length);
    expect(compareMissions(mission, got)).toBeNull();
  });

  it("reads the mission when the first request never arrives", async () => {
    const w = wire({ toVehicle: (n) => n === 0, toApp: () => false });
    w.v.ap.mission = mission;
    expect(await w.run(commandLink.downloadMission())).toHaveLength(mission.length);
  });

  it("gives up, and says where, when the aircraft goes silent", async () => {
    const w = wire({ toVehicle: () => false, toApp: (name, n) => name === "MISSION_ITEM_INT" && n >= 3 });
    w.v.ap.mission = mission;
    await expect(w.run(commandLink.downloadMission())).rejects.toThrow(/stopped answering at item 2 of 6/);
  });

  it("notices when the aircraft holds something other than what was sent", () => {
    const got = mission.map((m) => ({ ...m }));
    expect(compareMissions(mission, got)).toBeNull();
    got[3] = { ...got[3], z: 12 };
    expect(compareMissions(mission, got)).toMatch(/Command 3 was sent with a height of 40 m and reads back as 12 m/);
    expect(compareMissions(mission, got.slice(0, 4))).toMatch(/5 commands were sent and the aircraft holds 3/);
    // Home is the aircraft's own business.
    const moved = mission.map((m, i) => (i === 0 ? { ...m, x: m.x + 5000 } : m));
    expect(compareMissions(mission, moved)).toBeNull();
  });
});

describe("the plan saved in the browser", () => {
  it("comes back after a reload, and a damaged one is repaired, not fatal", async () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
    store.set("aeronex.sim.v1", JSON.stringify({ state: { terrain: "real", takeoffAlt: 35, ending: "land", points: [{ id: "a", n: 300, e: 100, alt: 30, holdS: 0 }] }, version: 2 }));
    vi.resetModules();
    const fresh = (await import("../../state/simStore")).useSim.getState();
    expect(fresh.terrain).toBe("real");
    expect(fresh.takeoffAlt).toBe(35);
    expect(fresh.ending).toBe("land");
    expect(fresh.points).toHaveLength(1);
    expect(fresh.canUndo).toBe(false);

    store.set("aeronex.sim.v1", JSON.stringify({ state: { home: { lat: "x" }, points: [{ n: "a" }, null, { id: "k", n: 10, e: 10 }], airframe: { massKg: 0 }, takeoffAlt: null, terrain: "moon", ending: 7 }, version: 2 }));
    vi.resetModules();
    const mended = (await import("../../state/simStore")).useSim.getState();
    expect(mended.home.lat).toBeCloseTo(23.0225);
    expect(mended.points).toEqual([{ id: "k", n: 10, e: 10, alt: 20, holdS: 0 }]);
    expect(mended.airframe.massKg).toBeGreaterThan(0);
    expect(mended.takeoffAlt).toBe(20);
    expect(mended.terrain).toBe("hills");
    expect(mended.ending).toBe("rtl");
    vi.unstubAllGlobals();
  });
});
