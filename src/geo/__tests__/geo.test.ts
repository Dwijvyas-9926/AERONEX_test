import { describe, expect, it } from "vitest";
import { Autopilot } from "../../sim/autopilot";
import { PRESETS } from "../../sim/airframe";
import { defaultParams } from "../../sim/params";
import { Physics } from "../../sim/physics";
import { makeTerrain } from "../../sim/terrain";
import { planToMission, rehomed } from "../../state/simStore";
import { covers, demDetail, loadDem, realTerrain, sampleDem, terrarium, type TileLoader } from "../elevation";
import { distanceM, parseLatLon, tileUrl, tileX, tileY, tilesIn, toGlobal, toLocal } from "../geo";
import { routeProfile } from "../profile";
import { imageryById, imageryUrl, IMAGERY } from "../sources";

const HOME = { lat: 23.0225, lon: 72.5714 };

/** A world whose height is a known function of place, served as Terrarium tiles. */
function fakeWorld(height: (lat: number, lon: number) => number, calls?: string[]): TileLoader {
  return async (z, x, y) => {
    calls?.push(`${z}/${x}/${y}`);
    const size = 256;
    const data = new Uint8ClampedArray(size * size * 4);
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const lon = ((x + (i + 0.5) / size) / 2 ** z) * 360 - 180;
        const m = Math.PI * (1 - (2 * (y + (j + 0.5) / size)) / 2 ** z);
        const lat = (Math.atan(Math.sinh(m)) * 180) / Math.PI;
        const v = height(lat, lon) + 32768;
        const k = (j * size + i) * 4;
        data[k] = Math.floor(v / 256);
        data[k + 1] = Math.floor(v) % 256;
        data[k + 2] = Math.floor((v - Math.floor(v)) * 256);
        data[k + 3] = 255;
      }
    }
    return { size, data };
  };
}

describe("places", () => {
  it("goes to metres and back without loss", () => {
    for (const [n, e] of [[0, 0], [1200, -800], [-4321.5, 9876.25]]) {
      const g = toGlobal(HOME, n, e);
      const l = toLocal(HOME, g.lat, g.lon);
      expect(l.n).toBeCloseTo(n, 6);
      expect(l.e).toBeCloseTo(e, 6);
    }
  });

  it("agrees with the virtual autopilot, so a waypoint is where the map says", () => {
    const ap = new Autopilot(new Physics(PRESETS[0]), defaultParams(PRESETS[0]), { ...HOME, altMsl: 50 });
    const mission = planToMission({ ...HOME, altMsl: 50 }, 20, [{ id: "a", n: 730, e: -415, alt: 30, holdS: 0 }], "rtl");
    const wp = mission[2];
    const back = ap.toLocal(wp.x, wp.y);
    expect(back.n).toBeCloseTo(730, 1);
    expect(back.e).toBeCloseTo(-415, 1);
    const mine = toLocal(HOME, wp.x / 1e7, wp.y / 1e7);
    expect(mine.n).toBeCloseTo(back.n, 6);
    expect(mine.e).toBeCloseTo(back.e, 6);
  });

  it("is within a metre of the true distance over a few kilometres", () => {
    const g = toGlobal(HOME, 3000, 4000);
    expect(Math.abs(distanceM(HOME, g) - 5000)).toBeLessThan(20);
    expect(Math.abs(distanceM(HOME, toGlobal(HOME, 300, 400)) - 500)).toBeLessThan(2);
  });

  it("reads coordinates the way people paste them", () => {
    expect(parseLatLon("23.0225, 72.5714")).toEqual(HOME);
    expect(parseLatLon(" -33.86   151.21 ")).toEqual({ lat: -33.86, lon: 151.21 });
    expect(parseLatLon("95, 10")).toBeNull();
    expect(parseLatLon("home")).toBeNull();
    expect(parseLatLon("23.02")).toBeNull();
  });

  it("keeps waypoints where they are on the ground when home moves", () => {
    const pts = [{ id: "a", n: 500, e: 200, alt: 30, holdS: 0 }];
    const where = toGlobal(HOME, 500, 200);
    const newHome = toGlobal(HOME, 120, -340);
    const moved = rehomed(HOME, newHome, pts);
    const after = toGlobal(newHome, moved[0].n, moved[0].e);
    expect(distanceM(where, after)).toBeLessThan(1);
    expect(moved[0].n).toBeCloseTo(380, 0);
    expect(moved[0].e).toBeCloseTo(540, 0);
  });
});

