import { Check, Loader2, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useParams } from "../../state/paramStore";
import { useLink } from "../../state/linkStore";
import type { Option } from "./ardupilot";
import { writeParam } from "./paramWrite";

/** Setup controls are locked while the aircraft is armed. */
const useArmed = () => useLink((s) => !!s.vehicle?.armed);
const ARMED_TITLE = "Disarm to change this setting";

/** Small indicator of a parameter's write state. */
function WriteState({ name }: { name: string }) {
  const pending = useParams((s) => s.pending[name]);
  if (!pending) return null;
  if (pending.state === "failed")
    return (
      <span className="pwrite failed" title="Write not confirmed">
        <TriangleAlert size={13} /> not saved
      </span>
    );
  return (
    <span className="pwrite writing" title="Waiting for the vehicle to confirm">
      <Loader2 size={13} className="spin" /> saving
    </span>
  );
}

export function ParamValueBadge({ name }: { name: string }) {
  const value = useParams((s) => s.values[name]);
  const pending = useParams((s) => s.pending[name]);
  if (value === undefined) return <span className="pbadge muted">—</span>;
  if (!pending) return <span className="pbadge ok" title={`${name} = ${value}`}><Check size={12} /> {fmt(value)}</span>;
  return <span className="pbadge">{fmt(value)}</span>;
}

const fmt = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, "").replace(/\.$/, ""));

/** A labelled enum parameter rendered as a <select>, writing on change. */
export function ParamSelect({ name, label, options, help, disabled }: { name: string; label: string; options: Option[]; help?: string; disabled?: boolean }) {
  const value = useParams((s) => s.values[name]);
  const armed = useArmed();
  const known = value !== undefined;
  return (
    <label className="field cal-param">
      <span className="cal-param-head">
        {label} <WriteState name={name} />
      </span>
      <select
        className="select"
        value={known ? String(value) : ""}
        disabled={disabled || armed || !known}
        title={armed ? ARMED_TITLE : undefined}
        onChange={(e) => writeParam(name, Number(e.target.value))}
      >
        {!known && <option value="">Reading…</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {help && <small>{help}</small>}
    </label>
  );
}

/** A labelled numeric parameter; writes on Enter or blur when changed. */
export function ParamNumber({ name, label, step = 1, min, max, suffix, help, disabled }: { name: string; label: string; step?: number; min?: number; max?: number; suffix?: string; help?: string; disabled?: boolean }) {
  const value = useParams((s) => s.values[name]);
  const armed = useArmed();
  const [draft, setDraft] = useState("");
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current && value !== undefined) setDraft(fmt(value));
  }, [value]);
  const commit = () => {
    editing.current = false;
    const v = Number(draft);
    if (draft !== "" && Number.isFinite(v)) {
      // Clamp typed entry to the control's range so an out-of-range value can't
      // be written to the vehicle.
      const c = Math.max(min ?? -Infinity, Math.min(max ?? Infinity, v));
      if (c !== value) writeParam(name, c);
      setDraft(fmt(c));
    } else if (value !== undefined) setDraft(fmt(value));
  };
  return (
    <label className="field cal-param">
      <span className="cal-param-head">
        {label} <WriteState name={name} />
      </span>
      <div className="cal-num">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={draft}
          disabled={disabled || armed || value === undefined}
          title={armed ? ARMED_TITLE : undefined}
          onFocus={() => (editing.current = true)}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
        {suffix && <span className="cal-num-suffix">{suffix}</span>}
      </div>
      {help && <small>{help}</small>}
    </label>
  );
}

/** A boolean parameter shown as a toggle (0/1). */
export function ParamToggle({ name, label, help, disabled }: { name: string; label: string; help?: string; disabled?: boolean }) {
  const value = useParams((s) => s.values[name]);
  const armed = useArmed();
  const on = value === 1;
  return (
    <div className="field cal-param">
      <span className="cal-param-head">
        {label} <WriteState name={name} />
      </span>
      <button
        className={`toggle${on ? " on" : ""}`}
        role="switch"
        aria-checked={on}
        disabled={disabled || armed || value === undefined}
        title={armed ? ARMED_TITLE : undefined}
        onClick={() => writeParam(name, on ? 0 : 1)}
      >
        <span className="knob" />
        <span className="toggle-txt">{value === undefined ? "—" : on ? "On" : "Off"}</span>
      </button>
      {help && <small>{help}</small>}
    </div>
  );
}

export function ProgressBar({ pct, tone = "accent" }: { pct: number; tone?: "accent" | "ok" | "danger" }) {
  return (
    <div className="cal-progress">
      <div className={`cal-progress-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  );
}
