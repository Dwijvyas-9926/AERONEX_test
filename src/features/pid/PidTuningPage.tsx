import { Cable, Link2, Link2Off, Loader2, Minus, Plus, RotateCcw, Search, SlidersVertical, TriangleAlert, Upload } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useLink } from "../../state/linkStore";
import { notify } from "../../state/notifyStore";
import { useParams } from "../../state/paramStore";
import { useParamEdits, type ParamEdits } from "../common/useParamEdits";
import { useRequireParams } from "../calibration/common";
import { advise, ALL_PID_PARAMS, HORIZONTAL, type PidControl, SYMPTOM_CHIPS, VERTICAL, YAW, type AdviceRec } from "./pidModel";

const fmt = (v: number, step: number) => {
  const dp = step < 0.001 ? 4 : step < 0.01 ? 3 : step < 0.1 ? 2 : 1;
  return v.toFixed(dp);
};

function PidSlider({ control, linked, disabled, edits }: { control: PidControl; linked: boolean; disabled: boolean; edits: ParamEdits }) {
  const vehicleValue = useParams((s) => s.values[control.name]);
  const pending = useParams((s) => s.pending[control.name]);
  const staged = edits.edits[control.name];
  const known = vehicleValue !== undefined;
  const shown = staged ?? vehicleValue ?? 0;
  const modified = staged !== undefined && (!known || Math.abs(staged - (vehicleValue as number)) > 1e-9);

  // Snap to the slider's step for slider/nudge changes.
  const stage = (v: number) => {
    const c = Math.round(v / control.step) * control.step;
    edits.setEdit(control.name, c);
    if (control.mirror && linked) edits.setEdit(control.mirror, c);
  };
  // Keyboard entry stages the exact value typed, clamped to the control's range
  // (no step-snapping), so precise decimals like 0.0825 are preserved but an
  // out-of-range value can't be written to the vehicle.
  const stageExact = (v: number) => {
    const c = Math.max(control.min, Math.min(control.max, v));
    edits.setEdit(control.name, c);
    if (control.mirror && linked) edits.setEdit(control.mirror, c);
  };

  const [draft, setDraft] = useState<string | null>(null);
  // Drop a stale draft whenever the shown value changes from elsewhere (revert, upload, link).
  useEffect(() => setDraft(null), [shown]);
  const commit = () => {
    if (draft == null) return;
    const v = Number(draft);
    if (Number.isFinite(v) && draft.trim() !== "") stageExact(v);
    setDraft(null);
  };

  return (
    <div className={`pid-row${modified ? " modified" : ""}`}>
      <div className="pid-row-head">
        <span className="pid-label">{control.label}</span>
        {control.mirror && linked && <span className="pid-link-tag" title="Roll and pitch staged together"><Link2 size={11} /> R+P</span>}
        {modified && <span className="pid-mod">● edited</span>}
        {pending?.state === "writing" && <span className="pwrite writing"><Loader2 size={12} className="spin" /> saving</span>}
        {pending?.state === "failed" && <span className="pwrite failed"><TriangleAlert size={12} /> not saved</span>}
        <input
          className="input pid-value-input"
          type="number"
          inputMode="decimal"
          step={control.step}
          value={draft ?? (known || staged !== undefined ? fmt(shown, control.step) : "")}
          placeholder="—"
          disabled={disabled || !known}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => e.currentTarget.select()}
          onBlur={commit}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          aria-label={`${control.label} value`}
        />
      </div>
      <div className="pid-controls">
        <button className="pid-nudge" disabled={disabled || !known} onClick={() => stage(shown - control.step)} aria-label={`Decrease ${control.label}`}><Minus size={14} /></button>
        <input
          type="range"
          min={Math.min(control.min, shown)}
          max={Math.max(control.max, shown)}
          step={control.step}
          value={shown}
          disabled={disabled || !known}
          onChange={(e) => stage(Number(e.target.value))}
        />
        <button className="pid-nudge" disabled={disabled || !known} onClick={() => stage(shown + control.step)} aria-label={`Increase ${control.label}`}><Plus size={14} /></button>
      </div>
      {control.help && <small className="pid-help">{control.help}{modified && known ? ` · on vehicle: ${fmt(vehicleValue as number, control.step)}` : ""}</small>}
    </div>
  );
}

function Section({ title, controls, linked, disabled, edits, extra }: { title: string; controls: PidControl[]; linked: boolean; disabled: boolean; edits: ParamEdits; extra?: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>{title}</h3>
        {extra}
      </div>
      <div className="panel-body pid-body">
        {controls.map((c) => (
          <PidSlider key={c.name} control={c} linked={linked} disabled={disabled} edits={edits} />
        ))}
      </div>
    </section>
  );
}

