import { ArrowRight, Box, Cable, Check, ChevronDown, CircleDashed, Crosshair, Drone, Gamepad2, Hand, MonitorCheck, Rotate3d } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { Link, useNavigate } from "react-router-dom";
import { AttitudeIndicator } from "../../components/ui/AttitudeIndicator";
import { HeroHud } from "./HeroHud";
import { LINK_STATUS } from "../connection/linkStatus";
import { browserName, hasGamepadApi, hasWebGL2, hasWebSerial, isSecureContextOk } from "../../services/capabilities";
import { isPortOpen, useLink } from "../../state/linkStore";
import { useActiveProfile } from "../../state/profileStore";
import { prefersReducedMotion, useSettings } from "../../state/settingsStore";
import { BOARD_LABELS, FIRMWARE_LABELS, FRAME_LABELS } from "../../vehicle/types";
import { HeroInstruments } from "./HeroInstruments";
import { ROUTES, STAGES } from "../../app/routes";
import { useUi } from "../../state/uiStore";

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
      {webgl && <HeroHud animate={animate} />}

      <motion.div
        className="hero-copy"
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.12, delayChildren: 0.12 } } }}
      >
        <motion.h1 id="hero-title" variants={FADE_UP}>
          Every flight
          <br />
          starts on the ground.
        </motion.h1>
        <motion.p variants={FADE_UP}>
          Connect your Pixhawk, prepare the aircraft&rsquo;s digital twin, calibrate it, and rehearse in a virtual valley before it ever
          leaves the bench.
        </motion.p>
        <motion.div className="hero-actions" variants={FADE_UP}>
          <button className="btn btn-primary btn-lg" onClick={() => nav("/connection")}>
            <Cable /> Connect aircraft
          </button>
          <button className="btn btn-lg hero-ghost" onClick={() => nav("/vehicle")}>
            <Drone /> Aircraft profile
          </button>
        </motion.div>
      </motion.div>

      {webgl ? (
        <HeroInstruments animate={animate} />
      ) : (
        <div className="hero-instruments">
          <AttitudeIndicator roll={-6} pitch={4} size={116} />
          <p className="hero-disclaimer">WebGL 2 isn&rsquo;t available in this browser, so the live 3D preview is off. Everything else works.</p>
        </div>
      )}

      {webgl && (
        <p className="hero-hint">
          <Hand size={14} /> Drag to orbit the aircraft
        </p>
      )}

      <a className="hero-scroll" href="#main-start" aria-label="Scroll to how AERONEX works">
        <span>See how it works</span>
        <ChevronDown size={18} />
      </a>
    </section>
  );
}

const FADE_UP = {
  hidden: { opacity: 0, y: 18 },
  show: { opacity: 1, y: 0, transition: { duration: 0.55, ease: [0.22, 1, 0.36, 1] as const } },
};

type StepState = "done" | "now" | "blocked" | "later";

function Checklist() {
  const profile = useActiveProfile();
  const status = useLink((s) => s.status);
  const vehicle = useLink((s) => s.vehicle);
  const steps: { title: string; detail: string; state: StepState; to: string; icon: typeof Box }[] = [
    {
      title: "Describe your aircraft",
      detail: profile ? `${profile.name}: ${FRAME_LABELS[profile.frame]}, ${BOARD_LABELS[profile.board]}.` : "Create an aircraft profile.",
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
    { title: "Rehearse in the simulator", detail: "Fly a virtual aircraft with real physics, and predict a mission before you fly it.", state: "now", to: "/simulator", icon: Gamepad2 },
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
          Open Connection
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
          A simulated {profile ? profile.name : "aircraft"} with real flight physics and a flight controller that speaks MAVLink. Every page works
          against it, and you can fail a motor or lose GPS to see what your settings do.
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

/**
 * The whole app on one strip: four stages, in the order the work happens,
 * each with the pages that belong to it.
 *
 * This is the answer to "what is all this, and where do I start?" — the same
 * four stages the sidebar is grouped by, with a line on what each page does.
 */
function StageMap() {
  const status = useLink((s) => s.status);
  const linked = status === "connected" || status === "stale";
  const openHelp = useUi((s) => s.open);
  return (
    <section className="stage-map" aria-labelledby="stage-map-title">
      <header className="stage-map-head">
        <div>
          <h2 id="stage-map-title">How AERONEX works</h2>
          <p>
            Four stages, in the order you would do them. Start anywhere: every page works without the ones before it, and only the pages marked{" "}
            <span className="needs-link">needs a link</span> wait for a flight controller, real or the simulator&rsquo;s virtual one.
          </p>
        </div>
        <button className="btn" onClick={() => openHelp("help")}>
          Open the guide <kbd>?</kbd>
        </button>
      </header>
      <ol className="stages">
        {STAGES.map((stage, i) => (
          <li className="stage" key={stage.group}>
            <div className="stage-head">
              <span className="stage-n" aria-hidden>
                {i + 1}
              </span>
              <div>
                <h3>{stage.group}</h3>
                <p>{stage.summary}</p>
              </div>
            </div>
            <ul>
              {ROUTES.filter((r) => r.group === stage.group).map((r) => {
                const Icon = r.icon;
                const planned = r.status.kind === "planned";
                const live = !planned && NEEDS_LINK.has(r.path);
                return (
                  <li key={r.path}>
                    <Link to={r.path} className={`stage-link${planned ? " planned" : ""}`}>
                      <Icon aria-hidden />
                      <span>
                        <strong>
                          {r.label}
                          {planned && <em>Soon</em>}
                          {live && !linked && <em className="needs-link">Needs a link</em>}
                        </strong>
                        <small>{r.blurb}</small>
                      </span>
                      <ArrowRight className="stage-go" aria-hidden />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** Pages that have nothing to show until a flight controller is linked. */
const NEEDS_LINK = new Set(["/calibration", "/pid", "/params", "/preflight", "/flight-data", "/keyboard-flight", "/doctor", "/telemetry"]);
// "A link" is a real flight controller or the simulator's virtual aircraft.

export function OverviewPage() {
  return (
    <>
      <Hero />
      <div className="page-pad overview-body" id="main-start">
        <StageMap />
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
