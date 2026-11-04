import { Check, Play, Radio, Save, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { commandLink } from "../../services/link/commandLink";
import { useLink } from "../../state/linkStore";
import { RADIO_FUNCTION } from "./ardupilot";
import { ParamToggle, useRequireParams } from "./common";

const PWM_LO = 900;
const PWM_HI = 2100;
const span = (v: number) => `${((Math.max(PWM_LO, Math.min(PWM_HI, v)) - PWM_LO) / (PWM_HI - PWM_LO)) * 100}%`;

interface Cap {
  min: number;
  max: number;
}

export function RadioSection({ canSend }: { canSend: boolean }) {
  const rc = useLink((s) => s.telemetry.rc);
  const now = Date.now();
  const stale = !rc || now - rc.at > 3000;
  const channels = rc?.value.channels ?? [];
  const live = channels.map((v, i) => ({ ch: i + 1, pwm: v })).filter((c) => c.pwm > 0 && c.pwm < 3000);

  // Reverse toggles for the four control channels.
  useRequireParams([1, 2, 3, 4].flatMap((n) => [`RC${n}_REVERSED`]), canSend);

  const [capturing, setCapturing] = useState(false);
  const [caps, setCaps] = useState<Record<number, Cap>>({});
  const [saved, setSaved] = useState(false);
  const capRef = useRef<Record<number, Cap>>({});
  capRef.current = caps;

  // Accumulate min/max for every reporting channel while capturing.
  useEffect(() => {
    if (!capturing || stale) return;
    setCaps((prev) => {
      const next = { ...prev };
      for (const { ch, pwm } of live) {
        const c = next[ch] ?? { min: pwm, max: pwm };
        next[ch] = { min: Math.min(c.min, pwm), max: Math.max(c.max, pwm) };
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rc?.at, capturing, stale]);

  const start = () => {
    const init: Record<number, Cap> = {};
    for (const { ch, pwm } of live) init[ch] = { min: pwm, max: pwm };
    setCaps(init);
    setSaved(false);
    setCapturing(true);
  };

  const finish = async () => {
    setCapturing(false);
    // Write min/max for every captured channel, trim = current (centre the sticks first).
    const current: Record<number, number> = {};
    for (const { ch, pwm } of live) current[ch] = pwm;
    for (const [chStr, c] of Object.entries(capRef.current)) {
      const ch = Number(chStr);
      if (c.max - c.min < 50) continue; // channel never moved — skip
      await commandLink.setParam(`RC${ch}_MIN`, Math.round(c.min)).catch(() => {});
      await commandLink.setParam(`RC${ch}_MAX`, Math.round(c.max)).catch(() => {});
      if (current[ch]) await commandLink.setParam(`RC${ch}_TRIM`, Math.round(current[ch])).catch(() => {});
    }
    setSaved(true);
  };

  return (
    <div className="cal-section">
      <div className="cal-sec-head">
        <div>
          <h2>Radio</h2>
          <p>Live channels straight from the receiver. Capture the travel of every stick and switch, then save the endpoints — the Mission Planner radio-calibration flow.</p>
        </div>
        <Radio className="cal-sec-icon" />
      </div>

      {stale && <div className="callout warn"><X /><span>No live RC data. Turn the transmitter on and bind the receiver; channels appear here when the autopilot forwards them.</span></div>}
      {capturing && <div className="callout accent"><span>Move every stick and switch to its limits, then centre the sticks and press <strong>Finish &amp; save</strong>.</span></div>}
      {saved && !capturing && <div className="callout ok"><Check /><span>Endpoints and trims written to the autopilot.</span></div>}

      <section className="panel">
        <div className="panel-head">
          <h3>Channels{rc ? ` · ${live.length} active` : ""}</h3>
          <div className="cal-actions tight">
            {!capturing ? (
              <button className="btn btn-primary" disabled={!canSend || stale} onClick={start}>
                <Play /> Start calibration
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => void finish()}>
                <Save /> Finish &amp; save
              </button>
            )}
          </div>
        </div>
        <div className="panel-body cal-body">
          {live.length === 0 && !stale && <p className="muted">No channels reported yet.</p>}
          <div className="rc-list">
            {live.map(({ ch, pwm }) => {
              const cap = caps[ch];
              return (
                <div key={ch} className="rc-ch">
                  <div className="rc-label">
                    <span className="rc-n">CH{ch}</span>
                    {RADIO_FUNCTION[ch] && <span className="rc-fn">{RADIO_FUNCTION[ch]}</span>}
                  </div>
                  <div className="rc-bar">
                    {cap && <span className="rc-cap" style={{ left: span(cap.min), width: `calc(${span(cap.max)} - ${span(cap.min)})` }} />}
                    <span className="rc-fill" style={{ width: span(pwm) }} />
                    <span className="rc-needle" style={{ left: span(pwm) }} />
                  </div>
                  <span className="rc-pwm">{pwm}</span>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head"><h3>Channel reverse</h3></div>
        <div className="panel-body cal-body">
          <p className="muted">If a control moves the wrong way in the bars above, reverse it here. Roll, pitch, throttle and yaw are channels 1–4.</p>
          <div className="rc-rev">
            {[1, 2, 3, 4].map((n) => (
              <ParamToggle key={n} name={`RC${n}_REVERSED`} label={`CH${n} ${RADIO_FUNCTION[n] ?? ""}`.trim()} disabled={!canSend} />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
