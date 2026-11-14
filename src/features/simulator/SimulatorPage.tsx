import { Pause, Pencil, SlidersHorizontal, BatteryWarning, CircleStop, Home as HomeIcon, Info, PlaneLanding, PlaneTakeoff, Play, Power, RotateCcw, Route, Satellite, TriangleAlert, Unplug, Wind } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { derive, G, PRESETS, type Airframe } from "../../sim/airframe";
import { MODE, MODE_NAME } from "../../sim/autopilot";
import { PARAM_DEFS } from "../../sim/params";
import { euler } from "../../sim/physics";
import { commandLink, COPTER_MODE } from "../../services/link/commandLink";
import { linkManager, rememberedParams } from "../../services/link/linkManager";
import { isPortOpen, useLink } from "../../state/linkStore";
import { notify } from "../../state/notifyStore";
import { NumInput } from "../../components/ui/NumInput";
import { modelledParams } from "../../sim/firmwareParams";
import { useActiveProfile } from "../../state/profileStore";
import { planToMission, useSim } from "../../state/simStore";
import { clockTime } from "../../utils/format";
import { fromFrameStudio, fromProfile } from "./airframeSources";
import { FlightMap, type MapPoint } from "./FlightMap";
import { ValleyDemo } from "./ValleyDemo";
import { makeTerrain, TERRAIN_LABEL, type TerrainKind } from "../../sim/terrain";
import { realTerrainAt } from "../../state/mapStore";
import { rehydrateModel, useModel } from "../../state/modelStore";
import { useSettings } from "../../state/settingsStore";
import type { WorldView } from "./world/FlightWorld";

const FlightWorld = lazy(() => import("./world/FlightWorld"));
// The real map, for the Map tab when the aircraft is flying over real ground.
const RealMap = lazy(() => import("../mission-planning/RealMap"));
const FLAT = makeTerrain("flat");
const VIEWS: [WorldView, string, string][] = [
  ["orbit", "Orbit", "Drag to look around the aircraft, scroll to zoom"],
  ["chase", "Chase", "Follow from behind"],
  ["ground", "Ground", "Watch from the ground station, as a pilot would"],
  ["top", "Top", "Straight down, north up"],
  ["fpv", "Onboard", "The view from the aircraft's nose"],
];

/**
 * Take the reader to the list of what the aircraft has said, and pick it out.
 * The list is on the simulator page for the virtual aircraft and on Telemetry
 * for a real one.
 */
export function showEvents() {
  const want = useLink.getState().virtual ? "#/simulator" : "#/telemetry";
  if (window.location.hash !== want) window.location.hash = want;
  let tries = 0;
  const find = () => {
    window.dispatchEvent(new Event("aeronex:events"));
    const el = document.querySelector<HTMLElement>("[data-events]");
    if (!el) {
      // The page is still arriving.
      if (++tries < 40) window.setTimeout(find, 150);
      return;
    }
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.classList.remove("flash");
    void el.offsetWidth;
    el.classList.add("flash");
  };
  window.setTimeout(find, 50);
}

/** Run a command and say so if the aircraft refuses it. */
export async function order(label: string, fn: () => Promise<unknown>) {
  try {
    const asked = Date.now();
    const r = await fn();
    if (typeof r === "number" && r !== 0) {
      // The aircraft gives its reason as a status message a moment after it
      // refuses. Wait for it, so the message can say why and not just where to look.
      await new Promise((res) => window.setTimeout(res, 450));
      const why = useLink
        .getState()
        .events.find((e) => e.at >= asked - 500 && (e.level === "error" || e.level === "warn") && !/^Simulator:/.test(e.text));
      const reason = why ? why.text.replace(/^(Critical|Error|Warning|Emergency|Alert):\s*/i, "") : null;
      notify("warn", `${label}: refused`, reason ? `The aircraft says: ${reason}` : "The aircraft did not say why.", { label: "Show the events list", run: showEvents });
    }
  } catch (e) {
    notify("error", `${label} failed`, (e as Error).message);
  }
}

export { modelledParams };

function Num({ label, value, onChange, step = 1, min, max, unit, hint }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; unit?: string; hint?: string }) {
  return (
    <label className="field">
      <span>
        {label}
        {unit ? ` (${unit})` : ""}
      </span>
      <NumInput className="input" value={value} step={step} min={min} max={max} onChange={onChange} />
      {hint && <small>{hint}</small>}
    </label>
  );
}

/* ----------------------------------------------------------------- setup */

