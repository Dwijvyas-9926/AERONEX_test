import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { attitudeToEuler } from "../../../rendering/frames";
import { ManualController, noKeys, type Keys } from "../testFlight";

/* Manual flight must move and lean the way a pilot expects. */

const fly = (keys: Partial<Keys>, seconds = 1) => {
  const c = new ManualController();
  const k = { ...noKeys(), ...keys };
  let p = c.pose;
  for (let t = 0; t < seconds; t += 0.02) p = c.update(0.02, k);
  return p;
};

// The model's nose points along -Z and its right side along +X.
const nose = (roll: number, pitch: number, yaw: number) => new Vector3(0, 0, -1).applyEuler(attitudeToEuler(roll, pitch, yaw, new Euler()));
const rightWing = (roll: number, pitch: number, yaw: number) => new Vector3(1, 0, 0).applyEuler(attitudeToEuler(roll, pitch, yaw, new Euler()));

describe("manual test flight", () => {
  it("W flies forward with the nose dipped, S flies back with the nose raised", () => {
    const f = fly({ pitchFwd: true });
    expect(f.z).toBeLessThan(-0.5);
    expect(nose(f.roll, f.pitch, f.yaw).y).toBeLessThan(-0.1);

    const b = fly({ pitchBack: true });
    expect(b.z).toBeGreaterThan(0.5);
    expect(nose(b.roll, b.pitch, b.yaw).y).toBeGreaterThan(0.1);
  });

  it("D slides right with the right side low, A the other way", () => {
    const r = fly({ rollRight: true });
    expect(r.x).toBeGreaterThan(0.5);
    expect(rightWing(r.roll, r.pitch, r.yaw).y).toBeLessThan(-0.1);

    const l = fly({ rollLeft: true });
    expect(l.x).toBeLessThan(-0.5);
    expect(rightWing(l.roll, l.pitch, l.yaw).y).toBeGreaterThan(0.1);
  });

  it("E turns the nose to the right and the heading up; Q the other way", () => {
    const e = fly({ yawRight: true }, 0.5);
    expect(e.yaw).toBeGreaterThan(0.3);
    expect(nose(0, 0, e.yaw).x).toBeGreaterThan(0.2);

    const q = fly({ yawLeft: true }, 0.5);
    expect(q.yaw).toBeLessThan(-0.3);
    expect(nose(0, 0, q.yaw).x).toBeLessThan(-0.2);
  });

  it("after a right turn, W flies the way the nose points", () => {
    const c = new ManualController();
    for (let t = 0; t < 0.98; t += 0.02) c.update(0.02, { ...noKeys(), yawRight: true });
    const heading = c.pose.yaw;
    const x0 = c.pose.x, z0 = c.pose.z;
    for (let t = 0; t < 2; t += 0.02) c.update(0.02, { ...noKeys(), pitchFwd: true });
    const moved = new Vector3(c.pose.x - x0, 0, c.pose.z - z0).normalize();
    expect(moved.dot(nose(0, 0, heading))).toBeGreaterThan(0.95);
  });
});
