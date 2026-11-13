import { ArrowDown, ArrowUp, CirclePause, Home as HomeIcon, PlaneLanding, PlaneTakeoff, CircleCheck, CircleX, Download, FlaskConical, FolderOpen, SatelliteDish, Globe, Info, LandPlot, ListChecks, Play, Redo2, Save, Trash2, TriangleAlert, Undo2, Upload, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { MODE_NAME } from "../../sim/autopilot";
import { NumInput } from "../../components/ui/NumInput";
import { defaultParams, type Params } from "../../sim/params";
import { predict, type FaultKind, type FaultPlan, type Prediction, type Verdict } from "../../sim/predict";
import { armedBlock, commandLink, missionBlock, COPTER_MODE } from "../../services/link/commandLink";
import { linkManager, rememberedParams } from "../../services/link/linkManager";
import { useLink } from "../../state/linkStore";
import { confirmAction, notify } from "../../state/notifyStore";
import { useParams } from "../../state/paramStore";
import { missionToPlan, planToMission, routeLength, useSim, type Ending, type ReadPlan } from "../../state/simStore";
import { FlightMap } from "../simulator/FlightMap";
import { makeTerrain, type TerrainKind } from "../../sim/terrain";
import { modelledParams, order } from "../simulator/SimulatorPage";
import { covers, realTerrain } from "../../geo/elevation";
import { fmtLatLon, toGlobal, toLocal, type LatLon } from "../../geo/geo";
import { checkPlan, flightSeconds } from "../../geo/planCheck";
import { useHomeSource } from "../../services/link/homeFollow";
import { fromWaypointFile, saveText, toWaypointFile } from "../../geo/planFile";
import { routeProfile } from "../../geo/profile";
import { demReach, ensureDem, useDem } from "../../state/mapStore";
import { CLEAR_WARN, HeightProfile } from "./HeightProfile";

// The map library is large and only this page needs it.
const RealMap = lazy(() => import("./RealMap"));
const FIELD = makeTerrain("flat");

const far = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`);

const VERDICT: Record<Verdict, { tone: "ok" | "warn" | "bad"; title: string }> = {
  completed: { tone: "ok", title: "Mission completed" },
  "came-home": { tone: "warn", title: "Came home early" },
  "landed-away": { tone: "warn", title: "Landed away from home" },
  holding: { tone: "warn", title: "Left hovering" },
  timeout: { tone: "warn", title: "Still flying" },
  refused: { tone: "bad", title: "Would not start" },
  crashed: { tone: "bad", title: "Crashed" },
  grounded: { tone: "bad", title: "Cannot take off" },
  stuck: { tone: "bad", title: "Could not get there" },
  "flew-away": { tone: "bad", title: "Flew away" },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function NumCell({ value, onChange, min, max, label }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string }) {
  return <NumInput className="input mp-num" aria-label={label} value={value} min={min} max={max} onChange={onChange} />;
}

/** Which parameters a prediction should fly on, and where they came from. */
function useFlightParams(): { params: Params; source: string; unread: { received: number; count: number | null } | null } {
  const sim = useSim();
  const virtual = useLink((s) => s.virtual);
  const status = useLink((s) => s.status);
  const live = useParams((s) => s.values);
  const count = useParams((s) => s.count);
  const received = useParams((s) => s.received);
  return useMemo(() => {
    const base = defaultParams(sim.airframe);
    if (status === "connected" && virtual && linkManager.sim) return { params: { ...linkManager.sim.ap.params }, source: "the virtual aircraft's current settings", unread: null };
    if (status === "connected" && !virtual && count && received >= count) return { params: { ...base, ...modelledParams(live) }, source: "the settings just read from your aircraft", unread: null };
    // A real aircraft is linked and its settings are not all here yet: nothing below is its own.
    const unread = status === "connected" && !virtual ? { received, count } : null;
    const saved = sim.useAircraftParams ? rememberedParams() : null;
    const got = modelledParams(saved?.values);
    if (saved && Object.keys(got).length) return { params: { ...base, ...got }, source: `the settings read from your aircraft on ${new Date(saved.at).toLocaleDateString()}`, unread };
    return { params: base, source: "ArduCopter's default settings, tuned for this airframe", unread };
  }, [sim.airframe, sim.useAircraftParams, status, virtual, live, count, received]);
}

export function MissionPlanningPage() {
  const sim = useSim();
  const nav = useNavigate();
  const status = useLink((s) => s.status);
  const virtual = useLink((s) => s.virtual);
  const linked = status === "connected";
  const { params, source, unread } = useFlightParams();
  /*
    The return-home height, the speeds, the fence and the battery failsafe are
    the aircraft's own settings. With a real aircraft linked they are read
    before anything is checked or sent, without the reader having to know to
    open the Parameters page first.
  */
  const askedFor = useRef(false);
  useEffect(() => {
    if (!unread) {
      askedFor.current = false;
      return;
    }
    if (askedFor.current || unread.count !== null) return;
    askedFor.current = true;
    void commandLink.requestAllParams().catch(() => (askedFor.current = false));
  }, [unread]);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Prediction | null>(null);
  const [wind, setWind] = useState({ speed: 0, from: 270, gust: 30 });
  const [charge, setCharge] = useState(100);
  const [fault, setFault] = useState<"none" | FaultKind>("none");
  const [faultAt, setFaultAt] = useState<{ by: "waypoint" | "time"; value: number }>({ by: "waypoint", value: 1 });
  const [motor, setMotor] = useState({ n: 1, level: 0 });
  const dem = useDem();
  const homeSource = useHomeSource((h) => h.source);
  // Looked at a couple of times a second, not at telemetry rate.
  const [gpsBlock, setGpsBlock] = useState(() => missionBlock() ?? armedBlock());
  useEffect(() => {
    const t = window.setInterval(() => {
      const b = missionBlock() ?? armedBlock();
      setGpsBlock((was) => (was?.body === b?.body ? was : b));
    }, 700);
    return () => window.clearInterval(t);
  }, []);
  const lastField = useRef<TerrainKind>(sim.terrain === "real" ? "hills" : sim.terrain);
  if (sim.terrain !== "real") lastField.current = sim.terrain;

  // A running simulator has its world already; the page shows that one.
  const simWorld = (linked && virtual && linkManager.sim?.terrain) || null;
  const real = simWorld ? simWorld.kind === "real" : sim.terrain === "real";
  const farthest = useMemo(() => Math.max(0, ...sim.points.map((p) => Math.hypot(p.n, p.e))), [sim.points]);
  const reach = demReach(farthest);
  const homeLat = sim.home.lat;
  const homeLon = sim.home.lon;
  useEffect(() => {
    if (real && !simWorld) void ensureDem({ lat: homeLat, lon: homeLon }, reach).catch(() => undefined);
  }, [real, simWorld, homeLat, homeLon, reach]);
  // The measured ground, as soon as any of it is there for this home.
  const measured = useMemo(() => (covers(dem.patch, { lat: homeLat, lon: homeLon }, 0) ? realTerrain(dem.patch) : null), [dem.patch, homeLat, homeLon]);
  useEffect(() => {
    // Home's height above the sea comes with the ground.
    if (real && !simWorld && measured && dem.patch && Math.abs(sim.home.altMsl - dem.patch.base) >= 1) sim.set("home", { ...sim.home, altMsl: Math.round(dem.patch.base) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [real, simWorld, measured]);
  const loaded = !real || !!simWorld || !!measured;

  // The landscape the aircraft will meet: the running simulator's, or the one chosen for it.
  const terrain = useMemo(() => simWorld ?? (sim.terrain === "real" ? (measured ?? FIELD) : makeTerrain(sim.terrain)), [simWorld, sim.terrain, measured]);
  const mission = useMemo(() => planToMission(sim.home, sim.takeoffAlt, sim.points, sim.ending), [sim.home, sim.takeoffAlt, sim.points, sim.ending]);
  const length = routeLength(sim.points, sim.ending);
  // The last waypoint carries its command on the map as well as in the list.
  const lastTag = sim.ending === "land" ? " Land" : sim.ending === "hold" ? " Hover" : "";
  const route = useMemo(() => sim.points.map((p, i) => ({ id: p.id, n: p.n, e: p.e, label: String(i + 1), tag: i === sim.points.length - 1 ? lastTag.trim() : "" })), [sim.points, lastTag]);
  const empty = sim.points.length === 0;
  // Measured ground stops somewhere. Past it the heights are not known, and must not be shown as if they were.
  const beyond = terrain.reach !== undefined && farthest > terrain.reach && (!!simWorld || dem.status !== "loading");
  // A prediction is for the home it was made from.
  useEffect(() => setResult(null), [homeLat, homeLon]);
  const groundKnown = loaded && !(terrain.reach !== undefined && farthest > terrain.reach);
  const profile = useMemo(() => routeProfile(sim.points, sim.takeoffAlt, sim.ending, params.RTL_ALT / 100, terrain.surface), [sim.points, sim.takeoffAlt, sim.ending, params.RTL_ALT, terrain]);
  const low = useMemo(() => (profile.lowest && groundKnown && profile.lowest.clear < CLEAR_WARN ? { n: profile.lowest.n, e: profile.lowest.e, clear: profile.lowest.clear } : null), [profile, groundKnown]);
  const mark = useMemo(
    () => (result && result.verdict !== "completed" && result.verdict !== "refused" && result.verdict !== "grounded" ? { n: result.stats.endN, e: result.stats.endE, label: result.verdict === "crashed" ? "Crash" : "Ends here", tone: (result.verdict === "crashed" ? "bad" : "ok") as "bad" | "ok" } : null),
    [result],
  );
  const windShown = useMemo(() => ({ speed: wind.speed, fromDeg: wind.from }), [wind.speed, wind.from]);

  const checks = useMemo(
    () => checkPlan({ points: sim.points, takeoffAlt: sim.takeoffAlt, ending: sim.ending, params, airframe: sim.airframe, profile, groundKnown, real, groundReach: beyond ? (terrain.reach ?? null) : null }),
    [sim.points, sim.takeoffAlt, sim.ending, params, sim.airframe, profile, groundKnown, real, beyond, terrain],
  );
  const [allAlt, setAllAlt] = useState(30);
  const [tab, setTab] = useState<"plan" | "predict">("plan");
  const fileBox = useRef<HTMLInputElement>(null);

  const moveHome = (to: LatLon) => {
    sim.moveHome(to);
    setResult(null);
  };

  // Ctrl or ⌘ Z, and Shift with it or Ctrl Y to go forward again. Not while typing: a box has its own undo.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (!(e.ctrlKey || e.metaKey) || e.altKey || (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT"))) return;
      const k = e.key.toLowerCase();
      if (k !== "z" && k !== "y") return;
      e.preventDefault();
      const s = useSim.getState();
      if (k === "y" || e.shiftKey) s.redo();
      else s.undo();
      setResult(null);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);

  /** Puts a mission, from the aircraft or a file, into the planner, and says what did not fit. */
  const adopt = (got: ReadPlan, from: string) => {
    if (!got.points.length && got.takeoffAlt === null) {
      notify("warn", `${from} holds no mission`, "There was nothing to load, so the plan here is unchanged.");
      return;
    }
    sim.loadPlan({ takeoffAlt: got.takeoffAlt ?? sim.takeoffAlt, points: got.points, ending: got.ending, ...(got.home && !simWorld ? { home: got.home } : {}) });
    setResult(null);
    const what = `${got.points.length} ${got.points.length === 1 ? "waypoint" : "waypoints"} loaded. Undo brings the old plan back.`;
    if (got.notes.length) notify("warn", `Loaded from ${from.toLowerCase()}, with changes`, `${got.notes.join(" ")} ${what}`);
    else notify("success", `Loaded from ${from.toLowerCase()}`, what);
  };

  const openFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      // With the virtual aircraft flying, home stays where it is and the waypoints keep their places on the ground.
      const items = fromWaypointFile(await file.text());
      const got = missionToPlan(items, sim.home);
      if (got.home && simWorld) {
        const ref = got.home;
        got.points = got.points.map((w) => {
          const g = toGlobal(ref, w.n, w.e);
          const l = toLocal(sim.home, g.lat, g.lon);
          return { ...w, n: Math.round(l.n), e: Math.round(l.e) };
        });
      }
      adopt(got, "The file");
    } catch (e) {
      notify("error", "That file could not be opened", (e as Error).message);
    }
  };

  const saveFile = () => {
    const stamp = new Date().toISOString().slice(0, 10);
    saveText(`aeronex-plan-${stamp}.waypoints`, toWaypointFile(mission));
    notify("success", "Plan saved", "The file opens here, in Mission Planner and in QGroundControl.");
  };

  const send = async () => {
    if (!virtual) {
      // The last look before a real aircraft is told where to go.
      const highest = Math.max(sim.takeoffAlt, ...sim.points.map((w) => w.alt));
      const bad = checks.filter((c) => c.sev === "bad");
      const ok = await confirmAction({
        title: `Send this mission to your aircraft?`,
        body: `${sim.points.length} ${sim.points.length === 1 ? "waypoint" : "waypoints"}, ${far(farthest)} from home at the farthest, up to ${Math.round(highest)} m above home, ending with ${sim.ending === "rtl" ? "a return home" : sim.ending === "land" ? "a landing at the last waypoint" : "a hover at the last waypoint"}. It replaces the mission the aircraft holds now.${bad.length ? ` The plan check found ${bad.length} ${bad.length === 1 ? "problem" : "problems"}: ${bad[0].text}` : ""}${homeSource === "aircraft" ? "" : " The aircraft has no GPS position yet, so home here is where you placed it, not where the aircraft is. Heights are counted from where it takes off."}`,
        confirmLabel: "Send the mission",
        tone: bad.length || farthest > 2000 || homeSource !== "aircraft" ? "danger" : "default",
      });
      if (!ok) return;
    }
    await order("Send the mission", async () => {
      let sendError: Error | null = null;
      await commandLink.uploadMission(mission).catch((e: Error) => {
        // Over a poor link the aircraft's "got it" can be the message that is lost. A refusal is final;
        // silence is not: the read-back below decides.
        if (!/stopped answering/.test(e.message)) throw e;
        sendError = e;
      });
      // What matters is what the aircraft holds, so it is read back and compared.
      const differs = await commandLink.verifyMission(mission).catch((e: Error) => {
        throw sendError ?? e;
      });
      if (differs && sendError) throw sendError;
      if (differs) throw new Error(`The mission was sent, but the aircraft does not hold what was sent. ${differs} Send it again, and do not fly until it reads back the same.`);
      notify("success", "Mission sent and checked", `${mission.length - 1} commands are on the ${virtual ? "virtual " : ""}aircraft, and reading them back gave the same mission.`);
    });
  };

  const read = () =>
    order("Read the mission", async () => {
      const items = await commandLink.downloadMission();
      const known = useLink.getState().telemetry.home?.value;
      adopt(missionToPlan(items, known ? { ...known } : sim.home), "The aircraft");
    });

  const flyNow = () =>
    order("Fly the mission", async () => {
      await commandLink.uploadMission(mission);
      const g = await commandLink.setMode(COPTER_MODE.GUIDED);
      if (g !== 0) return g;
      const a = await commandLink.arm(true);
      if (a !== 0) return a;
      const m = await commandLink.setMode(COPTER_MODE.AUTO);
      if (m !== 0) return m;
      const r = await commandLink.startMission();
      if (r === 0) nav("/simulator");
      return r;
    });

  const run = () => {
    setBusy(true);
    // Let the button repaint before a second of arithmetic.
    window.setTimeout(() => {
      try {
        const faults: FaultPlan[] =
          fault === "none"
            ? []
            : [{ kind: fault, motor: motor.n, level: motor.level / 100, at: faultAt.by === "time" ? { time: faultAt.value } : { waypoint: faultAt.value + 1 } }];
        setResult(predict(sim.airframe, params, sim.home, mission, { windSpeed: wind.speed, windFromDeg: wind.from, gust: wind.gust / 100, soc: charge / 100, faults }, 7, terrain));
      } catch (e) {
        notify("error", "The prediction failed", (e as Error).message);
      } finally {
        setBusy(false);
      }
    }, 30);
  };

  const v = result ? VERDICT[result.verdict] : null;

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Mission Planning</h1>
          <p>Draw the route, check it against the ground, predict the flight, then send it to the aircraft.</p>
        </div>
        <div className="actions">
          <button className="btn" disabled={!linked} onClick={read} title={linked ? undefined : "Connect an aircraft first"}>
            <Download /> Read from aircraft
          </button>
          <button className="btn btn-primary" disabled={!linked || empty || !!gpsBlock || !!unread} onClick={send} title={!linked ? "Connect an aircraft first" : gpsBlock ? gpsBlock.title : unread ? "Reading the aircraft's settings first" : undefined}>
            <Upload /> Send to {virtual ? "virtual aircraft" : "aircraft"}
          </button>
        </div>
      </header>

      {/* The plan in six numbers, so the state of it can be read without reading the page. */}
      <dl className="mp-glance" aria-label="The plan at a glance">
        <div>
          <dt>Waypoints</dt>
          <dd>{sim.points.length}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>{empty ? "–" : length >= 1000 ? <>{(length / 1000).toFixed(2)}<small>km</small></> : <>{Math.round(length)}<small>m</small></>}</dd>
        </div>
        <div title="Take-off, the legs at cruise speed, the waits and the landing. The prediction gives the real figure.">
          <dt>Flight time, about</dt>
          <dd>{empty ? "–" : clock(flightSeconds({ points: sim.points, takeoffAlt: sim.takeoffAlt, ending: sim.ending, params, profile }))}</dd>
        </div>
        <div>
          <dt>Highest point</dt>
          <dd>{Math.round(Math.max(sim.takeoffAlt, ...sim.points.map((w) => w.alt)))}<small>m above home</small></dd>
        </div>
        <div title="The closest the whole route comes to the ground, not only at the waypoints.">
          <dt>Closest to the ground</dt>
          <dd className={!profile.lowest || !groundKnown ? "na" : profile.lowest.clear < 0 ? "bad" : profile.lowest.clear < CLEAR_WARN ? "warn" : undefined}>
            {!profile.lowest ? "–" : !groundKnown ? "not known" : <>{Math.round(profile.lowest.clear)}<small>m</small></>}
          </dd>
        </div>
        <div title={fmtLatLon(sim.home)}>
          <dt>Home</dt>
          <dd className="word">{simWorld ? "Virtual aircraft" : homeSource === "aircraft" ? "Aircraft GPS" : homeSource === "waiting" ? "Waiting for GPS" : real ? "Placed by you" : "Practice field"}</dd>
        </div>
      </dl>

      <div className="mp-grid">
        <section className="panel mp-map">
          <div className="panel-head">
            <h3>Route</h3>
            <div className="segmented mp-world" role="group" aria-label="What the route is drawn on" title={simWorld ? "The virtual aircraft is flying in this world. Stop it to change." : undefined}>
              <button aria-pressed={real} disabled={!!simWorld} onClick={() => { sim.set("terrain", "real"); setResult(null); }}>
                <Globe /> Real map
              </button>
              <button aria-pressed={!real} disabled={!!simWorld} onClick={() => { sim.set("terrain", lastField.current); setResult(null); }}>
                <LandPlot /> Practice field
              </button>
            </div>
          </div>
          {unread && !gpsBlock && (
            <div className="callout info mp-away" role="status">
              <Info />
              <span>
                <strong>Reading the aircraft's settings{unread.count ? `: ${unread.received} of ${unread.count}` : ""}.</strong> The return-home height, speeds, fence and battery failsafe are the aircraft's own. The
                checks here use them, so the mission can be sent once they are all read.
              </span>
            </div>
          )}
          {gpsBlock && (
            <div className="callout warn mp-away" role="status">
              <SatelliteDish />
              <span>
                <strong>{gpsBlock.title}.</strong> {gpsBlock.body} You can still plan, predict and fly it in the simulator.
              </span>
            </div>
          )}
          {real ? (
            <Suspense fallback={<div className="rmap rmap-loading">Loading the map…</div>}>
              <RealMap
                home={sim.home}
                route={route}
                closeRoute={sim.ending === "rtl"}
                ghost={result?.track}
                fenceRadius={params.FENCE_ENABLE ? params.FENCE_RADIUS : null}
                wind={windShown}
                mark={mark}
                low={low}
                homeLocked={!!simWorld || homeSource === "aircraft"}
                onPick={(n, e) => {
                  sim.addPoint(n, e);
                  setResult(null);
                }}
                onMovePoint={(id, n, e) => {
                  sim.updatePoint(id, { n: Math.round(n), e: Math.round(e) });
                  setResult(null);
                }}
                onMoveHome={moveHome}
              />
            </Suspense>
          ) : (
            <FlightMap
              route={route}
              closeRoute={sim.ending === "rtl"}
              ghost={result?.track}
              fenceRadius={params.FENCE_ENABLE ? params.FENCE_RADIUS : null}
              wind={windShown}
              mark={mark}
              terrain={terrain}
              onPick={(n, e) => {
                sim.addPoint(n, e);
                setResult(null);
              }}
              minSpan={80}
            />
          )}
          {real && !simWorld && dem.status === "error" && (
            <div className="callout warn mp-away" role="status">
              <TriangleAlert />
              <span>
                <strong>The ground heights could not be loaded.</strong> {dem.error} Until they are, clearances and predictions here assume level ground.
              </span>
              <button className="btn btn-sm" onClick={() => void ensureDem(sim.home, reach).catch(() => undefined)}>
                Try again
              </button>
            </div>
          )}
          {groundKnown && <HeightProfile profile={profile} real={real} loading={real && !simWorld && dem.status === "loading"} />}
        </section>

        <div className="stack">
          {/* One thing at a time beside the map: the plan, or the prediction of it. */}
          <div className="mp-tabs" role="tablist" aria-label="Plan or prediction">
            <button role="tab" id="mp-tab-plan" aria-selected={tab === "plan"} aria-controls="mp-plan" onClick={() => setTab("plan")}>
              <ListChecks /> Plan
              {checks.some((c) => c.sev === "bad") ? <i className="mp-dot bad" title="The plan check found a problem" /> : checks.some((c) => c.sev === "warn") ? <i className="mp-dot warn" title="The plan check has warnings" /> : null}
            </button>
            <button role="tab" id="mp-tab-predict" aria-selected={tab === "predict"} aria-controls="mp-predict" onClick={() => setTab("predict")}>
              <FlaskConical /> Predict
              {result && v ? <i className={`mp-dot ${v.tone}`} title={v.title} /> : null}
            </button>
          </div>
          <section className="panel" id="mp-plan" role="tabpanel" aria-labelledby="mp-tab-plan" hidden={tab !== "plan"}>
            <div className="panel-head">
              <h3>Plan</h3>
              <div className="mp-tools" role="group" aria-label="Plan tools">
                <button className="icon-btn" disabled={!sim.canUndo} onClick={() => { sim.undo(); setResult(null); }} aria-label="Undo" title="Undo (Ctrl Z)">
                  <Undo2 />
                </button>
                <button className="icon-btn" disabled={!sim.canRedo} onClick={() => { sim.redo(); setResult(null); }} aria-label="Redo" title="Redo (Ctrl Shift Z)">
                  <Redo2 />
                </button>
                <button className="icon-btn" onClick={() => fileBox.current?.click()} aria-label="Open a plan file" title="Open a plan file (.waypoints), from here, Mission Planner or QGroundControl">
                  <FolderOpen />
                </button>
                <button className="icon-btn" disabled={empty} onClick={saveFile} aria-label="Save the plan to a file" title="Save the plan to a file that Mission Planner and QGroundControl also open">
                  <Save />
                </button>
                <button
                  className="icon-btn"
                  disabled={empty}
                  onClick={() => {
                    sim.clearPoints();
                    setResult(null);
                  }}
                  aria-label="Remove every waypoint"
                  title="Remove every waypoint (Undo brings them back)"
                >
                  <Trash2 />
                </button>
                <input
                  ref={fileBox}
                  type="file"
                  accept=".waypoints,.txt,.mission"
                  hidden
                  onChange={(e) => {
                    void openFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
            <div className="panel-body mp-plan">
              {empty ? (
                <p className="mp-empty">
                  {real
                    ? "Click the map to place the first waypoint. Home is the H. Link your aircraft and home goes to its GPS position by itself; with no aircraft, press the home button on the map and click where it will take off."
                    : "Click the map to place the first waypoint. Home is the H in the middle; the grid is in metres."}
                </p>
              ) : (
                <table className={`mp-table${real ? " real" : ""}`}>
                  <thead>
                    <tr>
                      <th>#</th>
                      {real ? (
                        <th colSpan={2}>Latitude, longitude</th>
                      ) : (
                        <>
                          <th>North (m)</th>
                          <th>East (m)</th>
                        </>
                      )}
                      <th>Height (m)</th>
                      <th title="Height of the waypoint above the ground beneath it">Clear (m)</th>
                      <th>Wait (s)</th>
                      <th aria-label="Move or remove" />
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="mp-cmd">
                      <td className="c-n">
                        <PlaneTakeoff aria-label="Take off" />
                      </td>
                      <td className="c-what" colSpan={2}>
                        <strong>Take off</strong>
                        <small>Straight up from home</small>
                      </td>
                      <td className="c-h" data-label="Height (m)">
                        <NumCell label="Take-off height" value={sim.takeoffAlt} min={2} max={500} onChange={(x) => sim.set("takeoffAlt", x)} />
                      </td>
                      <td className="c-rest" colSpan={3} />
                    </tr>
                    {sim.points.map((p, i) => {
                      const ground = terrain.surface(p.n, p.e);
                      const known = loaded && !(terrain.reach !== undefined && Math.max(Math.abs(p.n), Math.abs(p.e)) > terrain.reach);
                      return (
                        <tr key={p.id} className="mp-wp">
                          <td className="num c-n">{i + 1}</td>
                          {real ? (
                            <td colSpan={2} className="num mp-pos c-pos" title={`${Math.round(Math.hypot(p.n, p.e))} m from home. Drag its marker on the map to move it.`}>
                              {fmtLatLon(toGlobal(sim.home, p.n, p.e))}
                            </td>
                          ) : (
                            <>
                              <td className="c-north" data-label="North (m)"><NumCell label={`Waypoint ${i + 1} north`} value={p.n} min={-20000} max={20000} onChange={(x) => sim.updatePoint(p.id, { n: x })} /></td>
                              <td className="c-east" data-label="East (m)"><NumCell label={`Waypoint ${i + 1} east`} value={p.e} min={-20000} max={20000} onChange={(x) => sim.updatePoint(p.id, { e: x })} /></td>
                            </>
                          )}
                          <td className="c-h" data-label="Height (m)"><NumCell label={`Waypoint ${i + 1} height`} value={p.alt} min={2} max={500} onChange={(x) => sim.updatePoint(p.id, { alt: x })} /></td>
                          {known ? (
                            <td className={`num mp-clear c-clear${p.alt - ground < 10 ? " low" : ""}`} data-label="Clear (m)" title={`The ground here is ${ground.toFixed(0)} m above home`}>
                              {terrain.isWater(p.n, p.e) ? "water" : Math.round(p.alt - ground)}
                            </td>
                          ) : (
                            <td className="num mp-clear c-clear" data-label="Clear (m)" title={loaded ? "Too far from home: the ground heights do not reach here" : "The ground heights are still loading"}>
                              {loaded ? "?" : "…"}
                            </td>
                          )}
                          <td className="c-wait" data-label="Wait (s)"><NumCell label={`Waypoint ${i + 1} wait`} value={p.holdS} min={0} max={600} onChange={(x) => sim.updatePoint(p.id, { holdS: x })} /></td>
                          <td className="c-act">
                            <div className="mp-acts">
                            <button className="icon-btn" disabled={i === 0} aria-label={`Move waypoint ${i + 1} earlier`} title="Fly this one earlier" onClick={() => { sim.shiftPoint(p.id, -1); setResult(null); }}>
                              <ArrowUp />
                            </button>
                            <button className="icon-btn" disabled={i === sim.points.length - 1} aria-label={`Move waypoint ${i + 1} later`} title="Fly this one later" onClick={() => { sim.shiftPoint(p.id, 1); setResult(null); }}>
                              <ArrowDown />
                            </button>
                            <button className="icon-btn" aria-label={`Remove waypoint ${i + 1}`} title="Remove" onClick={() => { sim.removePoint(p.id); setResult(null); }}>
                              <X />
                            </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    {/* The last command, as a row of its own, so the list is the whole mission. */}
                    <tr className={`mp-cmd end ${sim.ending}`}>
                      <td className="c-n">{sim.ending === "rtl" ? <HomeIcon aria-hidden /> : sim.ending === "land" ? <PlaneLanding aria-hidden /> : <CirclePause aria-hidden />}</td>
                      <td className="c-what" colSpan={6}>
                        <strong>{sim.ending === "rtl" ? "Return home and land" : sim.ending === "land" ? `Land at waypoint ${sim.points.length}` : `Hover at waypoint ${sim.points.length}`}</strong>
                        <small>
                          {sim.ending === "rtl"
                            ? `Flies back to home at ${(params.RTL_ALT / 100).toFixed(0)} m or its own height if higher, then lands.`
                            : sim.ending === "land"
                              ? "Descends and lands where the last waypoint is, away from home."
                              : "Stays in the air there until you take over. Nothing lands it."}
                        </small>
                      </td>
                    </tr>
                  </tbody>
                </table>
              )}
              {empty && (
                <div className="mp-line">
                  <span className="mp-step">Take off to</span>
                  <NumCell label="Take-off height" value={sim.takeoffAlt} min={2} max={500} onChange={(x) => sim.set("takeoffAlt", x)} />
                  <span className="muted">m</span>
                </div>
              )}
              <div className="mp-line">
                <span className="mp-step">At the end</span>
                <div className="segmented" role="group" aria-label="How the mission ends">
                  {(
                    [
                      ["rtl", "Return home and land"],
                      ["land", "Land where it is"],
                      ["hold", "Hover there"],
                    ] as [Ending, string][]
                  ).map(([k, l]) => (
                    <button key={k} aria-pressed={sim.ending === k} onClick={() => { sim.set("ending", k); setResult(null); }}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
              {sim.points.length > 1 && (
                <div className="mp-line">
                  <span className="mp-step">Every height</span>
                  <NumCell label="Height for every waypoint" value={allAlt} min={2} max={500} onChange={setAllAlt} />
                  <span className="muted">m</span>
                  <button className="btn btn-sm" onClick={() => { sim.setAllHeights(allAlt); setResult(null); }}>
                    Set all waypoints
                  </button>
                </div>
              )}
              {!empty && (
                <div className="mp-check" aria-live="polite">
                  <h4>Plan check</h4>
                  {checks.some((c) => c.sev !== "note") ? null : (
                    <p className="mp-check-ok">
                      <CircleCheck aria-hidden /> Nothing wrong that can be seen from the numbers. Predict the flight to see how it goes.
                    </p>
                  )}
                  <ul>
                    {checks.map((c) => (
                      <li key={c.text} className={c.sev}>
                        {c.sev === "bad" ? <CircleX aria-hidden /> : c.sev === "warn" ? <TriangleAlert aria-hidden /> : <Info aria-hidden />}
                        <span>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section className="panel" id="mp-predict" role="tabpanel" aria-labelledby="mp-tab-predict" hidden={tab !== "predict"}>
            <div className="panel-head">
              <h3>Predict this flight</h3>
            </div>
            <div className="panel-body mp-predict">
              <p className="mp-source">
                Flies <strong>{sim.airframe.name}</strong> ({sim.airframe.massKg} kg, {sim.airframe.cells}S {sim.airframe.capacityMah} mAh) on {source}.{" "}
                <Link to="/simulator">Change the aircraft</Link>
              </p>
              <div className="mp-fields">
                <label className="field">
                  <span>Wind (m/s)</span>
                  <NumCell label="Wind speed" value={wind.speed} min={0} max={30} onChange={(x) => setWind({ ...wind, speed: x })} />
                </label>
                <label className="field">
                  <span>From (°)</span>
                  <NumCell label="Wind direction" value={wind.from} min={0} max={359} onChange={(x) => setWind({ ...wind, from: x })} />
                </label>
                <label className="field">
                  <span>Gusts (%)</span>
                  <NumCell label="Gust strength" value={wind.gust} min={0} max={100} onChange={(x) => setWind({ ...wind, gust: x })} />
                </label>
                <label className="field">
                  <span>Battery (%)</span>
                  <NumCell label="Battery at take-off" value={charge} min={5} max={100} onChange={setCharge} />
                </label>
              </div>
              <div className="mp-fault">
                <label className="field">
                  <span>What goes wrong</span>
                  <select className="select" value={fault} onChange={(e) => setFault(e.target.value as "none" | FaultKind)}>
                    <option value="none">Nothing</option>
                    <option value="motor">A motor loses thrust</option>
                    <option value="gps">GPS is lost</option>
                    <option value="radio">The radio transmitter is lost</option>
                    <option value="gcs">This app loses the link</option>
                  </select>
                </label>
                {fault !== "none" && (
                  <>
                    <label className="field">
                      <span>When</span>
                      <select className="select" value={faultAt.by} onChange={(e) => setFaultAt({ by: e.target.value as "waypoint" | "time", value: e.target.value === "time" ? 30 : 1 })}>
                        <option value="waypoint">On reaching waypoint</option>
                        <option value="time">Seconds after arming</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>{faultAt.by === "waypoint" ? "Waypoint" : "Seconds"}</span>
                      <NumCell label="When the fault happens" value={faultAt.value} min={faultAt.by === "waypoint" ? 1 : 1} max={faultAt.by === "waypoint" ? Math.max(1, sim.points.length) : 2400} onChange={(x) => setFaultAt({ ...faultAt, value: x })} />
                    </label>
                  </>
                )}
                {fault === "motor" && (
                  <>
                    <label className="field">
                      <span>Motor</span>
                      <NumCell label="Which motor" value={motor.n} min={1} max={4} onChange={(x) => setMotor({ ...motor, n: x })} />
                    </label>
                    <label className="field">
                      <span>Thrust left (%)</span>
                      <NumCell label="Thrust left" value={motor.level} min={0} max={95} onChange={(x) => setMotor({ ...motor, level: x })} />
                    </label>
                  </>
                )}
              </div>
              <div className="mp-run">
                <button className="btn btn-primary" disabled={empty || busy} onClick={run}>
                  <FlaskConical /> {busy ? "Flying it…" : "Predict the flight"}
                </button>
                {linked && virtual && (
                  <button className="btn" disabled={empty} onClick={flyNow}>
                    <Play /> Fly it live in the simulator
                  </button>
                )}
              </div>
            </div>
          </section>
          {result && v && tab === "predict" && (
            <section className={`panel mp-result in-col ${v.tone}`} aria-live="polite">
              <div className="mp-verdict">
                {v.tone === "ok" ? <CircleCheck /> : v.tone === "bad" ? <CircleX /> : <TriangleAlert />}
                <div>
                  <h3>{v.title}</h3>
                  <p>{result.headline}</p>
                </div>
              </div>
              {result.verdict !== "refused" && result.verdict !== "grounded" && (
                <dl className="readouts mp-stats">
                  <div className="readout"><dt>Flight time</dt><dd>{clock(result.stats.durationS)}</dd></div>
                  <div className="readout"><dt>Distance flown</dt><dd>{result.stats.distanceM >= 1000 ? (result.stats.distanceM / 1000).toFixed(2) : Math.round(result.stats.distanceM)}<small>{result.stats.distanceM >= 1000 ? "km" : "m"}</small></dd></div>
                  <div className="readout"><dt>Battery left</dt><dd className={result.stats.endSoc < 0.2 ? "bad" : undefined}>{Math.round(result.stats.endSoc * 100)}<small>%</small></dd></div>
                  <div className="readout"><dt>Battery used</dt><dd>{Math.round(result.stats.usedMah)}<small>mAh</small></dd></div>
                  <div className="readout"><dt>Lowest voltage</dt><dd>{result.stats.minVolts.toFixed(1)}<small>V</small></dd></div>
                  <div className="readout"><dt>Peak current</dt><dd>{Math.round(result.stats.maxAmps)}<small>A</small></dd></div>
                  <div className="readout"><dt>Top speed</dt><dd>{result.stats.maxSpeed.toFixed(1)}<small>m/s</small></dd></div>
                  <div className="readout"><dt>Steepest lean</dt><dd>{Math.round(result.stats.maxLeanDeg)}<small>°</small></dd></div>
                  <div className="readout"><dt>Peak throttle</dt><dd className={result.stats.maxThrottle > 0.9 ? "bad" : undefined}>{Math.round(result.stats.maxThrottle * 100)}<small>%</small></dd></div>
                  <div className="readout"><dt>Commands done</dt><dd>{result.stats.reached.length}<small>of {result.stats.commands}</small></dd></div>
                </dl>
              )}
              <div className="mp-cols">
                <div>
                  <h4>What it means</h4>
                  <ul className="mp-findings">
                    {result.findings.map((f) => (
                      <li key={f.text} className={f.sev}>
                        {f.text}
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h4>What happened, in order</h4>
                  <ol className="mp-timeline">
                    {result.events
                      .filter((e) => e.kind && e.kind !== "prearm")
                      .map((e, i) => (
                        <li key={i} className={e.sev}>
                          <span className="num">{clock(e.t)}</span>
                          {e.text}
                        </li>
                      ))}
                  </ol>
                </div>
              </div>
              <p className="mp-caveat">
                A prediction from a model of ArduCopter with no obstacles or sensor noise.{" "}
                {real && groundKnown
                  ? "The ground is measured data of about 30 m detail, typically right to 10 m; trees, buildings and wires are not in it."
                  : real
                    ? "The ground heights were not loaded, so it flew over level ground."
                    : "The ground is the practice landscape, not a real place."}{" "}
                The final mode was {MODE_NAME[result.track.at(-1)?.mode ?? 0] ?? "unknown"}.
                Use it to find mistakes in a plan and its settings, not as a promise.
              </p>
            </section>
          )}
        </div>
      </div>

    </div>
  );
}
