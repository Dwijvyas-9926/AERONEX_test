import { Box, Cable, Check, CircleDashed, Crosshair, Drone, Gamepad2, Hand, MonitorCheck, Rotate3d } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LINK_STATUS } from "../connection/linkStatus";
import { browserName, hasGamepadApi, hasWebGL2, hasWebSerial, isSecureContextOk } from "../../services/capabilities";
import { isPortOpen, useLink } from "../../state/linkStore";
import { useActiveProfile } from "../../state/profileStore";
import { prefersReducedMotion, useSettings } from "../../state/settingsStore";
import { BOARD_LABELS, FIRMWARE_LABELS, FRAME_LABELS } from "../../vehicle/types";
import { HeroInstruments } from "./HeroInstruments";

const HeroScene = lazy(() => import("./HeroScene"));

/** Pause the 3D loop when the hero scrolls out of view or the tab is hidden. */
function useInView<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [inView, setInView] = useState(true);
  const [tabVisible, setTabVisible] = useState(() => !document.hidden);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.05 });
    io.observe(el);
    const vis = () => setTabVisible(!document.hidden);
    document.addEventListener("visibilitychange", vis);
    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", vis);
    };
  }, []);
  return [ref, inView && tabVisible] as const;
}

function Hero() {
  const motionPref = useSettings((s) => s.motion);
  const graphics = useSettings((s) => s.graphics);
  const reduced = prefersReducedMotion(motionPref);
  const [ref, visible] = useInView<HTMLElement>();
  const [ready, setReady] = useState(false);
  const webgl = useMemo(() => hasWebGL2(), []);
  const nav = useNavigate();
  const animate = !reduced && visible;

  return (
    <section className="hero" ref={ref} aria-labelledby="hero-title">
      <div className={`hero-canvas${ready ? " ready" : ""}`} aria-hidden>
        {webgl ? (
          <Suspense fallback={null}>
            <HeroScene animate={animate} graphics={graphics} onReady={() => setReady(true)} />
          </Suspense>
        ) : null}
      </div>
      <div className="hero-shade" aria-hidden />

      <div className="hero-copy">
        <h1 id="hero-title">
          Every flight
          <br />
          starts on the ground.
        </h1>
        <p>
          Connect your Pixhawk, prepare the aircraft&rsquo;s digital twin, calibrate it, and rehearse in a virtual valley before it ever
          leaves the bench.
        </p>
        <div className="hero-actions">
          <button className="btn btn-primary btn-lg" onClick={() => nav("/connection")}>
            <Cable /> Connect aircraft
          </button>
          <button className="btn btn-lg hero-ghost" onClick={() => nav("/vehicle")}>
            <Drone /> Vehicle profiles
          </button>
        </div>
      </div>

      {webgl ? (
        <HeroInstruments animate={animate} />
      ) : (
        <div className="hero-instruments">
          <p className="hero-disclaimer">WebGL 2 isn&rsquo;t available in this browser, so the 3D preview is off. Everything else works.</p>
        </div>
      )}

      {webgl && (
        <p className="hero-hint">
          <Hand size={14} /> Drag to orbit the aircraft
        </p>
      )}
    </section>
  );
}

type StepState = "done" | "now" | "blocked" | "later";

