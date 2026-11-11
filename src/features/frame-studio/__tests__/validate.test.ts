import { describe, expect, it } from "vitest";
import {
  designFrame,
  distanceToBoundary,
  pointInPolygon,
  requiredEdgeClearance,
  roundedRect,
  type FrameSpec,
  type Profile,
} from "../geometry";
import { validateDesign, worstSeverity } from "../validate";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x",
  propIn: 5,
  clearanceMm: 10,
  wheelbaseMm: null,
  motorId: "2207",
  motorThrustG: 1350,
  stackPattern: 30.5,
  stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 },
  electronicsMassG: 120,
  construction: "bolted",
  materialId: "cf-plate",
  fixedDimMm: 4,
  plateThicknessMm: null,
  wallMm: 2.5,
  styleId: "freestyle",
  safetyFactor: 2,
  ...over,
});

/* Four builds that a real person would plausibly ask the studio for. */
const REFERENCE_BUILDS: [string, FrameSpec][] = [
  ['5" carbon freestyle', spec()],
  ['5" printed PA-CF', spec({ materialId: "pa-cf", fixedDimMm: 12 })],
  [
    '7" carbon long range',
    spec({ propIn: 7, motorId: "2806", motorThrustG: 1800, fixedDimMm: 5, styleId: "gentle", battery: { l: 140, w: 45, h: 35, massG: 420 } }),
  ],
  [
    '3" printed PETG micro',
    spec({ propIn: 3, motorId: "1404", motorThrustG: 350, stackPattern: 20, stackBolt: 2, materialId: "petg", fixedDimMm: 10, electronicsMassG: 45, battery: { l: 65, w: 30, h: 20, massG: 60 } }),
  ],
];

describe("reference builds are clean designs", () => {
  for (const [label, s] of REFERENCE_BUILDS) {
    it(`${label} raises nothing`, () => {
      const findings = validateDesign(designFrame(s));
      // Any finding here is a bug in the geometry, so name it in the failure.
      expect(findings.map((f) => `[${f.severity}] ${f.scope}: ${f.title} (${f.measured ?? "-"} vs ${f.limit ?? "-"})`)).toEqual([]);
      expect(worstSeverity(findings)).toBe("ok");
    });
  }
});

