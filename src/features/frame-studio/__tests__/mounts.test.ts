import { describe, expect, it } from "vitest";
import { CAMERAS, cameraById } from "../catalog";
import { buildBOM } from "../bom";
import { cameraFootprintL, cameraMount, designFrame, pointInPolygon, polygonArea, type FrameSpec } from "../geometry";
import { validateDesign } from "../validate";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null,
  motorId: "2207", motorThrustG: 1350, stackPattern: 30.5, stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4, plateThicknessMm: null,
  wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro",
  styleId: "freestyle", safetyFactor: 2, ...over,
});

const part = (s: FrameSpec, id: string) => designFrame(s).profiles.find((p) => p.id === id);
const bomText = (s: FrameSpec) => buildBOM(designFrame(s)).map((l) => `${l.item} ${l.purpose} ${l.note ?? ""}`).join("\n");

describe("battery mounting", () => {
  it("cuts the strap slots in whichever plate the pack sits against", () => {
    /*
      They used to be cut in the bottom plate regardless, which described a
      top-mounted pack held on by a strap passing underneath the frame and
      round the outside of everything.
    */
    const under = designFrame(spec({ batteryMount: "bottom", cameraId: "none" }));
    const over = designFrame(spec({ batteryMount: "top", cameraId: "none" }));
    expect(under.profiles.find((p) => p.id === "bottom-plate")!.lightenedFrom).toBe(2);
    expect(over.profiles.find((p) => p.id === "bottom-plate")!.lightenedFrom).toBe(0);
    // The top plate gains them: its stack opening plus two strap slots.
    expect(over.profiles.find((p) => p.id === "top-plate")!.slots.length).toBeGreaterThan(
      under.profiles.find((p) => p.id === "top-plate")!.slots.length,
    );
  });

  it("says which plate to thread the strap through", () => {
    expect(bomText(spec({ batteryMount: "top" }))).toContain("slots in the top plate");
    expect(bomText(spec({ batteryMount: "bottom" }))).toContain("slots in the bottom plate");
  });

  it("brings the mass nearer the propellers when the pack goes on top", () => {
    const under = designFrame(spec({ batteryMount: "bottom" }));
    const over = designFrame(spec({ batteryMount: "top" }));
    expect(over.cg.zMm).toBeGreaterThan(under.cg.zMm);
    expect(over.cg.belowThrustMm).toBeLessThan(under.cg.belowThrustMm);
  });

  it("warns when a bottom-mounted pack hangs a long way below the discs", () => {
    const f = validateDesign(designFrame(spec({ batteryMount: "bottom", battery: { l: 105, w: 35, h: 55, massG: 400 } })));
    expect(f.find((x) => x.id === "cg-pendulous")?.severity).toBe("warn");
  });

  it("warns when a top-mounted pack stands into the propeller discs", () => {
    const f = validateDesign(designFrame(spec({ batteryMount: "top", battery: { l: 105, w: 35, h: 55, massG: 400 } })));
    const hit = f.find((x) => x.id === "battery-in-the-discs");
    expect(hit).toBeDefined();
    expect(hit!.detail).toMatch(/lithium/i);
  });
});

describe("the camera mount", () => {
  it("is left out entirely when no camera is fitted", () => {
    const d = designFrame(spec({ cameraId: "none" }));
    expect(d.profiles.some((p) => p.id === "camera-plate")).toBe(false);
    expect(cameraMount(cameraById("none"), 2.5, 90)).toBeNull();
    expect(cameraFootprintL(cameraById("none"))).toBe(0);
  });

  it("adds two side plates, cut from plate stock", () => {
    const p = part(spec(), "camera-plate")!;
    expect(p.qty).toBe(2);
    expect(p.thicknessMm).toBe(designFrame(spec()).stock.bottomPlateMm);
    expect(polygonArea(p.outline)).toBeGreaterThan(0);
  });

  it("gives every camera size a pivot and tilt holes that do not overlap", () => {
    for (const c of CAMERAS.filter((x) => x.widthMm > 0)) {
      const m = cameraMount(c, 2.5, 120)!;
      expect(m.plate.holes.length).toBeGreaterThan(2);
      for (let i = 0; i < m.plate.holes.length; i++) {
        for (let j = i + 1; j < m.plate.holes.length; j++) {
          const a = m.plate.holes[i];
          const b = m.plate.holes[j];
          const gap = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) - a.r - b.r;
          expect(gap, `${c.id} holes ${i}/${j}`).toBeGreaterThan(1.5);
        }
        // And each hole sits in material.
        expect(pointInPolygon(m.plate.holes[i].c, m.plate.outline), `${c.id} hole ${i}`).toBe(true);
      }
    }
  });

  it("lengthens the frame to make room rather than cutting through the stack", () => {
    /*
      A micro mount does not fit forward of a 30.5 mm stack on the plate an
      85 mm frame would otherwise get, so the plate grows. Real frames built
      around a camera are longer for exactly this reason.
    */
    const none = designFrame(spec({ cameraId: "none" }));
    const micro = designFrame(spec({ cameraId: "micro" }));
    const full = designFrame(spec({ cameraId: "full" }));
    expect(micro.bodyLmm).toBeGreaterThan(none.bodyLmm);
    expect(full.bodyLmm).toBeGreaterThan(micro.bodyLmm);
    expect(micro.bodyWmm).toBe(none.bodyWmm); // only the length needs to give
  });

  it("keeps its tab slots clear of every bolt on the plate below", () => {
    for (const c of CAMERAS.filter((x) => x.widthMm > 0)) {
      for (const propIn of [3, 5, 7, 10]) {
        const bottom = part(spec({ cameraId: c.id, propIn, fixedDimMm: null }), "bottom-plate")!;
        for (const slot of bottom.slots) {
          for (const h of bottom.holes) {
            const gap = Math.min(...slot.map((p) => Math.hypot(p[0] - h.c[0], p[1] - h.c[1]))) - h.r;
            expect(gap, `${c.id} ${propIn}"`).toBeGreaterThan(1.4);
          }
        }
      }
    }
  });

  it("counts the camera in the weight the arms are sized against", () => {
    const none = designFrame(spec({ cameraId: "none" }));
    const full = designFrame(spec({ cameraId: "full" }));
    expect(full.mass.auwG).toBeGreaterThan(none.mass.auwG);
  });

  it("asks for the pivot hardware", () => {
    expect(bomText(spec({ cameraId: "micro" }))).toMatch(/M2 × 12 mm cap head.*Camera pivot/s);
    expect(bomText(spec({ cameraId: "none" }))).not.toMatch(/Camera pivot/);
  });

  it("raises no errors on any camera, size or construction", () => {
    for (const c of CAMERAS) {
      for (const propIn of [3, 5, 7, 10]) {
        for (const construction of ["bolted", "unibody"] as const) {
          const d = designFrame(spec({ cameraId: c.id, propIn, construction, fixedDimMm: null }));
          const errs = validateDesign(d)
            .filter((f) => f.severity === "error" && f.id !== "motor-prop-mismatch");
          expect(errs.map((f) => f.id), `${c.id} ${propIn}" ${construction}`).toEqual([]);
        }
      }
    }
  });
});