function Advisor({ edits, values }: { edits: ParamEdits; values: Record<string, number> }) {
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const results = useMemo(() => (query.trim() ? advise(query) : []), [query]);

  const run = (q: string) => {
    setText(q);
    setQuery(q);
  };

  const apply = (rec: AdviceRec) => {
    const changed: string[] = [];
    for (const p of rec.params) {
      const current = edits.edits[p] ?? values[p];
      if (current === undefined) continue;
      const next = rec.direction === "decrease" ? current * (1 - rec.pct / 100) : current * (1 + rec.pct / 100);
      edits.setEdit(p, next);
      changed.push(p);
    }
    if (changed.length) notify("info", "Change staged", `${rec.direction === "decrease" ? "Lowered" : "Raised"} ${changed.join(", ")} by ${rec.pct}%. Upload to apply.`);
    else notify("warn", "Not staged", "Those parameters haven't loaded from the vehicle yet.");
  };

  return (
    <section className="panel pid-advisor">
      <div className="panel-head">
        <h3>What should I change?</h3>
      </div>
      <div className="panel-body pid-body">
        <p className="muted" style={{ fontSize: "var(--t-sm)" }}>Describe what the aircraft is doing. The fix is staged — nothing is written until you upload.</p>
        <div className="pid-search">
          <Search size={16} />
          <input className="input" placeholder="e.g. it wobbles fast when hovering" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && run(text)} />
          <button className="btn btn-primary" onClick={() => run(text)}>Ask</button>
        </div>
        <div className="pid-chips">
          {SYMPTOM_CHIPS.map((c) => (
            <button key={c} className="pid-chip" onClick={() => run(c)}>{c}</button>
          ))}
        </div>

        {query.trim() && results.length === 0 && (
          <div className="callout"><span>No match. Try words like “fast wobble”, “slow rocking”, “bounces up and down”, “twitchy”, “sluggish” or “nose wag”.</span></div>
        )}

        {results.map((a) => (
          <div key={a.id} className="pid-advice">
            <strong>{a.title}</strong>
            {a.recs.map((r, i) => (
              <div key={i} className="pid-rec">
                <div className="pid-rec-head">
                  <span className={`pid-dir ${r.direction}`}>{r.direction === "decrease" ? "Lower" : "Raise"} {r.pct}%</span>
                  <code>{r.params.join(" + ")}</code>
                  <button className="btn" style={{ height: 28 }} onClick={() => apply(r)}>Stage</button>
                </div>
                <p>{r.why}</p>
              </div>
            ))}
            {a.note && <div className="callout" style={{ marginTop: "var(--s2)" }}><span>{a.note}</span></div>}
          </div>
        ))}
      </div>
    </section>
  );
}

export function PidTuningPage() {
  const vehicle = useLink((s) => s.vehicle);
  const status = useLink((s) => s.status);
  const values = useParams((s) => s.values);
  const connected = !!vehicle && (status === "connected" || status === "stale");
  const canSend = !!vehicle && status === "connected";
  const [linked, setLinked] = useState(true);
  const edits = useParamEdits();
  useRequireParams(ALL_PID_PARAMS, canSend);

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>PID Tuning</h1>
          <p>Stage gain changes to calm horizontal and vertical wobble, then upload them together — with an advisor that turns what you see into what to change.</p>
        </div>
        {connected ? (
          <span className={`pill ${canSend ? "ok" : "warn"} plain`}>{vehicle!.firmwareLabel} · {vehicle!.armed ? "ARMED" : "Disarmed"}</span>
        ) : (
          <Link className="btn btn-primary" to="/connection"><Cable /> Connect a vehicle</Link>
        )}
      </header>

      {!connected && <div className="callout" style={{ marginBottom: "var(--s4)" }}><span>Connect a flight controller to read and stage its PID gains. Values are read live from the vehicle; changes upload only when you press the button.</span></div>}
      <div className="callout warn" style={{ marginBottom: "var(--s4)" }}>
        <TriangleAlert />
        <span>Change gains in <strong>small steps</strong> and re-test with a short, low hover in the open. Uploaded values apply immediately — no reboot — and a bad value can make the aircraft hard to control.</span>
      </div>

      <div className="pid-actionbar">
        <span className="pid-count">{edits.count > 0 ? `${edits.count} change${edits.count === 1 ? "" : "s"} staged` : "No changes staged"}</span>
        <div className="pid-actionbar-btns">
          <button className="btn btn-ghost" disabled={!edits.count || edits.uploading} onClick={edits.revert}><RotateCcw size={15} /> Revert</button>
          <button className="btn btn-primary" disabled={!canSend || !edits.count || edits.uploading} onClick={() => void edits.upload()}>
            {edits.uploading ? <Loader2 className="spin" /> : <Upload />} Upload to Pixhawk{edits.count ? ` (${edits.count})` : ""}
          </button>
        </div>
      </div>

      <div className="pid-layout">
        <div className="stack">
          <Section
            title="Horizontal — roll & pitch"
            controls={HORIZONTAL}
            linked={linked}
            disabled={!canSend}
            edits={edits}
            extra={
              <button className={`btn btn-ghost pid-linkbtn${linked ? " on" : ""}`} onClick={() => setLinked((v) => !v)} title="Stage roll and pitch together">
                {linked ? <Link2 size={15} /> : <Link2Off size={15} />} {linked ? "Roll + Pitch linked" : "Independent"}
              </button>
            }
          />
          <Section title="Vertical — altitude" controls={VERTICAL} linked={false} disabled={!canSend} edits={edits} />
          <Section title="Yaw" controls={YAW} linked={false} disabled={!canSend} edits={edits} />
        </div>
        <div className="stack">
          <Advisor edits={edits} values={values} />
        </div>
      </div>

      <p className="cal-foot muted">
        <SlidersVertical size={13} style={{ verticalAlign: "-2px", marginRight: 4 }} />
        ArduPilot's standard rate, angle and altitude gains. Manual basic tuning — it doesn't run Autotune, and it never writes to the vehicle on its own.
      </p>
    </div>
  );
}