function Checklist() {
  const profile = useActiveProfile();
  const status = useLink((s) => s.status);
  const vehicle = useLink((s) => s.vehicle);
  const steps: { title: string; detail: string; state: StepState; to: string; icon: typeof Box }[] = [
    {
      title: "Describe your aircraft",
      detail: profile ? `${profile.name}: ${FRAME_LABELS[profile.frame]}, ${BOARD_LABELS[profile.board]}.` : "Create a vehicle profile.",
      state: profile ? "done" : "now",
      to: "/vehicle",
      icon: Drone,
    },
    {
      title: "Connect the flight controller",
      detail: vehicle
        ? `${vehicle.typeLabel} on ${vehicle.firmwareLabel}, system ${vehicle.sysid}. ${LINK_STATUS[status].label}.`
        : "USB or telemetry radio, from a Chromium-based browser.",
      state: vehicle && status === "connected" ? "done" : "now",
      to: "/connection",
      icon: Cable,
    },
    { title: "Prepare the digital twin", detail: "Import your assembly, set its nose and top, and test-fly it.", state: "now", to: "/digital-twin", icon: Box },
    { title: "Calibrate sensors and radio", detail: "Accel, compass, radio, flight modes and ESC — guided, firmware-aware workflows.", state: "now", to: "/calibration", icon: Crosshair },
    { title: "Rehearse in the simulator", detail: "Fly the valley with the keyboard or auto-patrol, with five cameras and a HUD.", state: "now", to: "/simulator", icon: Gamepad2 },
  ];
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>First flight checklist</h3>
        <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
          {steps.filter((s) => s.state === "done").length} of {steps.length} done
        </span>
      </div>
      <ol className="checklist">
        {steps.map((s, i) => (
          <li key={s.title} className={`step ${s.state}`}>
            <span className="step-mark" aria-hidden>
              {s.state === "done" ? <Check size={14} /> : i + 1}
            </span>
            <div className="step-body">
              <Link to={s.to} className="step-title">
                {s.title}
              </Link>
              <p>{s.detail}</p>
            </div>
            <span className={`pill ${s.state === "done" ? "ok" : s.state === "now" ? "accent" : "idle"} plain`}>
              {s.state === "done" ? "Done" : s.state === "now" ? "Next" : "Planned"}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ModePanels() {
  const status = useLink((s) => s.status);
  const portLabel = useLink((s) => s.portLabel);
  const profile = useActiveProfile();
  const serial = hasWebSerial();
  const view = LINK_STATUS[status];
  return (
    <div className="mode-grid">
      <section className="panel mode-card">
        <div className="mode-top">
          <span className="mode-icon physical">
            <Cable />
          </span>
          <span className={`pill ${view.tone}${view.live ? " live" : ""}`}>{view.label}</span>
        </div>
        <h3>Physical aircraft</h3>
        <p className="muted">
          {isPortOpen(status) && portLabel
            ? `Open on ${portLabel}.`
            : serial
              ? "Pixhawk 2.4.8, Pixhawk 6C Mini or any MAVLink controller over USB or a SiK-style telemetry radio."
              : `${browserName()} can't open serial ports. Use Chrome or Edge on desktop to connect hardware.`}
        </p>
        <Link className="btn" to="/connection">
          Open Vehicle Connection
        </Link>
      </section>
      <section className="panel mode-card">
        <div className="mode-top">
          <span className="mode-icon virtual">
            <Rotate3d />
          </span>
          <span className="pill virtual plain">Ready</span>
        </div>
        <h3>Virtual aircraft</h3>
        <p className="muted">
          Fly {profile ? profile.name : "your aircraft"} over a 3D valley with a river, forest and bridge — its own flight model, five cameras and a
          HUD. Never linked to real hardware.
        </p>
        <Link className="btn" to="/simulator">
          Launch simulator
        </Link>
      </section>
    </div>
  );
}

function Capabilities() {
  const items = useMemo(
    () => [
      { label: "Web Serial", ok: hasWebSerial(), why: "Needed to connect a flight controller from the browser." },
      { label: "Secure context", ok: isSecureContextOk(), why: "Web Serial only works on https:// or localhost." },
      { label: "WebGL 2", ok: hasWebGL2(), why: "Needed for 3D views and the simulator." },
      { label: "Gamepad API", ok: hasGamepadApi(), why: "Optional. Lets the simulator use a gamepad or USB joystick." },
    ],
    [],
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>This browser</h3>
        <MonitorCheck size={18} color="var(--muted)" />
      </div>
      <ul className="caps">
        {items.map((c) => (
          <li key={c.label}>
            {c.ok ? <Check size={16} color="var(--ok)" /> : <CircleDashed size={16} color="var(--warn)" />}
            <div>
              <strong>{c.label}</strong>
              <p>{c.ok ? "Available." : c.why}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ProfileSummary() {
  const p = useActiveProfile();
  if (!p) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{p.name}</h3>
        <Link to="/vehicle" style={{ fontSize: "var(--t-sm)" }}>
          Edit profile
        </Link>
      </div>
      <dl className="readouts" style={{ margin: 0, borderRadius: 0 }}>
        <div className="readout">
          <dt>Frame</dt>
          <dd style={{ fontSize: "var(--t-md)" }}>{FRAME_LABELS[p.frame]}</dd>
        </div>
        <div className="readout">
          <dt>Flight controller</dt>
          <dd style={{ fontSize: "var(--t-md)" }}>{BOARD_LABELS[p.board]}</dd>
        </div>
        <div className="readout">
          <dt>Firmware (declared)</dt>
          <dd style={{ fontSize: "var(--t-md)" }}>{FIRMWARE_LABELS[p.firmware]}</dd>
        </div>
        <div className="readout">
          <dt>All-up mass</dt>
          {p.massGrams ? (
            <dd>
              {p.massGrams.toLocaleString()}
              <small>g</small>
            </dd>
          ) : (
            <dd className="na">Not set</dd>
          )}
        </div>
      </dl>
    </section>
  );
}

export function OverviewPage() {
  return (
    <>
      <Hero />
      <div className="page-pad overview-body">
        <div className="split">
          <div className="stack">
            <ModePanels />
            <Checklist />
          </div>
          <div className="stack">
            <ProfileSummary />
            <Capabilities />
          </div>
        </div>
      </div>
    </>
  );
}
