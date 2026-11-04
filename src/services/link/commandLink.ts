import { encode } from "../../mavlink/encode";
import type { Decoded } from "../../mavlink/parser";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { useCalibration, magCalOk } from "../../state/calibrationStore";
import { notify } from "../../state/notifyStore";

/*
  The command layer: the one place the app TALKS to the vehicle. It owns the
  GCS identity, encodes outbound frames (via mavlink/encode), hands them to the
  link's serial writer, tracks COMMAND_ACK / PARAM_VALUE replies, and routes the
  vehicle's calibration messages into the param and calibration stores.

  Writing is gated: commands only go out while a vehicle link is live, and the
  caller (the Calibration UI) additionally refuses anything motor-related unless
  the vehicle is disarmed and the operator has confirmed props are off.
*/

// MAVProxy/Mission Planner identify as system 255, component 190 (GCS).
const GCS = { sysid: 255, compid: 190 };

// MAV_CMD ids used here.
export const CMD = {
  PREFLIGHT_CALIBRATION: 241,
  PREFLIGHT_REBOOT_SHUTDOWN: 246,
  DO_START_MAG_CAL: 42424,
  DO_ACCEPT_MAG_CAL: 42425,
  DO_CANCEL_MAG_CAL: 42426,
  DO_MOTOR_TEST: 209,
  SET_MESSAGE_INTERVAL: 511,
} as const;

// MOTOR_TEST_THROTTLE_TYPE
const MOTOR_TEST_THROTTLE_PERCENT = 0;

// MAV_RESULT
export const MAV_RESULT: Record<number, string> = {
  0: "Accepted",
  1: "Temporarily rejected",
  2: "Denied",
  3: "Unsupported",
  4: "Failed",
  5: "In progress",
  6: "Cancelled",
};
const MAV_PARAM_TYPE_REAL32 = 9;

type SendFn = (bytes: Uint8Array) => Promise<void> | void;

interface PendingCmd {
  resolve: (result: number) => void;
  timer: ReturnType<typeof setTimeout>;
}

