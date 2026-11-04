import { describe, expect, it } from "vitest";
import { advise, ALL_PID_PARAMS } from "../pidModel";

describe("PID tuning advisor", () => {
  it("maps fast wobble to lowering rate D", () => {
    const [a] = advise("it wobbles fast when hovering");
    expect(a.id).toBe("fast-horizontal");
    expect(a.recs[0].params).toEqual(["ATC_RAT_RLL_D", "ATC_RAT_PIT_D"]);
    expect(a.recs[0].direction).toBe("decrease");
  });

  it("maps slow rocking to lowering rate P", () => {
    const [a] = advise("slow rocking side to side");
    expect(a.id).toBe("slow-horizontal");
    expect(a.recs[0].params).toEqual(["ATC_RAT_RLL_P", "ATC_RAT_PIT_P"]);
  });

  it("maps vertical bounce to the PSC accel-Z gains", () => {
    const [a] = advise("the drone bounces up and down");
    expect(a.id).toBe("vertical-bounce");
    expect(a.recs[0].params).toEqual(["PSC_ACCZ_P"]);
  });

  it("maps twitchy and sluggish to opposite directions on angle P", () => {
    expect(advise("feels twitchy")[0].recs[0].direction).toBe("decrease");
    expect(advise("sluggish to respond")[0].recs[0].direction).toBe("increase");
  });

  it("maps nose wag to yaw rate P", () => {
    const [a] = advise("the nose wags left and right");
    expect(a.id).toBe("yaw");
    expect(a.recs[0].params).toEqual(["ATC_RAT_YAW_P"]);
  });

  it("flags position drift as not-a-PID with guidance and no auto-apply recs", () => {
    const [a] = advise("it drifts and won't hold position");
    expect(a.id).toBe("drift");
    expect(a.recs).toHaveLength(0);
    expect(a.note).toMatch(/compass|GPS/i);
  });

  it("returns nothing for an unrelated description", () => {
    expect(advise("the paint is blue")).toHaveLength(0);
  });

  it("returns at most two ranked results", () => {
    expect(advise("fast wobble and bounces up and down and nose wag").length).toBeLessThanOrEqual(2);
  });

  it("every advisor parameter is a real control the page exposes (apply targets exist)", () => {
    const known = new Set(ALL_PID_PARAMS);
    for (const phrase of ["fast wobble", "slow rocking", "bounces up and down", "twitchy", "sluggish", "nose wag"]) {
      for (const a of advise(phrase)) for (const r of a.recs) for (const p of r.params) expect(known.has(p)).toBe(true);
    }
  });
});
