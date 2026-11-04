import { Check, CircleCheck, CircleX, Gauge, Loader2, RotateCcw } from "lucide-react";
import { commandLink } from "../../services/link/commandLink";
import { ACCEL_POSITIONS, useCalibration } from "../../state/calibrationStore";
import { useLink } from "../../state/linkStore";

const POS_LABELS = ["Level", "Left side", "Right side", "Nose down", "Nose up", "On its back"];

export function AccelSection({ canSend }: { canSend: boolean }) {
  const accel = useCalibration((s) => s.accel);
  const level = useCalibration((s) => s.level);
  const gyro = useCalibration((s) => s.gyro);
  const armed = useLink((s) => s.vehicle?.armed) ?? false;
  const running = accel.phase === "running";
  const block = armed || !canSend;

  return (
    <div className="cal-section">
      <div className="cal-sec-head">
        <div>
          <h2>Accelerometer &amp; level</h2>
          <p>The full six-position calibration, driven by the autopilot's own prompts — exactly the sequence Mission Planner uses.</p>
        </div>
        <Gauge className="cal-sec-icon" />
      </div>

      {armed && <div className="callout warn"><CircleX /><span>Disarm the vehicle to calibrate. The autopilot refuses calibration while armed.</span></div>}

      <section className="panel">
        <div className="panel-head">
          <h3>Full accelerometer calibration</h3>
          {accel.phase === "success" && <span className="pill ok plain"><Check size={13} /> Calibrated</span>}
          {accel.phase === "failed" && <span className="pill danger plain">Failed</span>}
        </div>
        <div className="panel-body cal-body">
          <p className="muted">
            Place the vehicle in each position as prompted and hold it still, then confirm. You'll do all six: level, each side, nose down, nose up, and on its back.
          </p>
          <ol className="accel-steps">
            {POS_LABELS.map((lbl, i) => {
              const done = running ? i < accel.step : accel.phase === "success";
              const current = running && accel.awaitingConfirm && i === accel.step;
              return (
                <li key={lbl} className={`accel-step${done ? " done" : ""}${current ? " current" : ""}`}>
                  <span className="accel-dot">{done ? <Check size={14} /> : i + 1}</span>
                  <span>{lbl}</span>
                  {current && <span className="accel-now">hold still</span>}
                </li>
              );
            })}
          </ol>

          {accel.prompt && running && (
            <div className="callout accent">
              <span>{accel.prompt}</span>
            </div>
          )}
          {accel.message && !accel.prompt && <p className={`cal-msg ${accel.phase}`}>{accel.message}</p>}

          <div className="cal-actions">
            {!running && (
              <button className="btn btn-primary" disabled={block} onClick={() => void commandLink.startAccelCal()}>
                <Gauge /> {accel.phase === "idle" ? "Start calibration" : "Restart"}
              </button>
            )}
            {running && accel.awaitingConfirm && (
              <button className="btn btn-primary" onClick={() => void commandLink.confirmAccelPosition()}>
                <Check /> Vehicle is in position — capture ({ACCEL_POSITIONS[Math.min(accel.step, 5)]})
              </button>
            )}
            {running && !accel.awaitingConfirm && (
              <span className="cal-wait"><Loader2 className="spin" size={16} /> waiting for the autopilot…</span>
            )}
          </div>
        </div>
      </section>

      <div className="cal-two">
        <section className="panel">
          <div className="panel-head">
            <h3>Level horizon</h3>
            {level.phase === "success" && <span className="pill ok plain"><Check size={13} /> Set</span>}
          </div>
          <div className="panel-body cal-body">
            <p className="muted">Trims the artificial horizon. Set the vehicle level on a flat surface and press the button — a one-shot, no repositioning.</p>
            {level.message && <p className={`cal-msg ${level.phase}`}>{level.message}</p>}
            <button className="btn" disabled={block || level.phase === "running"} onClick={() => void commandLink.startLevel()}>
              {level.phase === "running" ? <Loader2 className="spin" /> : <CircleCheck />} Calibrate level
            </button>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h3>Gyro</h3>
            {gyro.phase === "success" && <span className="pill ok plain"><Check size={13} /> Done</span>}
          </div>
          <div className="panel-body cal-body">
            <p className="muted">Re-zeros the gyroscopes. Keep the vehicle completely still; this runs automatically before an accel calibration too.</p>
            {gyro.message && <p className={`cal-msg ${gyro.phase}`}>{gyro.message}</p>}
            <button className="btn" disabled={block || gyro.phase === "running"} onClick={() => void commandLink.startGyro()}>
              {gyro.phase === "running" ? <Loader2 className="spin" /> : <RotateCcw />} Calibrate gyro
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
