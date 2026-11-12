import { cellOcv, derive, G, NOMINAL_CELL_V, RHO, type Airframe, type Derived } from "./airframe";

/*
  Rigid-body flight dynamics for an X quadcopter.

  Frames follow the aerospace convention ArduPilot uses: the world is
  north-east-down with the origin at home on the ground, the body is
  forward-right-down. Motors are numbered as ArduCopter numbers them:
  1 front-right (CCW), 2 rear-left (CCW), 3 front-left (CW), 4 rear-right (CW).

  What is modelled: thrust with a first-order motor lag, thrust falling with
  battery sag, gyroscopic coupling, quadratic and linear drag against the
  air mass, steady wind with turbulence, ground contact, and a battery that
  discharges by the power the propellers draw. What is not: blade flapping,
  ground effect, propeller wash interaction, frame flex or sensor errors.
*/

export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number]; // w, x, y, z

/** Sign of each motor's x, y and spin (+1 = counter-clockwise from above). */
export const MOTORS: { sx: number; sy: number; c: number }[] = [
  { sx: 1, sy: 1, c: 1 },
  { sx: -1, sy: -1, c: 1 },
  { sx: 1, sy: -1, c: -1 },
  { sx: -1, sy: 1, c: -1 },
];

export interface Environment {
  /** Steady wind: speed in m/s and the compass bearing it blows FROM, degrees. */
  windSpeed: number;
  windFromDeg: number;
  /** Gust strength as a fraction of the steady wind, 0–1. */
  gust: number;
}

export interface Faults {
  /** Thrust each motor can still make, 0–1. */
  motor: [number, number, number, number];
}

export interface PhysState {
  t: number;
  pos: Vec3; // NED, m
  vel: Vec3; // NED, m/s
  acc: Vec3; // NED, m/s², from the last step
  q: Quat;
  w: Vec3; // body rates, rad/s
  thrust: [number, number, number, number]; // N
  usedMah: number;
  volts: number;
  amps: number;
  onGround: boolean;
  crashed: boolean;
  /** Vertical speed at the last touch-down, m/s. */
  lastImpact: number;
  /** Why a touch-down counted as a crash. */
  crashWhy: "impact" | "tipped" | "sliding" | null;
  /** Sideways speed at the last touch-down, m/s. */
  lastSlide: number;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const euler = (q: Quat): { roll: number; pitch: number; yaw: number } => {
  const [w, x, y, z] = q;
  return {
    roll: Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)),
    pitch: Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))),
    yaw: Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z)),
  };
};

export const quatFromYaw = (yaw: number): Quat => [Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)];

/** Rotate a body-frame vector into the world frame. */
export function toWorld(q: Quat, v: Vec3): Vec3 {
  const [w, x, y, z] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + (y * tz - z * ty), vy + w * ty + (z * tx - x * tz), vz + w * tz + (x * ty - y * tx)];
}

export class Physics {
  readonly af: Airframe;
  readonly d: Derived;
  env: Environment = { windSpeed: 0, windFromDeg: 0, gust: 0 };
  faults: Faults = { motor: [1, 1, 1, 1] };
  s: PhysState;
  private rand: () => number;
  private gustN = 0;
  private gustE = 0;
  private gustD = 0;

  constructor(af: Airframe, opts: { soc?: number; yawDeg?: number; seed?: number } = {}) {
    this.af = af;
    this.d = derive(af);
    this.rand = mulberry32(opts.seed ?? 1);
    const soc = opts.soc ?? 1;
    this.s = {
      t: 0,
      pos: [0, 0, 0],
      vel: [0, 0, 0],
      acc: [0, 0, 0],
      q: quatFromYaw(((opts.yawDeg ?? 0) * Math.PI) / 180),
      w: [0, 0, 0],
      thrust: [0, 0, 0, 0],
      usedMah: (1 - soc) * af.capacityMah,
      volts: af.cells * cellOcv(soc),
      amps: 0,
      onGround: true,
      crashed: false,
      lastImpact: 0,
      crashWhy: null,
      lastSlide: 0,
    };
  }

  get soc() {
    return 1 - this.s.usedMah / this.af.capacityMah;
  }

  /** Wind velocity of the air mass, NED, including the current gust. */
  wind(): Vec3 {
    const { windSpeed, windFromDeg } = this.env;
    const to = ((windFromDeg + 180) * Math.PI) / 180;
    return [windSpeed * Math.cos(to) + this.gustN, windSpeed * Math.sin(to) + this.gustE, this.gustD];
  }