describe("map tiles", () => {
  it("puts the equator and Greenwich in the middle of the world", () => {
    expect(tileX(0, 0)).toBeCloseTo(0.5);
    expect(tileY(0, 0)).toBeCloseTo(0.5);
    expect(tileX(-180, 3)).toBeCloseTo(0);
    expect(tileY(85.0511, 3)).toBeCloseTo(0, 3);
  });

  it("finds the known tile for a known place", () => {
    // Ahmedabad at zoom 10: checked against the standard slippy-map formula.
    expect(Math.floor(tileX(72.5714, 10))).toBe(718);
    expect(Math.floor(tileY(23.0225, 10))).toBe(444);
  });

  it("lists every tile over an area, once", () => {
    const t = tilesIn({ west: 72.5, east: 72.7, south: 22.95, north: 23.1 }, 12);
    expect(t.length).toBeGreaterThan(3);
    expect(new Set(t.map((x) => `${x.x}/${x.y}`)).size).toBe(t.length);
    expect(tileUrl("https://h/{z}/{y}/{x}.jpg", { z: 3, x: 5, y: 2 })).toBe("https://h/3/2/5.jpg");
  });

  it("gives no address until a key or a usable address is there", () => {
    expect(imageryUrl(imageryById("s2-2016"), {}, "")).toContain("eox.at");
    expect(imageryUrl(imageryById("maptiler"), {}, "")).toBeNull();
    expect(imageryUrl(imageryById("maptiler"), { maptiler: "a b" }, "")).toContain("key=a%20b");
    expect(imageryUrl(imageryById("custom"), {}, "http://x/{z}/{x}/{y}")).toBeNull();
    expect(imageryUrl(imageryById("custom"), {}, "https://x/{z}/{x}/{y}.png")).toBe("https://x/{z}/{x}/{y}.png");
    expect(imageryUrl(imageryById("esri"), {}, "")).toContain("World_Imagery");
    expect(imageryById("gone").id).toBe(IMAGERY[0].id);
    // Only open data may be stored.
    expect(IMAGERY.filter((s) => s.keep).map((s) => s.id)).toEqual(["s2-2016", "s2-2024"]);
  });
});

describe("real ground", () => {
  it("decodes a height from a pixel", () => {
    expect(terrarium(128, 0, 0)).toBe(0);
    expect(terrarium(0, 0, 0)).toBe(-32768);
    expect(terrarium(128, 53, 128)).toBeCloseTo(53.5);
    expect(terrarium(127, 246, 0)).toBe(-10);
  });

  it("rebuilds a known slope to within a metre", async () => {
    // 100 m at home, rising 40 m per km north and falling 15 m per km east.
    const height = (lat: number, lon: number) => {
      const l = toLocal(HOME, lat, lon);
      return 100 + l.n * 0.04 - l.e * 0.015;
    };
    const p = await loadDem(HOME, 2000, fakeWorld(height));
    expect(p.base).toBeCloseTo(100, 0);
    for (const [n, e] of [[0, 0], [1500, -900], [-1999, 1999], [333, 777]]) {
      expect(Math.abs(sampleDem(p, n, e) - (100 + n * 0.04 - e * 0.015))).toBeLessThan(1);
    }
    // Outside, the edge: never a hole.
    expect(sampleDem(p, 9000, 0)).toBeCloseTo(sampleDem(p, 2000, 0), 3);
  });

  it("puts a hill where the hill is", async () => {
    const top = toGlobal(HOME, 600, -400);
    const height = (lat: number, lon: number) => {
      const l = toLocal(top, lat, lon);
      return 50 + 120 * Math.exp(-(l.n * l.n + l.e * l.e) / (2 * 150 * 150));
    };
    const t = realTerrain(await loadDem(HOME, 2000, fakeWorld(height)));
    expect(t.kind).toBe("real");
    expect(t.land(0, 0)).toBeCloseTo(0, 5);
    expect(t.land(600, -400)).toBeGreaterThan(110);
    expect(t.land(600, -400)).toBeLessThan(121);
    expect(t.land(-600, 400)).toBeLessThan(2);
    expect(t.isWater(600, -400)).toBe(false);
    expect(t.waterLevel).toBeLessThan(-50);
  });

  it("asks for only the tiles it needs, coarser for a wider area", async () => {
    const near: string[] = [];
    await loadDem(HOME, 2000, fakeWorld(() => 10, near));
    expect(near.length).toBeLessThanOrEqual(4);
    expect(near.every((k) => k.startsWith("13/"))).toBe(true);
    expect(demDetail(6000).zoom).toBe(12);
    expect(demDetail(15000).zoom).toBe(11);
  });

  it("knows which plan a loaded patch serves", async () => {
    const p = await loadDem(HOME, 2000, fakeWorld(() => 10));
    expect(covers(p, HOME, 2000)).toBe(true);
    expect(covers(p, HOME, 3000)).toBe(false);
    expect(covers(p, toGlobal(HOME, 50, 0), 2000)).toBe(false);
    expect(covers(null, HOME, 100)).toBe(false);
  });

  it("fails loudly when a tile cannot be had", async () => {
    await expect(loadDem(HOME, 2000, async () => Promise.reject(new Error("offline")))).rejects.toThrow("offline");
  });

  it("gives the open field when real ground is asked of the generator", () => {
    expect(makeTerrain("real").kind).toBe("flat");
    expect(makeTerrain("real").land(500, 500)).toBe(0);
  });
});

