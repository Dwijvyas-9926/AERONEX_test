/*
  Keyboard Flight — the flight controller.

  Safety-critical, so it's written as a pure, dependency-injected state machine
  that can be driven by a mock autopilot in tests (see __tests__). It never
  touches MAVLink or React directly; the page wires real commands + telemetry in.

  Control model (verified against ArduPilot guided-mode docs):
   - Flight happens in GUIDED mode. Movement is body-relative velocity via
     SET_POSITION_TARGET_LOCAL_NED (vx forward, vy right, vz down, yaw_rate).
   - Every velocity is RAMPED toward its target at a limited acceleration, and
     capped low, so nothing is ever sudden. Releasing a key ramps it back to 0,
     and the vehicle then holds position (and brakes on its own ~3 s after the
     last command — a built-in dead-man hold).
   - Takeoff is MAV_CMD_NAV_TAKEOFF to a low altitude; Land is LAND mode, which
     auto-disarms once on the ground.
   - Range is fenced as height is: horizontal motion away from the take-off
     point stops short of maxRange, allowing for the braking distance, and
     without a fresh position from the aircraft there is no horizontal motion
     at all. Moving back towards the take-off point is always allowed.
*/

export type FlightPhase = "idle" | "arming" | "takeoff" | "flying" | "landing" | "emergency";

export interface FlightConfig {
  takeoffAlt: number; // m — target of the initial takeoff
  maxAlt: number; // m — climb ceiling (safety)
  maxRange: number; // m — horizontal distance from the take-off point (safety)
  maxHoriz: number; // m/s — forward/back/left/right cap
  maxClimb: number; // m/s — vertical cap
  maxYawRate: number; // rad/s — yaw cap
  horizAccel: number; // m/s² — how fast horizontal velocity may change
  climbAccel: number; // m/s² — vertical
  yawAccel: number; // rad/s² — yaw
  tickMs: number; // control-loop period
}

// Gentle, student-safe defaults. ~1.5 m/s walk pace, ~20°/s yaw, soft ramps.
export const DEFAULT_CONFIG: FlightConfig = {
  takeoffAlt: 2,
  maxAlt: 10,
  maxRange: 20,
  maxHoriz: 1.5,
  maxClimb: 0.5,
  maxYawRate: 0.35,
  horizAccel: 0.6,
  climbAccel: 0.4,
  yawAccel: 0.6,
  tickMs: 100,
};

export interface KeyState {
  fwd: boolean;
  back: boolean;
  left: boolean;
  right: boolean;
  up: boolean;
  yawLeft: boolean;
  yawRight: boolean;
}
export const NO_KEYS: KeyState = { fwd: false, back: false, left: false, right: false, up: false, yawLeft: false, yawRight: false };

export interface Telemetry {
  armed: boolean;
  relAlt: number | null;
  mode: number | null;
  connected: boolean;
  /** Fresh horizontal position, metres north and east of any fixed point; null when there is none. */
  pos: { n: number; e: number } | null;
  /** Fresh heading, radians clockwise from north; null when there is none. */
  heading: number | null;
}

export type LogLevel = "info" | "warn" | "error" | "action";

export interface FlightDeps {
  arm: (on: boolean) => Promise<number>;
  setMode: (mode: number) => Promise<number>;
  takeoff: (alt: number) => Promise<number>;
  setVelocity: (vx: number, vy: number, vz: number, yawRate: number) => void;
  getTelemetry: () => Telemetry;
  now: () => number;
  log: (level: LogLevel, message: string) => void;
  onChange: (s: FlightState) => void;
}

export interface FlightState {
  phase: FlightPhase;
  vx: number;
  vy: number;
  vz: number;
  yawRate: number;
  relAlt: number | null;
  armed: boolean;
}

const MODE = { GUIDED: 4, RTL: 6, LAND: 9 } as const;
const MAV_RESULT_ACCEPTED = 0;
/** How long to wait for a mode change to show in telemetry before re-sending, ms. */
const RESEND_MS = 1500;
/** Attempts after which the pilot is told the aircraft is not listening. */
const GIVE_UP_AFTER = 4;

const approach = (cur: number, target: number, maxStep: number) => {
  if (cur < target) return Math.min(cur + maxStep, target);
  if (cur > target) return Math.max(cur - maxStep, target);
  return target;
};