  /** Advance by dt with each motor commanded 0–1 of its full thrust. */
  step(cmd: [number, number, number, number], dt: number) {
    const { af, d, s } = this;

    // Turbulence: a first-order random process, about a 3 s correlation time.
    if (this.env.gust > 0 && this.env.windSpeed > 0) {
      const sigma = this.env.gust * this.env.windSpeed;
      const k = dt / 3;
      const n = () => (this.rand() + this.rand() + this.rand() - 1.5) * 2;
      const drive = sigma * Math.sqrt(2 * k);
      this.gustN += -this.gustN * k + drive * n();
      this.gustE += -this.gustE * k + drive * n();
      this.gustD += -this.gustD * k + 0.4 * drive * n();
    } else {
      this.gustN = this.gustE = this.gustD = 0;
    }

    // Motors: thrust available falls with the square of pack voltage.
    const vf = Math.min(1.16, Math.max(0, s.volts / (af.cells * NOMINAL_CELL_V)) ** 2);
    let total = 0;
    let power = 0;
    for (let i = 0; i < 4; i++) {
      const want = Math.max(0, Math.min(1, cmd[i])) * af.motorMaxThrustN * vf * this.faults.motor[i];
      s.thrust[i] += (want - s.thrust[i]) * Math.min(1, dt / d.motorTauS);
      total += s.thrust[i];
      // Momentum-theory induced power for one disc, over a 50% overall efficiency.
      power += s.thrust[i] ** 1.5 / Math.sqrt(2 * RHO * (d.discArea / 4)) / 0.5;
    }

    // Battery.
    const amps = power / Math.max(3, s.volts) + 0.6;
    s.amps = amps;
    s.usedMah += (amps * dt) / 3.6;
    s.volts = Math.max(0, af.cells * cellOcv(this.soc) - amps * d.rPack);

    // Torques about the body axes.
    let tx = 0;
    let ty = 0;
    let tz = 0;
    for (let i = 0; i < 4; i++) {
      const m = MOTORS[i];
      tx += -m.sy * d.a * s.thrust[i];
      ty += m.sx * d.a * s.thrust[i];
      tz += m.c * d.kYaw * s.thrust[i];
    }
    const [p, q, r] = s.w;
    // A little aerodynamic damping of rotation.
    tx -= 0.02 * d.Ixx * p * 10;
    ty -= 0.02 * d.Iyy * q * 10;
    tz -= 0.02 * d.Izz * r * 10;
    const wd: Vec3 = [
      (tx - (d.Izz - d.Iyy) * q * r) / d.Ixx,
      (ty - (d.Ixx - d.Izz) * p * r) / d.Iyy,
      (tz - (d.Iyy - d.Ixx) * p * q) / d.Izz,
    ];

    // Forces in the world frame.
    const f = toWorld(s.q, [0, 0, -total]);
    const wind = this.wind();
    const va: Vec3 = [s.vel[0] - wind[0], s.vel[1] - wind[1], s.vel[2] - wind[2]];
    const speed = Math.hypot(va[0], va[1], va[2]);
    const kq = 0.5 * RHO * d.cdA * speed;
    const kl = 0.25 * af.massKg;
    const acc: Vec3 = [
      (f[0] - (kq + kl) * va[0]) / af.massKg,
      (f[1] - (kq + kl) * va[1]) / af.massKg,
      (f[2] - (kq + 0.5 * kl) * va[2]) / af.massKg + G,
    ];

    if (s.onGround) {
      // Sitting on the ground: it leaves only when thrust beats weight.
      if (acc[2] >= 0 || s.crashed) {
        s.vel = [0, 0, 0];
        s.acc = [0, 0, 0];
        s.w = [0, 0, 0];
        s.pos[2] = 0;
        if (!s.crashed) s.q = quatFromYaw(euler(s.q).yaw);
        s.t += dt;
        return;
      }
      s.onGround = false;
    }

    s.acc = acc;
    for (let i = 0; i < 3; i++) {
      s.vel[i] += acc[i] * dt;
      s.pos[i] += s.vel[i] * dt;
      s.w[i] += wd[i] * dt;
    }
    // Integrate attitude.
    const [qw, qx, qy, qz] = s.q;
    const [wx, wy, wz] = s.w;
    const h = 0.5 * dt;
    const nq: Quat = [
      qw + h * (-qx * wx - qy * wy - qz * wz),
      qx + h * (qw * wx + qy * wz - qz * wy),
      qy + h * (qw * wy - qx * wz + qz * wx),
      qz + h * (qw * wz + qx * wy - qy * wx),
    ];
    const n = Math.hypot(nq[0], nq[1], nq[2], nq[3]) || 1;
    s.q = [nq[0] / n, nq[1] / n, nq[2] / n, nq[3] / n];

    // Ground contact.
    if (s.pos[2] >= 0) {
      const e = euler(s.q);
      const tilt = Math.acos(Math.max(-1, Math.min(1, Math.cos(e.roll) * Math.cos(e.pitch))));
      const impact = s.vel[2];
      const slide = Math.hypot(s.vel[0], s.vel[1]);
      s.lastImpact = impact;
      // Harder than a firm landing, tipped over, or skidding fast: a crash.
      if (!s.crashed) {
        s.crashWhy = impact > 2.5 ? "impact" : tilt > 0.9 ? "tipped" : slide > 4 ? "sliding" : null;
        s.lastSlide = slide;
      }
      if (s.crashWhy) s.crashed = true;
      s.pos[2] = 0;
      s.vel = [0, 0, 0];
      s.w = [0, 0, 0];
      s.onGround = true;
      if (!s.crashed) s.q = quatFromYaw(e.yaw);
    }
    s.t += dt;
  }
}