describe("manufacturing invariants hold for every reference build", () => {
  const allParts = (): [string, Profile][] =>
    REFERENCE_BUILDS.flatMap(([label, s]) => designFrame(s).profiles.map((p) => [`${label} / ${p.name}`, p] as [string, Profile]));

  it("every hole sits inside its part", () => {
    for (const [label, part] of allParts()) {
      for (const h of part.holes) {
        expect(pointInPolygon(h.c, part.outline), `${label}: hole at ${h.c}`).toBe(true);
      }
    }
  });

  it("every hole clears the part edge by its required edge distance", () => {
    for (const [label, part] of allParts()) {
      for (const h of part.holes) {
        const clear = distanceToBoundary(h.c, part.outline) - h.r;
        expect(clear, `${label}: hole at ${h.c}`).toBeGreaterThanOrEqual(requiredEdgeClearance(h) - 0.01);
      }
    }
  });

  it("no two holes on a part run into each other", () => {
    for (const [label, part] of allParts()) {
      for (let i = 0; i < part.holes.length; i++) {
        for (let j = i + 1; j < part.holes.length; j++) {
          const a = part.holes[i];
          const b = part.holes[j];
          const gap = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) - a.r - b.r;
          expect(gap, `${label}: holes ${i}/${j}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it("the top plate reaches every arm root bolt, so the clamp is real", () => {
    for (const [label, s] of REFERENCE_BUILDS) {
      const d = designFrame(s);
      const top = d.profiles.find((p) => p.id === "top-plate")!;
      const bottom = d.profiles.find((p) => p.id === "bottom-plate")!;
      const rootBolts = bottom.holes.filter((h) => {
        const r = Math.hypot(h.c[0], h.c[1]);
        return r > d.rootRadiusMm - d.armOverlapMm - 0.5 && r < d.rootRadiusMm + 0.5;
      });
      expect(rootBolts.length, `${label}: root bolts found`).toBe(8); // 2 per arm
      for (const h of rootBolts) {
        expect(pointInPolygon(h.c, top.outline), `${label}: bolt at ${h.c}`).toBe(true);
      }
    }
  });
});

describe("real problems are reported", () => {
  it("flags a build that cannot lift itself", () => {
    const findings = validateDesign(designFrame(spec({ motorId: "1103", motorThrustG: 130 })));
    const f = findings.find((x) => x.id === "tw-cannot-hover");
    expect(f?.severity).toBe("error");
    expect(worstSeverity(findings)).toBe("error");
  });

  it("warns that acrylic does not belong in an arm", () => {
    const findings = validateDesign(designFrame(spec({ materialId: "acrylic", fixedDimMm: 3 })));
    expect(findings.find((x) => x.id === "material-structural")?.severity).toBe("warn");
  });

  it("warns about a sheet thickness nobody stocks", () => {
    const findings = validateDesign(designFrame(spec({ fixedDimMm: 3.7 })));
    expect(findings.some((x) => x.id === "stock-thickness")).toBe(true);
  });

  it("reports overlapping props when the wheelbase is forced down", () => {
    // designFrame clamps to the clearance minimum, so build the failure directly
    const d = designFrame(spec());
    const broken = { ...d, minMotorSpacingMm: d.propDiaMm - 5 };
    const findings = validateDesign(broken);
    expect(findings.find((x) => x.id === "prop-overlap")?.severity).toBe("error");
  });

  it("catches a hole placed off the part", () => {
    const d = designFrame(spec());
    const bad: Profile = { ...d.profiles[0], holes: [{ c: [500, 500], r: 1.5 }] };
    const findings = validateDesign({ ...d, profiles: [bad] });
    expect(findings.some((f) => f.title === "Hole falls outside the part")).toBe(true);
  });

  it("catches two holes drilled on top of each other", () => {
    const d = designFrame(spec());
    const bad: Profile = {
      ...d.profiles[0],
      holes: [
        { c: [0, 0], r: 1.5 },
        { c: [1, 0], r: 1.5 },
      ],
    };
    const findings = validateDesign({ ...d, profiles: [bad] });
    expect(findings.some((f) => f.title === "Two holes overlap")).toBe(true);
  });
});

describe("polygon measurement", () => {
  it("measures distance to a boundary and inside/outside correctly", () => {
    const sq = roundedRect(100, 100, 0);
    expect(pointInPolygon([0, 0], sq)).toBe(true);
    expect(pointInPolygon([60, 0], sq)).toBe(false);
    expect(distanceToBoundary([0, 0], sq)).toBeCloseTo(50, 3);
    expect(distanceToBoundary([40, 0], sq)).toBeCloseTo(10, 3);
  });

  it("arcs circumscribe, so a round feature is never cut undersized", () => {
    // a 40 mm circle approximated as a polygon must still contain radius 20
    const circle = roundedRect(40, 40, 20);
    for (const p of circle) expect(Math.hypot(p[0], p[1])).toBeGreaterThanOrEqual(20 - 1e-9);
    expect(distanceToBoundary([0, 0], circle)).toBeGreaterThanOrEqual(20 - 1e-9);
  });

  it("applies the lower edge factor to motor-pad bolts only", () => {
    const d = designFrame(spec());
    const arm = d.profiles.find((p) => p.id === "arm")!;
    const pad = arm.holes.filter((h) => h.edgeFactor !== undefined);
    const root = arm.holes.filter((h) => h.edgeFactor === undefined);
    expect(pad).toHaveLength(4);
    expect(root).toHaveLength(2);
    expect(requiredEdgeClearance(root[0])).toBeGreaterThan(requiredEdgeClearance(pad[0]));
  });
});
