import { Euler } from "three";

/*
  Coordinate conventions (used by every 3D view in the app)

  World / render frame (three.js): right-handed, Y up, metres.
    +X = east, +Y = up, -Z = north.
  Aircraft body frame in render space: nose along -Z, right wing along +X, top along +Y.

  Autopilot frame (MAVLink / ArduPilot / PX4): NED, metres.
    +N north, +E east, +D down. Attitude roll/pitch/yaw in radians,
    roll right-wing-down positive, pitch nose-up positive, yaw clockwise from north.

  Conversions below are the single source of truth. Imported CAD models get their
  own "model -> body" correction in Digital Twin Studio (Phase 3); that is a visual
  correction only and never changes autopilot orientation parameters.
*/

export function nedToWorld(n: number, e: number, d: number): [number, number, number] {
  return [e, -d, -n];
}

/** Aerospace ZYX (yaw, pitch, roll) mapped onto three.js intrinsic YXZ. */
export function attitudeToEuler(roll: number, pitch: number, yaw: number, out = new Euler()): Euler {
  return out.set(pitch, -yaw, -roll, "YXZ");
}
