import { Cable, Compass, Gauge, Plane, ShieldCheck, SlidersVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../components/shell/BrandMark";

/* The same four stages as the sidebar and the Overview, in the same words. */
const STEPS: { n: number; title: string; body: string }[] = [
  { n: 1, title: "Design", body: "Frame Studio draws a frame around the motors, electronics and battery you own, checks it is strong enough, and gives you files to cut or print. Digital Twin shows your own 3D model and confirms the app agrees which way is forward." },
  { n: 2, title: "Set up", body: "Describe the aircraft in Aircraft Profile and link it in Connection. Work through Calibration once, use PID Tuning if it wobbles, and Parameters for any other setting. Nothing is written to the aircraft until you press Upload." },
  { n: 3, title: "Fly", body: "Rehearse in the Flight Simulator with nothing plugged in. Before a real flight, Preflight Check gives one go or no-go verdict. Flight Data shows the live instruments, and Keyboard Flight flies a short test hop without a radio transmitter." },
  { n: 4, title: "Review", body: "Drone Doctor scans the aircraft's health and says, in plain words, what to fix. Telemetry shows the raw data arriving over the link when something will not connect." },
];

export function AboutPage() {
  return (
    <div className="page-pad about">
      <section className="about-hero">
        <BrandMark className="about-mark" />
        <h1 className="about-wordmark">AERONEX</h1>
        <p className="about-tagline">Design, set up, fly and review a Pixhawk drone from the browser.</p>
      </section>

      <p className="about-lede">
        AERONEX is a ground station that runs in a web browser. It takes a Pixhawk drone from a drawing to a calibrated, checked aircraft ready to
        fly, and there is nothing to install. Every page has a guide: press <kbd>?</kbd> on any of them.
      </p>

      <div className="about-grid">
        <section className="about-card">
          <Gauge className="about-icon" />
          <h3>What it does</h3>
          <p>
            Connection and live telemetry, pre-flight health checks, full sensor and radio calibration, motor tests, guided PID tuning and complete
            parameter access — alongside a live flight display, a digital twin of your aircraft and a 3D flight simulator. It speaks MAVLink natively and
            needs no installation.
          </p>
        </section>
        <section className="about-card">
          <Compass className="about-icon" />
          <h3>Who it's for</h3>
          <p>
            Builders and pilots setting up ArduPilot or PX4 multicopters; field teams who need a fast, dependable pre-flight check; and students and
            engineers learning how flight controllers really work. AERONEX grew out of a disaster-relief drone programme, where reliability on the ground
            is everything.
          </p>
        </section>
      </div>

      <section className="about-section">
        <h2>How it works</h2>
        <ol className="about-steps">
          {STEPS.map((s) => (
            <li key={s.n} className="about-step">
              <span className="about-step-n">{s.n}</span>
              <div>
                <strong>{s.title}</strong>
                <p>{s.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="about-section">
        <h2>Under the hood</h2>
        <p className="about-prose">
          AERONEX implements the MAVLink 1 / 2 protocol from scratch, validating every frame against its checksum, and reaches hardware directly through the
          browser's Web Serial API. It is built with React, TypeScript and Three.js, and runs entirely on your machine — your vehicle's data never leaves it.
          Every value on screen comes from the aircraft itself; nothing is simulated unless it is clearly labelled as such.
        </p>
      </section>

      <section className="about-creator">
        <div>
          <span className="about-creator-label">Creator</span>
          <h2>Dwij Vyas</h2>
          <p>
            AERONEX is conceived, designed and engineered by Dwij Vyas — built to raise the standard of what an open, accessible ground station can be:
            professional-grade capability, without the complexity.
          </p>
        </div>
      </section>

      <div className="about-foot">
        <ShieldCheck className="about-icon" />
        <p>
          AERONEX supports preparation, configuration and analysis. It is not a substitute for manufacturer documentation, local aviation regulations, or the
          vehicle's own pre-arm safety checks. Always fly responsibly and within the law.
        </p>
      </div>

      <div className="about-cta">
        <Link className="btn btn-primary" to="/connection"><Cable /> Connect aircraft</Link>
        <Link className="btn" to="/flight-data"><Plane /> Open the flight display</Link>
        <Link className="btn" to="/pid"><SlidersVertical /> Tune it</Link>
      </div>
    </div>
  );
}
