import { beforeEach, describe, expect, it } from "vitest";
import { commandLink } from "../commandLink";
import { useCalibration } from "../../../state/calibrationStore";
import { useParams } from "../../../state/paramStore";

/*
  The vehicle-message routing in commandLink.handle drives every calibration
  flow, and there's no hardware to exercise it, so these tests feed it the exact
  decoded messages ArduPilot sends and assert the stores land in the right state.
*/

beforeEach(() => {
  useCalibration.getState().reset();
  useParams.getState().reset();
});

describe("accelerometer calibration via STATUSTEXT", () => {
  it("a 'Place ...' prompt puts the flow into awaiting-confirm and strips the keypress hint", () => {
    useCalibration.getState().setAccel({ phase: "running", step: 0 });
    commandLink.handle("STATUSTEXT", { severity: 6, text: "Place vehicle LEVEL and press any key." });
    const a = useCalibration.getState().accel;
    expect(a.awaitingConfirm).toBe(true);
    expect(a.prompt).toBe("Place vehicle LEVEL");
  });

  it("a success message completes the flow", () => {
    useCalibration.getState().setAccel({ phase: "running", step: 6 });
    commandLink.handle("STATUSTEXT", { severity: 6, text: "Calibration successful" });
    expect(useCalibration.getState().accel.phase).toBe("success");
  });

  it("ignores prompts when no accel calibration is running", () => {
    commandLink.handle("STATUSTEXT", { severity: 6, text: "Place vehicle level" });
    expect(useCalibration.getState().accel.awaitingConfirm).toBe(false);
  });
});

describe("compass calibration via MAG_CAL messages", () => {
  it("progress updates each compass bar", () => {
    useCalibration.getState().setMag({ phase: "running" });
    commandLink.handle("MAG_CAL_PROGRESS", { compass_id: 0, completion_pct: 42, cal_status: 2 });
    const c = useCalibration.getState().mag.compasses[0];
    expect(c.pct).toBe(42);
    expect(c.status).toBe(2);
  });

  it("a success report with autosave completes and records offsets", () => {
    useCalibration.getState().setMag({ phase: "running" });
    commandLink.handle("MAG_CAL_REPORT", { compass_id: 0, cal_status: 4, autosaved: 1, fitness: 3.2, ofs_x: 10, ofs_y: -20, ofs_z: 5 });
    const mag = useCalibration.getState().mag;
    expect(mag.phase).toBe("success");
    expect(mag.compasses[0].offsets).toEqual([10, -20, 5]);
    expect(mag.compasses[0].autosaved).toBe(true);
  });

  it("a failed report marks the flow failed", () => {
    useCalibration.getState().setMag({ phase: "running" });
    commandLink.handle("MAG_CAL_REPORT", { compass_id: 0, cal_status: 5, autosaved: 0, fitness: 99, ofs_x: 0, ofs_y: 0, ofs_z: 0 });
    expect(useCalibration.getState().mag.phase).toBe("failed");
  });
});

describe("parameter echo", () => {
  it("PARAM_VALUE populates the cache and clears a matching pending write", () => {
    useParams.getState().markPending("MOT_PWM_TYPE", 6);
    expect(useParams.getState().pending["MOT_PWM_TYPE"]).toBeTruthy();
    commandLink.handle("PARAM_VALUE", { param_id: "MOT_PWM_TYPE", param_value: 6, param_count: 900, param_type: 9 });
    expect(useParams.getState().values["MOT_PWM_TYPE"]).toBe(6);
    expect(useParams.getState().pending["MOT_PWM_TYPE"]).toBeUndefined();
    expect(useParams.getState().count).toBe(900);
  });

  it("keeps a pending write marked when the echo doesn't match yet", () => {
    useParams.getState().markPending("MOT_SPIN_ARM", 0.1);
    commandLink.handle("PARAM_VALUE", { param_id: "MOT_SPIN_ARM", param_value: 0.05, param_count: 900, param_type: 9 });
    expect(useParams.getState().pending["MOT_SPIN_ARM"]).toBeTruthy();
  });
});

describe("when the link goes away or drops packets", () => {
  const vehicle = { sysid: 1, compid: 1 } as never;

  it("settles a command that was in flight, instead of leaving it waiting for ever", async () => {
    const { useLink } = await import("../../../state/linkStore");
    useLink.setState({ vehicle });
    commandLink.attach(async () => {});
    const pending = commandLink.sendCommand(400, { p1: 1 }, 0, 60_000);
    commandLink.detach();
    await expect(pending).rejects.toThrow(/Link closed/);
    useLink.setState({ vehicle: null });
  });

  it("does not throw out of the velocity timer once the vehicle is gone", async () => {
    const { useLink } = await import("../../../state/linkStore");
    useLink.setState({ vehicle: null });
    commandLink.attach(async () => {});
    expect(() => commandLink.setVelocityBody(1, 0, 0, 0)).not.toThrow();
    commandLink.detach();
  });

  it("clears a pending write when a large value comes back as the float it was stored as", () => {
    // 16777217 is not representable in a float32; the vehicle echoes 16777216.
    useParams.getState().markPending("BIG_VALUE", 16777217);
    commandLink.handle("PARAM_VALUE", { param_id: "BIG_VALUE", param_value: Math.fround(16777217), param_count: 10, param_index: 65535 });
    expect(useParams.getState().pending.BIG_VALUE).toBeUndefined();
  });

  it("asks again for parameters the list download lost", async () => {
    const { vi } = await import("vitest");
    const { useLink } = await import("../../../state/linkStore");
    const { MavlinkParser, decode } = await import("../../../mavlink/parser");
    vi.useFakeTimers();
    try {
      useLink.setState({ vehicle });
      const sent: { name: string; index: number }[] = [];
      const parser = new MavlinkParser();
      commandLink.attach(async (bytes) => {
        for (const f of parser.push(bytes)) sent.push({ name: f.name, index: (decode(f)?.param_index as number) ?? -1 });
      });
      await commandLink.requestAllParams();
      // Ten parameters; numbers 3 and 7 never arrive.
      for (let i = 0; i < 10; i++) {
        if (i === 3 || i === 7) continue;
        commandLink.handle("PARAM_VALUE", { param_id: `P_${i}`, param_value: i, param_count: 10, param_index: i });
      }
      expect(useParams.getState().received).toBe(8);
      await vi.advanceTimersByTimeAsync(3500);
      const asked = sent.filter((s) => s.name === "PARAM_REQUEST_READ").map((s) => s.index);
      expect(new Set(asked)).toEqual(new Set([3, 7]));
      // Once they arrive, it stops asking.
      commandLink.handle("PARAM_VALUE", { param_id: "P_3", param_value: 3, param_count: 10, param_index: 3 });
      commandLink.handle("PARAM_VALUE", { param_id: "P_7", param_value: 7, param_count: 10, param_index: 7 });
      const before = sent.length;
      await vi.advanceTimersByTimeAsync(6000);
      expect(sent.length).toBe(before);
      expect(useParams.getState().received).toBe(10);
    } finally {
      commandLink.detach();
      useLink.setState({ vehicle: null });
      vi.useRealTimers();
    }
  });
});
