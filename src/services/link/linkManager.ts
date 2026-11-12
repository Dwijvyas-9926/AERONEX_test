import { describeUsbDevice, hasWebSerial } from "../capabilities";
import { emptyStats, useLink, type LinkError } from "../../state/linkStore";
import { VehicleSession } from "./vehicleSession";
import { commandLink } from "./commandLink";
import { useParams } from "../../state/paramStore";
import { useCalibration } from "../../state/calibrationStore";
import { VirtualVehicle, type VehicleOptions } from "../../sim/vehicle";

/*
  Owns the physical serial connection. Reads are always safe; writes are used
  only by the command layer (commandLink) for calibration — commands and
  parameter sets the operator explicitly triggers. Nothing is written
  autonomously, and the UI gates anything motor-related behind a disarmed,
  props-off confirmation.
*/

const HEARTBEAT_TIMEOUT_MS = 8000; // first heartbeat must arrive within this window
const STALE_AFTER_MS = 3000; // heartbeats are nominally 1 Hz
const FLUSH_MS = 200;

class LinkManager {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private session: VehicleSession | null = null;
  private timers: number[] = [];
  private closing = false;
  private dirty = false;
  /** Settles when the read loop has let go of the port. */
  private readDone: Promise<void> = Promise.resolve();
  /** The simulator's aircraft, when that is what the link leads to. */
  private virtual: VirtualVehicle | null = null;
  /** Simulated seconds per real second. */
  simSpeed = 1;

  /** The virtual aircraft on the link, for the simulator's own controls. */
  get sim(): VirtualVehicle | null {
    return this.virtual;
  }

