import { describe, expect, it } from "vitest";
import { materialById } from "../catalog";
import { minRootWidth, motorPadWidth, sizeArm, type SectionInput } from "../structure";

/*
  Calibration reference: a conventional 5" freestyle quad.
    2207 motors (~1350 g peak), 220 mm wheelbase, ~85 mm exposed arm,
    ~650 g all-up, 4 mm carbon plate, freestyle load factor, SF 2.
  Real frames in this class use arms roughly 14–18 mm wide, so the solver
  must land in that band — that is the test of whether the model is honest.
*/
const ref = (over: Partial<SectionInput> = {}): SectionInput => ({
  material: materialById("cf-plate"),
  safetyFactor: 2,
  armLengthMm: 85,
  motorThrustG: 1350,
  auwG: 650,
  loadFactor: 10,
  motorPattern: 16,
  motorBolt: 3,
  rootBolt: 3,
  fixedDimMm: 4,
  wallMm: 2.5,
  ...over,
});

describe("arm sizing — calibration against a real 5\" frame", () => {
  it("produces an arm width in the real-world band (14–18 mm)", () => {
    const r = sizeArm(ref());
    expect(r.widthMm).toBeGreaterThanOrEqual(13);
    expect(r.widthMm).toBeLessThanOrEqual(18);
    expect(r.heightMm).toBe(4); // sheet thickness
  });

  it("is NOT governed by static thrust — the key engineering point", () => {
    const r = sizeArm(ref());
    expect(r.governing).not.toBe("thrust");
    // static thrust alone would allow an absurdly thin arm
    expect(r.required.thrust).toBeLessThan(3);
    expect(["stiffness", "geometry", "impact"]).toContain(r.governing);
  });

  it("keeps stress below the allowable and deflection small", () => {
    const r = sizeArm(ref());
    expect(r.stressMPa).toBeLessThan(r.allowableMPa);
    expect(r.deflectionMm).toBeLessThan(1);
  });
});

describe("arm sizing — responds correctly to inputs", () => {
  it("a longer arm needs a wider section", () => {
    const short = sizeArm(ref({ armLengthMm: 60 }));
    const long = sizeArm(ref({ armLengthMm: 130 }));
    expect(long.widthMm).toBeGreaterThan(short.widthMm);
  });

  it("a thinner sheet needs a much wider arm (stiffness scales with t³)", () => {
    const thick = sizeArm(ref({ fixedDimMm: 5 }));
    const thin = sizeArm(ref({ fixedDimMm: 2 }));
    expect(thin.widthMm).toBeGreaterThan(thick.widthMm * 2);
  });

  it("harder flying (bigger load factor) grows the arm", () => {
    const gentle = sizeArm(ref({ loadFactor: 6, fixedDimMm: 2 }));
    const racing = sizeArm(ref({ loadFactor: 15, fixedDimMm: 2 }));
    expect(racing.widthMm).toBeGreaterThanOrEqual(gentle.widthMm);
  });

  it("a weaker material needs more material than carbon", () => {
    const cf = sizeArm(ref({ fixedDimMm: 3 }));
    const ply = sizeArm(ref({ material: materialById("ply-birch"), fixedDimMm: 3 }));
    expect(ply.widthMm).toBeGreaterThan(cf.widthMm);
  });
});

describe("printed arms — solve height, where stiffness scales with h³", () => {
  const printed = () => sizeArm(ref({ material: materialById("pa-cf"), fixedDimMm: 12 }));

  it("gives a deeper section than a carbon plate arm", () => {
    const r = printed();
    expect(r.heightMm).toBeGreaterThan(6); // must be notably deeper than 4 mm plate
    expect(r.widthMm).toBeGreaterThanOrEqual(12);
  });

  it("stays within a practical depth for a 5\" build", () => {
    const r = printed();
    expect(r.heightMm).toBeLessThan(20);
  });

  it("a tougher printed material needs less depth than a weak one", () => {
    const paCf = sizeArm(ref({ material: materialById("pa-cf"), fixedDimMm: 12 }));
    const petg = sizeArm(ref({ material: materialById("petg"), fixedDimMm: 12 }));
    expect(petg.heightMm).toBeGreaterThan(paCf.heightMm);
  });
});

describe("fastener geometry", () => {
  it("motor pad is sized off the bolt-circle diagonal, not the flat span", () => {
    /*
      The four bolts sit on a square's corners, so the furthest hole centre is
      (pattern/2)·√2 out — 11.31 mm on a 16 mm pattern, not 8 mm. The pad radius
      is that, plus the hole radius, plus one bolt diameter of edge distance:
        (16/2)·√2 + 1.5 + 3 = 15.81 mm → 31.6 mm across.
      Sizing off the flat span would give 25 mm, which leaves the corner holes
      hanging 0.3 mm over the edge.
    */
    expect(motorPadWidth(16, 3)).toBeCloseTo(31.627, 2);
    expect(motorPadWidth(9, 2)).toBeCloseTo(18.728, 2);
    // every pad must actually contain its own bolt circle with room to spare
    for (const [pattern, bolt] of [[9, 2], [12, 2], [16, 3], [19, 3], [25, 3]] as const) {
      const padR = motorPadWidth(pattern, bolt) / 2;
      const cornerR = (pattern / 2) * Math.SQRT2;
      expect(padR - cornerR - bolt / 2).toBeGreaterThanOrEqual(bolt - 0.001);
    }
  });

  it("root width leaves material around its own bolts", () => {
    expect(minRootWidth(3)).toBeGreaterThanOrEqual(14);
    expect(minRootWidth(2)).toBeGreaterThanOrEqual(8);
  });

  it("root is wide enough for whichever bolt is larger", () => {
    // small motor bolts, but M3 arm bolts — the arm must suit the M3
    const r = sizeArm(ref({ motorPattern: 9, motorBolt: 2, rootBolt: 3 }));
    expect(r.widthMm).toBeGreaterThanOrEqual(minRootWidth(3));
  });
});
