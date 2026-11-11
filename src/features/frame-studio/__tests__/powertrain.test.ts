import { describe, expect, it } from "vitest";
import { MOTORS, PROP_SIZES, motorById, propFit } from "../catalog";
import { designFrame, type FrameSpec } from "../geometry";
import { validateDesign } from "../validate";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null,
  motorId: "2207", motorThrustG: 1350, stackPattern: 30.5, stackBolt: 3,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4,
  plateThicknessMm: null, wallMm: 2.5, styleId: "freestyle", safetyFactor: 2, ...over,
});

const find = (s: FrameSpec, id: string) => validateDesign(designFrame(s)).find((f) => f.id === id);

describe("propFit", () => {
  it("accepts the pairing each motor is sold for", () => {
    for (const m of MOTORS) {
      for (const p of m.props) expect(propFit(m, p).fit, `${m.size} on ${p}"`).toBe("ideal");
    }
  });

  it("treats the edge of the envelope as workable, not ideal", () => {
    // A 2207 is a 5" motor that flies 4" perfectly well.
    expect(propFit(motorById("2207"), 4).fit).toBe("workable");
    expect(propFit(motorById("2207"), 6.5).fit).toBe("workable");
  });

  it("rejects the pairing the user asked about", () => {
    // The case that prompted this: nothing stopped 10" props on 1103 motors.
    const r = propFit(motorById("1103"), 10);
    expect(r.fit).toBe("wrong");
    expect(r.betterMotor?.size).toBe("3110");
    expect(r.betterProp).toBe(2.5);
  });

  it("rejects a prop far too small as well as far too large", () => {
    const small = propFit(motorById("3110"), 2);
    expect(small.fit).toBe("wrong");
    expect(small.betterMotor?.size).toBe("1103");
    expect(small.betterProp).toBe(8);
  });

  it("is monotonic — the envelope has no holes in it", () => {
    for (const m of MOTORS) {
      const verdicts = PROP_SIZES.map((p) => propFit(m, p).fit);
      // Once a size is wrong on the small side it cannot become wrong again
      // before becoming ok: the sequence must read wrong*, ok*, wrong*.
      const seq = verdicts.map((v) => (v === "wrong" ? "x" : "o")).join("");
      expect(seq, `${m.size}: ${seq}`).toMatch(/^x*o+x*$/);
    }
  });

  it("always names a way out when the pairing is wrong", () => {
    for (const m of MOTORS) {
      for (const p of PROP_SIZES) {
        const r = propFit(m, p);
        if (r.fit !== "wrong") continue;
        expect(r.betterProp, `${m.size} on ${p}"`).toBeDefined();
        // The prop it suggests must itself be a good pairing.
        expect(propFit(m, r.betterProp!).fit).toBe("ideal");
        // And the motor it suggests must actually take this prop.
        if (r.betterMotor) expect(propFit(r.betterMotor, p).fit).not.toBe("wrong");
      }
    }
  });
});

describe("the motor/prop finding", () => {
  it("is an error for a 1103 on 10in props", () => {
    const f = find(spec({ motorId: "1103", propIn: 10 }), "motor-prop-mismatch");
    expect(f?.severity).toBe("error");
    expect(f?.title).toContain("1103");
    expect(f?.detail).toMatch(/overheat|current/i);
    expect(f?.detail).toContain("3110");
  });

  it("explains a too-small prop differently from a too-large one", () => {
    const big = find(spec({ motorId: "1103", propIn: 10 }), "motor-prop-mismatch");
    const small = find(spec({ motorId: "3110", propIn: 2 }), "motor-prop-mismatch");
    expect(big?.detail).toMatch(/cannot supply|too small for/i);
    expect(small?.detail).toMatch(/far too small/i);
    expect(small?.detail).not.toMatch(/overheat/i);
  });

  it("warns rather than errors at the edge of the envelope", () => {
    const f = find(spec({ motorId: "2207", propIn: 4 }), "motor-prop-unusual");
    expect(f?.severity).toBe("warn");
    expect(find(spec({ motorId: "2207", propIn: 4 }), "motor-prop-mismatch")).toBeUndefined();
  });

  it("says nothing at all about the default pairing", () => {
    expect(find(spec(), "motor-prop-mismatch")).toBeUndefined();
    expect(find(spec(), "motor-prop-unusual")).toBeUndefined();
  });

  it("never emits a severity the review panel drops", () => {
    // The panel renders errors and warnings only, so an "ok" finding would be
    // invisible. Nothing may rely on that lane until the panel grows one.
    for (const m of ["1103", "2207", "3110"]) {
      for (const p of PROP_SIZES) {
        for (const f of validateDesign(designFrame(spec({ motorId: m, propIn: p })))) {
          expect(f.severity, `${f.id} on ${m}/${p}`).not.toBe("ok");
        }
      }
    }
  });
});

describe("the thrust default", () => {
  it("states a cell count for every motor, with a plausible KV window", () => {
    for (const m of MOTORS) {
      expect(m.thrustCells, m.size).toBeGreaterThanOrEqual(1);
      expect(m.thrustCells, m.size).toBeLessThanOrEqual(12);
      const [lo, hi] = m.kv;
      expect(lo, m.size).toBeGreaterThan(0);
      expect(hi, m.size).toBeGreaterThan(lo);
      // Bigger stators turn bigger props slower: KV must fall as size rises.
      expect(hi, m.size).toBeLessThan(30000);
    }
  });

  it("orders KV inversely to prop size across the range", () => {
    /*
      Only across a strict increase in prop size. Two motors in the same class
      — a 2207 and a 2306 are both 5" motors — may legitimately carry
      different windings, and demanding monotonicity within a class was a
      test bug rather than a data problem.
    */
    for (const a of MOTORS) {
      for (const b of MOTORS) {
        if (Math.max(...b.props) <= Math.max(...a.props)) continue;
        expect(b.kv[1], `${b.size} (${b.props.join("/")}") vs ${a.size} (${a.props.join("/")}")`).toBeLessThanOrEqual(a.kv[1]);
      }
    }
  });

  it("keeps propRange consistent with the recommended props", () => {
    for (const m of MOTORS) {
      const [lo, hi] = m.propRange;
      expect(lo, m.size).toBeLessThanOrEqual(Math.min(...m.props));
      expect(hi, m.size).toBeGreaterThanOrEqual(Math.max(...m.props));
    }
  });
});
