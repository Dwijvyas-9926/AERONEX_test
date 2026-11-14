import { Cable, Gamepad2, ShieldCheck } from "lucide-react";
import { Link } from "react-router-dom";
import { ROUTES, STAGES, type BuildStatus } from "../../app/routes";
import { BrandMark } from "../../components/shell/BrandMark";
import { useUi } from "../../state/uiStore";

/*
  The About page says what AERONEX is today. The progress list is read from
  the same route table as the sidebar, so it cannot drift from the app.
*/

function statusOf(s: BuildStatus): { label: string; tone: string; detail?: string } {
  if (s.kind === "ready") return { label: "Complete", tone: "ok" };
  if (s.kind === "partial") return { label: "Working", tone: "accent", detail: s.note };
  return { label: "Planned", tone: "idle" };
}

/* How the app keeps a real aircraft safe. Each line is something the code enforces. */
const SAFEGUARDS: { title: string; body: string }[] = [
  {
    title: "Commands for ArduCopter only",
    body: "Arming, modes, take-off, missions and calibration are sent only to a multicopter running ArduCopter. Any other autopilot is shown and read, never commanded.",
  },
  {
    title: "Every command confirmed",
    body: "Each command waits for the aircraft's acknowledgement and is retried in the MAVLink way. A refusal is reported in plain words, never assumed to have worked.",
  },
  {
    title: "No settings changed in flight",
    body: "Parameters are not written to an armed aircraft unless you confirm it, and nothing is written until you press Upload.",
  },
  {
    title: "The aircraft's own pre-arm checks",
    body: "Preflight Check follows ArduCopter's pre-arm result and its reasons, then adds battery, GPS and link checks on top. It never overrides the autopilot.",
  },
  {
    title: "Gentle keyboard flight",
    body: "Walking pace, 10 m ceiling and a 20 m fence around the take-off point. If the tab loses focus the aircraft holds; if the link drops it lands.",
  },
  {
    title: "Missions checked twice",
    body: "A route is checked against the measured ground and the battery as you draw it. Sending asks first, is refused if the aircraft is not at the route's home, and is read back afterwards.",
  },
];

export function AboutPage() {
  const openGuide = useUi((s) => s.toggle);
  return (
    <div className="page-pad about">
      <section className="about-hero">
        <BrandMark className="about-mark" />
        <h1 className="about-wordmark">AERONEX</h1>
        <p className="about-tagline">A ground station for ArduCopter drones that runs in your browser.</p>
        <p className="about-meta">
          <span className="pill accent plain">Development preview</span>
          <span className="pill plain">ArduCopter 4.6 and 4.7</span>
          <span className="pill plain">Pixhawk 2.4.8 and 6C Mini</span>
        </p>
      </section>

      <p className="about-lede">
        AERONEX takes a multicopter from a drawing to a calibrated, checked aircraft, then flies it and tells you what went wrong. It connects to the
        flight controller over a USB cable or a telemetry radio, needs nothing installed, and comes with a virtual aircraft so every page can be learned
        before any hardware is plugged in.
      </p>

      <section className="about-section">
        <h2>Where it stands</h2>
        <p className="about-prose about-prose-gap">
          Complete pages work end to end. Working pages run on real hardware with the limits noted. Planned pages explain what is coming and do nothing
          yet.
        </p>
        <div className="about-progress">
          {STAGES.map((stage) => (
            <section key={stage.group} className="about-stage">
              <header>
                <h3>{stage.group}</h3>
                <p>{stage.summary}</p>
              </header>
              <ul>
                {ROUTES.filter((r) => r.group === stage.group).map((r) => {
                  const st = statusOf(r.status);
                  const Icon = r.icon;
                  return (
                    <li key={r.path}>
                      <Icon aria-hidden className="about-row-icon" />
                      <Link to={r.path} className="about-row-name">
                        {r.label}
                      </Link>
                      <span className="about-row-detail">{st.detail ?? ""}</span>
                      <span className={`pill ${st.tone} plain`}>{st.label}</span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <section className="about-section">
        <h2>Built to be safe on a real aircraft</h2>
        <div className="about-safeguards">
          {SAFEGUARDS.map((s) => (
            <div key={s.title} className="about-safeguard">
              <ShieldCheck aria-hidden className="about-icon" />
              <div>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="about-grid">
        <section className="about-card">
          <h3>Tested against the real firmware</h3>
          <p>
            Beside its unit tests, AERONEX is run against ArduPilot's own simulator build of ArduCopter 4.6 and 4.7, the same flight code as a Pixhawk. The
            tests link, read every setting the app uses by name, send and read back missions, fly them, and check that the planner's flight-time
            prediction lands within 15% of the flight.
          </p>
        </section>
        <section className="about-card">
          <h3>Simulated data is always labelled</h3>
          <p>
            The virtual aircraft speaks MAVLink exactly as a flight controller does, so every page works on it. While it is linked, every page says the
            data is simulated, exports are marked, and the status bar reads Virtual aircraft. The 3D previews on the Overview and in Digital Twin are
            labelled as previews.
          </p>
        </section>
      </div>

      <section className="about-section">
        <h2>Under the hood</h2>
        <p className="about-prose">
          AERONEX talks to the flight controller through the browser's Web Serial API, using its own MAVLink 1 and 2 implementation that checks every
          frame against its checksum. The app is built with React, TypeScript, Three.js and MapLibre and runs entirely on your computer: aircraft data
          never leaves it. Map pictures and ground heights come from the providers credited on the map; provider keys are kept for the session only unless
          you choose otherwise in Settings.
        </p>
      </section>

      <section className="about-section">
        <h2>Coming next</h2>
        <p className="about-prose">
          Flight Logs, to open a log after landing and see what the aircraft went through. After that, deeper support for the hardware in the field, then
          other vehicle types. Until then, ArduCopter is the only firmware AERONEX commands.
        </p>
      </section>

      <section className="about-creator">
        <span className="about-creator-label">Creator</span>
        <h2>Dwij Vyas</h2>
        <p>
          AERONEX is conceived, designed and engineered by Dwij Vyas. It grew out of a disaster-relief drone programme, where an aircraft has to be ready
          on the first attempt and the ground station must never get in the way. The aim is a ground station that is as dependable as professional
          tools and as easy to pick up as a web page.
        </p>
      </section>

      <div className="about-foot">
        <ShieldCheck className="about-icon" />
        <p>
          AERONEX helps you prepare, configure, fly and review an aircraft. It is not flight-certified and does not replace the manufacturer's
          documentation, the autopilot's own safety checks or your local aviation rules. Fly within the law, and test on your own hardware before you
          rely on it.
        </p>
      </div>

      <div className="about-cta">
        <Link className="btn btn-primary" to="/simulator">
          <Gamepad2 /> Try the virtual aircraft
        </Link>
        <Link className="btn" to="/connection">
          <Cable /> Connect an aircraft
        </Link>
        <button className="btn" onClick={() => openGuide("help")}>
          Open the guide <kbd>?</kbd>
        </button>
      </div>
    </div>
  );
}
