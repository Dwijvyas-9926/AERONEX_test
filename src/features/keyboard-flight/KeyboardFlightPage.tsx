import { Gamepad2, Gauge, Hand, Keyboard, OctagonX, PlaneLanding, RotateCcw, ShieldCheck, TriangleAlert, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ConnectPrompt } from "../../components/ui/ConnectPrompt";
import { Pfd } from "../flightdata/Pfd";
import { notify } from "../../state/notifyStore";
import { commandLink, vehicleBlock } from "../../services/link/commandLink";
import { useLink } from "../../state/linkStore";
import { DEFAULT_CONFIG, FlightController, type FlightDeps, type FlightState, type KeyState, type LogLevel } from "./flightController";

const DEG = 180 / Math.PI;
const fresh = (at: number | undefined) => at != null && Date.now() - at < 3000;

interface LogLine { id: number; level: LogLevel; text: string; at: number }

// which movement key maps to which controller input
const MOVE: Record<string, Partial<KeyState>> = {
  w: { fwd: true }, s: { back: true }, a: { left: true }, d: { right: true }, q: { yawLeft: true }, e: { yawRight: true },
};
const MOVE_OFF: Record<string, Partial<KeyState>> = {
  w: { fwd: false }, s: { back: false }, a: { left: false }, d: { right: false }, q: { yawLeft: false }, e: { yawRight: false },
};

function KeyCap({ k, label, active }: { k: string; label: string; active: boolean }) {
  return (
    <div className={`kf-key${active ? " on" : ""}`}>
      <span className="kf-key-cap">{k}</span>
      <span className="kf-key-label">{label}</span>
    </div>
  );
}

function VelBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.max(-100, Math.min(100, (value / max) * 100));
  return (
    <div className="kf-vel">
      <span className="kf-vel-label">{label}</span>
      <div className="kf-vel-track">
        <div className="kf-vel-fill" style={{ width: `${Math.abs(pct)}%`, marginLeft: pct < 0 ? `${50 - Math.abs(pct) / 2}%` : "50%" }} />
        <span className="kf-vel-zero" />
      </div>
      <span className="kf-vel-num">{value >= 0 ? "+" : ""}{value.toFixed(2)}</span>
    </div>
  );
}

