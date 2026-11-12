import { Fan, OctagonX, Play, Square, Timer, TriangleAlert, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { commandLink } from "../../services/link/commandLink";
import { useLink } from "../../state/linkStore";

/*
  Per-motor spin test (MAV_CMD_DO_MOTOR_TEST). Each motor has a throttle slider
  and a matching number box for a precise value. While a motor is "spinning" we
  resend the command on a timer shorter than its timeout, so the motor keeps
  turning at the set value but stops on its own the instant anything interrupts
  the GCS (dead-man safety). Gated on disarmed + props-off.

  The sequence test is deliberately self-contained: it owns its own resend loop
  and reads the *current* blocked state through a ref, so a momentary link blip
  can't silently abort the whole run after the first motor.
*/

const LETTERS = "ABCDEFGH".split("");
const DEFAULT_DURATION = 3; // seconds each motor spins
const MIN_DURATION = 1;
const MAX_DURATION = 30;
const GAP_MS = 500; // pause between motors in the sequence
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clampDur = (v: number) => Math.max(MIN_DURATION, Math.min(MAX_DURATION, Math.round(v)));
const clampPct = (v: number) => Math.max(0, Math.min(100, Math.round(v)));

export function MotorTestSection({ canSend }: { canSend: boolean }) {
  const armed = useLink((s) => s.vehicle?.armed) ?? false;
  const [count, setCount] = useState(4);
  const [throttle, setThrottle] = useState<number[]>(() => Array(8).fill(8));
  const [spinning, setSpinning] = useState<boolean[]>(() => Array(8).fill(false));
  const [propsOff, setPropsOff] = useState(false);
  const [duration, setDuration] = useState(DEFAULT_DURATION);
  const [durDraft, setDurDraft] = useState<string | null>(null);
  const [seqRunning, setSeqRunning] = useState(false);
  const [seqIndex, setSeqIndex] = useState(-1);

  const throttleRef = useRef(throttle);
  const spinningRef = useRef(spinning);
  const durationRef = useRef(duration);
  const canSendRef = useRef(canSend);
  const blockedRef = useRef(false);
  const seqAbort = useRef(false);
  throttleRef.current = throttle;
  spinningRef.current = spinning;
  durationRef.current = duration;
  canSendRef.current = canSend;

  const blocked = !canSend || armed || !propsOff;
  blockedRef.current = blocked;

  // Keep-alive timeout for each DO_MOTOR_TEST command: long enough to cover a
  // resend gap, capped so a motor never free-runs for long after the link dies.
  const cmdTimeout = () => Math.min(Math.max(durationRef.current, 2), 4);

  const stopAll = (send = true) => {
    seqAbort.current = true;
    setSeqRunning(false);
    setSeqIndex(-1);
    setSpinning(Array(8).fill(false));
    if (send && canSendRef.current) void commandLink.stopAllMotors(count);
  };

  // Resend loop for *manually* held motors (individual Spin). The sequence does
  // its own resending and does not use this.
  useEffect(() => {
    const id = setInterval(() => {
      if (blockedRef.current || seqRunning) return;
      for (let i = 0; i < count; i++) {
        if (spinningRef.current[i]) void commandLink.motorTest(i + 1, throttleRef.current[i], cmdTimeout());
      }
    }, 900);
    return () => clearInterval(id);
  }, [count, seqRunning]);

  // Safety: if the link drops, the vehicle arms, or props-off is unchecked,
  // cut any held motors and abort a running sequence.
  useEffect(() => {
    if (blocked && (spinningRef.current.some(Boolean) || seqRunning)) stopAll(canSend);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocked]);

  // Stop everything only when the component actually unmounts (not on every
  // canSend change — that was what reset the sequence after the first motor).
  useEffect(
    () => () => {
      if (canSendRef.current) void commandLink.stopAllMotors(8);
    },
    [],
  );

  const toggle = (i: number) => {
    if (seqRunning) return;
    const on = !spinningRef.current[i];
    // Stopping is always allowed; starting is checked here as well as on the
    // button, so the gate does not depend on a disabled attribute alone.
    if (on && blockedRef.current) return;
    // The command goes out here rather than inside the state updater, which
    // React is free to run more than once.
    if (on) void commandLink.motorTest(i + 1, throttleRef.current[i], cmdTimeout());
    else void commandLink.stopMotor(i + 1);
    setSpinning((prev) => {
      const next = [...prev];
      next[i] = on;
      return next;
    });
  };

  const setThr = (i: number, v: number) => {
    const c = clampPct(v);
    setThrottle((prev) => {
      const next = [...prev];
      next[i] = c;
      return next;
    });
    throttleRef.current[i] = c;
    if (spinningRef.current[i] && !blockedRef.current) void commandLink.motorTest(i + 1, c, cmdTimeout());
  };

  // Step through every motor one at a time, keeping each alive for `duration`
  // seconds with its own resend, then stopping it before moving on.
  const sequence = async () => {
    if (blockedRef.current || seqRunning) return;
    seqAbort.current = false;
    setSeqRunning(true);
    setSpinning(Array(8).fill(false));
    try {
      for (let i = 0; i < count; i++) {
        if (seqAbort.current || blockedRef.current) break;
        setSeqIndex(i);
        const endAt = Date.now() + durationRef.current * 1000;
        // Fire immediately, then resend every ~700ms until this motor's time is up.
        void commandLink.motorTest(i + 1, throttleRef.current[i], cmdTimeout());
        let last = Date.now();
        while (Date.now() < endAt) {
          if (seqAbort.current || blockedRef.current) break;
          await sleep(100);
          if (Date.now() - last >= 700) {
            void commandLink.motorTest(i + 1, throttleRef.current[i], cmdTimeout());
            last = Date.now();
          }
        }
        void commandLink.stopMotor(i + 1);
        if (seqAbort.current || blockedRef.current) break;
        await sleep(GAP_MS);
      }
    } finally {
      setSeqIndex(-1);
      setSeqRunning(false);
      if (canSendRef.current) void commandLink.stopAllMotors(count);
    }
  };

  const commitDur = () => {
    if (durDraft == null) return;
    const v = Number(durDraft);
    if (Number.isFinite(v) && durDraft.trim() !== "") setDuration(clampDur(v));
    setDurDraft(null);
  };

  const anySpinning = spinning.some(Boolean);
  const busy = anySpinning || seqRunning;

  return (
    <div className="cal-section">
      <div className="cal-sec-head">
        <div>
          <h2>Motor test</h2>
          <p>Spin each motor on its own to check wiring order and direction. Set its speed with the slider or type an exact percent — the motor stops by itself the instant anything interrupts the link.</p>
        </div>
        <Fan className="cal-sec-icon" />
      </div>

      <div className="callout danger">
        <TriangleAlert />
        <span><strong>Remove all propellers first.</strong> Motors spin at the commanded throttle immediately. Confirm the aircraft is secured and clear of people.</span>
      </div>
      {armed && <div className="callout warn"><X /><span>Disarm the vehicle to run a motor test.</span></div>}
      {!canSend && <div className="callout warn"><X /><span>Connect aircraft to test motors.</span></div>}

      <section className="panel">
        <div className="panel-head">
          <h3>Motors</h3>
          <div className="cal-actions tight">
            <label className="mt-count">
              Motors
              <select className="select" value={count} onChange={(e) => { stopAll(); setCount(Number(e.target.value)); }} disabled={busy}>
                {[3, 4, 6, 8].map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
            <label className="mt-count">
              <Timer size={14} /> Spin time
              <div className="mt-dur">
                <input
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={MIN_DURATION}
                  max={MAX_DURATION}
                  step={1}
                  value={durDraft ?? String(duration)}
                  disabled={busy}
                  onChange={(e) => setDurDraft(e.target.value)}
                  onBlur={commitDur}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                />
                <span className="mt-dur-unit">s</span>
              </div>
            </label>
            <button className="btn btn-danger" onClick={() => stopAll()} disabled={!canSend}>
              <OctagonX /> Stop all
            </button>
          </div>
        </div>
        <div className="panel-body cal-body">
          <label className="esc-confirm">
            <input type="checkbox" checked={propsOff} onChange={(e) => { setPropsOff(e.target.checked); if (!e.target.checked) stopAll(); }} />
            <span>I have removed all propellers and the area is clear.</span>
          </label>

          {seqRunning && (
            <div className="callout accent">
              <Fan size={16} className="spin" />
              <span>Sequence running — <strong>Motor {LETTERS[seqIndex] ?? "?"}</strong> ({seqIndex + 1} of {count}), {duration}s each. Watch that each motor spins in turn, in the direction marked for its position.</span>
            </div>
          )}

          <div className="mt-grid">
            {Array.from({ length: count }, (_, i) => {
              const live = spinning[i] || (seqRunning && seqIndex === i);
              return (
                <div key={i} className={`mt-motor${live ? " live" : ""}`}>
                  <div className="mt-head">
                    <span className="mt-letter">{LETTERS[i]}</span>
                    <span className="mt-num">Motor {i + 1}</span>
                    {live && <span className="mt-spin"><Fan size={14} className="spin" /></span>}
                  </div>
                  <div className="mt-slider">
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      value={throttle[i]}
                      disabled={blocked || seqRunning}
                      onChange={(e) => setThr(i, Number(e.target.value))}
                    />
                    <div className="mt-pct">
                      <input
                        className="input mt-pct-input"
                        type="number"
                        inputMode="numeric"
                        min={0}
                        max={100}
                        step={1}
                        value={throttle[i]}
                        disabled={blocked || seqRunning}
                        onChange={(e) => setThr(i, Number(e.target.value))}
                        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                      />
                      <span className="mt-pct-unit">%</span>
                    </div>
                  </div>
                  <button className={`btn ${spinning[i] ? "btn-danger" : "btn-primary"}`} disabled={blocked || seqRunning} onClick={() => toggle(i)}>
                    {spinning[i] ? <><X /> Stop</> : <><Play /> Spin</>}
                  </button>
                </div>
              );
            })}
          </div>

          <div className="cal-actions">
            {!seqRunning ? (
              <button className="btn" disabled={blocked || anySpinning} onClick={() => void sequence()}>
                <Play /> Test in sequence (A → {LETTERS[count - 1]}, {duration}s each)
              </button>
            ) : (
              <button className="btn btn-danger" onClick={() => stopAll()}>
                <Square /> Stop sequence
              </button>
            )}
          </div>
          <p className="muted" style={{ fontSize: "var(--t-xs)" }}>
            Motor A should be the one the firmware lists first for your frame; confirm each spins in the direction marked for its position. Keep throttle low — just enough to turn the motor. On the bench you need a battery connected (props off) for the motors to actually turn.
          </p>
        </div>
      </section>
    </div>
  );
}