class CommandLink {
  private send: SendFn | null = null;
  private pendingCmds = new Map<number, PendingCmd>();
  private pendingParams = new Map<string, { resolve: () => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();

  /** Called by the link manager when the port's writer is ready / gone. */
  attach(send: SendFn) {
    this.send = send;
  }
  detach() {
    this.send = null;
    for (const p of this.pendingCmds.values()) clearTimeout(p.timer);
    for (const p of this.pendingParams.values()) {
      clearTimeout(p.timer);
      p.reject(new Error("Link closed"));
    }
    this.pendingCmds.clear();
    this.pendingParams.clear();
  }

  get canSend() {
    return !!this.send && !!useLink.getState().vehicle;
  }

  private target() {
    const v = useLink.getState().vehicle;
    if (!v) throw new Error("No vehicle connected");
    return { sysid: v.sysid, compid: v.compid };
  }

  private async write(name: string, fields: Record<string, number | string | number[]>) {
    if (!this.send) throw new Error("The serial link is not open for writing.");
    await this.send(encode(name, fields, GCS));
  }

  // ---- low-level ----

  /** Send a COMMAND_LONG and resolve with the MAV_RESULT from its COMMAND_ACK. */
  sendCommand(command: number, params: Partial<Record<"p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7", number>> = {}, confirmation = 0, timeoutMs = 4000): Promise<number> {
    const t = this.target();
    const fields = {
      target_system: t.sysid,
      target_component: t.compid,
      command,
      confirmation,
      param1: params.p1 ?? 0,
      param2: params.p2 ?? 0,
      param3: params.p3 ?? 0,
      param4: params.p4 ?? 0,
      param5: params.p5 ?? 0,
      param6: params.p6 ?? 0,
      param7: params.p7 ?? 0,
    };
    return new Promise<number>((resolve, reject) => {
      const prev = this.pendingCmds.get(command);
      if (prev) {
        clearTimeout(prev.timer);
        prev.resolve(-1);
      }
      const timer = setTimeout(() => {
        this.pendingCmds.delete(command);
        reject(new Error("No acknowledgement from the vehicle (timed out)."));
      }, timeoutMs);
      this.pendingCmds.set(command, { resolve, timer });
      this.write("COMMAND_LONG", fields).catch((e) => {
        clearTimeout(timer);
        this.pendingCmds.delete(command);
        reject(e as Error);
      });
    });
  }

  /** Write one parameter and resolve when the vehicle echoes the new value. */
  setParam(id: string, value: number, timeoutMs = 4000): Promise<void> {
    const t = this.target();
    useParams.getState().markPending(id, value);
    return new Promise<void>((resolve, reject) => {
      const prev = this.pendingParams.get(id);
      if (prev) {
        clearTimeout(prev.timer);
        prev.reject(new Error("Superseded"));
      }
      const timer = setTimeout(() => {
        this.pendingParams.delete(id);
        useParams.getState().markFailed(id);
        reject(new Error(`No confirmation for ${id} (timed out).`));
      }, timeoutMs);
      this.pendingParams.set(id, { resolve, reject, timer });
      this.write("PARAM_SET", { target_system: t.sysid, target_component: t.compid, param_id: id, param_value: value, param_type: MAV_PARAM_TYPE_REAL32 }).catch((e) => {
        clearTimeout(timer);
        this.pendingParams.delete(id);
        useParams.getState().markFailed(id);
        reject(e as Error);
      });
    });
  }

  /** Request a single parameter by name (param_index = -1 means "by id"). */
  async requestParam(id: string) {
    const t = this.target();
    await this.write("PARAM_REQUEST_READ", { target_system: t.sysid, target_component: t.compid, param_id: id, param_index: -1 });
  }

  /** Request a set of parameters by name, spaced slightly to avoid flooding. */
  async requestParams(ids: string[]) {
    for (const id of ids) {
      if (!this.canSend) return;
      await this.requestParam(id).catch(() => {});
      await delay(12);
    }
  }

  async requestAllParams() {
    const t = this.target();
    await this.write("PARAM_REQUEST_LIST", { target_system: t.sysid, target_component: t.compid });
  }

  /** Ask for a message to be streamed at a given rate (Hz) via SET_MESSAGE_INTERVAL. */
  async requestMessageInterval(msgId: number, hz: number) {
    const interval = hz > 0 ? Math.round(1e6 / hz) : -1;
    await this.sendCommand(CMD.SET_MESSAGE_INTERVAL, { p1: msgId, p2: interval }, 0, 2000).catch(() => {});
  }

  /** Request the standard ArduPilot data streams (MAV_DATA_STREAM groups) so the
      vehicle actually sends attitude, position, GPS, battery, RC, EKF and
      vibration. ArduPilot sends little beyond the heartbeat until asked. */
  async requestDataStreams() {
    if (!this.canSend) return;
    const t = this.target();
    // [MAV_DATA_STREAM id, rate Hz]
    const streams: [number, number][] = [
      [2, 2], // EXTENDED_STATUS: SYS_STATUS (sensor health), GPS_RAW_INT
      [6, 3], // POSITION: GLOBAL_POSITION_INT
      [10, 10], // EXTRA1: ATTITUDE
      [11, 4], // EXTRA2: VFR_HUD
      [12, 3], // EXTRA3: VIBRATION, EKF_STATUS_REPORT
      [3, 5], // RC_CHANNELS
      [1, 2], // RAW_SENSORS
    ];
    for (const [id, hz] of streams) {
      await this.write("REQUEST_DATA_STREAM", { target_system: t.sysid, target_component: t.compid, req_stream_id: id, req_message_rate: hz, start_stop: 1 }).catch(() => {});
    }
  }

  /** Fire-and-forget COMMAND_LONG (no ACK wait) — for commands resent at a rate. */
  private async sendCommandNoAck(command: number, params: Partial<Record<"p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7", number>>) {
    await this.write("COMMAND_LONG", this.cmdFields(command, params)).catch(() => {});
  }

  // ---- motor test ----

  /** Spin one motor (1-based, in test order) at a throttle %, auto-stopping after
      `timeoutS` so the motor halts if the GCS stops resending (dead-man safety). */
  async motorTest(motor: number, throttlePct: number, timeoutS = 3) {
    await this.sendCommandNoAck(CMD.DO_MOTOR_TEST, { p1: motor, p2: MOTOR_TEST_THROTTLE_PERCENT, p3: Math.max(0, Math.min(100, throttlePct)), p4: timeoutS, p5: 0, p6: 0 });
  }

  /** Stop one motor immediately (throttle 0, zero timeout). */
  async stopMotor(motor: number) {
    await this.sendCommandNoAck(CMD.DO_MOTOR_TEST, { p1: motor, p2: MOTOR_TEST_THROTTLE_PERCENT, p3: 0, p4: 0, p5: 0, p6: 0 });
  }

  async stopAllMotors(count: number) {
    for (let i = 1; i <= count; i++) await this.stopMotor(i);
  }

  // ---- accelerometer / level / gyro ----

  async startAccelCal() {
    useCalibration.getState().setAccel({ phase: "running", step: 0, prompt: null, awaitingConfirm: false, message: "Starting — keep the vehicle still for the gyro check." });
    try {
      await this.write("COMMAND_LONG", { ...this.cmdFields(CMD.PREFLIGHT_CALIBRATION, { p5: 1 }) });
    } catch (e) {
      useCalibration.getState().setAccel({ phase: "failed", message: (e as Error).message });
    }
  }

  /** Confirm the vehicle is in the requested position: ArduPilot expects a
      COMMAND_ACK carrying the step counter, then streams the next prompt. */
  async confirmAccelPosition() {
    const a = useCalibration.getState().accel;
    if (a.phase !== "running" || !a.awaitingConfirm) return;
    const step = a.step;
    useCalibration.getState().setAccel({ awaitingConfirm: false, prompt: null, step: step + 1, message: "Captured — collecting sample…" });
    try {
      await this.write("COMMAND_ACK", { command: step, result: 1 });
    } catch (e) {
      useCalibration.getState().setAccel({ phase: "failed", message: (e as Error).message });
    }
  }

  async startLevel() {
    useCalibration.getState().setLevel({ phase: "running", message: "Hold the vehicle level and still…" });
    try {
      const r = await this.sendCommand(CMD.PREFLIGHT_CALIBRATION, { p5: 2 }, 0, 8000);
      const ok = r === 0;
      useCalibration.getState().setLevel({ phase: ok ? "success" : "failed", message: ok ? "Level set." : `Vehicle returned: ${MAV_RESULT[r] ?? r}` });
    } catch (e) {
      useCalibration.getState().setLevel({ phase: "failed", message: (e as Error).message });
    }
  }

  async startGyro() {
    useCalibration.getState().setGyro({ phase: "running", message: "Keep the vehicle completely still…" });
    try {
      const r = await this.sendCommand(CMD.PREFLIGHT_CALIBRATION, { p1: 1 }, 0, 8000);
      const ok = r === 0;
      useCalibration.getState().setGyro({ phase: ok ? "success" : "failed", message: ok ? "Gyros calibrated." : `Vehicle returned: ${MAV_RESULT[r] ?? r}` });
    } catch (e) {
      useCalibration.getState().setGyro({ phase: "failed", message: (e as Error).message });
    }
  }

  // ---- compass (onboard MagCal) ----

  async startMagCal() {
    useCalibration.getState().setMag({ phase: "running", compasses: {}, message: "Rotate the vehicle through all orientations.", maxPct: 0, lastAdvanceAt: Date.now() });
    try {
      // p1=0 all compasses, p2=0 no auto-retry, p3=1 autosave on success, p5=0 no auto-reboot
      await this.sendCommand(CMD.DO_START_MAG_CAL, { p1: 0, p2: 0, p3: 1, p5: 0 }, 0, 4000);
    } catch (e) {
      useCalibration.getState().setMag({ phase: "failed", message: (e as Error).message });
    }
  }

  async cancelMagCal() {
    try {
      await this.sendCommand(CMD.DO_CANCEL_MAG_CAL, { p3: 1 }, 0, 3000);
    } catch {
      /* best effort */
    }
    useCalibration.getState().setMag({ phase: "cancelled", message: "Calibration cancelled." });
  }

  async acceptMagCal() {
    try {
      await this.sendCommand(CMD.DO_ACCEPT_MAG_CAL, { p3: 1 }, 0, 3000);
      useCalibration.getState().setMag({ message: "Calibration accepted and saved." });
    } catch (e) {
      useCalibration.getState().setMag({ message: (e as Error).message });
    }
  }

  async reboot() {
    // param1=1: reboot autopilot. Best-effort — the vehicle drops the link as it reboots.
    try {
      await this.write("COMMAND_LONG", { ...this.cmdFields(CMD.PREFLIGHT_REBOOT_SHUTDOWN, { p1: 1 }) });
    } catch {
      /* link will drop; that's expected */
    }
  }

  private cmdFields(command: number, p: Partial<Record<"p1" | "p2" | "p3" | "p4" | "p5" | "p6" | "p7", number>>) {
    const t = this.target();
    return {
      target_system: t.sysid,
      target_component: t.compid,
      command,
      confirmation: 0,
      param1: p.p1 ?? 0,
      param2: p.p2 ?? 0,
      param3: p.p3 ?? 0,
      param4: p.p4 ?? 0,
      param5: p.p5 ?? 0,
      param6: p.p6 ?? 0,
      param7: p.p7 ?? 0,
    };
  }

  // ---- inbound routing (called by the link manager for each decoded frame) ----

  handle(name: string, d: Decoded) {
    switch (name) {
      case "COMMAND_ACK": {
        const cmd = d.command as number;
        const result = d.result as number;
        const p = this.pendingCmds.get(cmd);
        if (p) {
          clearTimeout(p.timer);
          this.pendingCmds.delete(cmd);
          p.resolve(result);
        }
        break;
      }
      case "PARAM_VALUE": {
        const id = (d.param_id as string) ?? "";
        const value = d.param_value as number;
        const count = (d.param_count as number) ?? 0;
        useParams.getState().onParamValue(id, value, count);
        const pend = this.pendingParams.get(id);
        if (pend && Math.abs((useParams.getState().pending[id]?.target ?? value) - value) < 1e-4) {
          clearTimeout(pend.timer);
          this.pendingParams.delete(id);
          pend.resolve();
        }
        break;
      }
      case "STATUSTEXT": {
        this.onStatusText(String(d.text ?? ""));
        break;
      }
      case "MAG_CAL_PROGRESS": {
        const cal = useCalibration.getState();
        const id = d.compass_id as number;
        const prev = cal.mag.compasses[id];
        const pct = d.completion_pct as number;
        const coverage = countBits(d.completion_mask as number[] | undefined);
        cal.upsertMagCompass({
          id,
          pct,
          status: d.cal_status as number,
          fitness: prev?.fitness ?? null,
          offsets: prev?.offsets ?? null,
          autosaved: prev?.autosaved ?? false,
          coverage,
        });
        // Track overall progress so the UI can tell when a cal has stalled.
        if (pct > cal.mag.maxPct) cal.setMag({ maxPct: pct, lastAdvanceAt: Date.now() });
        break;
      }
      case "MAG_CAL_REPORT": {
        this.onMagReport(d);
        break;
      }
    }
  }

  private onStatusText(text: string) {
    const cal = useCalibration.getState();
    if (cal.accel.phase !== "running") return;
    // ArduPilot drives 6-point accel cal through STATUSTEXT prompts.
    if (/^place /i.test(text)) {
      cal.setAccel({ prompt: text.replace(/\s*and press any key\.?$/i, ""), awaitingConfirm: true, message: null });
    } else if (/calibration successful/i.test(text)) {
      cal.setAccel({ phase: "success", awaitingConfirm: false, prompt: null, message: "Calibration successful." });
    } else if (/calibration failed|cal failed/i.test(text)) {
      cal.setAccel({ phase: "failed", awaitingConfirm: false, prompt: null, message: text });
    }
  }

  private onMagReport(d: Decoded) {
    const cal = useCalibration.getState();
    const id = d.compass_id as number;
    const status = d.cal_status as number;
    cal.upsertMagCompass({
      id,
      pct: 100,
      status,
      fitness: (d.fitness as number) ?? null,
      offsets: [d.ofs_x as number, d.ofs_y as number, d.ofs_z as number],
      autosaved: (d.autosaved as number) === 1,
      coverage: cal.mag.compasses[id]?.coverage ?? 80,
    });
    // Resolve overall phase from all reported compasses.
    const all = Object.values(useCalibration.getState().mag.compasses);
    const done = all.length > 0 && all.every((c) => c.status >= 4);
    if (done) {
      const ok = all.every((c) => magCalOk(c.status));
      const saved = all.every((c) => c.autosaved);
      cal.setMag({
        phase: ok ? "success" : "failed",
        message: ok ? (saved ? "Compass calibrated and saved. Reboot to apply." : "Compass calibrated. Accept to save, then reboot.") : "Calibration failed on at least one compass. Try again in a clear area.",
      });
      if (ok && !saved) notify("info", "Compass cal complete", "Accept to save the offsets.");
    }
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Count set bits across a byte array (MAG_CAL_PROGRESS completion_mask = 80 sphere sections). */
function countBits(mask: number[] | undefined): number {
  if (!mask) return 0;
  let n = 0;
  for (const byte of mask) {
    let b = byte & 0xff;
    while (b) {
      n += b & 1;
      b >>= 1;
    }
  }
  return n;
}

export const commandLink = new CommandLink();
