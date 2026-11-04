import { beforeEach, describe, expect, it } from "vitest";
import { encode } from "../../../mavlink/encode";
import { VehicleSession } from "../vehicleSession";
import { commandLink } from "../commandLink";
import { useCalibration } from "../../../state/calibrationStore";
import { useParams } from "../../../state/paramStore";

/*
  End-to-end receive path: real MAVLink frames (built with our own encoder, the
  one proven byte-identical to pymavlink) are fed through the parser and the
  vehicle session exactly as serial bytes would be, and must land in the
  calibration/param stores via commandLink. This covers the new session routing
  of COMMAND_ACK / PARAM_VALUE / MAG_CAL_* that no other test touches.
*/

const VEH = { sysid: 1, compid: 1 };

function newSession() {
  const s = new VehicleSession(
    () => 1000,
    (name, d) => commandLink.handle(name, d),
  );
  // An ArduPilot autopilot heartbeat makes system 1 / component 1 the target.
  s.ingest(encode("HEARTBEAT", { type: 2, autopilot: 3, base_mode: 0, custom_mode: 0, system_status: 4, mavlink_version: 3 }, VEH));
  return s;
}

beforeEach(() => {
  useCalibration.getState().reset();
  useParams.getState().reset();
});

describe("calibration receive pipeline (encode → parse → session → store)", () => {
  it("locks onto the autopilot from its heartbeat", () => {
    const s = newSession();
    expect(s.vehicle?.sysid).toBe(1);
    expect(s.vehicle?.firmware).toBe("ardupilot");
  });

  it("routes MAG_CAL_PROGRESS to the compass bar", () => {
    const s = newSession();
    useCalibration.getState().setMag({ phase: "running" });
    s.ingest(encode("MAG_CAL_PROGRESS", { compass_id: 0, cal_status: 2, completion_pct: 55 }, VEH));
    expect(useCalibration.getState().mag.compasses[0].pct).toBe(55);
  });

  it("completes compass calibration from a MAG_CAL_REPORT", () => {
    const s = newSession();
    useCalibration.getState().setMag({ phase: "running" });
    s.ingest(encode("MAG_CAL_REPORT", { compass_id: 0, cal_status: 4, autosaved: 1, fitness: 2.5, ofs_x: 12, ofs_y: 3, ofs_z: -8 }, VEH));
    const mag = useCalibration.getState().mag;
    expect(mag.phase).toBe("success");
    expect(mag.compasses[0].offsets).toEqual([12, 3, -8]);
  });

  it("caches a PARAM_VALUE the vehicle sends", () => {
    const s = newSession();
    s.ingest(encode("PARAM_VALUE", { param_id: "FLTMODE1", param_value: 5, param_type: 9, param_count: 1100, param_index: 0 }, VEH));
    expect(useParams.getState().values["FLTMODE1"]).toBe(5);
    expect(useParams.getState().count).toBe(1100);
  });

  it("drives the accel prompt from a STATUSTEXT", () => {
    const s = newSession();
    useCalibration.getState().setAccel({ phase: "running", step: 0 });
    s.ingest(encode("STATUSTEXT", { severity: 6, text: "Place vehicle nose DOWN and press any key." }, VEH));
    expect(useCalibration.getState().accel.awaitingConfirm).toBe(true);
    expect(useCalibration.getState().accel.prompt).toBe("Place vehicle nose DOWN");
  });
});