function Setup({ running = false, onDone }: { running?: boolean; onDone?: () => void }) {
  const sim = useSim();
  const profile = useActiveProfile();
  const af = sim.airframe;
  const d = derive(af);
  const remembered = useMemo(() => rememberedParams(), []);
  const fromAircraft = useMemo(() => modelledParams(remembered?.values), [remembered]);
  const applied = Object.keys(fromAircraft).length;
  const setAf = (patch: Partial<Airframe>) => sim.set("airframe", { ...af, ...patch, name: patch.name ?? "Custom aircraft" });
  // Hover power from momentum theory, as the physics computes it.
  const hoverW = (4 * ((af.massKg * G) / 4) ** 1.5) / Math.sqrt(2 * 1.225 * (d.discArea / 4)) / 0.5;
  const hoverMin = ((af.capacityMah / 1000) * af.cells * 3.7 * 0.8) / hoverW * 60;
  const flyable = d.thrustToWeight >= 1.5;
  const [loading, setLoading] = useState(false);

  const start = async () => {
    // Weight, thrust and battery are what the aircraft is built from, so a
    // change to them means a new aircraft: stop the one flying and start again.
    if (running) await linkManager.disconnect("Virtual aircraft restarted with new settings.");
    // The real ground has to be fetched, or read back from what was saved.
    let terrain = makeTerrain(sim.terrain);
    if (sim.terrain === "real") {
      setLoading(true);
      const measured = await realTerrainAt(sim.home);
      setLoading(false);
      if (measured) terrain = measured;
      else notify("warn", "The real ground could not be loaded", "There is no internet and this place has not been saved in Mission Planning. The aircraft is starting over an open field instead.");
    }
    linkManager.connectVirtual({
      airframe: af,
      home: sim.home,
      soc: sim.soc,
      params: sim.useAircraftParams ? fromAircraft : {},
      terrain,
    });
    onDone?.();
  };

  return (
    <div className="split">
      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h3>The aircraft to simulate</h3>
            <span className="muted" style={{ fontSize: "var(--t-sm)" }}>{af.name}</span>
          </div>
          <div className="panel-body form-grid">
            <label className="field span2">
              <span>Start from</span>
              <select
                className="select"
                value={PRESETS.findIndex((p) => p.name === af.name)}
                onChange={(e) => {
                  const p = PRESETS[Number(e.target.value)];
                  if (p) sim.set("airframe", p);
                }}
              >
                <option value={-1} disabled>
                  {af.name}
                </option>
                {PRESETS.map((p, i) => (
                  <option key={p.name} value={i}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="span2 sim-fill">
              <button
                className="btn"
                onClick={() => {
                  const r = fromProfile(profile, af);
                  if (r.filled.length === 0) notify("info", "Nothing to copy yet", "Add a weight or a motor diagonal to the Aircraft Profile first.");
                  else {
                    sim.set("airframe", r.airframe);
                    // The simulator flies a four-motor X; a hexa or octa profile is copied for its size and weight only.
                    const quad = !profile?.frame || profile.frame === "quad-x";
                    notify(quad ? "success" : "warn", "Copied from the Aircraft Profile", `Took its ${r.filled.join(" and ")}. Check the rest.${quad ? "" : " The simulator flies it as a four-motor X frame: the profile's frame layout is not modelled, so treat timings and battery figures as rough."}`);
                  }
                }}
              >
                Copy from Aircraft Profile
              </button>
              <button
                className="btn"
                onClick={() => {
                  sim.set("airframe", fromFrameStudio());
                  notify("success", "Copied from Frame Studio", "Battery capacity is estimated from the pack's weight, and motor thrust is a typical figure for the motor class, not a measurement. Correct either if you know it.");
                }}
              >
                Copy from Frame Studio design
              </button>
            </div>
            <Num label="Weight ready to fly" unit="kg" value={af.massKg} step={0.05} min={0.1} max={30} onChange={(v) => setAf({ massKg: v })} />
            <Num label="Motor-to-motor diagonal" unit="mm" value={Math.round(af.diagonalM * 1000)} step={10} min={80} max={1500} onChange={(v) => setAf({ diagonalM: v / 1000 })} />
            <Num label="Thrust of one motor, full throttle" unit="g" value={Math.round((af.motorMaxThrustN / G) * 1000)} step={50} min={50} max={20000} onChange={(v) => setAf({ motorMaxThrustN: (v / 1000) * G })} hint="From the motor's thrust table, with your propeller." />
            <Num label="Propeller diameter" unit="inches" value={Math.round((af.propDiaM / 0.0254) * 10) / 10} step={0.5} min={2} max={30} onChange={(v) => setAf({ propDiaM: v * 0.0254 })} />
            <Num label="Battery cells" unit="S" value={af.cells} min={1} max={14} onChange={(v) => setAf({ cells: Math.round(v) })} />
            <Num label="Battery capacity" unit="mAh" value={af.capacityMah} step={100} min={100} max={60000} onChange={(v) => setAf({ capacityMah: v })} />
          </div>
          <dl className="readouts sim-derived">
            <div className="readout">
              <dt>Thrust to weight</dt>
              <dd className={flyable ? undefined : "bad"}>{d.thrustToWeight.toFixed(1)}<small>: 1</small></dd>
            </div>
            <div className="readout">
              <dt>Hover throttle</dt>
              <dd>{Math.round(d.hoverThrottle * 100)}<small>%</small></dd>
            </div>
            <div className="readout">
              <dt>Hover power</dt>
              <dd>{Math.round(hoverW)}<small>W</small></dd>
            </div>
            <div className="readout">
              <dt>Hover time to 20%</dt>
              <dd>{hoverMin.toFixed(0)}<small>min</small></dd>
            </div>
          </dl>
          {d.thrustToWeight < 1.05 ? (
            <div className="callout danger" style={{ margin: "0 var(--s5) var(--s5)" }}>
              <TriangleAlert />
              <span>
                The four motors make {((4 * af.motorMaxThrustN) / G).toFixed(1)} kg of thrust and the aircraft weighs {af.massKg} kg. It cannot leave the
                ground. Lighten it or fit bigger motors.
              </span>
            </div>
          ) : d.thrustToWeight < 1.5 ? (
            <div className="callout warn" style={{ margin: "0 var(--s5) var(--s5)" }}>
              <TriangleAlert />
              <span>
                Thrust to weight of {d.thrustToWeight.toFixed(2)} : 1 is marginal. It may lift, but it will sink when it leans to move and has nothing
                in hand for wind. Aim for 2 : 1 or more.
              </span>
            </div>
          ) : d.thrustToWeight > 12 ? (
            <div className="callout warn" style={{ margin: "0 var(--s5) var(--s5)" }}>
              <TriangleAlert />
              <span>Thrust to weight of {d.thrustToWeight.toFixed(0)} : 1 is far beyond any real aircraft. Check the weight and the thrust of one motor.</span>
            </div>
          ) : hoverMin < 3 ? (
            <div className="callout warn" style={{ margin: "0 var(--s5) var(--s5)" }}>
              <TriangleAlert />
              <span>This battery gives under three minutes in the air. Check the capacity.</span>
            </div>
          ) : null}
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Where and how it starts</h3>
          </div>
          <div className="panel-body form-grid">
            <Num label="Home latitude" unit="°" value={sim.home.lat} step={0.0001} min={-85} max={85} onChange={(v) => sim.set("home", { ...sim.home, lat: v })} />
            <Num label="Home longitude" unit="°" value={sim.home.lon} step={0.0001} min={-180} max={180} onChange={(v) => sim.set("home", { ...sim.home, lon: v })} />
            <Num label="Home height above sea level" unit="m" value={sim.home.altMsl} min={-400} max={6000} onChange={(v) => sim.set("home", { ...sim.home, altMsl: v })} />
            <Num label="Battery at the start" unit="%" value={Math.round(sim.soc * 100)} min={5} max={100} step={5} onChange={(v) => sim.set("soc", v / 100)} />
            <label className="field span2">
              <span>Landscape</span>
              <select className="select" value={sim.terrain} onChange={(e) => sim.set("terrain", e.target.value as TerrainKind)}>
                {(Object.keys(TERRAIN_LABEL) as TerrainKind[]).map((k) => (
                  <option key={k} value={k}>
                    {TERRAIN_LABEL[k].name}
                  </option>
                ))}
              </select>
              <small>
                {TERRAIN_LABEL[sim.terrain].detail}{" "}
                {sim.terrain === "real" ? "The aircraft collides with this ground. Set home on the map in Mission Planning; nothing is drawn that the data does not know, so there are no trees or water." : "The aircraft collides with this ground; trees are scenery only."}
              </small>
            </label>
            <label className="sim-check span2">
              <input type="checkbox" checked={sim.useAircraftParams && applied > 0} disabled={applied === 0} onChange={(e) => sim.set("useAircraftParams", e.target.checked)} />
              <span>
                <strong>Use the settings from my real aircraft</strong>
                <small>
                  {remembered && applied > 0
                    ? `${applied} of the ${PARAM_DEFS.length} parameters the simulator models were read from your aircraft on ${new Date(remembered.at).toLocaleDateString()}. The rest start at ArduCopter's defaults.`
                    : "None saved yet. Connect your aircraft once and let the parameter download finish; its failsafe, speed and tuning settings are then used here."}
                </small>
              </span>
            </label>
          </div>
          <div className="form-foot sim-setup-foot">
            {running && (
              <button className="btn btn-lg" onClick={onDone}>
                Back to the flight, unchanged
              </button>
            )}
            <button className="btn btn-primary btn-lg" disabled={loading} onClick={() => void start()}>
              {running ? <RotateCcw /> : <Play />} {running ? "Restart with these settings" : "Start the virtual aircraft"}
            </button>
          </div>
        </section>
      </div>

      <div className="stack">
        <section className="panel">
          <div className="panel-head">
            <h3>What this simulates</h3>
          </div>
          <div className="panel-body sim-notes">
            <p>
              A virtual flight controller with real flight physics. It speaks MAVLink exactly as a Pixhawk does, so once it is started every page in
              the app works against it: Preflight Check, Flight Data, Parameters, Keyboard Flight, Drone Doctor and Mission Planning.
            </p>
            <ul>
              <li><strong>Physics.</strong> Weight, thrust, motor lag, drag, wind and gusts, and a battery that sags and runs down.</li>
              <li><strong>Flight controller.</strong> ArduCopter's control loops, flight modes, arming checks and failsafes, driven by {PARAM_DEFS.length} of its parameters under their real names.</li>
              <li><strong>Failures.</strong> Lose a motor, the GPS, the radio or the link in mid-flight and watch what the settings make it do.</li>
            </ul>
            <div className="callout info">
              <Info />
              <span>
                It is a model of ArduCopter written from its documentation, not the firmware itself, and it has no obstacles or sensor
                noise. The real ground, when chosen, is the bare shape of the land without trees or buildings. Treat a prediction as a strong hint about your settings, and still make the first real flight a cautious one.
              </span>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- control room */

interface Snap {
  n: number;
  e: number;
  alt: number;
  yawDeg: number;
  speed: number;
  climb: number;
  volts: number;
  amps: number;
  soc: number;
  throttle: number;
  mode: number;
  armed: boolean;
  crashed: boolean;
  t: number;
  motors: number[];
  gpsOk: boolean;
  rcOk: boolean;
  fence: number | null;
  failsafes: string[];
  /** Which mission command it is on, how many there are, and how far the next point is. */
  missionSeq: number;
  missionLen: number;
  toGo: number | null;
}

function useSnap(): { snap: Snap | null; track: MapPoint[]; clearTrack: () => void } {
  const [snap, setSnap] = useState<Snap | null>(null);
  const track = useRef<MapPoint[]>([]);
  const [, bump] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      const v = linkManager.sim;
      if (!v) {
        setSnap(null);
        return;
      }
      const s = v.phys.s;
      const last = track.current[track.current.length - 1];
      if (!last || Math.hypot(last.n - s.pos[0], last.e - s.pos[1]) > 0.5) {
        track.current.push({ n: s.pos[0], e: s.pos[1] });
        if (track.current.length > 4000) track.current.splice(0, 1000);
      }
      setSnap({
        n: s.pos[0],
        e: s.pos[1],
        alt: -s.pos[2],
        yawDeg: (euler(s.q).yaw * 180) / Math.PI,
        speed: Math.hypot(s.vel[0], s.vel[1]),
        climb: -s.vel[2],
        volts: s.volts,
        amps: s.amps,
        soc: v.phys.soc,
        throttle: v.ap.throttleOut,
        mode: v.ap.mode,
        armed: v.ap.armed,
        crashed: s.crashed,
        t: s.t,
        motors: [...v.phys.faults.motor],
        gpsOk: v.gpsOk,
        rcOk: v.rcOk,
        fence: v.ap.params.FENCE_ENABLE ? v.ap.params.FENCE_RADIUS : null,
        failsafes: [...v.ap.failsafes],
        missionSeq: v.ap.missionSeq,
        missionLen: v.ap.mission.length,
        toGo: v.ap.goal ? Math.hypot(v.ap.goal.n - s.pos[0], v.ap.goal.e - s.pos[1], v.ap.goal.alt + s.pos[2]) : null,
      });
    }, 150);
    return () => clearInterval(id);
  }, []);
  return {
    snap,
    track: track.current,
    clearTrack: () => {
      track.current = [];
      bump((n) => n + 1);
    },
  };
}

function ControlRoom({ onEdit }: { onEdit: () => void }) {
  const sim = useSim();
  const events = useLink((s) => s.events);
  const status = useLink((s) => s.status);
  const { snap, track, clearTrack } = useSnap();
  const [wind, setWind] = useState({ windSpeed: 0, windFromDeg: 270, gust: 0.3 });
  const [speed, setSpeed] = useState(1);
  const [takeoffAlt, setTakeoffAlt] = useState(15);
  const [gcsCut, setGcsCut] = useState(false);
  const [show, setShow] = useState<"world" | "map">("world");
  const [view, setView] = useState<WorldView>("orbit");
  const [book, setBook] = useState<"events" | "faults">("events");
  // A message that points at the events list must find it showing.
  useEffect(() => {
    const show = () => setBook("events");
    window.addEventListener("aeronex:events", show);
    return () => window.removeEventListener("aeronex:events", show);
  }, []);
  const graphics = useSettings((s) => s.graphics);
  const profile = useActiveProfile();
  const object = useModel((s) => s.object);
  const modelStatus = useModel((s) => s.status);
  const imported = profile?.model.source === "imported" ? profile.model : null;
  // The model set up in Digital Twin: load it if this page is the first to need it.
  useEffect(() => {
    if (profile && profile.model.source === "imported") void rehydrateModel(profile.id, profile.model);
  }, [profile]);
  const terrain = linkManager.sim?.terrain ?? FLAT;
  const ready = status === "connected";

  useEffect(() => {
    const v = linkManager.sim;
    if (v) v.phys.env = { ...wind };
  }, [wind, snap === null]); // eslint-disable-line react-hooks/exhaustive-deps

  const route = useMemo(() => sim.points.map((p, i) => ({ id: p.id, n: p.n, e: p.e, label: String(i + 1) })), [sim.points]);
  const windShown = useMemo(() => ({ speed: wind.windSpeed, fromDeg: wind.windFromDeg }), [wind.windSpeed, wind.windFromDeg]);
  const flying = !!snap?.armed;

  const takeOff = () =>
    order("Take-off", async () => {
      const g = await commandLink.setMode(COPTER_MODE.GUIDED);
      if (g !== 0) return g;
      const a = await commandLink.arm(true);
      if (a !== 0) return a;
      return commandLink.guidedTakeoff(takeoffAlt);
    });

  const flyMission = () =>
    order("Fly the mission", async () => {
      if (sim.points.length === 0) throw new Error("There is no mission yet. Plan one in Mission Planning.");
      await commandLink.uploadMission(planToMission(sim.home, sim.takeoffAlt, sim.points, sim.ending));
      if (!flying) {
        const g = await commandLink.setMode(COPTER_MODE.GUIDED);
        if (g !== 0) return g;
        const a = await commandLink.arm(true);
        if (a !== 0) return a;
      }
      const m = await commandLink.setMode(COPTER_MODE.AUTO);
      if (m !== 0) return m;
      return flying ? 0 : commandLink.startMission();
    });

  const setMotor = (i: number) => {
    const v = linkManager.sim;
    if (!v) return;
    const now = v.phys.faults.motor[i];
    v.phys.faults.motor[i] = now === 1 ? 0.6 : now === 0.6 ? 0 : 1;
    v.ap.log("warn", `Injected: motor ${i + 1} at ${Math.round(v.phys.faults.motor[i] * 100)}% thrust`);
  };

  if (!snap) return null;
  const af = sim.airframe;
  const state = snap.crashed ? "Crashed" : snap.armed ? "Armed" : "Disarmed";
  const stateTone = snap.crashed ? "danger" : snap.armed ? "warn" : "idle";
  const faultsOn = snap.motors.filter((m) => m < 1).length + (snap.gpsOk ? 0 : 1) + (snap.rcOk ? 0 : 1) + (gcsCut ? 1 : 0);
  const reset = () => {
    linkManager.sim?.reset(sim.soc);
    clearTrack();
    if (gcsCut) {
      commandLink.startHeartbeat();
      setGcsCut(false);
    }
  };
  return (
    <>
      {/* Which aircraft this is, and the things done to the simulator as a whole. */}
      <div className="sim-top">
        <div className="sim-top-id">
          <strong>{af.name}</strong>
          <span>
            {af.massKg} kg, {Math.round(af.diagonalM * 1000)} mm, {Math.round((af.motorMaxThrustN / G) * 1000)} g thrust per motor, {af.cells}S {af.capacityMah} mAh
          </span>
        </div>
        <div className="sim-top-acts">
          <Link className="btn btn-sm" to="/params">
            <SlidersHorizontal /> Flight settings
          </Link>
          <button className="btn btn-sm" onClick={onEdit}>
            <Pencil /> Change the aircraft
          </button>
          <span className="sim-top-gap" aria-hidden />
          <button className="btn btn-sm" onClick={reset} title="Puts the aircraft back on the pad with a fresh battery and clears every fault">
            <RotateCcw /> Put it back at home
          </button>
          <button className="btn btn-sm btn-danger" onClick={() => void linkManager.disconnect("Virtual aircraft stopped.")}>
            <Power /> Stop
          </button>
        </div>
      </div>

      {/*
        The view on the left and everything needed to fly on the right, in one
        screen: nothing that is pressed during a flight is below the fold.
      */}
      <div className="sim-console">
        <section className="panel sim-stage sim-map-panel">
          <div className="panel-head">
            <div className="segmented" role="group" aria-label="View">
              <button aria-pressed={show === "world"} onClick={() => setShow("world")}>
                3D world
              </button>
              <button aria-pressed={show === "map"} onClick={() => setShow("map")}>
                Map
              </button>
            </div>
            <div className="sim-speed">
              <span className="sim-label">Time</span>
              <div className="segmented" role="group" aria-label="Simulation speed">
                {[0, 1, 2, 5, 10].map((x) => (
                  <button
                    key={x}
                    aria-pressed={speed === x}
                    aria-label={x === 0 ? "Pause" : `${x} times speed`}
                    title={x === 0 ? "Freeze the flight where it is. The link stays up." : undefined}
                    onClick={() => {
                      linkManager.simSpeed = x;
                      setSpeed(x);
                    }}
                  >
                    {x === 0 ? <Pause /> : `${x}×`}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {show === "world" ? (
            <div className="world">
              <Suspense fallback={<div className="world-loading">Building the landscape…</div>}>
                <FlightWorld
                  terrain={terrain}
                  airframe={sim.airframe}
                  route={sim.points}
                  takeoffAlt={sim.takeoffAlt}
                  ending={sim.ending}
                  wind={{ speed: wind.windSpeed, fromDeg: wind.windFromDeg }}
                  view={view}
                  graphics={graphics}
                  object={imported && modelStatus === "ready" ? object : null}
                  forward={imported?.forward ?? "-z"}
                  up={imported?.up ?? "+y"}
                  scalePercent={imported?.scalePercent ?? 100}
                  fenceRadius={snap.fence}
                />
              </Suspense>
              <div className="world-hud top">
                <span className={`world-chip ${snap.crashed ? "bad" : snap.armed ? "on" : ""}`}>{snap.crashed ? "Crashed" : (MODE_NAME[snap.mode] ?? "Mode")}</span>
                <span className="world-chip">{imported && modelStatus === "ready" ? imported.filename : imported ? "Loading your model…" : "Standard quadcopter"}</span>
                {speed === 0 && <span className="world-chip on">Paused</span>}
              </div>
              <div className="world-hud views" role="group" aria-label="Camera">
                {VIEWS.map(([k, label, tip]) => (
                  <button key={k} aria-pressed={view === k} title={tip} onClick={() => setView(k)}>
                    {label}
                  </button>
                ))}
              </div>
              <dl className="world-hud strip">
                <div><dt>Above ground</dt><dd>{Math.max(0, snap.alt - terrain.surface(snap.n, snap.e)).toFixed(1)} m</dd></div>
                <div><dt>Heading</dt><dd>{String(Math.round((snap.yawDeg + 360) % 360)).padStart(3, "0")}°</dd></div>
                <div><dt>Wind</dt><dd>{wind.windSpeed} m/s</dd></div>
              </dl>
            </div>
          ) : terrain.kind === "real" ? (
            <Suspense fallback={<div className="rmap rmap-loading">Loading the map…</div>}>
              <RealMap home={sim.home} route={route} closeRoute={sim.ending === "rtl"} fenceRadius={snap.fence} wind={windShown} homeLocked />
            </Suspense>
          ) : (
            <FlightMap
              route={route}
              closeRoute={sim.ending === "rtl"}
              track={track}
              aircraft={{ n: snap.n, e: snap.e, yawDeg: snap.yawDeg }}
              fenceRadius={snap.fence}
              wind={{ speed: wind.windSpeed, fromDeg: wind.windFromDeg }}
              terrain={terrain}
            />
          )}
        </section>

        <aside className="sim-rail" aria-label="Flight controls and readings">
          {/* What it is doing now. */}
          <section className="panel sim-state">
            <div className="sim-state-head">
              <div>
                <span className="sim-label">Flight mode</span>
                <h3>{MODE_NAME[snap.mode] ?? "Mode"}</h3>
              </div>
              <div className="sim-state-side">
                <span className={`pill ${stateTone} plain`}>{state}</span>
                <span className="num muted" title="Flight clock">
                  {Math.floor(snap.t / 60)}:{String(Math.floor(snap.t % 60)).padStart(2, "0")}
                </span>
              </div>
            </div>
            {snap.mode === MODE.AUTO && snap.missionLen > 1 && (
              <p className="sim-progress">
                <Route aria-hidden /> Command {Math.min(snap.missionSeq, snap.missionLen - 1)} of {snap.missionLen - 1}
                {snap.toGo !== null ? `, ${snap.toGo >= 1000 ? `${(snap.toGo / 1000).toFixed(1)} km` : `${Math.round(snap.toGo)} m`} to go` : ""}
              </p>
            )}
            {snap.failsafes.length > 0 && (
              <div className="callout warn sim-note">
                <TriangleAlert />
                <span>Failsafe active: {snap.failsafes.join(", ")}.</span>
              </div>
            )}
            <dl className="sim-gauges">
              <div><dt>Height</dt><dd>{snap.alt.toFixed(1)}<small>m</small></dd></div>
              <div><dt>Speed</dt><dd>{snap.speed.toFixed(1)}<small>m/s</small></dd></div>
              <div><dt>Climb</dt><dd>{snap.climb.toFixed(1)}<small>m/s</small></dd></div>
              <div><dt>From home</dt><dd>{Math.hypot(snap.n, snap.e).toFixed(0)}<small>m</small></dd></div>
              <div><dt>Battery</dt><dd className={snap.soc < 0.2 ? "bad" : undefined}>{Math.max(0, Math.round(snap.soc * 100))}<small>%</small></dd></div>
              <div><dt>Voltage</dt><dd>{snap.volts.toFixed(1)}<small>V</small></dd></div>
              <div><dt>Current</dt><dd>{snap.amps.toFixed(0)}<small>A</small></dd></div>
              <div><dt>Throttle</dt><dd className={snap.throttle > 0.9 ? "bad" : undefined}>{Math.round(snap.throttle * 100)}<small>%</small></dd></div>
            </dl>
          </section>

          {/* What to tell it. */}
          <section className="panel">
            <div className="panel-body sim-actions">
              <div className="sim-takeoff">
                <button className="btn btn-primary" disabled={!ready || flying || snap.crashed} onClick={takeOff}>
                  <PlaneTakeoff /> Take off to
                </button>
                <NumInput className="input" min={2} max={120} value={takeoffAlt} onChange={setTakeoffAlt} aria-label="Take-off height in metres" />
                <span className="muted">m</span>
              </div>
              <button className="btn" disabled={!ready || snap.crashed} onClick={flyMission} title={sim.points.length ? undefined : "Plan a mission in Mission Planning first"}>
                <Route /> Fly the mission{sim.points.length ? ` (${sim.points.length} ${sim.points.length === 1 ? "waypoint" : "waypoints"})` : ""}
              </button>
              <div className="sim-row">
                <button className="btn" disabled={!flying} onClick={() => order("Hold", () => commandLink.setMode(COPTER_MODE.BRAKE))} title="Stop and hover where it is">
                  <CircleStop /> Hold
                </button>
                <button className="btn" disabled={!flying} onClick={() => order("Return home", () => commandLink.setMode(COPTER_MODE.RTL))} title="Fly back to home and land">
                  <HomeIcon /> Return
                </button>
                <button className="btn" disabled={!flying} onClick={() => order("Land", () => commandLink.setMode(COPTER_MODE.LAND))} title="Land where it is">
                  <PlaneLanding /> Land
                </button>
              </div>
              {snap.crashed && (
                <button className="btn" onClick={reset}>
                  <RotateCcw /> Put it back at home
                </button>
              )}
            </div>
          </section>

          {/* What it says, and what can be done to it. */}
          <section className="panel sim-book" data-events>
            <div className="sim-tabs" role="tablist" aria-label="Events or faults">
              <button role="tab" aria-selected={book === "events"} onClick={() => setBook("events")}>
                Events
              </button>
              <button role="tab" aria-selected={book === "faults"} onClick={() => setBook("faults")}>
                Faults and wind
                {faultsOn > 0 && <i className="sim-count">{faultsOn}</i>}
              </button>
            </div>
            {book === "events" ? (
              <ul className="sim-events">
                {events.slice(0, 30).map((ev) => (
                  <li key={ev.id} className={ev.level}>
                    <span className="num">{clockTime(ev.at)}</span>
                    {ev.text}
                  </li>
                ))}
              </ul>
            ) : (
              <div className="panel-body sim-faults">
                <div>
                  <span className="sim-label">Motors: click to weaken, again to stop</span>
                  <div className="sim-row">
                    {snap.motors.map((m, i) => (
                      <button key={i} className={`btn sim-motor${m < 1 ? (m === 0 ? " dead" : " weak") : ""}`} onClick={() => setMotor(i)} title="Steps through 100%, 60% and 0% thrust">
                        {i + 1}
                        <small>{Math.round(m * 100)}%</small>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="sim-fault-grid">
                  <button className={`btn${snap.gpsOk ? "" : " sim-on"}`} onClick={() => linkManager.sim && (linkManager.sim.gpsOk = !snap.gpsOk)}>
                    <Satellite /> {snap.gpsOk ? "Lose GPS" : "GPS lost"}
                  </button>
                  <button className={`btn${snap.rcOk ? "" : " sim-on"}`} onClick={() => linkManager.sim && (linkManager.sim.rcOk = !snap.rcOk)}>
                    <Unplug /> {snap.rcOk ? "Lose radio" : "Radio lost"}
                  </button>
                  <button
                    className={`btn${gcsCut ? " sim-on" : ""}`}
                    onClick={() => {
                      if (gcsCut) commandLink.startHeartbeat();
                      else commandLink.stopHeartbeat();
                      setGcsCut(!gcsCut);
                    }}
                    title="Stops this app's heartbeat, which is what the ground-station failsafe watches for"
                  >
                    <Unplug /> {gcsCut ? "Link silent" : "Silence the link"}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      const v = linkManager.sim;
                      if (v) v.phys.s.usedMah = Math.max(v.phys.s.usedMah, 0.85 * v.phys.af.capacityMah);
                    }}
                  >
                    <BatteryWarning /> Battery to 15%
                  </button>
                </div>
                <div className="sim-wind">
                  <span className="sim-label">
                    <Wind size={14} /> Wind
                  </span>
                  <label>
                    <span>Speed</span>
                    <input type="range" min={0} max={20} value={wind.windSpeed} onChange={(e) => setWind({ ...wind, windSpeed: Number(e.target.value) })} />
                    <output>{wind.windSpeed} m/s</output>
                  </label>
                  <label>
                    <span>From</span>
                    <input type="range" min={0} max={359} step={5} value={wind.windFromDeg} onChange={(e) => setWind({ ...wind, windFromDeg: Number(e.target.value) })} />
                    <output>{wind.windFromDeg}°</output>
                  </label>
                  <label>
                    <span>Gusts</span>
                    <input type="range" min={0} max={1} step={0.1} value={wind.gust} onChange={(e) => setWind({ ...wind, gust: Number(e.target.value) })} />
                    <output>{Math.round(wind.gust * 100)}%</output>
                  </label>
                </div>
              </div>
            )}
          </section>
        </aside>
      </div>
      <p className="sim-foot">
        The buttons send the same MAVLink commands a real aircraft gets. <Link to="/keyboard-flight">Keyboard Flight</Link> and <Link to="/missions">Mission Planning</Link> work on this
        aircraft too.
      </p>
    </>
  );
}

/* ------------------------------------------------------------------ page */

export function SimulatorPage() {
  const [tab, setTab] = useState<"virtual" | "valley">("virtual");
  const [editing, setEditing] = useState(false);
  const status = useLink((s) => s.status);
  const virtual = useLink((s) => s.virtual);
  const open = isPortOpen(status);

  if (tab === "valley") {
    return (
      <div className="sim-page with-bar">
        <div className="sim-bar">
          <button className="btn btn-sm" onClick={() => setTab("virtual")}>
            Back to the simulator
          </button>
          <span className="muted">A scenic demo flight. It is not physics-based and not connected to the rest of the app.</span>
        </div>
        <ValleyDemo />
      </div>
    );
  }

  return (
    <div className={`page-pad${open && virtual && !editing ? " sim-live" : ""}`}>
      <header className="page-head">
        <div>
          <h1>Flight Simulator</h1>
          {!(open && virtual && !editing) && (
            <p>
              A virtual aircraft with real flight physics and a flight controller that speaks MAVLink. Fly it, plan missions for it, and break things on
              purpose to see what your settings would do.
            </p>
          )}
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={() => setTab("valley")} title="A scenic flight to watch. It is not physics-based.">
            Scenic demo
          </button>
        </div>
      </header>
      {open && !virtual ? (
        <div className="callout warn">
          <TriangleAlert />
          <span>
            A real aircraft is linked. Disconnect it in <Link to="/connection">Connection</Link> before starting the virtual one: the app talks to one
            aircraft at a time.
          </span>
        </div>
      ) : open && virtual && editing ? (
        <>
          <div className="callout info" style={{ marginBottom: "var(--s5)" }}>
            <Info />
            <span>
              The virtual aircraft is still running. Changing its weight, motors or battery builds a new aircraft, so it restarts on the ground at
              home. Failsafe, speed and tuning settings do not need a restart: change those in <Link to="/params">Parameters</Link> while it flies.
            </span>
          </div>
          <Setup running onDone={() => setEditing(false)} />
        </>
      ) : open && virtual ? (
        <ControlRoom onEdit={() => setEditing(true)} />
      ) : (
        <Setup />
      )}
    </div>
  );
}
