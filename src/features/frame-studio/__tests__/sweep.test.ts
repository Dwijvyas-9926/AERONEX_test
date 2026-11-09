import { describe, expect, it } from "vitest";
import { FLYING_STYLES, MATERIALS, MOTORS, PROP_SIZES, STACK_PATTERNS } from "../catalog";
import { designFrame, LAYOUTS, type FrameSpec } from "../geometry";
import { planSheets, toDXF } from "../exporters";
import { validateDesign } from "../validate";

/*
  A broad sweep over the whole input space.

  Unit tests check the cases someone thought of. This checks the ones nobody
  did: every prop size against every motor, material, construction, stack,
  layout and flying style. It is looking for the failure modes that only show
  up at the edges — NaN leaking into a readout, an empty outline, a zero or
  negative thickness, a non-finite coordinate reaching an exported file — and
  for the design disagreeing with itself about where the motors are.
*/

const base: FrameSpec = {
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
  construction: "bolted",
  materialId: "cf-plate",
  fixedDimMm: null,
  plateThicknessMm: null,
  wallMm: 2.5,
  styleId: "freestyle",
  safetyFactor: 2,
};

/** Every combination of the things a user can pick, minus the slow axes. */
function* specs(): Generator<[string, FrameSpec]> {
  for (const propIn of PROP_SIZES) {
    for (const material of MATERIALS) {
      for (const construction of ["bolted", "unibody"] as const) {
        const motor = MOTORS.find((m) => m.props.includes(propIn)) ?? MOTORS[0];
        yield [
          `${propIn}" ${material.id} ${construction}`,
          { ...base, propIn, materialId: material.id, construction, motorId: motor.id, motorThrustG: motor.thrustG },
        ];
      }
    }
  }
  for (const layout of LAYOUTS) {
    for (const style of FLYING_STYLES) {
      for (const stack of STACK_PATTERNS) {
        yield [
          `${layout.id} ${style.id} stack${stack.pattern}`,
          { ...base, layout: layout.id, styleId: style.id, stackPattern: stack.pattern, stackBolt: stack.bolt },
        ];
      }
    }
  }
}

describe("every combination produces a sane design", () => {
  it("no NaN, no empty geometry, no zero-thickness part", () => {
    for (const [label, spec] of specs()) {
      const d = designFrame(spec);
      const numbers = [
        d.wheelbaseMm, d.armLengthMm, d.mass.auwG, d.mass.frameG, d.thrustToWeight, d.hoverThrottle,
        d.section.widthMm, d.section.heightMm, d.section.stressMPa, d.section.deflectionMm, d.section.areaMm2,
      ];
      for (const v of numbers) expect(Number.isFinite(v), `${label}: ${numbers.join()}`).toBe(true);

      expect(d.profiles.length, label).toBeGreaterThan(0);
      for (const p of d.profiles) {
        expect(p.outline.length, `${label} / ${p.id}`).toBeGreaterThan(2);
        expect(p.thicknessMm, `${label} / ${p.id}`).toBeGreaterThan(0);
        expect(p.qty, `${label} / ${p.id}`).toBeGreaterThan(0);
        for (const [x, y] of p.outline) {
          expect(Number.isFinite(x) && Number.isFinite(y), `${label} / ${p.id}`).toBe(true);
        }
      }
      expect(() => validateDesign(d), label).not.toThrow();
    }
  });

  it("the wheelbase a design reports is the wheelbase its parts would build", () => {
    /*
      These were different numbers once. The cantilever was clamped at a 25 mm
      floor while the motor positions, the clearance check and the title block
      all kept using the nominal layout, so a 2" frame reported 86 mm and the
      drawn parts assembled to 136 mm.
    */
    for (const [label, spec] of specs()) {
      const d = designFrame(spec);
      const drawn = 2 * (d.rootRadiusMm + Math.min(...d.armGroups.map((a) => a.cantileverMm)));
      const nominal = 2 * Math.min(...d.motors.map((m) => Math.hypot(m[0], m[1])));
      expect(Math.abs(drawn - nominal), `${label}: draws ${drawn.toFixed(1)}, reports ${nominal.toFixed(1)}`).toBeLessThan(1);
    }
  });

  it("exports contain no non-finite coordinate", () => {
    for (const [label, spec] of specs()) {
      for (const sheet of planSheets(designFrame(spec).profiles)) {
        const dxf = toDXF(sheet.nest);
        expect(/NaN|Infinity/.test(dxf), `${label} @ ${sheet.thicknessMm}mm`).toBe(false);
      }
    }
  });
});
