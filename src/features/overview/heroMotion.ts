import { heightAt } from "../../rendering/terrain";

/*
  Preview flight for the Overview hero. This is a scripted demonstration path,
  not a physics simulation and not vehicle telemetry; the UI labels it so.
  Attitude is still derived consistently from the path: the aircraft tilts
  into its acceleration exactly as a multicopter must, and the instrument
  overlay reads the same numbers the 3D model uses.
*/

const G = 9.81;
export const HOVER_ANCHOR = { x: 4, z: 18 };
export const HOVER_ALT = 34; // metres above the terrain at the anchor

export interface HeroState {
  x: number;
  y: number;
  z: number;
  roll: number; // rad, right wing down positive
  pitch: number; // rad, nose up positive
  yaw: number; // rad, clockwise from north (-Z)
  agl: number;
  groundSpeed: number;
  climb: number;
  ground: number; // terrain height under the aircraft
}

export const heroState: HeroState = { x: 0, y: 0, z: 0, roll: 0, pitch: 0, yaw: 0, agl: 0, groundSpeed: 0, climb: 0, ground: 0 };

const baseGround = heightAt(HOVER_ANCHOR.x, HOVER_ANCHOR.z);

// Position as sums of sinusoids so velocity and acceleration are analytic.
const PX = [
  [7.5, 0.16, 0],
  [1.2, 0.47, 1.1],
];
const PZ = [
  [6.0, 0.13, 0.6],
  [1.0, 0.41, 2.3],
];
const PY = [[0.8, 0.29, 0.4]];

const pos = (terms: number[][], t: number) => terms.reduce((s, [a, w, p]) => s + a * Math.sin(w * t + p), 0);
const vel = (terms: number[][], t: number) => terms.reduce((s, [a, w, p]) => s + a * w * Math.cos(w * t + p), 0);
const acc = (terms: number[][], t: number) => terms.reduce((s, [a, w, p]) => s - a * w * w * Math.sin(w * t + p), 0);

export function stepHero(t: number, s: HeroState = heroState): HeroState {
  s.x = HOVER_ANCHOR.x + pos(PX, t);
  s.z = HOVER_ANCHOR.z + pos(PZ, t);
  s.y = baseGround + HOVER_ALT + pos(PY, t);

  const vx = vel(PX, t);
  const vz = vel(PZ, t);
  s.groundSpeed = Math.hypot(vx, vz);
  s.climb = vel(PY, t);

  // Slow, deliberate heading changes
  s.yaw = 0.55 * Math.sin(t * 0.07) - 0.35;

  // World acceleration -> body-aligned (yaw frame). Forward is -Z rotated by yaw.
  const ax = acc(PX, t);
  const az = acc(PZ, t);
  const ay = acc(PY, t);
  const fx = Math.sin(s.yaw);
  const fz = -Math.cos(s.yaw);
  const rx = Math.cos(s.yaw);
  const rz = Math.sin(s.yaw);
  const aFwd = ax * fx + az * fz;
  const aRight = ax * rx + az * rz;
  const lift = G + ay;
  s.pitch = -Math.atan2(aFwd, lift) * 2.5; // exaggerated slightly so the motion reads at hero scale
  s.roll = Math.atan2(aRight, lift) * 2.5;

  s.ground = heightAt(s.x, s.z);
  s.agl = s.y - s.ground;
  return s;
}
