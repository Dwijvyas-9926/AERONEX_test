import { describe, expect, it } from "vitest";
import fixtures from "./fixtures.json";
import { decode, MavlinkParser } from "../parser";

const F = fixtures as Record<string, number[]>;
const all = Object.values(F).map((a) => new Uint8Array(a));

/** A small deterministic generator, so a failure can be reproduced. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe("the framer under a hostile stream", () => {
  it("finds every frame however the bytes are split across reads", () => {
    const stream = new Uint8Array(all.reduce((n, a) => n + a.length, 0));
    let o = 0;
    for (const a of all) { stream.set(a, o); o += a.length; }
    for (let cut = 1; cut < stream.length; cut += 3) {
      const p = new MavlinkParser();
      const got = [...p.push(stream.subarray(0, cut)), ...p.push(stream.subarray(cut))];
      expect(got.length, `split at ${cut}`).toBe(all.length);
    }
    // And one byte at a time, which is what a slow serial link looks like.
    const p = new MavlinkParser();
    let n = 0;
    for (const b of stream) n += p.push(new Uint8Array([b])).length;
    expect(n).toBe(all.length);
  });

  it("recovers real frames from between runs of line noise", () => {
    const rand = rng(7);
    const parts: Uint8Array[] = [];
    let expected = 0;
    for (let i = 0; i < 400; i++) {
      const noise = new Uint8Array(Math.floor(rand() * 40));
      // Bias the noise towards the two start bytes, the worst case for a framer.
      for (let k = 0; k < noise.length; k++) noise[k] = rand() < 0.3 ? (rand() < 0.5 ? 0xfd : 0xfe) : Math.floor(rand() * 256);
      parts.push(noise, all[i % all.length]);
      expected++;
    }
    const p = new MavlinkParser();
    let got = 0;
    for (const part of parts) {
      for (const f of p.push(part)) {
        got++;
        expect(decode(f)).not.toBeNull();
      }
    }
    // Noise ending in a start byte can swallow the head of the frame behind
    // it until more bytes prove it false, so a handful may be lost — but
    // never most, and never a crash.
    expect(got).toBeGreaterThan(expected * 0.9);
    expect(got).toBeLessThanOrEqual(expected);
  });

  it("never throws on pure garbage, and never emits a frame from it", () => {
    const rand = rng(99);
    const p = new MavlinkParser();
    let frames = 0;
    for (let i = 0; i < 300; i++) {
      const junk = new Uint8Array(1 + Math.floor(rand() * 2000));
      for (let k = 0; k < junk.length; k++) junk[k] = Math.floor(rand() * 256);
      frames += p.push(junk).length;
    }
    // A 16-bit checksum will pass by chance about once in 65,536 candidates.
    expect(frames).toBeLessThan(3);
  });

  it("survives a single read larger than its whole buffer", () => {
    const p = new MavlinkParser();
    const huge = new Uint8Array((1 << 20) + 5000).fill(0x55);
    expect(() => p.push(huge)).not.toThrow();
    // And still works afterwards.
    expect(p.push(all[0])).toHaveLength(1);
  });

  it("decodes a payload shorter than the message without reading past it", () => {
    const [f] = new MavlinkParser().push(all[0]);
    const short = { ...f, payload: f.payload.subarray(0, 1) };
    const d = decode(short)!;
    for (const v of Object.values(d)) {
      if (typeof v === "number") expect(Number.isFinite(v)).toBe(true);
    }
  });
});