export class FlightController {
  private keys: KeyState = { ...NO_KEYS };
  private vx = 0;
  private vy = 0;
  private vz = 0;
  private yawRate = 0;
  private phaseV: FlightPhase = "idle";
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false; // a command sequence is in flight
  /** The mode a descent was asked for in, and when it was last asked. */
  private descent: { mode: number; sentAt: number; tries: number } | null = null;
  private warnedNoAlt = false;
  /** Where the aircraft took off, in the same frame as Telemetry.pos. */
  private origin: { n: number; e: number } | null = null;
  private warnedRange = false;
  private warnedNoPos = false;
  private deps: FlightDeps;
  config: FlightConfig;

  constructor(deps: FlightDeps, config: FlightConfig = DEFAULT_CONFIG) {
    this.deps = deps;
    this.config = config;
  }

  get phase() {
    return this.phaseV;
  }

  private setPhase(p: FlightPhase) {
    this.phaseV = p;
    this.emit();
  }

  private emit() {
    const t = this.deps.getTelemetry();
    this.deps.onChange({ phase: this.phaseV, vx: this.vx, vy: this.vy, vz: this.vz, yawRate: this.yawRate, relAlt: t.relAlt, armed: t.armed });
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.config.tickMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.neutralize();
  }

  setKeys(next: Partial<KeyState>) {
    this.keys = { ...this.keys, ...next };
  }

  /** Immediately command zero motion (used on focus loss / stop). Does not land. */
  neutralize() {
    this.keys = { ...NO_KEYS };
    this.vx = this.vy = this.vz = this.yawRate = 0;
    if (this.phaseV === "flying") this.deps.setVelocity(0, 0, 0, 0);
    this.emit();
  }

  /** T on the ground: arm in GUIDED and take off; T in the air just climbs (handled in tick). */
  async requestTakeoff(): Promise<void> {
    const t = this.deps.getTelemetry();
    if (this.busy || this.phaseV !== "idle") return;
    if (!t.connected) return this.deps.log("error", "Not connected — can't take off.");
    if (t.armed) return this.deps.log("error", "Vehicle is already armed. Land/disarm first.");
    this.busy = true;
    this.warnedNoAlt = false;
    this.warnedRange = false;
    this.warnedNoPos = false;
    this.origin = t.pos ? { ...t.pos } : null;
    this.setPhase("arming");
    try {
      this.deps.log("action", "Switching to GUIDED…");
      if ((await this.deps.setMode(MODE.GUIDED)) !== MAV_RESULT_ACCEPTED) throw new Error("GUIDED mode was rejected (check GPS fix and pre-arm).");
      this.deps.log("action", "Arming…");
      if ((await this.deps.arm(true)) !== MAV_RESULT_ACCEPTED) throw new Error("Arming was rejected (pre-arm checks failed).");
      // Confirm it actually armed before commanding a climb.
      await this.waitFor(() => this.deps.getTelemetry().armed, 4000, "Vehicle did not arm.");
      this.deps.log("action", `Taking off to ${this.config.takeoffAlt} m…`);
      if ((await this.deps.takeoff(this.config.takeoffAlt)) !== MAV_RESULT_ACCEPTED) throw new Error("Takeoff command was rejected.");
      this.setPhase("takeoff");
    } catch (e) {
      this.deps.log("error", (e as Error).message);
      // Safety: if something failed mid-sequence, bring it down.
      await this.safeLand();
    } finally {
      this.busy = false;
    }
  }

  /**
   * Ask the autopilot to come down, and keep asking until it has.
   *
   * A mode change is one packet over a radio link, and its reply is another.
   * This used to send it once: if either was lost, or the autopilot refused,
   * the screen said "Landing" while the aircraft sat in a hover with the
   * keys disabled — the one state in which the pilot believes something is
   * happening that is not. The control loop now watches the reported mode
   * and re-sends until the vehicle is actually in it.
   */
  private async descend(mode: number, what: string): Promise<void> {
    this.neutralize();
    this.descent = { mode, sentAt: this.deps.now(), tries: 1 };
    this.setPhase("landing");
    try {
      const r = await this.deps.setMode(mode);
      if (r !== MAV_RESULT_ACCEPTED) this.deps.log("error", `${what} was not accepted — sending it again.`);
    } catch {
      this.deps.log("error", `${what} got no reply — sending it again.`);
    }
  }

