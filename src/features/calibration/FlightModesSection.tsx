import { SlidersHorizontal, X } from "lucide-react";
import { commandLink } from "../../services/link/commandLink";
import { useNow } from "../../hooks/useNow";
import { useLink } from "../../state/linkStore";
import { useParams } from "../../state/paramStore";
import { COPTER_FLIGHT_MODES, FLTMODE_CH, switchPosition } from "./ardupilot";
import { ParamSelect, useRequireParams } from "./common";

const PWM_BANDS = ["≤ 1230", "1231–1360", "1361–1490", "1491–1620", "1621–1749", "≥ 1750"];

export function FlightModesSection({ canSend }: { canSend: boolean }) {
  useRequireParams(["FLTMODE_CH", "FLTMODE1", "FLTMODE2", "FLTMODE3", "FLTMODE4", "FLTMODE5", "FLTMODE6", "SIMPLE", "SUPER_SIMPLE"], canSend);
  const fltCh = useParams((s) => s.values["FLTMODE_CH"]);
  const rc = useLink((s) => s.telemetry.rc);
  const now = useNow(500);
  const chPwm = fltCh && rc && now - rc.at < 3000 ? rc.value.channels[fltCh - 1] : undefined;
  const activePos = chPwm ? switchPosition(chPwm) : null;

  return (
    <div className="cal-section">
      <div className="cal-sec-head">
        <div>
          <h2>Flight modes</h2>
          <p>Assign a mode to each position of your mode switch, just like Mission Planner. The live position is highlighted as you flip the switch.</p>
        </div>
        <SlidersHorizontal className="cal-sec-icon" />
      </div>

      {!canSend && <div className="callout warn"><X /><span>Connect aircraft to read and change mode assignments.</span></div>}

      <section className="panel">
        <div className="panel-head"><h3>Mode switch</h3></div>
        <div className="panel-body cal-body">
          <div className="fm-top">
            <ParamSelect name="FLTMODE_CH" label="Mode channel" options={FLTMODE_CH} help="The RC channel your mode switch is on (Copter default: 5)." disabled={!canSend} />
            <div className="fm-live">
              <span className="muted">Live position</span>
              <strong>{activePos ? `Position ${activePos}` : "—"}</strong>
              {chPwm && <span className="muted">{chPwm} µs</span>}
            </div>
          </div>

          <div className="fm-slots">
            {[1, 2, 3, 4, 5, 6].map((pos) => (
              <div key={pos} className={`fm-slot${activePos === pos ? " active" : ""}`}>
                <div className="fm-slot-head">
                  <span className="fm-pos">Pos {pos}</span>
                  <span className="fm-pwm">{PWM_BANDS[pos - 1]} µs</span>
                  {activePos === pos && <span className="pill accent plain">current</span>}
                </div>
                <ParamSelect name={`FLTMODE${pos}`} label="" options={COPTER_FLIGHT_MODES} disabled={!canSend} />
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Simple &amp; Super Simple</h3></div>
        <div className="panel-body cal-body">
          <p className="muted">Tick the switch positions that should use Simple or Super Simple mode (heading-independent control). Leave all unticked to disable.</p>
          <BitmaskRow name="SIMPLE" label="Simple" canSend={canSend} />
          <BitmaskRow name="SUPER_SIMPLE" label="Super Simple" canSend={canSend} />
        </div>
      </section>
    </div>
  );
}

function BitmaskRow({ name, label, canSend }: { name: string; label: string; canSend: boolean }) {
  const value = useParams((s) => s.values[name]) ?? 0;
  const known = useParams((s) => s.values[name] !== undefined);
  const toggle = (bit: number) => {
    const next = value ^ (1 << bit);
    void commandLink.setParam(name, next);
  };
  return (
    <div className="fm-bits">
      <span className="fm-bits-label">{label}</span>
      <div className="fm-bits-boxes">
        {[0, 1, 2, 3, 4, 5].map((bit) => (
          <button
            key={bit}
            className={`fm-bit${value & (1 << bit) ? " on" : ""}`}
            disabled={!canSend || !known}
            onClick={() => toggle(bit)}
            title={`Position ${bit + 1}`}
          >
            {bit + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
