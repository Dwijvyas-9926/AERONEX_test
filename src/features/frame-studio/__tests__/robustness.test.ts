import { describe, expect, it } from "vitest";
import { CAMERAS, MOTORS, PROP_SIZES, STACK_PATTERNS } from "../catalog";
import { buildBOM } from "../bom";
import { planSheets, toDXF } from "../exporters";
import { designFrame, LAYOUTS, pointInPolygon, sanitizeSpec, type FrameSpec } from "../geometry";
import { pageSizeById, planPrint, toPrintPDF } from "../printsheet";
import { DEFAULT_SPEC, carriesKit, kitPatch } from "../store";
import { validateDesign } from "../validate";

/*
  What the studio does with input nobody meant to give it.

  The form limits what can be typed, but a spec also arrives from a record an
  older build saved, from one edited by hand, and from a field cleared
  mid-keystroke. An audit that fed the solver NaN, zero, negative and absurd
  values found it did not fail on them — it produced empty outlines, plates
  with no area and a 433-page print job, and reported each as a property of
  the design. These hold the line that was drawn after it.
*/

const finite = (o: unknown, path = ""): string | null => {
  if (typeof o === "number") return Number.isFinite(o) ? null : path;
  if (Array.isArray(o)) {
    for (let i = 0; i < o.length; i++) {
      const r = finite(o[i], `${path}[${i}]`);
      if (r) return r;
    }
    return null;
  }
  if (o && typeof o === "object") {
    for (const [k, v] of Object.entries(o)) {
      const r = finite(v, `${path}.${k}`);
      if (r) return r;
    }
  }
  return null;
};

/** Everything that must hold of any design at all, however it was asked for. */
function sound(name: string, s: FrameSpec) {
  const d = designFrame(s);
  expect(finite({ ...d, spec: null }), `${name}: non-finite value`).toBeNull();
  for (const p of d.profiles) {
    expect(p.outline.length, `${name}: ${p.id} outline`).toBeGreaterThan(2);
    expect(p.thicknessMm, `${name}: ${p.id} thickness`).toBeGreaterThan(0);
    expect(p.areaMm2, `${name}: ${p.id} area`).toBeGreaterThan(0);
    for (const h of p.holes) expect(pointInPolygon(h.c, p.outline), `${name}: ${p.id} hole off the part`).toBe(true);
    for (const slot of p.slots) {
      expect(slot.every((q) => pointInPolygon(q, p.outline)), `${name}: ${p.id} slot off the part`).toBe(true);
      for (const h of p.holes) expect(pointInPolygon(h.c, slot), `${name}: ${p.id} slot through a hole`).toBe(false);
    }
  }
  expect(d.mass.frameG, `${name}: frame mass`).toBeGreaterThan(0);
  // Nothing downstream may throw, and nothing may print a non-number.
  validateDesign(d);
  buildBOM(d);
  for (const sheet of planSheets(d.profiles)) expect(/NaN|Infinity|undefined/.test(toDXF(sheet.nest)), `${name}: DXF`).toBe(false);
  const plan = planPrint(d, pageSizeById("a4"));
  expect(plan.pages.length, `${name}: pages`).toBeLessThan(60);
  toPrintPDF(d, plan, "A");
  return d;
}

describe("hostile input", () => {
  const cases: [string, Partial<FrameSpec>][] = [
    ["thrust 0", { motorThrustG: 0 }], ["thrust NaN", { motorThrustG: NaN }], ["thrust -5", { motorThrustG: -5 }], ["thrust 1e9", { motorThrustG: 1e9 }],
    ["clearance -20", { clearanceMm: -20 }], ["clearance 500", { clearanceMm: 500 }], ["clearance NaN", { clearanceMm: NaN }],
    ["wheelbase 10", { wheelbaseMm: 10 }], ["wheelbase 5000", { wheelbaseMm: 5000 }], ["wheelbase NaN", { wheelbaseMm: NaN }], ["wheelbase 0", { wheelbaseMm: 0 }],
    ["battery 0", { battery: { l: 0, w: 0, h: 0, massG: 0 } }], ["battery huge", { battery: { l: 400, w: 200, h: 150, massG: 5000 } }],
    ["battery NaN", { battery: { l: NaN, w: NaN, h: NaN, massG: NaN } }], ["battery negative", { battery: { l: -10, w: -10, h: -10, massG: -10 } }],
    ["battery missing", { battery: undefined as never }],
    ["electronics NaN", { electronicsMassG: NaN }], ["electronics 1e6", { electronicsMassG: 1e6 }],
    ["arm stock 0.1", { fixedDimMm: 0.1 }], ["arm stock 100", { fixedDimMm: 100 }], ["arm stock NaN", { fixedDimMm: NaN }], ["arm stock -3", { fixedDimMm: -3 }],
    ["plate 0.1", { plateThicknessMm: 0.1 }], ["plate 50", { plateThicknessMm: 50 }], ["plate NaN", { plateThicknessMm: NaN }],
    ["wall 0", { wallMm: 0, materialId: "pa-cf" }], ["wall 50", { wallMm: 50, materialId: "pa-cf" }], ["wall NaN", { wallMm: NaN, materialId: "pa-cf" }],
    ["safety 0", { safetyFactor: 0 }], ["safety NaN", { safetyFactor: NaN }], ["safety 100", { safetyFactor: 100 }],
    ["stack height 0", { stackHeightMm: 0 }], ["stack height 200", { stackHeightMm: 200 }], ["stack height NaN", { stackHeightMm: NaN }],
    ["stack 100", { stackPattern: 100 }], ["stack 0", { stackPattern: 0 }], ["stack NaN", { stackPattern: NaN }], ["stack bolt 0", { stackBolt: 0 }],
    ["prop 1", { propIn: 1 }], ["prop 30", { propIn: 30 }], ["prop 0", { propIn: 0 }], ["prop NaN", { propIn: NaN }],
    ["unknown motor", { motorId: "zzz" }], ["unknown material", { materialId: "zzz" }], ["unknown camera", { cameraId: "zzz" }],
    ["unknown style", { styleId: "zzz" }], ["unknown layout", { layout: "zzz" as never }], ["unknown mount", { batteryMount: "sideways" as never }],
    ["10 inch props on 1103 motors", { propIn: 10, motorId: "1103", motorThrustG: 130 }],
    ["full-size camera on a 2 inch", { propIn: 2, motorId: "1103", motorThrustG: 130, cameraId: "full" }],
  ];

  it.each(cases)("builds something sound from: %s", (name, over) => {
    for (const construction of ["bolted", "unibody"] as const) {
      sound(`${name} (${construction})`, { ...DEFAULT_SPEC, ...over, construction });
    }
  });

  it("leaves a sensible spec exactly as it was", () => {
    expect(sanitizeSpec(DEFAULT_SPEC)).toEqual(DEFAULT_SPEC);
  });

  it("is idempotent", () => {
    const wild = { ...DEFAULT_SPEC, propIn: 99, clearanceMm: NaN, battery: { l: -1, w: 9999, h: NaN, massG: 3 } };
    expect(sanitizeSpec(sanitizeSpec(wild))).toEqual(sanitizeSpec(wild));
  });
});