  /** L: land gradually at the current position; the vehicle auto-disarms on the ground. */
  async requestLand(): Promise<void> {
    if (this.phaseV === "idle" || (this.phaseV === "landing" && this.descent?.mode === MODE.LAND)) return;
    this.deps.log("action", "Landing — descending gently and will disarm on the ground.");
    await this.descend(MODE.LAND, "The land command");
  }

  /** Emergency: Return-To-Launch (climbs to RTL alt, flies home, lands). */
  async emergencyRTL(): Promise<void> {
    this.deps.log("warn", "RETURN TO HOME commanded.");
    await this.descend(MODE.RTL, "Return-to-home");
  }

  /** Emergency stop in place: brake to a hover (does not land). */
  emergencyHold() {
    this.neutralize();
    this.deps.log("warn", "HOLD — braking to a hover.");
  }

  /** Last-resort: cut the motors. Only safe on the ground. */
  async disarmNow(): Promise<void> {
    this.neutralize();
    this.deps.log("warn", "DISARM commanded.");
    await this.deps.arm(false).catch(() => this.deps.log("error", "Disarm failed."));
  }

  private async safeLand() {
    if (this.deps.getTelemetry().armed) {
      await this.descend(MODE.LAND, "The land command");
    } else {
      this.setPhase("idle");
    }
  }