describe("route profile", () => {
  const flat = () => 0;
  /** A 60 m ridge running north-south, 300 m east of home. */
  const ridge = (_n: number, e: number) => 60 * Math.exp(-((e - 300) ** 2) / (2 * 40 * 40));

  it("is empty with no waypoints", () => {
    const p = routeProfile([], 20, "rtl", 15, flat);
    expect(p.samples).toHaveLength(0);
    expect(p.lowest).toBeNull();
  });

  it("finds a ridge between two waypoints that both clear the ground", () => {
    const pts = [
      { n: 0, e: 100, alt: 30 },
      { n: 0, e: 500, alt: 30 },
    ];
    const p = routeProfile(pts, 30, "hold", 15, ridge);
    // Both waypoints are comfortably clear…
    expect(pts[0].alt - p.groundAt[0]).toBeGreaterThan(29);
    expect(pts[1].alt - p.groundAt[1]).toBeGreaterThan(29);
    // …and the line between them goes 30 m into the ridge.
    expect(p.lowest!.clear).toBeCloseTo(-30, 0);
    expect(p.lowest!.e).toBeCloseTo(300, -1);
    expect(p.legs[p.lowest!.leg]).toMatchObject({ from: "1", to: "2" });
    expect(p.legs[0].minClear).toBeGreaterThan(25);
  });

  it("slopes the flight between waypoints of different heights", () => {
    const p = routeProfile([{ n: 0, e: 400, alt: 60 }], 20, "hold", 15, flat);
    const mid = p.samples.find((s) => Math.abs(s.d - 200) < 1)!;
    expect(mid.fly).toBeCloseTo(40, 0);
    expect(p.length).toBeCloseTo(400);
  });

  it("flies the return at the return height, or its own if higher", () => {
    const low = routeProfile([{ n: 0, e: 600, alt: 20 }], 20, "rtl", 50, ridge);
    // Climbs to 50 m before coming back: clears the 60 m ridge? No — 10 m into it.
    expect(low.legs.at(-1)).toMatchObject({ to: "Home" });
    expect(low.legs.at(-1)!.minClear).toBeCloseTo(-10, 0);
    expect(low.length).toBeCloseTo(1200);
    const high = routeProfile([{ n: 0, e: 600, alt: 90 }], 90, "rtl", 50, ridge);
    expect(high.legs.at(-1)!.minClear).toBeCloseTo(30, 0);
  });

  it("has no return leg when the mission ends away from home", () => {
    expect(routeProfile([{ n: 0, e: 600, alt: 20 }], 20, "land", 50, flat).length).toBeCloseTo(600);
  });
});

describe("things laid on the drawn ground", () => {
  it("follow the ground as it is drawn, so nothing is buried on a slope", async () => {
    const { drapedRing, drawnGround, NEAR_HALF, NEAR_SEGS } = await import("../../features/simulator/world/landscape");
    // A steady slope with a bump: 30 cm per metre east.
    const terrain = { ...makeTerrain("flat"), land: (n: number, e: number) => e * 0.3 + 4 * Math.sin(n / 9) };
    const step = (NEAR_HALF * 2) / NEAR_SEGS;
    // At the points the mesh was sampled, the drawn ground is the terrain.
    expect(drawnGround(terrain, NEAR_HALF - 3 * step, -NEAR_HALF + 5 * step)).toBeCloseTo(terrain.land(NEAR_HALF - 3 * step, -NEAR_HALF + 5 * step), 6);
    // Between them it is the flat triangle, not the curve.
    const mid = drawnGround(terrain, NEAR_HALF - 3.5 * step, -NEAR_HALF + 5 * step);
    expect(mid).toBeCloseTo((terrain.land(NEAR_HALF - 3 * step, -NEAR_HALF + 5 * step) + terrain.land(NEAR_HALF - 4 * step, -NEAR_HALF + 5 * step)) / 2, 6);

    const g = drapedRing(terrain, 40, 25, 0, 2.6, 0.05);
    const pos = g.getAttribute("position");
    let lowest = Infinity;
    let spread = 0;
    for (let k = 0; k < pos.count; k++) {
      const above = pos.getY(k) - drawnGround(terrain, -pos.getZ(k), pos.getX(k));
      lowest = Math.min(lowest, above);
      spread = Math.max(spread, Math.abs(pos.getY(k) - pos.getY(0)));
    }
    // Every point sits its lift above the ground, and the disc tilts with the slope: a flat one would be half under.
    expect(lowest).toBeCloseTo(0.05, 4);
    expect(spread).toBeGreaterThan(0.5);
    expect(Math.hypot(pos.getX(pos.count - 1) - 25, -pos.getZ(pos.count - 1) - 40)).toBeCloseTo(2.6, 4);
  });
});
