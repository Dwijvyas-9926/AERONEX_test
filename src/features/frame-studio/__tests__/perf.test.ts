import { describe, expect, it } from "vitest";
import { designFrame, type FrameSpec } from "../geometry";

/*
  A guard, not a benchmark.

  The spec panel re-solves the whole design inside a useMemo on every
  keystroke, so the solve has to fit in a frame or typing a number feels
  laggy. Adding the camera mount's placement search and the plate lightening
  took one solve to 95 ms before anyone measured it — the sweep caught the
  slowdown as a timeout, which is a blunt instrument and only fires in CI.

  The limit is deliberately generous against the measured figure so this
  fails on a real regression rather than on a busy machine.
*/
const BUDGET_MS = 30;

/*
  A unibody costs more and always has. Its chassis outline is the union of
  the plate and four arms, found by casting a ray at every vertex of every
  input — roughly nine hundred rays against two hundred segments — and it
  cannot be hoisted out of the mass loop because the arms it unions are what
  the loop is still sizing. The sampling is deliberate: a uniform sweep
  chords across the motor pads' tangent points and shaves them below the edge
  distance their bolts were sized for. So this is a separate, larger budget
  rather than a reason to make the geometry worse.
*/
const UNIBODY_BUDGET_MS = 80;

const spec = (o: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null, motorId: "2207",
  motorThrustG: 1350, stackPattern: 30.5, stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4, plateThicknessMm: null,
  wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro",
  styleId: "freestyle", safetyFactor: 2, ...o,
});

/** Mean solve time, with the inputs varied so nothing can be cached away. */
function solveMs(s: FrameSpec, runs = 20): number {
  /*
    Warm properly. One warm-up call left the first measured case paying for
    the whole module's JIT, which failed this guard when the file ran on its
    own and passed when it ran after the rest of the suite — the worst kind
    of flake, since it only appears in isolation.
  */
  for (let i = 0; i < 8; i++) designFrame({ ...s, motorThrustG: s.motorThrustG + i });
  const t0 = performance.now();
  for (let i = 0; i < runs; i++) designFrame({ ...s, motorThrustG: s.motorThrustG + i });
  return (performance.now() - t0) / runs;
}

describe("a design is cheap enough to rebuild on every keystroke", () => {
  it("solves a 5\" inside a frame budget", () => {
    expect(solveMs(spec())).toBeLessThan(BUDGET_MS);
  });

  it("holds across the sizes and both constructions", () => {
    for (const [label, s] of [
      ['3"', spec({ propIn: 3, motorId: "1404", motorThrustG: 350, stackPattern: 20, stackBolt: 2, stackHeightMm: 12 })],
      ['10"', spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 })],
      ["printed", spec({ materialId: "pa-cf", fixedDimMm: 12 })],
    ] as const) {
      expect(solveMs(s, 10), label).toBeLessThan(BUDGET_MS);
    }
  });

  it("keeps a unibody within its own, larger budget", () => {
    expect(solveMs(spec({ construction: "unibody" }), 10)).toBeLessThan(UNIBODY_BUDGET_MS);
  });

  it("stays cheap with every optional cut switched on", () => {
    // The worst case: camera mount, lightening and a top-mounted pack all
    // competing for room on the same plate.
    const loaded = spec({ cameraId: "full", lightenPlates: true, batteryMount: "top" });
    expect(solveMs(loaded)).toBeLessThan(BUDGET_MS);
  });
});
