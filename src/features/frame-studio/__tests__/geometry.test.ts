import { describe, expect, it } from "vitest";
import { designFrame, type FrameSpec, minSpacing, minWheelbaseFor, motorPositions, polygonArea, roundedRect } from "../geometry";

const baseSpec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x",
  propIn: 5,
  clearanceMm: 10,
  wheelbaseMm: null,
  motorId: "2207",
  motorThrustG: 1350,
  stackPattern: 30.5,
  stackBolt: 3,
  battery: { l: 105, w: 35, h: 30, massG: 180 },
  electronicsMassG: 120,
  materialId: "cf-plate",
  fixedDimMm: 4,
  plateThicknessMm: null,
  wallMm: 2.5,
  styleId: "freestyle",
  safetyFactor: 2,
  ...over,
});

describe("layout geometry", () => {
  it("True X places four motors symmetrically on the wheelbase circle", () => {
    const pts = motorPositions("true-x", 220);
    expect(pts).toHaveLength(4);
    for (const p of pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(110, 4);
    // adjacent spacing for a true X is wheelbase/√2
    expect(minSpacing(pts)).toBeCloseTo(220 / Math.SQRT2, 3);
  });

  it("stretched X is longer front-to-back than it is wide", () => {
    const pts = motorPositions("stretched-x", 220);
    const halfW = Math.max(...pts.map((p) => Math.abs(p[0])));
    const halfL = Math.max(...pts.map((p) => Math.abs(p[1])));
    expect(halfL).toBeGreaterThan(halfW);
    for (const p of pts) expect(Math.hypot(p[0], p[1])).toBeCloseTo(110, 4);
  });

  it("dead cat sweeps the front motors further out to the sides", () => {
    const pts = motorPositions("deadcat", 220);
    const front = pts.filter((p) => p[1] > 0);
    const rear = pts.filter((p) => p[1] < 0);
    expect(front).toHaveLength(2);
    expect(Math.abs(front[0][0])).toBeGreaterThan(Math.abs(rear[0][0]));
  });

  it("every layout puts its centre of thrust at the origin", () => {
    /*
      The origin is where the plates, the stack and the battery go, so it has
      to be the mean of the motor positions. If it is not, the aircraft is
      built with its CG permanently off the centre of thrust and trims crooked.
    */
    for (const layout of ["true-x", "stretched-x", "h", "deadcat"] as const) {
      const pts = motorPositions(layout, 220);
      const cx = pts.reduce((s, p) => s + p[0], 0) / 4;
      const cy = pts.reduce((s, p) => s + p[1], 0) / 4;
      expect(cx, `${layout} x`).toBeCloseTo(0, 6);
      expect(cy, `${layout} y`).toBeCloseTo(0, 6);
    }
  });
});

describe("propeller clearance drives the wheelbase", () => {
  it("True X minimum matches the closed form √2·(prop + gap)", () => {
    const prop = 5 * 25.4;
    const expected = Math.ceil(Math.SQRT2 * (prop + 10));
    expect(minWheelbaseFor("true-x", prop, 10)).toBe(expected);
  });

  it("a computed 5\" minimum sits just under the published 210–230 mm band", () => {
    const wb = minWheelbaseFor("true-x", 5 * 25.4, 10);
    expect(wb).toBeGreaterThan(180);
    expect(wb).toBeLessThan(215);
  });

  it("bigger props and bigger gaps always need a bigger frame", () => {
    expect(minWheelbaseFor("true-x", 7 * 25.4, 10)).toBeGreaterThan(minWheelbaseFor("true-x", 5 * 25.4, 10));
    expect(minWheelbaseFor("true-x", 5 * 25.4, 30)).toBeGreaterThan(minWheelbaseFor("true-x", 5 * 25.4, 10));
  });

  it("never returns a design whose props would overlap", () => {
    for (const layout of ["true-x", "stretched-x", "h", "deadcat"] as const) {
      const d = designFrame(baseSpec({ layout }));
      expect(d.minMotorSpacingMm).toBeGreaterThanOrEqual(d.propDiaMm + d.spec.clearanceMm - 0.5);
    }
  });
});

describe("full design", () => {
  it("produces a sane 5\" carbon quad", () => {
    const d = designFrame(baseSpec());
    expect(d.wheelbaseMm).toBeGreaterThan(180);
    expect(d.armLengthMm).toBeGreaterThan(20);
    expect(d.profiles.map((p) => p.id)).toEqual(["bottom-plate", "top-plate", "arm"]);
    // a 4 mm carbon 5" frame is roughly 90–160 g of plate and arms
    expect(d.mass.frameG).toBeGreaterThan(50);
    expect(d.mass.frameG).toBeLessThan(220);
    // and the whole aircraft should be a plausible freestyle weight
    expect(d.mass.auwG).toBeGreaterThan(400);
    expect(d.mass.auwG).toBeLessThan(900);
  });

  it("reports a usable thrust-to-weight and a realistic hover throttle", () => {
    const d = designFrame(baseSpec());
    expect(d.thrustToWeight).toBeGreaterThan(3);
    // a 5" freestyle quad hovers around a quarter to a third of throttle
    expect(d.hoverThrottle).toBeGreaterThan(0.2);
    expect(d.hoverThrottle).toBeLessThan(0.45);
    // and only needs a small fraction of its peak thrust to hold altitude
    expect(d.hoverThrustFraction).toBeLessThan(d.hoverThrottle);
  });

  it("converges — mass and arm size settle rather than runaway", () => {
    const a = designFrame(baseSpec());
    const b = designFrame(baseSpec());
    expect(a.mass.auwG).toBe(b.mass.auwG);
    expect(a.section.widthMm).toBe(b.section.widthMm);
  });

  it("a printed frame comes out heavier than the carbon equivalent", () => {
    const cf = designFrame(baseSpec({ materialId: "cf-plate", fixedDimMm: 4 }));
    const printed = designFrame(baseSpec({ materialId: "pa-cf", fixedDimMm: 12 }));
    expect(printed.mass.frameG).toBeGreaterThan(cf.mass.frameG);
    // deeper arm section, as the h³ advantage predicts
    expect(printed.section.heightMm).toBeGreaterThan(cf.section.heightMm);
  });

  it("honours a user-chosen wheelbase above the minimum", () => {
    const d = designFrame(baseSpec({ wheelbaseMm: 260 }));
    expect(d.wheelbaseMm).toBe(260);
  });

  it("clamps a user wheelbase that would overlap the props", () => {
    const d = designFrame(baseSpec({ wheelbaseMm: 100 }));
    expect(d.wheelbaseMm).toBe(d.minWheelbaseMm);
  });
});

describe("profile primitives", () => {
  it("rounded rectangle has about the right area", () => {
    const a = polygonArea(roundedRect(100, 50, 6));
    expect(a).toBeGreaterThan(100 * 50 * 0.95);
    expect(a).toBeLessThanOrEqual(100 * 50);
  });

  it("every generated profile is a closed polygon with positive area", () => {
    const d = designFrame(baseSpec());
    for (const p of d.profiles) {
      expect(p.outline.length).toBeGreaterThan(3);
      expect(polygonArea(p.outline)).toBeGreaterThan(0);
      expect(p.areaMm2).toBeGreaterThan(0);
    }
  });

  it("arm carries four motor bolts plus its root bolts", () => {
    const d = designFrame(baseSpec());
    const arm = d.profiles.find((p) => p.id === "arm")!;
    expect(arm.holes.length).toBe(6);
    expect(arm.qty).toBe(4);
  });
});
