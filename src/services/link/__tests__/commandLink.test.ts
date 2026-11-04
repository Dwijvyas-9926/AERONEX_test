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
