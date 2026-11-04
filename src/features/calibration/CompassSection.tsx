import { Check, Compass, Loader2, RotateCw, Save, TriangleAlert, X } from "lucide-react";
import { commandLink } from "../../services/link/commandLink";
import { useNow } from "../../hooks/useNow";
import { MAG_CAL_STATUS, magCalOk, useCalibration } from "../../state/calibrationStore";
import { useLink } from "../../state/linkStore";
import { ProgressBar } from "./common";

const ORIENTATIONS = ["Nose down", "Nose up", "Left side down", "Right side down", "Top down (upside-down)", "Level, then spin"];

export function CompassSection({ canSend }: { canSend: boolean }) {
  const mag = useCalibration((s) => s.mag);
  const armed = useLink((s) => s.vehicle?.armed) ?? false;
  const now = useNow(500);
  const running = mag.phase === "running";
  const compasses = Object.values(mag.compasses).sort((a, b) => a.id - b.id);
  const anyUnsaved = mag.phase === "success" && compasses.some((c) => magCalOk(c.status) && !c.autosaved);
  // Progress hasn't advanced for a while → almost always too little rotation or magnetic interference.
  const stalled = running && mag.maxPct > 0 && mag.maxPct < 100 && now - mag.lastAdvanceAt > 12000;

  return (
    <div className="cal-section">
      <div className="cal-sec-head">
        <div>
          <h2>Compass</h2>
          <p>Onboard magnetometer calibration. The bars fill only as the autopilot sees each part of the sphere, so the vehicle has to be turned through <em>every</em> orientation — not just spun flat.</p>
        </div>
        <Compass className="cal-sec-icon" />
      </div>

      {armed && <div className="callout warn"><X /><span>Disarm to start compass calibration.</span></div>}

      {running ? (
        <div className="callout accent">
          <RotateCw />
          <div>
            <strong>Keep turning the vehicle through all six orientations.</strong> Point each side straight down in turn and rotate a full circle at each, then do it nose-up and upside-down. The bar climbs only when a new part of the sphere is sampled.
            <div className="mag-orient">
              {ORIENTATIONS.map((o) => <span key={o}>{o}</span>)}
            </div>
          </div>
        </div>
      ) : (
        <div className="callout">
          <span>Do this <strong>away from the laptop, USB cable, phones, steel and magnets</strong> — those are the usual reason a calibration sticks. Hold the vehicle in the air and be ready to rotate it through every orientation.</span>
        </div>
      )}

      {stalled && (
        <div className="callout warn">
          <TriangleAlert />
          <span>
            Progress has stalled at {Math.round(mag.maxPct)}%. This almost always means either the vehicle isn't being turned enough or there's magnetic interference nearby. Move well away from metal, your laptop and the USB cable, and rotate through the orientations above — especially nose-up and upside-down. If it won't pass, cancel and try outdoors.
          </span>
        </div>
      )}

      <section className="panel">
        <div className="panel-head">
          <h3>Onboard calibration</h3>
          {mag.phase === "success" && <span className="pill ok plain"><Check size={13} /> Complete</span>}
          {mag.phase === "failed" && <span className="pill danger plain">Failed</span>}
          {mag.phase === "cancelled" && <span className="pill warn plain">Cancelled</span>}
          {running && <span className="pill accent plain">{Math.round(mag.maxPct)}%</span>}
        </div>
        <div className="panel-body cal-body">
          {compasses.length === 0 && <p className="muted">{running ? "Waiting for the first progress report…" : "Start calibration to see each compass the autopilot reports."}</p>}

          {compasses.map((c, i) => (
            <div key={c.id} className="mag-compass">
              <div className="mag-row">
                <strong>Compass {c.id + 1}{i === 0 ? " (primary)" : ""}</strong>
                <span className={`mag-status ${magCalOk(c.status) ? "ok" : c.status >= 5 ? "bad" : ""}`}>{MAG_CAL_STATUS[c.status] ?? `Status ${c.status}`}</span>
              </div>
              <ProgressBar pct={c.pct} tone={c.status >= 5 ? "danger" : magCalOk(c.status) ? "ok" : "accent"} />
              <div className="mag-meta">
                <span>{Math.round(c.pct)}%</span>
                {running && c.coverage > 0 && <span>{c.coverage}/80 sections sampled</span>}
                {c.fitness != null && <span>fitness {c.fitness.toFixed(1)} mGauss</span>}
                {c.offsets && <span>offsets {c.offsets.map((o) => Math.round(o)).join(", ")}</span>}
                {c.autosaved && <span className="ok">saved</span>}
              </div>
            </div>
          ))}

          {mag.message && <p className={`cal-msg ${mag.phase}`}>{mag.message}</p>}

          <div className="cal-actions">
            {!running ? (
              <button className="btn btn-primary" disabled={armed || !canSend} onClick={() => void commandLink.startMagCal()}>
                <RotateCw /> {mag.phase === "idle" ? "Start compass calibration" : "Restart"}
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => void commandLink.cancelMagCal()}>
                <X /> Cancel
              </button>
            )}
            {anyUnsaved && (
              <button className="btn" onClick={() => void commandLink.acceptMagCal()}>
                <Save /> Accept &amp; save
              </button>
            )}
            {mag.phase === "success" && (
              <button className="btn btn-ghost" onClick={() => void commandLink.reboot()}>
                <Loader2 size={15} /> Reboot to apply
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
