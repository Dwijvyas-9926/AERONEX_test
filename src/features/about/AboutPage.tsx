import { Cable, Compass, Gauge, Plane, ShieldCheck, SlidersVertical } from "lucide-react";
import { Link } from "react-router-dom";
import { BrandMark } from "../../components/shell/BrandMark";

const STEPS: { n: number; title: string; body: string }[] = [
  { n: 1, title: "Connect", body: "Open Vehicle Connection and link your Pixhawk over USB or a telemetry radio. AERONEX discovers the aircraft and begins streaming live telemetry automatically." },
  { n: 2, title: "Check readiness", body: "Preflight turns the vehicle's own sensors, state estimate, GPS, vibration and battery into a single go / no-go verdict before you arm." },
  { n: 3, title: "Calibrate", body: "Work through accelerometer and level, compass, radio, flight modes, ESC and motor tests in the Calibration Center — the sequence a professional setup follows." },
  { n: 4, title: "Tune & configure", body: "Stage PID changes with the built-in advisor, or edit any setting in Full Parameters, and upload when you're ready. Nothing is written to the aircraft until you choose to." },
  { n: 5, title: "Fly & observe", body: "Watch a full primary flight display update live, and see the aircraft's real movement mirrored in the Digital Twin." },
  { n: 6, title: "Model & rehearse", body: "Import your own CAD assembly into the Digital Twin and rehearse missions in the 3D flight simulator." },
];

export function AboutPage() {
  return (
    <div className="page-pad about">
      <section className="about-hero">
        <BrandMark className="about-mark" />
        <h1 className="about-wordmark">AERONEX</h1>
        <p className="about-tagline">Ground control for Pixhawk-class drones, reimagined for the browser.</p>
      </section>

      <p className="about-lede">
        AERONEX is a modern, web-based ground control station for drones built on the Pixhawk flight-controller family. It connects to a real flight
        controller over USB or a telemetry radio and brings the entire ground workflow — from first connection to flight-ready — into one clean, fast,
        professional interface.
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
        <h2>How to use it</h2>
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
        <Link className="btn btn-primary" to="/connection"><Cable /> Connect a vehicle</Link>
        <Link className="btn" to="/flight-data"><Plane /> Open the flight display</Link>
        <Link className="btn" to="/pid"><SlidersVertical /> Tune it</Link>
      </div>
    </div>
  );
}