  /**
   * Put the virtual aircraft on the link in place of a serial port.
   *
   * Everything downstream is the same as for hardware: its MAVLink bytes go
   * through the same session and parser, and commands reach it as the bytes
   * they would be on a cable. Only the transport differs.
   */
  connectVirtual(options: VehicleOptions) {
    const { status } = useLink.getState();
    if (["selecting", "opening", "listening", "no-heartbeat", "connected", "stale"].includes(status)) return;
    const vehicle = new VirtualVehicle(options);
    this.virtual = vehicle;
    this.closing = false;
    this.simSpeed = 1;
    useParams.getState().reset();
    useCalibration.getState().reset();
    this.session = new VehicleSession(undefined, (name, d) => commandLink.handle(name, d));
    commandLink.attach(async (bytes) => {
      vehicle.receive(bytes);
    });
    this.session.log("info", `Virtual aircraft started: ${options.airframe.name}. It speaks MAVLink like a flight controller, but nothing here is hardware.`);
    useLink.setState({
      status: "listening",
      virtual: true,
      error: null,
      portLabel: "Virtual aircraft",
      openedAt: Date.now(),
      connectedAt: null,
      lastHeartbeatAt: null,
      vehicle: null,
      telemetry: {},
      stats: emptyStats(),
      events: this.session.events,
      recentFrames: [],
    });
    let last = performance.now();
    this.timers.push(
      window.setInterval(() => {
        const now = performance.now();
        const real = (now - last) / 1000;
        last = now;
        // A background tab, or a slow frame of the 3D view, runs timers rarely.
        // Do not leap the aircraft forward to catch up — but do let its
        // telemetry clock keep real time, or its once-a-second heartbeat
        // falls behind and the link is reported stale while it is fine.
        vehicle.advance(Math.min(0.25, real) * this.simSpeed, Math.min(5, real));
        const out = vehicle.drain();
        if (out.length && this.session) {
          if (this.session.ingest(out)) this.flush(true);
          this.dirty = true;
        }
      }, 20),
    );
    this.timers.push(window.setInterval(() => this.flush(), FLUSH_MS));
    this.timers.push(window.setInterval(() => this.watchdog(), 500));
    this.timers.push(window.setInterval(() => this.session?.tickRates(), 1000));
  }

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("pagehide", () => void this.disconnect("Page closed."));
      if (hasWebSerial()) {
        navigator.serial!.addEventListener("disconnect", (e) => {
          if (e.target === this.port) void this.fail("lost", "The serial device was disconnected.");
        });
      }
    }
  }

  /** List ports this site already has permission for (no prompt). */
  async grantedPorts(): Promise<SerialPort[]> {
    if (!hasWebSerial()) return [];
    try {
      return await navigator.serial!.getPorts();
    } catch {
      return [];
    }
  }

  /** Must be called from a user gesture when `port` is not supplied. */
  async connect(port?: SerialPort) {
    if (!hasWebSerial()) return;
    const { status } = useLink.getState();
    if (["selecting", "opening", "listening", "no-heartbeat", "connected", "stale"].includes(status)) return;

    let chosen = port;
    if (!chosen) {
      useLink.setState({ status: "selecting", error: null });
      try {
        chosen = await navigator.serial!.requestPort();
      } catch (e) {
        // User closed the chooser without picking a port.
        useLink.setState({ status: "idle" });
        if ((e as DOMException)?.name !== "NotFoundError") this.setError(openError(e));
        return;
      }
    }

    const { baud } = useLink.getState();
    useLink.setState({ status: "opening", virtual: false, error: null, portLabel: describeUsbDevice(chosen.getInfo()) });
    try {
      await chosen.open({ baudRate: baud, bufferSize: 16384 });
    } catch (e) {
      useLink.setState({ status: "error", error: openError(e), portLabel: null });
      return;
    }

    this.port = chosen;
    this.closing = false;
    useParams.getState().reset();
    useCalibration.getState().reset();
    this.session = new VehicleSession(undefined, (name, d) => commandLink.handle(name, d));
    // Open the write side so the command layer can send calibration commands.
    try {
      this.writer = chosen.writable?.getWriter() ?? null;
    } catch {
      this.writer = null;
    }
    commandLink.attach((bytes) => this.writeBytes(bytes));
    this.session.log("info", `Serial port opened at ${baud.toLocaleString()} baud. Listening for MAVLink.`);
    const t = Date.now();
    useLink.setState({
      status: "listening",
      openedAt: t,
      connectedAt: null,
      lastHeartbeatAt: null,
      vehicle: null,
      telemetry: {},
      stats: emptyStats(),
      events: this.session.events,
      recentFrames: [],
    });

    this.timers.push(window.setInterval(() => this.flush(), FLUSH_MS));
    this.timers.push(window.setInterval(() => this.watchdog(), 500));
    this.timers.push(window.setInterval(() => this.session?.tickRates(), 1000));
    // Keep the standard data streams flowing (survives a vehicle reboot or a
    // dropped request). ArduPilot sends little beyond the heartbeat otherwise.
    this.timers.push(window.setInterval(() => this.streamKeepalive(), 5000));
    this.readDone = this.readLoop().catch(() => undefined);
  }

  async disconnect(reason = "Disconnected by user.") {
    if (!this.port && !this.virtual) {
      if (useLink.getState().status !== "idle") useLink.setState({ status: "idle" });
      return;
    }
    this.session?.log("info", reason);
    await this.teardown();
    useLink.setState({ status: "idle", virtual: false, vehicle: null, connectedAt: null, openedAt: null, portLabel: null, events: this.session?.events ?? [] });
  }

  private async readLoop() {
    const port = this.port;
    while (port && port.readable && !this.closing) {
      this.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value && this.session) {
            if (this.session.ingest(value)) this.flush(true);
            this.dirty = true;
          }
        }
      } catch (e) {
        // Framing/parity/break errors are recoverable: readable is replaced. Others are fatal.
        const name = (e as DOMException)?.name;
        if (!this.closing && !["BreakError", "FramingError", "ParityError", "BufferOverrunError"].includes(name)) {
          void this.fail("lost", `Read failed: ${(e as Error)?.message ?? name}`);
          return;
        }
        this.session?.log("warn", `Serial line error (${name}). Continuing.`);
      } finally {
        try {
          this.reader?.releaseLock();
        } catch {
          /* already released */
        }
        this.reader = null;
      }
    }
  }

  private watchdog() {
    const s = useLink.getState();
    const now = Date.now();
    const last = this.session?.lastHeartbeatAt ?? null;
    if (s.status === "listening" && !last && s.openedAt && now - s.openedAt > HEARTBEAT_TIMEOUT_MS) {
      const st = this.session!.snapshot().stats;
      const detail =
        st.bytes === 0
          ? "The port is open but no data has arrived."
          : st.framesOk === 0
            ? `${st.bytes.toLocaleString()} bytes arrived but none were valid MAVLink. This almost always means the baud rate is wrong.`
            : "MAVLink frames are arriving, but none are autopilot heartbeats.";
      this.session!.log("warn", `No autopilot heartbeat after ${HEARTBEAT_TIMEOUT_MS / 1000} s. ${detail}`);
      useLink.setState({ status: "no-heartbeat" });
      this.dirty = true;
    }
    if (last && s.status === "connected" && now - last > STALE_AFTER_MS) {
      this.session!.log("warn", "Heartbeats stopped. Telemetry on screen is stale.");
      useLink.setState({ status: "stale" });
      this.dirty = true;
    }
    if (last && (s.status === "stale" || s.status === "no-heartbeat" || s.status === "listening") && now - last <= STALE_AFTER_MS) {
      if (s.status === "stale") this.session!.log("info", "Heartbeats resumed.");
      useLink.setState({ status: "connected", connectedAt: s.connectedAt ?? now });
      this.dirty = true;
    }
  }

  private flush(force = false) {
    if (!this.session || (!this.dirty && !force)) return;
    this.dirty = false;
    const snap = this.session.snapshot();
    const s = useLink.getState();
    const becameConnected = snap.lastHeartbeatAt && (s.status === "listening" || s.status === "no-heartbeat");
    useLink.setState({
      ...snap,
      ...(becameConnected ? { status: "connected", connectedAt: Date.now() } : null),
    });
    // Ask for telemetry as soon as a vehicle appears, so attitude/GPS/battery flow immediately.
    if (becameConnected) void commandLink.requestDataStreams();
  }

  private streamKeepalive() {
    if (useLink.getState().status === "connected" && commandLink.canSend) void commandLink.requestDataStreams();
  }

  private async fail(status: "lost" | "error", text: string) {
    this.session?.log("error", text);
    await this.teardown();
    useLink.setState({
      status,
      events: this.session?.events ?? [],
      error: {
        title: status === "lost" ? "Connection lost" : "Connection failed",
        detail: text,
        hints: ["Check the USB cable or radio power.", "Reconnect when the device is back; telemetry shown before the loss is no longer current."],
      },
    });
  }

  private async writeBytes(bytes: Uint8Array) {
    if (!this.writer) throw new Error("The serial port is not open for writing.");
    await this.writer.write(bytes);
  }

  private async teardown() {
    this.closing = true;
    this.timers.forEach((t) => clearInterval(t));
    this.timers = [];
    // Keep what a real aircraft told us, so the simulator can fly on its settings.
    if (!this.virtual) rememberParams();
    this.virtual = null;
    commandLink.detach();
    try {
      await this.reader?.cancel();
    } catch {
      /* ignore */
    }
    /*
      Wait for the read loop to release its lock before closing. Cancelling
      the reader only asks it to stop; the lock is released a tick later, in
      the loop's own `finally`. Closing straight away raced that and failed
      with the stream still locked — silently, because the error was
      swallowed — which left the port open underneath, so the next attempt
      to connect was told another program was using it. Bounded, so a loop
      that never settles cannot hang a disconnect.
    */
    await Promise.race([this.readDone, new Promise<void>((r) => setTimeout(r, 1500))]);
    try {
      // Abort rather than release: a write still in flight keeps the stream
      // locked, and a locked stream cannot be closed either.
      await this.writer?.abort();
    } catch {
      /* already errored or closed */
    }
    try {
      this.writer?.releaseLock();
    } catch {
      /* released by the abort */
    }
    this.writer = null;
    try {
      await this.port?.close();
    } catch {
      /* port may already be gone */
    }
    this.port = null;
    this.reader = null;
  }

  private setError(error: LinkError) {
    useLink.setState({ status: "error", error });
  }
}

