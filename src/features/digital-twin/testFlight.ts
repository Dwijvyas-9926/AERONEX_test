/*
  Test-flight motion for an imported model. Two independent drivers that output
  the same pose shape, so the viewport and HUD don't care which is active:

  - Scripted: an analytic figure-eight over a flat pad. Attitude is derived from
    the path's acceleration, so the model banks into turns like a multicopter.
  - Manual: a kinematic keyboard controller. Stick inputs set target velocities
    (not forces), so it's responsive and stable for checking that the model reads
    correctly in motion. It is NOT a physics model and is labelled as such.
*/

const G = 9.81;

export interface Pose {
  x: number;
  y: number;
  z: number;
  roll: number;
  pitch: number;
  yaw: number;
  agl: number;
  groundSpeed: number;
  climb: number;
}

export const newPose = (): Pose => ({ x: 0, y: 1.2, z: 0, roll: 0, pitch: 0, yaw: 0, agl: 1.2, groundSpeed: 0, climb: 0 });

// ---- Scripted figure-eight ----
const AX = 3.2;
const AZ = 2.0;
const W = 0.5;
const HOVER_Y = 1.25;

export function stepScripted(t: number, p: Pose): Pose {
  p.x = AX * Math.sin(W * t);
  p.z = AZ * Math.sin(2 * W * t);
  p.y = HOVER_Y + 0.25 * Math.sin(W * t * 0.7);

  const vx = AX * W * Math.cos(W * t);
  const vz = AZ * 2 * W * Math.cos(2 * W * t);
  const ax = -AX * W * W * Math.sin(W * t);
  const az = -AZ * 4 * W * W * Math.sin(2 * W * t);
  p.groundSpeed = Math.hypot(vx, vz);
  p.climb = 0.25 * W * 0.7 * Math.cos(W * t * 0.7);

  // Face the direction of travel
  p.yaw = Math.atan2(vx, -vz);
  const fx = Math.sin(p.yaw);
  const fz = -Math.cos(p.yaw);
  const rx = Math.cos(p.yaw);
  const rz = Math.sin(p.yaw);
  const aFwd = ax * fx + az * fz;
  const aRight = ax * rx + az * rz;
  p.pitch = -Math.atan2(aFwd, G) * 1.8;
  p.roll = Math.atan2(aRight, G) * 1.8;
  p.agl = p.y;
  return p;
}

// ---- Manual kinematic controller ----
export interface Keys {
  pitchFwd: boolean; // W
  pitchBack: boolean; // S
  rollLeft: boolean; // A
  rollRight: boolean; // D
  yawLeft: boolean; // Q
  yawRight: boolean; // E
  up: boolean; // Shift / Space
  down: boolean; // Ctrl
}

export const noKeys = (): Keys => ({ pitchFwd: false, pitchBack: false, rollLeft: false, rollRight: false, yawLeft: false, yawRight: false, up: false, down: false });

const MAX_H_SPEED = 3.0; // m/s target
const MAX_V_SPEED = 2.0;
const YAW_RATE = 1.6; // rad/s
const ACCEL = 4.0; // how fast velocity chases the target
const MAX_TILT = 0.4; // rad, visual bank at full stick

export class ManualController {
  pose = newPose();
  private vx = 0;
  private vz = 0;
  private vy = 0;

  reset() {
    this.pose = newPose();
    this.vx = this.vz = this.vy = 0;
  }

  update(dt: number, k: Keys): Pose {
    const p = this.pose;
    const step = Math.min(dt, 0.05);

    const fwd = (k.pitchFwd ? 1 : 0) - (k.pitchBack ? 1 : 0);
    const right = (k.rollRight ? 1 : 0) - (k.rollLeft ? 1 : 0);
    // Yaw is a compass heading: positive turns clockwise, to the right (E).
    const yawIn = (k.yawRight ? 1 : 0) - (k.yawLeft ? 1 : 0);
    const climbIn = (k.up ? 1 : 0) - (k.down ? 1 : 0);

    p.yaw += yawIn * YAW_RATE * step;

    // Target velocity in body frame -> world
    const sin = Math.sin(p.yaw);
    const cos = Math.cos(p.yaw);
    const tFwdX = sin * MAX_H_SPEED * fwd;
    const tFwdZ = -cos * MAX_H_SPEED * fwd;
    const tRightX = cos * MAX_H_SPEED * right;
    const tRightZ = sin * MAX_H_SPEED * right;
    const tx = tFwdX + tRightX;
    const tz = tFwdZ + tRightZ;
    const ty = climbIn * MAX_V_SPEED;

    const lerp = 1 - Math.exp(-ACCEL * step);
    this.vx += (tx - this.vx) * lerp;
    this.vz += (tz - this.vz) * lerp;
    this.vy += (ty - this.vy) * lerp;

    p.x += this.vx * step;
    p.z += this.vz * step;
    p.y += this.vy * step;
    if (p.y < 0) {
      p.y = 0;
      this.vy = 0;
    }

    // Visual attitude from commanded horizontal motion: a multicopter tilts
    // into the way it is going. Pitch is nose-up positive, so moving forward
    // (W) dips the nose; roll is right-wing-down positive.
    p.pitch = -fwd * MAX_TILT * 0.9;
    p.roll = right * MAX_TILT * 0.9;
    p.groundSpeed = Math.hypot(this.vx, this.vz);
    p.climb = this.vy;
    p.agl = p.y;
    return p;
  }
}

/** Shared live pose for the HUD overlay (written by the scene each frame). */
export const livePose: Pose = newPose();
