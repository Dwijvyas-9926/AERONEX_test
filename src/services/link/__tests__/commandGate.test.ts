import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { commandLink, vehicleBlock, COPTER_MODE } from "../commandLink";
import { useLink, type VehicleIdentity } from "../../../state/linkStore";
import { MavlinkParser, decode } from "../../../mavlink/parser";
import { isArduCopter } from "../../../mavlink/identity";

/*
  Every mode number and flight sequence in AERONEX is ArduCopter's. These
  pin down that nothing able to move a vehicle goes to anything else, and
  that a command whose reply is lost is sent again rather than reported as
  failed.
*/

const ident = (over: Partial<VehicleIdentity>): VehicleIdentity => ({
  sysid: 1, compid: 1, type: 2, typeLabel: "Quadrotor", autopilot: 3, firmware: "ardupilot", firmwareLabel: "ArduPilot",
  armed: false, mode: null, customMode: 0, systemStatus: "Standby", mavlinkVersion: 3, protocol: 2, ...over,
});

let sent: { name: string; d: Record<string, unknown> }[] = [];
beforeEach(() => {
  sent = [];
  const parser = new MavlinkParser();
  commandLink.attach(async (bytes) => {
    for (const f of parser.push(bytes)) sent.push({ name: f.name, d: decode(f) ?? {} });
  });
});
afterEach(() => {
  commandLink.detach();
  useLink.setState({ vehicle: null, status: "idle", virtual: false });
  vi.useRealTimers();
});

describe("which vehicles count as ArduCopter", () => {
  it("every frame ArduCopter reports, and nothing else", () => {
    for (const type of [2, 3, 4, 13, 14, 15, 29, 35]) expect(isArduCopter({ autopilot: 3, type })).toBe(true);
    // ArduPlane (fixed wing, and QuadPlane's VTOL types), Rover, Sub, and PX4 quads.
    for (const type of [1, 10, 11, 12, 19, 20, 21, 22]) expect(isArduCopter({ autopilot: 3, type })).toBe(false);
    expect(isArduCopter({ autopilot: 12, type: 2 })).toBe(false);
  });
});

describe("nothing that moves a vehicle goes to one that is not ArduCopter", () => {
  for (const [label, v] of [
    ["ArduPlane", ident({ type: 1, typeLabel: "Fixed Wing" })],
    ["Rover", ident({ type: 10, typeLabel: "Ground Rover" })],
    ["PX4", ident({ autopilot: 12, firmware: "px4", firmwareLabel: "PX4" })],
  ] as const) {
    it(`refuses arming, modes, take-off, guided moves, motor tests, calibration and missions on ${label}`, async () => {
      useLink.setState({ vehicle: v, status: "connected" });
      expect(vehicleBlock()?.title).toMatch(/ArduCopter only/);
      await expect(commandLink.arm(true)).rejects.toThrow(/ArduCopter only/);
      await expect(commandLink.setMode(COPTER_MODE.GUIDED)).rejects.toThrow(/ArduCopter only/);
      await expect(commandLink.guidedTakeoff(2)).rejects.toThrow(/ArduCopter only/);
      await expect(commandLink.uploadMission([])).rejects.toThrow(/ArduCopter only/);
      await expect(commandLink.startMission()).rejects.toThrow(/ArduCopter only/);
      commandLink.setVelocityBody(1, 0, 0, 0);
      await commandLink.motorTest(1, 10);
      await commandLink.startGyro();
      expect(sent).toHaveLength(0);
    });
  }

  it("still lets any vehicle be disarmed", async () => {
    vi.useFakeTimers();
    useLink.setState({ vehicle: ident({ type: 1, typeLabel: "Fixed Wing", armed: true }), status: "connected" });
    const r = commandLink.arm(false);
    commandLink.handle("COMMAND_ACK", { command: 400, result: 0 });
    await expect(r).resolves.toBe(0);
    expect(sent[0].name).toBe("COMMAND_LONG");
    expect(sent[0].d.param1).toBe(0);
  });

  it("lets ArduCopter through, and never sends a forced arm", async () => {
    useLink.setState({ vehicle: ident({}), status: "connected" });
    expect(vehicleBlock()).toBeNull();
    const r = commandLink.arm(true);
    commandLink.handle("COMMAND_ACK", { command: 400, result: 0 });
    await expect(r).resolves.toBe(0);
    expect(sent[0].d.param1).toBe(1);
    expect(sent[0].d.param2).toBe(0);
  });

  it("spins no motor on an armed aircraft, and refuses calibration in the air", async () => {
    useLink.setState({ vehicle: ident({ armed: true }), status: "connected" });
    await commandLink.motorTest(1, 10);
    await commandLink.startLevel();
    expect(sent).toHaveLength(0);
    const { useCalibration } = await import("../../../state/calibrationStore");
    expect(useCalibration.getState().level.phase).toBe("failed");
    expect(useCalibration.getState().level.message).toMatch(/Disarm/);
  });

  it("refuses a take-off to a height that is not a positive number", async () => {
    useLink.setState({ vehicle: ident({}), status: "connected" });
    await expect(commandLink.guidedTakeoff(Number.NaN)).rejects.toThrow(/positive/);
    await expect(commandLink.guidedTakeoff(-3)).rejects.toThrow(/positive/);
    expect(sent).toHaveLength(0);
  });
});

describe("a command whose reply is lost", () => {
  it("is sent again with the confirmation counted up, and succeeds when a reply comes", async () => {
    vi.useFakeTimers();
    useLink.setState({ vehicle: ident({}), status: "connected" });
    const r = commandLink.setMode(COPTER_MODE.LOITER);
    await vi.advanceTimersByTimeAsync(1600);
    await vi.advanceTimersByTimeAsync(1600);
    commandLink.handle("COMMAND_ACK", { command: 176, result: 0 });
    await expect(r).resolves.toBe(0);
    expect(sent.map((s) => s.d.confirmation)).toEqual([0, 1, 2]);
  });

  it("is given up after three tries, and says so", async () => {
    vi.useFakeTimers();
    useLink.setState({ vehicle: ident({}), status: "connected" });
    const r = commandLink.setMode(COPTER_MODE.LOITER);
    const caught = r.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(((await caught) as Error).message).toMatch(/after 3 tries/);
    expect(sent).toHaveLength(3);
  });

  it("is not sent again once the vehicle has refused it", async () => {
    vi.useFakeTimers();
    useLink.setState({ vehicle: ident({}), status: "connected" });
    const r = commandLink.arm(true);
    commandLink.handle("COMMAND_ACK", { command: 400, result: 4 });
    await expect(r).resolves.toBe(4);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
  });

  it("calibrations are never sent twice", async () => {
    vi.useFakeTimers();
    useLink.setState({ vehicle: ident({}), status: "connected" });
    void commandLink.startGyro();
    await vi.advanceTimersByTimeAsync(9000);
    expect(sent.filter((s) => s.name === "COMMAND_LONG")).toHaveLength(1);
  });
});
