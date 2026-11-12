import { CircleCheck, CircleX, Download, FlaskConical, Play, Trash2, TriangleAlert, Upload, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CMD, MODE_NAME, type MissionItem } from "../../sim/autopilot";
import { defaultParams, type Params } from "../../sim/params";
import { predict, type FaultKind, type FaultPlan, type Prediction, type Verdict } from "../../sim/predict";
import { commandLink, COPTER_MODE } from "../../services/link/commandLink";
import { linkManager, rememberedParams } from "../../services/link/linkManager";
import { useLink } from "../../state/linkStore";
import { notify } from "../../state/notifyStore";
import { useParams } from "../../state/paramStore";
import { planToMission, routeLength, useSim, type Ending, type PlanPoint } from "../../state/simStore";
import { FlightMap } from "../simulator/FlightMap";
import { modelledParams, order } from "../simulator/SimulatorPage";

const M_PER_DEG = 111319.5;

const VERDICT: Record<Verdict, { tone: "ok" | "warn" | "bad"; title: string }> = {
  completed: { tone: "ok", title: "Mission completed" },
  "came-home": { tone: "warn", title: "Came home early" },
  "landed-away": { tone: "warn", title: "Landed away from home" },
  holding: { tone: "warn", title: "Left hovering" },
  timeout: { tone: "warn", title: "Still flying" },
  refused: { tone: "bad", title: "Would not start" },
  crashed: { tone: "bad", title: "Crashed" },
};

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;

function NumCell({ value, onChange, min, max, label }: { value: number; onChange: (v: number) => void; min: number; max: number; label: string }) {
  return (
    <input
      className="input mp-num"
      type="number"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== "" && Number.isFinite(v)) onChange(Math.max(min, Math.min(max, v)));
      }}
    />
  );
}

/** Which parameters a prediction should fly on, and where they came from. */
function useFlightParams(): { params: Params; source: string } {
  const sim = useSim();
  const virtual = useLink((s) => s.virtual);
  const status = useLink((s) => s.status);
  const live = useParams((s) => s.values);
  const count = useParams((s) => s.count);
  const received = useParams((s) => s.received);
  return useMemo(() => {
    const base = defaultParams(sim.airframe);
    if (status === "connected" && virtual && linkManager.sim) return { params: { ...linkManager.sim.ap.params }, source: "the virtual aircraft's current settings" };
    if (status === "connected" && !virtual && count && received >= count) return { params: { ...base, ...modelledParams(live) }, source: "the settings just read from your aircraft" };
    const saved = sim.useAircraftParams ? rememberedParams() : null;
    const got = modelledParams(saved?.values);
    if (saved && Object.keys(got).length) return { params: { ...base, ...got }, source: `the settings read from your aircraft on ${new Date(saved.at).toLocaleDateString()}` };
    return { params: base, source: "ArduCopter's default settings, tuned for this airframe" };
  }, [sim.airframe, sim.useAircraftParams, status, virtual, live, count, received]);
}

