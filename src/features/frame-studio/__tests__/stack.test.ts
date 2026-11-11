import { describe, expect, it } from "vitest";
import { STACK_PATTERNS, STACK_CLEARANCE_MM, stackHeightFor } from "../catalog";
import { buildBOM } from "../bom";
import { designFrame, stackOpeningSize, type FrameSpec } from "../geometry";
import { validateDesign } from "../validate";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null,
  motorId: "2207", motorThrustG: 1350, stackPattern: 30.5,
  stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4,
  plateThicknessMm: null, wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro", styleId: "freestyle", safetyFactor: 2, ...over,
});

const topOf = (s: FrameSpec) => designFrame(s).profiles.find((p) => p.id === "top-plate")!;
const bottomOf = (s: FrameSpec) => designFrame(s).profiles.find((p) => p.id === "bottom-plate")!;
const bomText = (s: FrameSpec) => buildBOM(designFrame(s)).map((l) => `${l.item} ${l.note ?? ""}`).join("\n");

describe("where the stack actually sits", () => {
  it("mounts to the bottom plate, not through both plates", () => {
    /*
      The bug this fixes: both plates carried the stack's bolt pattern, which
      describes a stack sandwiched between them. The plates are an arm's
      thickness apart — 5 mm here — and a real stack is 15 mm tall.
    */
    const stackHoles = (holes: { c: [number, number] }[]) =>
      holes.filter((h) => Math.hypot(h.c[0], h.c[1]) < 30).length;
    expect(stackHoles(bottomOf(spec()).holes)).toBe(4);
    expect(stackHoles(topOf(spec()).holes)).toBe(0);
  });

  it("opens the top plate up so the stack can pass through", () => {
    const top = topOf(spec());
    expect(top.slots.length).toBe(1);
    const xs = top.slots[0].map((p) => p[0]);
    const width = Math.max(...xs) - Math.min(...xs);
    /*
      Slightly over nominal, never under: the arcs circumscribe their radius
      so that cut parts do not come out undersized, which on a clearance
      opening means it errs towards clearing more.
    */
    const nominal = stackOpeningSize(spec());
    expect(width).toBeGreaterThanOrEqual(nominal);
    expect(width).toBeLessThan(nominal + 0.5);
  });

  it("reports the gap, the protrusion and the opening honestly", () => {
    const d = designFrame(spec());
    // The gap between the plates is the arm's thickness.
    expect(d.stackClearance.gapMm).toBeCloseTo(d.section.heightMm, 2);
    expect(d.stackClearance.protrudesMm).toBeCloseTo(15 - d.section.heightMm, 1);
    expect(d.stackClearance.openingMm).toBeGreaterThan(30.5);
  });

  it("sizes the opening from the pattern, so a bigger stack opens a bigger hole", () => {
    const small = stackOpeningSize(spec({ stackPattern: 16, stackBolt: 2 }));
    const large = stackOpeningSize(spec({ stackPattern: 30.5, stackBolt: 3 }));
    expect(small).toBeLessThan(large);
    expect(small).toBeGreaterThan(16);
  });

  it("leaves the opening out when it would crowd the arm bolts", () => {
    // A tiny frame with a full-size stack has no room for both.
    const tight = spec({ propIn: 2, motorId: "1103", motorThrustG: 130, stackPattern: 30.5, stackBolt: 3, fixedDimMm: 2.5 });
    const top = topOf(tight);
    // Either it fits with a real ligament, or it is not cut at all — never
    // cut through the bolts.
    if (top.slots.length > 0) {
      for (const h of top.holes) {
        const gap = Math.min(...top.slots[0].map((p) => Math.hypot(p[0] - h.c[0], p[1] - h.c[1]))) - h.r;
        expect(gap).toBeGreaterThan(1.4);
      }
    }
  });

  it("never reports an opening it did not cut", () => {
    for (const p of STACK_PATTERNS) {
      for (const propIn of [2, 3, 5, 7, 10]) {
        const s = spec({ propIn, stackPattern: p.pattern, stackBolt: p.bolt, stackHeightMm: p.heightMm, fixedDimMm: null });
        const d = designFrame(s);
        const cut = d.profiles.find((x) => x.id === "top-plate")!.slots.length > 0;
        expect(d.stackClearance.openingMm > 0, `${propIn}" / ${p.pattern}mm`).toBe(cut);
      }
    }
  });
});

