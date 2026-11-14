import { Rocket, RotateCw, TriangleAlert, X, Zap } from "lucide-react";
import { useState } from "react";
import { commandLink } from "../../services/link/commandLink";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { ESC_CALIBRATION, ESC_TYPES } from "./ardupilot";
import { ParamNumber, ParamSelect } from "./common";
import { useRequireParams, writeParam } from "./paramWrite";
import { notify } from "../../state/notifyStore";

export function EscSection({ canSend }: { canSend: boolean }) {
  useRequireParams(["MOT_PWM_TYPE", "MOT_PWM_MIN", "MOT_PWM_MAX", "MOT_SPIN_ARM", "MOT_SPIN_MIN", "MOT_SPIN_MAX", "ESC_CALIBRATION"], canSend);
  const armed = useLink((s) => s.vehicle?.armed) ?? false;
  const escCal = useParams((s) => s.values["ESC_CALIBRATION"]);
  const [propsOff, setPropsOff] = useState(false);
  const [done, setDone] = useState(false);

  const calibrate = async () => {
    // Arm the one-shot "calibrate at next boot" mode, then reboot into it —
    // only once the aircraft has confirmed the setting. Rebooting without it
    // would show the steps for a calibration that is not going to happen.
    try {
      await commandLink.setParam("ESC_CALIBRATION", 3);
    } catch (e) {
      notify("error", "ESC calibration not started", (e as Error).message);
      return;
    }
    setDone(true);
    await commandLink.reboot();
  };

  return (
    <div className="cal-section">
      <div className="cal-sec-head">
        <div>
          <h2>ESC</h2>
          <p>Set the ESC protocol and output range, then calibrate the ESC throttle endpoints — the Mission Planner ESC setup, behind a props-off gate.</p>
        </div>
        <Zap className="cal-sec-icon" />
      </div>

      <div className="callout danger">
        <TriangleAlert />
        <span><strong>Remove all propellers before anything on this page.</strong> ESC calibration and any throttle output can spin the motors at full power without warning.</span>
      </div>
      {armed && <div className="callout warn"><X /><span>Disarm before changing motor parameters or calibrating.</span></div>}

      <section className="panel">
        <div className="panel-head"><h3>ESC type &amp; output</h3></div>
        <div className="panel-body cal-body">
          <div className="esc-grid">
            <ParamSelect name="MOT_PWM_TYPE" label="ESC type (protocol)" options={ESC_TYPES} help="Reboot after changing. DShot needs a board/output that supports it." disabled={!canSend} />
            <ParamNumber name="MOT_PWM_MIN" label="PWM min" suffix="µs" step={1} min={0} max={2000} help="0 = follow RC3 range." disabled={!canSend} />
            <ParamNumber name="MOT_PWM_MAX" label="PWM max" suffix="µs" step={1} min={0} max={2000} help="0 = follow RC3 range." disabled={!canSend} />
            <ParamNumber name="MOT_SPIN_ARM" label="Spin armed" step={0.01} min={0} max={1} help="Throttle when armed & idle (0–1). Typical 0.10." disabled={!canSend} />
            <ParamNumber name="MOT_SPIN_MIN" label="Spin min" step={0.01} min={0} max={1} help="Lowest flight throttle (0–1). Typical 0.15." disabled={!canSend} />
            <ParamNumber name="MOT_SPIN_MAX" label="Spin max" step={0.01} min={0} max={1} help="Highest throttle (0–1). Typical 0.95." disabled={!canSend} />
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h3>ESC calibration</h3>
          {done && <span className="pill accent plain">rebooting…</span>}
        </div>
        <div className="panel-body cal-body">
          <p className="muted">
            All-at-once calibration: the autopilot passes your throttle straight to every ESC on the next boot so each learns its min and max together. It arms <code>ESC_CALIBRATION</code> and reboots — then follow your ESCs' tones.
          </p>
          <ol className="esc-steps">
            <li>Remove propellers. Confirm below.</li>
            <li>Press <strong>Calibrate &amp; reboot</strong>. The board reboots into calibration mode.</li>
            <li>With the battery connected, raise throttle to full, wait for the ESC tones, then lower to zero.</li>
            <li>Power-cycle. Calibration mode clears itself after the pass.</li>
          </ol>

          <ParamSelect name="ESC_CALIBRATION" label="ESC calibration mode" options={ESC_CALIBRATION} help="“Auto-calibrate on next boot” is set for you by the button below." disabled={!canSend} />

          <label className="esc-confirm">
            <input type="checkbox" checked={propsOff} onChange={(e) => setPropsOff(e.target.checked)} />
            <span>I have removed all propellers.</span>
          </label>

          <div className="cal-actions">
            <button className="btn btn-danger" disabled={!canSend || armed || !propsOff} onClick={() => void calibrate()}>
              <Rocket /> Calibrate &amp; reboot
            </button>
            {escCal !== undefined && escCal !== 0 && (
              <button className="btn btn-ghost" disabled={!canSend} onClick={() => writeParam("ESC_CALIBRATION", 0)}>
                <RotateCw size={15} /> Clear calibration flag
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
