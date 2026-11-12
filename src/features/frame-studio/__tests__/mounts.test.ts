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

  it("adds two side plates, cut from the plate they stand in", () => {
    const d = designFrame(spec());
    const p = part(spec(), "camera-plate")!;
    expect(p.qty).toBe(2);
    expect(p.thicknessMm).toBe(d.stock.topPlateMm);
    expect(polygonArea(p.outline)).toBeGreaterThan(0);
  });

  it("stands on the clamp plate, not the bottom plate", () => {
    /*
      The side plates are 35 mm tall for a micro camera and the gap between
      the plates is about 7, so standing them on the bottom plate ran them
      straight up through the clamp plate and past an arm root — which is what
      the solid view showed. Mounting them on the clamp plate puts the whole
      cage above everything the frame carries, which is also how a real frame
      holds a camera.
    */
    for (const c of CAMERAS.filter((x) => x.widthMm > 0)) {
      for (const propIn of [3, 5, 7, 10]) {
        const s = spec({ cameraId: c.id, propIn, fixedDimMm: null });
        const d = designFrame(s);
        const where = `${c.id} ${propIn}"`;
        const top = part(s, "top-plate")!;
        const bottom = part(s, "bottom-plate")!;
        const plate = part(s, "camera-plate")!;
        const mount = d.cameraMount!;

        // Four feet: two tabs on each of the two side plates.
        // A foot slot is a thin strip straddling one side plate's mid-plane.
        const feet = top.slots.slice(0, top.lightenedFrom).filter((slot) => {
          const xs = slot.map((q) => q[0]);
          const mid = (Math.min(...xs) + Math.max(...xs)) / 2;
          const wide = Math.max(...xs) - Math.min(...xs);
          return Math.abs(Math.abs(mid) - mount.spacingMm / 2) < 0.2
            && Math.abs(wide - (plate.thicknessMm + 0.3)) < 0.01;
        });
        expect(feet.length, `${where} feet in the clamp plate`).toBe(4);
        /*
          And nothing in the bottom plate: fitting a camera now cuts the same
          bottom plate a camera-less frame gets. Which also frees its front
          strap slot to go back to the edge, where a strap round a battery
          belongs — it used to be pushed inboard to dodge the mount, and on a
          small frame that left two slots 24 mm apart on a 105 mm pack.
        */
        const bare = part(spec({ cameraId: "none", propIn, fixedDimMm: null }), "bottom-plate")!;
        expect(bottom.lightenedFrom, `${where} bottom-plate cuts`).toBe(bare.lightenedFrom);

        /*
          The tabs reach a millimetre and a half past the far face of the
          plate they drop into, so seating the body's underside on that
          plate's top face — which is what the solid view does — leaves the
          tabs in their slots rather than standing the cage proud of them.
        */
        const bodyBottom = -mount.heightMm / 2;
        const tabBottom = Math.min(...plate.outline.map((q) => q[1]));
        expect(bodyBottom - tabBottom, `${where} tab depth`)
          .toBeCloseTo(plate.thicknessMm + 1.5, 6);
      }
    }
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

  it("keeps its tab slots clear of every bolt and cut-out in the plate below", () => {
    for (const c of CAMERAS.filter((x) => x.widthMm > 0)) {
      for (const propIn of [3, 5, 7, 10]) {
        const top = part(spec({ cameraId: c.id, propIn, fixedDimMm: null }), "top-plate")!;
        for (const slot of top.slots) {
          for (const h of top.holes) {
            const gap = Math.min(...slot.map((p) => Math.hypot(p[0] - h.c[0], p[1] - h.c[1]))) - h.r;
            expect(gap, `${c.id} ${propIn}"`).toBeGreaterThan(1.4);
          }
        }
        /*
          And every cut in the plate against every other. This is the check
          that caught the mount placed 0.3 mm from the stack opening: the fit
          search had rejected its own arithmetic by a rounding hair, walked
          every remaining position and fallen through to an unchecked
          fallback. A sliver that thin is only a warning, so the suite's
          no-errors sweep passed straight over it.
        */
        const d = designFrame(spec({ cameraId: c.id, propIn, fixedDimMm: null }));
        const touching = validateDesign(d).filter((f) => /-slots-\d+-\d+$/.test(f.id));
        expect(touching.map((f) => `${f.id} ${f.measured}`), `${c.id} ${propIn}"`).toEqual([]);
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