export function MissionPlanningPage() {
  const sim = useSim();
  const nav = useNavigate();
  const status = useLink((s) => s.status);
  const virtual = useLink((s) => s.virtual);
  const linked = status === "connected";
  const { params, source } = useFlightParams();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Prediction | null>(null);
  const [wind, setWind] = useState({ speed: 0, from: 270, gust: 30 });
  const [charge, setCharge] = useState(100);
  const [fault, setFault] = useState<"none" | FaultKind>("none");
  const [faultAt, setFaultAt] = useState<{ by: "waypoint" | "time"; value: number }>({ by: "waypoint", value: 1 });
  const [motor, setMotor] = useState({ n: 1, level: 0 });

  const mission = useMemo(() => planToMission(sim.home, sim.takeoffAlt, sim.points, sim.ending), [sim.home, sim.takeoffAlt, sim.points, sim.ending]);
  const length = routeLength(sim.points, sim.ending);
  const cruise = params.WPNAV_SPEED / 100;
  const route = sim.points.map((p, i) => ({ n: p.n, e: p.e, label: String(i + 1) }));
  const empty = sim.points.length === 0;

  const send = () =>
    order("Send the mission", async () => {
      await commandLink.uploadMission(mission);
      notify("success", "Mission sent", `${mission.length - 1} commands are on the ${virtual ? "virtual " : ""}aircraft.`);
    });

  const read = () =>
    order("Read the mission", async () => {
      const items = await commandLink.downloadMission();
      const home = useLink.getState().telemetry.home?.value ?? sim.home;
      const pts: PlanPoint[] = [];
      let ending: Ending = "hold";
      let takeoff = sim.takeoffAlt;
      for (const it of items.slice(1) as MissionItem[]) {
        if (it.command === CMD.TAKEOFF) takeoff = it.z;
        else if (it.command === CMD.RTL) ending = "rtl";
        else if (it.command === CMD.LAND) ending = "land";
        else if (it.command === CMD.WAYPOINT && (it.x !== 0 || it.y !== 0)) {
          pts.push({ id: `r${it.seq}`, n: Math.round((it.x / 1e7 - home.lat) * M_PER_DEG), e: Math.round((it.y / 1e7 - home.lon) * M_PER_DEG * Math.cos((home.lat * Math.PI) / 180)), alt: it.z, holdS: it.p1 });
        }
      }
      sim.set("home", { ...sim.home, lat: home.lat, lon: home.lon });
      sim.set("takeoffAlt", takeoff);
      sim.set("points", pts);
      sim.set("ending", ending);
      notify("success", "Mission read", `${pts.length} waypoints came from the aircraft.`);
    });

  const flyNow = () =>
    order("Fly the mission", async () => {
      await commandLink.uploadMission(mission);
      await commandLink.setMode(COPTER_MODE.GUIDED);
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
        setResult(predict(sim.airframe, params, sim.home, mission, { windSpeed: wind.speed, windFromDeg: wind.from, gust: wind.gust / 100, soc: charge / 100, faults }));
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
          <p>Lay out a route, then fly it in the simulator before the aircraft does: with your wind, your battery, and the failure you are worried about.</p>
        </div>
        <div className="actions">
          <button className="btn" disabled={!linked} onClick={read} title={linked ? undefined : "Connect an aircraft first"}>
            <Download /> Read from aircraft
          </button>
          <button className="btn btn-primary" disabled={!linked || empty} onClick={send} title={linked ? undefined : "Connect an aircraft first"}>
            <Upload /> Send to {virtual ? "virtual aircraft" : "aircraft"}
          </button>
        </div>
      </header>

      <div className="mp-grid">
        <section className="panel mp-map">
          <div className="panel-head">
            <h3>Route</h3>
            <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
              {empty ? "No waypoints yet" : `${sim.points.length} waypoints, ${length >= 1000 ? `${(length / 1000).toFixed(2)} km` : `${Math.round(length)} m`}, about ${clock(length / cruise + sim.takeoffAlt / 2.5 + 30)} at ${cruise.toFixed(0)} m/s`}
            </span>
          </div>
          <FlightMap
            route={route}
            closeRoute={sim.ending === "rtl"}
            ghost={result?.track}
            fenceRadius={params.FENCE_ENABLE ? params.FENCE_RADIUS : null}
            wind={{ speed: wind.speed, fromDeg: wind.from }}
            mark={result && result.verdict !== "completed" && result.verdict !== "refused" ? { n: result.stats.endN, e: result.stats.endE, label: result.verdict === "crashed" ? "Crash" : "Ends here", tone: result.verdict === "crashed" ? "bad" : "ok" } : null}
            onPick={(n, e) => {
              sim.addPoint(n, e);
              setResult(null);
            }}
            minSpan={80}
          />
        </section>

        <div className="stack">
          <section className="panel">
            <div className="panel-head">
              <h3>Plan</h3>
              {!empty && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    sim.clearPoints();
                    setResult(null);
                  }}
                >
                  <Trash2 /> Clear
                </button>
              )}
            </div>
            <div className="panel-body mp-plan">
              <div className="mp-line">
                <span className="mp-step">Take off to</span>
                <NumCell label="Take-off height" value={sim.takeoffAlt} min={2} max={500} onChange={(x) => sim.set("takeoffAlt", x)} />
                <span className="muted">m</span>
              </div>
              {empty ? (
                <p className="mp-empty">Click the map to place the first waypoint. Home is the H in the middle; the grid is in metres.</p>
              ) : (
                <table className="mp-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>North (m)</th>
                      <th>East (m)</th>
                      <th>Height (m)</th>
                      <th>Wait (s)</th>
                      <th aria-label="Remove" />
                    </tr>
                  </thead>
                  <tbody>
                    {sim.points.map((p, i) => (
                      <tr key={p.id}>
                        <td className="num">{i + 1}</td>
                        <td><NumCell label={`Waypoint ${i + 1} north`} value={p.n} min={-20000} max={20000} onChange={(x) => sim.updatePoint(p.id, { n: x })} /></td>
                        <td><NumCell label={`Waypoint ${i + 1} east`} value={p.e} min={-20000} max={20000} onChange={(x) => sim.updatePoint(p.id, { e: x })} /></td>
                        <td><NumCell label={`Waypoint ${i + 1} height`} value={p.alt} min={2} max={500} onChange={(x) => sim.updatePoint(p.id, { alt: x })} /></td>
                        <td><NumCell label={`Waypoint ${i + 1} wait`} value={p.holdS} min={0} max={600} onChange={(x) => sim.updatePoint(p.id, { holdS: x })} /></td>
                        <td>
                          <button className="icon-btn" aria-label={`Remove waypoint ${i + 1}`} onClick={() => sim.removePoint(p.id)}>
                            <X />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="mp-line">
                <span className="mp-step">Then</span>
                <div className="segmented" role="group" aria-label="How the mission ends">
                  {(
                    [
                      ["rtl", "Return home and land"],
                      ["land", "Land where it is"],
                      ["hold", "Hover there"],
                    ] as [Ending, string][]
                  ).map(([k, l]) => (
                    <button key={k} aria-pressed={sim.ending === k} onClick={() => sim.set("ending", k)}>
                      {l}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head">
              <h3>Predict this flight</h3>
              <FlaskConical size={18} color="var(--muted)" />
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
        </div>
      </div>

      {result && v && (
        <section className={`panel mp-result ${v.tone}`} aria-live="polite">
          <div className="mp-verdict">
            {v.tone === "ok" ? <CircleCheck /> : v.tone === "bad" ? <CircleX /> : <TriangleAlert />}
            <div>
              <h3>{v.title}</h3>
              <p>{result.headline}</p>
            </div>
          </div>
          {result.verdict !== "refused" && (
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
            A prediction from a model of ArduCopter with no terrain, obstacles or sensor noise. The final mode was {MODE_NAME[result.track.at(-1)?.mode ?? 0] ?? "unknown"}.
            Use it to find mistakes in a plan and its settings, not as a promise.
          </p>
        </section>
      )}
    </div>
  );
}