export function KeyboardFlightPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const tel = useLink((s) => s.telemetry);
  const connected = !!vehicle && (status === "connected" || status === "stale");
  const canSend = !!vehicle && status === "connected";

  const [flight, setFlight] = useState<FlightState>({ phase: "idle", vx: 0, vy: 0, vz: 0, yawRate: 0, relAlt: null, armed: false });
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [active, setActive] = useState<Record<string, boolean>>({});
  const [showTutorial, setShowTutorial] = useState(true);
  const [ack, setAck] = useState(false);
  const [fsSet, setFsSet] = useState(false);
  const [fsBusy, setFsBusy] = useState(false);

  const fcRef = useRef<FlightController | null>(null);
  const readyRef = useRef(false);
  const modalRef = useRef(true);
  const logId = useRef(0);
  /** A fixed point for turning latitude and longitude into metres; any point will do, as long as it stays put. */
  const geoRef = useRef<{ lat: number; lon: number } | null>(null);

  const pushLog = useCallback((level: LogLevel, text: string) => {
    setLogs((l) => [...l.slice(-40), { id: logId.current++, level, text, at: Date.now() }]);
  }, []);

  // --- live readiness (pre-flight gate) ---
  const gps = tel.gps?.value;
  const gpsOk = !!gps && fresh(tel.gps?.at) && gps.fixType >= 3;
  const disarmed = !vehicle?.armed;
  const notCopter = vehicle ? vehicleBlock() : null;
  const ready = canSend && !notCopter && gpsOk && disarmed && ack && fsSet;
  useEffect(() => { readyRef.current = ready; }, [ready]);

  // --- build the controller once, wired to real MAVLink + telemetry ---
  useEffect(() => {
    const deps: FlightDeps = {
      arm: (on) => commandLink.arm(on),
      setMode: (m) => commandLink.setMode(m),
      takeoff: (alt) => commandLink.guidedTakeoff(alt),
      setVelocity: (vx, vy, vz, yawRate) => commandLink.setVelocityBody(vx, vy, vz, yawRate),
      getTelemetry: () => {
        const s = useLink.getState();
        const t = s.telemetry;
        /*
          Height above the take-off point, and only that. This fell back to
          the HUD altitude when no position had arrived, and the HUD altitude
          is above sea level: at a field 400 m up, the controller saw a
          take-off that had "reached" two metres before the motors spun, and
          a ceiling it was already far beyond. A reading that has stopped
          updating is no reading either.
        */
        const fresh = t.position && Date.now() - t.position.at < 3000;
        const alt = fresh ? t.position!.value.relAlt : null;
        // The mode number is what lets the controller see that a landing it
        // asked for has actually begun — or that someone has taken over on
        // the radio. It was passed as null, so the controller flew blind to
        // both.
        // Position and heading, for the range limit. Old readings count as none.
        let pos: { n: number; e: number } | null = null;
        if (fresh) {
          const { lat, lon } = t.position!.value;
          const r = (geoRef.current ??= { lat, lon });
          pos = { n: (lat - r.lat) * 111_320, e: (lon - r.lon) * 111_320 * Math.cos((r.lat * Math.PI) / 180) };
        }
        const attFresh = t.attitude && Date.now() - t.attitude.at < 3000;
        const hdg = attFresh ? t.attitude!.value.yaw : fresh && t.position!.value.heading != null ? (t.position!.value.heading * Math.PI) / 180 : null;
        return { armed: s.vehicle?.armed ?? false, relAlt: alt, mode: s.vehicle?.customMode ?? null, connected: !!s.vehicle && s.status === "connected", pos, heading: hdg };
      },
      now: () => Date.now(),
      log: pushLog,
      onChange: setFlight,
    };
    const fc = new FlightController(deps);
    fcRef.current = fc;
    fc.start();
    return () => {
      fcRef.current = null;
      /*
        Leaving this page with the aircraft in the air used to stop the
        controller and nothing else: the vehicle stayed in a GUIDED hover
        with no keys bound to it, and — because the app's heartbeat carries
        on from every other page — no failsafe to bring it down. It is told
        to land instead, and the controller is kept alive just long enough to
        see that through, re-sending if the command does not take.
      */
      if (fc.phase === "flying" || fc.phase === "takeoff") {
        void fc.requestLand();
        notify("warn", "Landing the aircraft", "You left Keyboard Flight with the aircraft in the air, so it has been told to land where it is.");
        const watch = setInterval(() => {
          if (fc.phase === "idle" || fc.phase === "emergency") {
            clearInterval(watch);
            fc.stop();
          }
        }, 500);
      } else {
        fc.stop();
      }
    };
  }, [pushLog]);

  // The tutorial shows every time the page opens: its state starts open.
  // Keep a ref so the global key handler can suppress flight keys while the modal is open.
  useEffect(() => { modalRef.current = showTutorial; }, [showTutorial]);

  // --- keyboard ---
  useEffect(() => {
    const setKey = (k: string, on: boolean) => {
      setActive((a) => ({ ...a, [k]: on }));
      const map = on ? MOVE : MOVE_OFF;
      if (map[k]) fcRef.current?.setKeys(map[k]);
    };
    const down = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e", "t", "l", " "].includes(k)) return;
      /*
        A browser shortcut is not a flight command. Ctrl+T opens a tab and
        Ctrl+L goes to the address bar; without this check the first also
        took off and the second also landed. Typing in a field is likewise
        typing, not flying.
      */
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      e.preventDefault();
      // Never trigger flight commands while the tutorial/controls modal is open.
      if (modalRef.current) return;
      if (e.repeat) return;
      if (k === " ") { fcRef.current?.emergencyHold(); setActive((a) => ({ ...a, space: true })); return; }
      if (k === "l") { void fcRef.current?.requestLand(); setActive((a) => ({ ...a, l: true })); return; }
      if (k === "t") {
        setActive((a) => ({ ...a, t: true }));
        const fc = fcRef.current;
        if (!fc) return;
        if (fc.phase === "idle") {
          if (readyRef.current) void fc.requestTakeoff();
          else pushLog("warn", "Complete the pre-flight checklist before taking off.");
        } else {
          fc.setKeys({ up: true });
        }
        return;
      }
      setKey(k, true);
    };
    const up = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (!["w", "a", "s", "d", "q", "e", "t", "l", " "].includes(k)) return;
      e.preventDefault();
      if (modalRef.current) return;
      if (k === " ") { setActive((a) => ({ ...a, space: false })); return; }
      if (k === "l") { setActive((a) => ({ ...a, l: false })); return; }
      if (k === "t") { setActive((a) => ({ ...a, t: false })); fcRef.current?.setKeys({ up: false }); return; }
      setKey(k, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [pushLog]);

  // --- focus-loss safety: neutralize motion if the window loses focus or is hidden ---
  useEffect(() => {
    const neutralize = () => {
      setActive({});
      if (fcRef.current && (fcRef.current.phase === "flying")) {
        fcRef.current.neutralize();
        pushLog("warn", "Window lost focus — holding position. Keep this tab focused while flying.");
      } else {
        fcRef.current?.neutralize();
      }
    };
    const onVis = () => { if (document.hidden) neutralize(); };
    window.addEventListener("blur", neutralize);
    document.addEventListener("visibilitychange", onVis);
    return () => { window.removeEventListener("blur", neutralize); document.removeEventListener("visibilitychange", onVis); };
  }, [pushLog]);

  const setFailsafe = async () => {
    setFsBusy(true);
    try {
      await commandLink.setParam("FS_GCS_ENABLE", 5); // Always Land
      setFsSet(true);
      pushLog("info", "GCS failsafe set to LAND — the drone will land itself if this app disconnects.");
    } catch {
      pushLog("error", "Could not set the GCS failsafe. Check the link and try again.");
    } finally {
      setFsBusy(false);
    }
  };

  // --- PFD inputs from live telemetry ---
  const att = tel.attitude;
  const hud = tel.hud;
  const pos = tel.position;
  const pfd = useMemo(() => ({
    roll: att ? att.value.roll * DEG : 0,
    pitch: att ? att.value.pitch * DEG : 0,
    heading: hud?.value.heading ?? pos?.value.heading ?? 0,
    speed: hud?.value.groundspeed ?? 0,
    speedUnit: "m/s",
    altitude: pos?.value.relAlt ?? hud?.value.alt ?? 0,
    altUnit: "m",
    climb: hud?.value.climb ?? 0,
    throttle: hud?.value.throttle ?? 0,
    stale: status === "stale",
    hasData: fresh(att?.at),
  }), [att, hud, pos, status]);

  if (!connected) {
    return (
      <div className="page-pad">
        <header className="page-head">
          <div>
            <h1>Keyboard Flight</h1>
            <p>Fly your drone for a test hop with no RC transmitter — arm, take off, move and land from the keyboard, all gentle and autopilot-stabilised.</p>
          </div>
        </header>
        <div className="callout warn" style={{ marginBottom: "var(--s4)" }}><TriangleAlert /><span>This commands a <strong>real drone to fly</strong>. Connect aircraft outdoors with a clear GPS view, props on, in an open area clear of people, and read the safety briefing before use.</span></div>
        <ConnectPrompt
          title="Connect an aircraft to fly it from the keyboard"
          items={[
            { icon: Keyboard, title: "Take off, move and land", detail: "T to take off, W A S D to move, Q and E to turn, L to land." },
            { icon: Gauge, title: "Gentle, capped motion", detail: "Walking pace at most, every change of speed ramped rather than sudden." },
            { icon: Hand, title: "Hold and return home", detail: "Space stops it in a hover; a lost link lands it where it is." },
          ]}
        >
          A first hop without a radio transmitter. The autopilot does the flying in its guided mode and the keys only
          ask it for a direction, so it holds position by itself the moment they are released. Rehearse in the
          simulator first.
        </ConnectPrompt>
      </div>
    );
  }

  const phaseLabel: Record<string, string> = { idle: "On ground", arming: "Arming…", takeoff: "Taking off…", flying: "In flight — you have control", landing: "Landing…", emergency: "FAILSAFE" };
  const flying = flight.phase === "flying" || flight.phase === "takeoff";

  return (
    <div className="page-pad kf-page">
      <header className="page-head">
        <div>
          <h1>Keyboard Flight</h1>
          <p>Guided test flight from the keyboard — gentle, stabilised, with automatic hold and land-on-disconnect failsafe.</p>
        </div>
        <button className="btn btn-ghost" onClick={() => setShowTutorial(true)}><Gamepad2 size={15} /> Controls</button>
      </header>

      <div className="callout danger">
        <TriangleAlert />
        <span><strong>Real flight.</strong> Props on, open area, everyone clear. Keep this browser tab focused — if it loses focus the drone holds, and if it disconnects the drone lands itself.</span>
      </div>

      <div className={`kf-grid${flying ? " flying" : ""}`}>
        <section className="panel kf-pfd-panel">
          <div className="kf-pfd-well on-navy">
            <Pfd {...pfd} />
          </div>
          <div className={`kf-phase ${flight.phase}`}>
            <span className="kf-phase-dot" />
            {phaseLabel[flight.phase] ?? flight.phase}
            {flight.relAlt != null && <span className="kf-phase-alt">{flight.relAlt.toFixed(1)} m</span>}
          </div>
        </section>

        <section className="panel kf-controls">
          <div className="panel-head"><h3>Controls</h3><span className={`kf-mode${vehicle?.armed ? " armed" : ""}`}>{vehicle?.mode ?? "—"} · {vehicle?.armed ? "ARMED" : "disarmed"}</span></div>
          <div className="panel-body">
            <div className="kf-keys">
              <div className="kf-keys-row"><KeyCap k="T" label="Take off / climb" active={!!active.t} /></div>
              <div className="kf-keys-row">
                <KeyCap k="Q" label="Yaw ←" active={!!active.q} />
                <KeyCap k="W" label="Forward" active={!!active.w} />
                <KeyCap k="E" label="Yaw →" active={!!active.e} />
              </div>
              <div className="kf-keys-row">
                <KeyCap k="A" label="Left" active={!!active.a} />
                <KeyCap k="S" label="Back" active={!!active.s} />
                <KeyCap k="D" label="Right" active={!!active.d} />
              </div>
              <div className="kf-keys-row"><KeyCap k="L" label="Land + disarm" active={!!active.l} /></div>
            </div>

            <div className="kf-vels">
              <VelBar label="Fwd" value={flight.vx} max={1.5} />
              <VelBar label="Right" value={flight.vy} max={1.5} />
              <VelBar label="Climb" value={-flight.vz} max={0.5} />
              <VelBar label="Yaw" value={flight.yawRate} max={0.35} />
            </div>
          </div>
        </section>

        <section className="panel kf-preflight">
          <div className="panel-head"><h3>Pre-flight</h3></div>
          <div className="panel-body">
            <ul className="kf-check">
              <li className={canSend ? "ok" : "bad"}><span className="kf-check-dot" /> Link connected</li>
              {notCopter && <li className="bad" title={notCopter.body}><span className="kf-check-dot" /> {notCopter.title}</li>}
              <li className={gpsOk ? "ok" : "bad"}><span className="kf-check-dot" /> GPS 3D fix {gps ? `(${gps.satellites ?? 0} sats, fix ${gps.fixType})` : ""}</li>
              <li className={disarmed ? "ok" : "bad"}><span className="kf-check-dot" /> Disarmed on the ground</li>
              <li className={fsSet ? "ok" : "bad"}>
                <span className="kf-check-dot" /> Land-on-disconnect failsafe
                {!fsSet && <button className="btn btn-ghost btn-sm" disabled={fsBusy || !canSend} onClick={() => void setFailsafe()}><ShieldCheck size={13} /> {fsBusy ? "Setting…" : "Set"}</button>}
              </li>
            </ul>
            <label className="esc-confirm">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>Props are on, the area is clear of people, and I'm ready to fly a real drone.</span>
            </label>
            <div className={`kf-ready ${ready ? "go" : "nogo"}`}>
              {ready ? <><ShieldCheck size={16} /> Ready — press <strong>T</strong> to take off</> : <><TriangleAlert size={16} /> Complete the checklist to enable takeoff</>}
            </div>
          </div>
        </section>
      </div>

      <div className="kf-emergency">
        <span className="kf-emergency-label"><TriangleAlert size={15} /> Emergency</span>
        <button className="btn kf-estop hold" onClick={() => fcRef.current?.emergencyHold()}><Hand size={16} /> Hold <kbd>Space</kbd></button>
        <button className="btn kf-estop land" onClick={() => void fcRef.current?.requestLand()}><PlaneLanding size={16} /> Land <kbd>L</kbd></button>
        <button className="btn kf-estop rtl" onClick={() => void fcRef.current?.emergencyRTL()}><RotateCcw size={16} /> Return home</button>
        <button className="btn kf-estop disarm" onClick={() => void fcRef.current?.disarmNow()}><OctagonX size={16} /> Disarm</button>
      </div>

      <section className="panel kf-log">
        <div className="panel-head"><h3>Flight log</h3></div>
        <div className="kf-log-body">
          {logs.length === 0 ? <p className="muted">Events will appear here as you fly.</p> : logs.slice().reverse().map((l) => (
            <div key={l.id} className={`kf-log-line ${l.level}`}><span className="kf-log-t">{new Date(l.at).toLocaleTimeString()}</span>{l.text}</div>
          ))}
        </div>
      </section>

      {showTutorial && (
        <div className="kf-modal-scrim" onClick={() => setShowTutorial(false)}>
          <div className="kf-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Keyboard flight controls">
            <button className="kf-modal-x" onClick={() => setShowTutorial(false)} aria-label="Close"><X size={18} /></button>
            <div className="kf-modal-head"><Gamepad2 size={22} /><h2>How to fly</h2></div>
            <p className="kf-modal-sub">Everything is slow, gradual and autopilot-stabilised. Release a key and the drone smoothly holds. This flies a <strong>real aircraft</strong> — fly in an open area, props on, people clear.</p>
            <div className="kf-modal-keys">
              <div className="kf-mk"><kbd>T</kbd><div><strong>Take off & climb</strong><span>Press once on the ground to arm and lift off gently. Hold in the air to climb. Release to hold altitude.</span></div></div>
              <div className="kf-mk"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><div><strong>Move</strong><span>Forward, left, back, right — gentle and capped. Release to glide to a stop and hold. It stays within {DEFAULT_CONFIG.maxRange} m of where it took off and {DEFAULT_CONFIG.maxAlt} m up.</span></div></div>
              <div className="kf-mk"><kbd>Q</kbd><kbd>E</kbd><div><strong>Yaw</strong><span>Rotate left / right slowly and smoothly.</span></div></div>
              <div className="kf-mk"><kbd>L</kbd><div><strong>Land</strong><span>Descends gently at the current spot and disarms automatically on the ground.</span></div></div>
              <div className="kf-mk emergency"><kbd>Space</kbd><div><strong>Hold</strong><span>Instantly brake to a stable hover at any time.</span></div></div>
            </div>
            <div className="kf-modal-note"><TriangleAlert size={15} /><span>If this tab loses focus the drone holds; if the app closes or disconnects, the drone lands itself where it is. Complete the pre-flight checklist before takeoff.</span></div>
            <button className="btn btn-primary kf-modal-go" onClick={() => setShowTutorial(false)}>Got it — let's fly</button>
          </div>
        </div>
      )}
    </div>
  );
}