describe("every combination a user can pick", () => {
  it("builds a sound frame, with or without a camera, pack above or below", () => {
    for (const propIn of PROP_SIZES) {
      for (const layout of LAYOUTS) {
        for (const construction of ["bolted", "unibody"] as const) {
          for (const camera of CAMERAS) {
            for (const batteryMount of ["top", "bottom"] as const) {
              const motor = MOTORS.find((m) => m.props.includes(propIn)) ?? MOTORS[0];
              const stack = propIn <= 3 ? STACK_PATTERNS[1] : STACK_PATTERNS[3];
              const name = `${propIn}" ${layout.id} ${construction} ${camera.id} ${batteryMount}`;
              const d = sound(name, {
                ...DEFAULT_SPEC, propIn, layout: layout.id, construction, cameraId: camera.id, batteryMount,
                motorId: motor.id, motorThrustG: motor.thrustG,
                stackPattern: stack.pattern, stackBolt: stack.bolt, stackHeightMm: stack.heightMm,
              });
              // A camera is either mounted or reported as not fitting — never both, never neither.
              const reported = validateDesign(d).some((f) => f.id === "camera-no-room");
              expect(reported, `${name}: camera-no-room`).toBe(!d.cameraFits);
              expect(d.cameraMount !== null, `${name}: mount`).toBe(camera.widthMm > 0 && d.cameraFits);
              // And the studio never reports its own geometry as unbuildable.
              const selfInflicted = validateDesign(d).filter((f) => /-(outside|edge)$|-slots-\d+-\d+$|-hole-\d+$/.test(f.id));
              expect(selfInflicted.map((f) => `${f.id} ${f.measured ?? ""}`), name).toEqual([]);
            }
          }
        }
      }
    }
  }, 120000);
});

describe("class kits", () => {
  it("give every propeller size a build that raises no errors, on any layout", () => {
    for (const propIn of PROP_SIZES) {
      const kit = { ...DEFAULT_SPEC, ...kitPatch(propIn), propIn };
      expect(carriesKit(kit), `${propIn}" kit recognised`).toBe(true);
      for (const layout of LAYOUTS) {
        for (const construction of ["bolted", "unibody"] as const) {
          for (const batteryMount of ["top", "bottom"] as const) {
            const d = designFrame({ ...kit, layout: layout.id, construction, batteryMount });
            const name = `${propIn}" ${layout.id} ${construction} ${batteryMount}`;
            const f = validateDesign(d);
            expect(f.filter((x) => x.severity === "error").map((x) => x.id), name).toEqual([]);
            // The only thing a suggested build may be warned about is a small
            // bolted frame being as small as its clamp bolts allow.
            expect(f.filter((x) => x.id !== "wheelbase-crowded").map((x) => x.id), name).toEqual([]);
            expect(d.thrustToWeight, name).toBeGreaterThan(3);
          }
        }
      }
    }
  }, 120000);

  it("is the default build for a 5 inch", () => {
    expect(carriesKit(DEFAULT_SPEC)).toBe(true);
    expect({ ...DEFAULT_SPEC, ...kitPatch(5) }).toEqual(DEFAULT_SPEC);
    // And an edited build is recognised as the user's own.
    expect(carriesKit({ ...DEFAULT_SPEC, electronicsMassG: 121 })).toBe(false);
  });
});
