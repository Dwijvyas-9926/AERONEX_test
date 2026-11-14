import { describe, expect, it } from "vitest";
import { armingChecks, firmwareName, withOlderNames } from "../paramNames";

describe("parameter names across ArduCopter releases", () => {
  it("finds 4.7's name and the factor from the older units", () => {
    expect(firmwareName("RTL_ALT", { RTL_ALT_M: 15 })).toEqual({ name: "RTL_ALT_M", scale: 0.01 });
    expect(firmwareName("PSC_ACCZ_P", { PSC_D_ACC_P: 0.05 })).toEqual({ name: "PSC_D_ACC_P", scale: 0.1 });
    expect(firmwareName("RTL_ALT", { RTL_ALT: 1500 })).toEqual({ name: "RTL_ALT", scale: 1 });
    expect(firmwareName("FRAME_CLASS", { WP_SPD: 10 })).toEqual({ name: "FRAME_CLASS", scale: 1 });
  });

  it("reads 4.7 values back under the older names and units", () => {
    expect(withOlderNames({ PSC_D_ACC_P: 0.05 }).PSC_ACCZ_P).toBeCloseTo(0.5);
    expect(withOlderNames({ RTL_ALT_M: 20 }).RTL_ALT).toBe(2000);
  });

  it("reads whether arming checks run, on either release", () => {
    expect(armingChecks({ ARMING_CHECK: 1 })).toBe("all");
    expect(armingChecks({ ARMING_CHECK: 0 })).toBe("none");
    expect(armingChecks({ ARMING_CHECK: 2 })).toBe("some");
    expect(armingChecks({ ARMING_SKIPCHK: 0 })).toBe("all");
    expect(armingChecks({ ARMING_SKIPCHK: -1 })).toBe("none");
    expect(armingChecks({ ARMING_SKIPCHK: 8 })).toBe("some");
    expect(armingChecks({})).toBeNull();
  });
});
