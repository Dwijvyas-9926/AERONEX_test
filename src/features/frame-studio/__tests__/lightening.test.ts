import { describe, expect, it } from "vitest";
import { LAYOUTS, designFrame, distanceToSegment, pointInPolygon, polygonArea, type FrameSpec, type Pt, type Profile } from "../geometry";
import { validateDesign } from "../validate";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null,
  motorId: "2207", motorThrustG: 1350, stackPattern: 30.5, stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4,
  plateThicknessMm: null, wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro",
  styleId: "freestyle", safetyFactor: 2, ...over,
});

/** Closest approach between a point and a closed polygon's edges. */
const gapToPoly = (p: Pt, poly: Pt[]) => {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, distanceToSegment(p, poly[j], poly[i]));
  return d;
};

const plates = (d: { profiles: Profile[] }): Profile[] =>
  d.profiles.filter((p) => p.cantileverMm === undefined);

describe("lightening cut-outs", () => {
  it("removes material and says how much", () => {
    const d = designFrame(spec());
    expect(d.lightening.count).toBeGreaterThan(0);
    expect(d.lightening.savedG).toBeGreaterThan(0);
    expect(d.lightening.areaMm2).toBeGreaterThan(0);
  });

  it("actually makes the frame lighter", () => {
    const solid = designFrame(spec({ lightenPlates: false }));
    const light = designFrame(spec({ lightenPlates: true }));
    expect(light.mass.frameG).toBeLessThan(solid.mass.frameG);
    // And the saving reported matches the mass that actually came off.
    expect(solid.mass.frameG - light.mass.frameG).toBeCloseTo(light.lightening.savedG, 0);
  });

  it("cuts nothing at all when switched off", () => {
    const d = designFrame(spec({ lightenPlates: false }));
    expect(d.lightening.count).toBe(0);
    expect(d.lightening.savedG).toBe(0);
    // Plates keep their functional openings -- strap slots, the stack hole,
    // the camera's tab slots -- and nothing beyond them.
    for (const p of d.profiles) {
      expect(p.slots.length, p.id).toBe(p.lightenedFrom ?? 0);
    }
  });

  it("never cuts into an arm", () => {
    // The arm is the load path and its section was solved by beam theory;
    // a hole in it invalidates the solve.
    for (const layout of LAYOUTS) {
      const d = designFrame(spec({ layout: layout.id }));
      for (const arm of d.profiles.filter((p) => p.cantileverMm !== undefined)) {
        expect(arm.slots.length, `${layout.id} arm`).toBe(0);
      }
    }
  });

  it("leaves real material between every cut-out and every bolt", () => {
    for (const layout of LAYOUTS) {
      for (const propIn of [2, 3, 5, 7, 10]) {
        for (const p of plates(designFrame(spec({ layout: layout.id, propIn, fixedDimMm: null })))) {
          for (const slot of p.slots) {
            for (const h of p.holes) {
              const gap = gapToPoly(h.c, slot) - h.r;
              expect(gap, `${layout.id} ${propIn}" ${p.id}`).toBeGreaterThan(1.5);
              expect(pointInPolygon(h.c, slot), `${layout.id} ${propIn}" ${p.id} hole swallowed`).toBe(false);
            }
          }
        }
      }
    }
  });

  it("keeps every cut-out inside its own plate", () => {
    for (const layout of LAYOUTS) {
      for (const propIn of [2, 5, 10]) {
        for (const p of plates(designFrame(spec({ layout: layout.id, propIn, fixedDimMm: null })))) {
          for (const slot of p.slots) {
            for (const pt of slot) {
              expect(pointInPolygon(pt, p.outline), `${layout.id} ${propIn}" ${p.id}`).toBe(true);
            }
          }
        }
      }
    }
  });

  it("never lets two cut-outs touch", () => {
    for (const layout of LAYOUTS) {
      for (const propIn of [2, 5, 7, 10]) {
        for (const p of plates(designFrame(spec({ layout: layout.id, propIn, fixedDimMm: null })))) {
          for (let i = 0; i < p.slots.length; i++) {
            for (let j = i + 1; j < p.slots.length; j++) {
              const touching = p.slots[i].some((pt) => pointInPolygon(pt, p.slots[j]))
                || p.slots[j].some((pt) => pointInPolygon(pt, p.slots[i]));
              expect(touching, `${layout.id} ${propIn}" ${p.id} slots ${i}/${j}`).toBe(false);
            }
          }
        }
      }
    }
  });

  it("raises no validation errors on any layout or size", () => {
    for (const layout of LAYOUTS) {
      for (const propIn of [2, 3, 5, 7, 10]) {
        for (const construction of ["bolted", "unibody"] as const) {
          const d = designFrame(spec({ layout: layout.id, propIn, construction, fixedDimMm: null }));
          const errs = validateDesign(d)
            .filter((f) => f.severity === "error" && f.id !== "motor-prop-mismatch");
          expect(errs.map((f) => f.id), `${layout.id} ${propIn}" ${construction}`).toEqual([]);
        }
      }
    }
  });

  it("is worth doing — a token hole is a stress raiser that saves nothing", () => {
    for (const propIn of [3, 5, 7, 10]) {
      const d = designFrame(spec({ propIn, fixedDimMm: null }));
      for (const p of plates(d)) {
        // Each profile records where its lightening begins; everything
        // before it is a functional opening.
        for (const slot of p.slots.slice(p.lightenedFrom ?? p.slots.length)) {
          expect(polygonArea(slot), `${propIn}" ${p.id}`).toBeGreaterThan(30);
        }
      }
    }
  });

  it("holds up on every material, including the soft ones", () => {
    for (const materialId of ["cf-plate", "ply-birch", "acrylic", "pa-cf", "petg"]) {
      const d = designFrame(spec({ materialId, fixedDimMm: null }));
      expect(Number.isFinite(d.mass.frameG), materialId).toBe(true);
      expect(d.mass.frameG, materialId).toBeGreaterThan(0);
      for (const p of plates(d)) {
        for (const slot of p.slots) expect(polygonArea(slot), materialId).toBeGreaterThan(0);
      }
    }
  });
});