const PARAMS_KEY = "aeronex.lastAircraftParams.v1";

/** Save a complete parameter download from a real aircraft in this browser. */
function rememberParams() {
  const p = useParams.getState();
  if (!p.count || p.received < p.count) return;
  try {
    localStorage.setItem(PARAMS_KEY, JSON.stringify({ at: Date.now(), values: p.values }));
  } catch {
    /* storage full or blocked: the simulator falls back to its own defaults */
  }
}

/** The last complete parameter set read from a real aircraft, if there is one. */
export function rememberedParams(): { at: number; values: Record<string, number> } | null {
  try {
    const raw = localStorage.getItem(PARAMS_KEY);
    return raw ? (JSON.parse(raw) as { at: number; values: Record<string, number> }) : null;
  } catch {
    return null;
  }
}

function openError(e: unknown): LinkError {
  const name = (e as DOMException)?.name ?? "Error";
  const msg = (e as Error)?.message ?? String(e);
  if (name === "InvalidStateError") {
    return {
      title: "Port is already open",
      detail: "Another tab or program is using this serial port.",
      hints: ["Close Mission Planner, QGroundControl or other browser tabs using the port, then try again."],
    };
  }
  if (name === "NetworkError") {
    return {
      title: "Couldn't open the serial port",
      detail: msg,
      hints: [
        "Make sure no other program (Mission Planner, QGroundControl, MAVProxy) has the port open.",
        "On Linux, your user may need to be in the dialout group.",
        "Unplug and replug the device, then try again.",
      ],
    };
  }
  if (name === "SecurityError") {
    return {
      title: "Serial access was blocked",
      detail: "The browser refused serial access for this page.",
      hints: ["Web Serial needs a secure context (https:// or http://localhost).", "Check site permissions for serial ports."],
    };
  }
  return { title: "Couldn't connect", detail: `${name}: ${msg}`, hints: ["Try again, or reconnect the device."] };
}

export const linkManager = new LinkManager();