describe("hardware sized from the stack height", () => {
  it("lengthens the stack bolt with the stack", () => {
    const short = bomText(spec({ stackPattern: 16, stackBolt: 2, stackHeightMm: 10 }));
    const tall = bomText(spec({ stackHeightMm: 25 }));
    expect(short).toMatch(/M2 × \d+ mm cap head \+ soft mounts/);
    const len = (t: string) => Number(/M\d+ × (\d+) mm cap head \+ soft mounts/.exec(t)![1]);
    expect(len(tall)).toBeGreaterThan(len(short) + 8);
  });

  it("drives the unibody standoff from the height, not the pattern", () => {
    /*
      The old rule read the mounting pattern — a width — to guess a height,
      and gave every 30.5 mm stack a 30 mm standoff whether it was 10 mm or
      25 mm tall.
    */
    const uni = (h: number) => bomText(spec({ construction: "unibody", stackHeightMm: h, materialId: "cf-plate" }));
    const standoff = (t: string) => Number(/M\d+ × (\d+) mm standoff/.exec(t)![1]);
    const a = standoff(uni(10));
    const b = standoff(uni(25));
    expect(b).toBeGreaterThan(a);
    expect(a).toBeGreaterThanOrEqual(10 + STACK_CLEARANCE_MM);
    expect(b).toBeGreaterThanOrEqual(25 + STACK_CLEARANCE_MM);
  });

  it("uses the battery height for the strap length", () => {
    // battery.h was collected by the UI and read by nothing at all.
    const shortPack = bomText(spec({ battery: { l: 105, w: 35, h: 20, massG: 180 } }));
    const tallPack = bomText(spec({ battery: { l: 105, w: 35, h: 45, massG: 180 } }));
    const strapLen = (t: string) => Number(/Battery strap, \d+ mm wide × (\d+) mm long/.exec(t)![1]);
    expect(strapLen(tallPack)).toBeGreaterThan(strapLen(shortPack));
    expect(tallPack).toContain("45 mm tall pack");
  });

  it("keeps every stack-pattern default consistent with its reference height", () => {
    for (const p of STACK_PATTERNS) expect(stackHeightFor(p.pattern)).toBe(p.heightMm);
  });
});

describe("the design stays clean with the opening in it", () => {
  it("raises no new errors across the stack patterns", () => {
    for (const p of STACK_PATTERNS) {
      for (const propIn of [2, 3, 5, 7, 10]) {
        for (const construction of ["bolted", "unibody"] as const) {
          const s = spec({ propIn, construction, stackPattern: p.pattern, stackBolt: p.bolt, stackHeightMm: p.heightMm, fixedDimMm: null });
          const errs = validateDesign(designFrame(s)).filter((f) => f.severity === "error");
          // Prop/motor mismatches are expected here (one motor across all
          // sizes); nothing else may error.
          const unexpected = errs.filter((f) => f.id !== "motor-prop-mismatch");
          expect(unexpected.map((f) => f.id), `${propIn}" ${construction} ${p.pattern}mm`).toEqual([]);
        }
      }
    }
  });

  it("catches two cut-outs that overlap", () => {
    // The slot-vs-slot check did not exist before; prove it fires.
    const d = designFrame(spec());
    const top = d.profiles.find((p) => p.id === "top-plate")!;
    const doubled = { ...top, slots: [...top.slots, ...top.slots] };
    const findings = validateDesign({ ...d, profiles: [doubled] });
    expect(findings.some((f) => f.id.includes("slots-0-1") && f.severity === "error")).toBe(true);
  });
});