  private async waitFor(cond: () => boolean, timeoutMs: number, failMsg: string) {
    const start = this.deps.now();
    while (!cond()) {
      if (this.deps.now() - start > timeoutMs) throw new Error(failMsg);
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  /**
   * The forward/right velocity target, with any part that would carry the
   * aircraft beyond maxRange of the take-off point taken out. The limit is
   * applied early by the distance needed to brake from the present speed, so
   * the ramp brings it to a stop at the limit rather than past it.
   */
  private limitRange(t: Telemetry, fwd: number, right: number): [number, number] {
    if (fwd === 0 && right === 0) return [0, 0];
    if (!t.pos || t.heading == null) {
      if (!this.warnedNoPos) {
        this.warnedNoPos = true;
        this.deps.log("warn", "No position or heading from the aircraft — horizontal moves are held until it reports again.");
      }
      return [0, 0];
    }
    this.warnedNoPos = false;
    if (!this.origin) this.origin = { ...t.pos };
    const dn = t.pos.n - this.origin.n;
    const de = t.pos.e - this.origin.e;
    const dist = Math.hypot(dn, de);
    const speed = Math.hypot(this.vx, this.vy);
    const brake = (speed * speed) / (2 * this.config.horizAccel) + speed * (this.config.tickMs / 1000);
    if (dist < 0.01 || dist + brake < this.config.maxRange) return [fwd, right];
    const un = dn / dist;
    const ue = de / dist;
    const c = Math.cos(t.heading);
    const s = Math.sin(t.heading);
    // Body (forward, right) to north/east, remove the outward part, and back.
    let wn = fwd * c - right * s;
    let we = fwd * s + right * c;
    const out = wn * un + we * ue;
    if (out <= 0) return [fwd, right];
    wn -= out * un;
    we -= out * ue;
    if (!this.warnedRange) {
      this.warnedRange = true;
      this.deps.log("warn", `Range limit: ${this.config.maxRange} m from the take-off point. You can still fly back towards it.`);
    }
    return [wn * c + we * s, -wn * s + we * c];
  }

  /** The control loop. Pure given telemetry; call manually in tests. */
  tick() {
    const t = this.deps.getTelemetry();
    const dt = this.config.tickMs / 1000;

    // Link lost mid-flight: stop sending; the vehicle's GCS failsafe handles the rest.
    if (!t.connected && (this.phaseV === "flying" || this.phaseV === "takeoff")) {
      this.deps.log("error", "Link lost — vehicle failsafe will take over.");
      this.setPhase("emergency");
      return;
    }

    switch (this.phaseV) {
      case "takeoff": {
        // Wait for the autopilot's takeoff to reach altitude, then hand over to the pilot.
        if (!this.origin && t.pos) this.origin = { ...t.pos };
        if (t.relAlt != null && t.relAlt >= this.config.takeoffAlt * 0.9) {
          this.deps.log("info", `Reached ${t.relAlt.toFixed(1)} m — you have control (WASD / Q,E / T up / L land).`);
          this.setPhase("flying");
        } else if (!t.armed) {
          this.deps.log("error", "Disarmed during takeoff.");
          this.setPhase("idle");
        } else if (t.relAlt == null && !this.warnedNoAlt) {
          // Without a height there is no knowing when the climb is done, so
          // control is never handed over. Say why, once, rather than sit
          // silent in "taking off".
          this.warnedNoAlt = true;
          this.deps.log("warn", "No height reading from the aircraft yet — waiting for position data. Press L to land.");
        }
        break;
      }
      case "flying": {
        /*
          Keyboard control only means anything while the aircraft is armed
          and in GUIDED. If it has disarmed — a crash, or the autopilot's own
          landing detector — or someone has switched mode on the radio, the
          velocity targets below are ignored by the vehicle while the screen
          goes on showing them as commanded. Say what happened and let go.
        */
        if (!t.armed) {
          this.deps.log("warn", "The aircraft disarmed.");
          this.vx = this.vy = this.vz = this.yawRate = 0;
          this.setPhase("idle");
          break;
        }
        if (t.mode !== null && t.mode !== MODE.GUIDED) {
          this.vx = this.vy = this.vz = this.yawRate = 0;
          if (t.mode === MODE.LAND || t.mode === MODE.RTL) {
            this.deps.log("warn", "The aircraft was switched to a landing mode — keyboard control released.");
            this.descent = { mode: t.mode, sentAt: this.deps.now(), tries: 1 };
            this.setPhase("landing");
          } else {
            this.deps.log("warn", "Flight mode was changed from the radio — keyboard control released.");
            this.setPhase("emergency");
          }
          break;
        }
        // Targets from keys, kept inside the range limit.
        const [vxT, vyT] = this.limitRange(
          t,
          (this.keys.fwd ? this.config.maxHoriz : 0) + (this.keys.back ? -this.config.maxHoriz : 0),
          (this.keys.right ? this.config.maxHoriz : 0) + (this.keys.left ? -this.config.maxHoriz : 0),
        );
        // vz is +down; "up" means negative. Anticipate the altitude ceiling: stop
        // commanding climb once the remaining room is only the braking distance,
        // so it coasts gently to a stop at maxAlt instead of overshooting.
        let vzT = this.keys.up ? -this.config.maxClimb : 0;
        if (t.relAlt != null && vzT < 0) {
          const brakeDist = (this.vz * this.vz) / (2 * this.config.climbAccel);
          if (t.relAlt + brakeDist >= this.config.maxAlt) vzT = 0;
        }
        const yawT = (this.keys.yawRight ? this.config.maxYawRate : 0) + (this.keys.yawLeft ? -this.config.maxYawRate : 0);

        // Ramp toward targets (gradual, no sudden movement).
        this.vx = approach(this.vx, vxT, this.config.horizAccel * dt);
        this.vy = approach(this.vy, vyT, this.config.horizAccel * dt);
        this.vz = approach(this.vz, vzT, this.config.climbAccel * dt);
        this.yawRate = approach(this.yawRate, yawT, this.config.yawAccel * dt);

        this.deps.setVelocity(this.vx, this.vy, this.vz, this.yawRate);
        this.emit();
        break;
      }
      case "landing": {
        if (!t.armed) {
          this.deps.log("info", "Landed and disarmed. ✔");
          this.descent = null;
          this.setPhase("idle");
          break;
        }
        // Still up, and not in the mode that was asked for: ask again.
        const d = this.descent;
        if (d && t.connected && t.mode !== null && t.mode !== d.mode && this.deps.now() - d.sentAt >= RESEND_MS) {
          d.sentAt = this.deps.now();
          d.tries++;
          if (d.tries === GIVE_UP_AFTER) {
            this.deps.log("error", "The aircraft is not accepting the command. Take over on the radio if you have one.");
          }
          void this.deps.setMode(d.mode).catch(() => {});
        }
        break;
      }
      case "emergency": {
        // Recover once the vehicle is reachable and safely disarmed.
        if (t.connected && !t.armed) {
          this.deps.log("info", "Vehicle is disarmed — ready again.");
          this.setPhase("idle");
        }
        break;
      }
      default:
        break;
    }
  }
}
