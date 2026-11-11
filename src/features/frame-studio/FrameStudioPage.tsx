import { AlertTriangle, Box, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Grid3x3, RotateCcw, Ruler, Shapes } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { CAMERAS, FLYING_STYLES, MATERIALS, MOTORS, PROP_SIZES, STACK_PATTERNS, cameraById, materialById, motorById, propFit, type MotorSpec } from "./catalog";
import { ExportPanel } from "./components/ExportPanel";
import { PlanView } from "./components/PlanView";
import { SheetView } from "./components/SheetView";
import { BATTERY_MOUNTS, CONSTRUCTIONS, LAYOUTS, designFrame, type Layout } from "./geometry";
import { lookForPart } from "./parts";
import { LAYOUT_HINT, STEPS, defaultFixedDim, stackHeightFor, useStudio } from "./store";
import { validateDesign, worstSeverity, type Finding } from "./validate";

/* The solid view pulls in three.js, which is far too heavy to load for a user
   who never leaves the plan view. */
const Frame3D = lazy(() => import("./components/Frame3D").then((m) => ({ default: m.Frame3D })));

const n1 = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

/** A number input that keeps the keyboard usable — no steppers fighting typing. */
function Num({
  label,
  value,
  onChange,
  suffix,
  min,
  max,
  step = 1,
  hint,
  more,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
  /** The long explanation, kept behind a disclosure. */
  more?: string;
}) {
  /*
    Keep what the user is typing separate from the committed number.

    A controlled number input driven straight off the store cannot be typed
    into. A partially entered value — "", "-", "1." — reads back as "" from
    the DOM, Number("") is 0, and 0 is finite, so the store takes 0 and React
    re-renders the field as "0". The practical effect is that no field can be
    cleared and no decimal can be typed at all: from "2", typing "1.5" goes
    1 → 0 → 5. Holding the draft locally lets the field show exactly what was
    typed, and only well-formed numbers reach the store.
  */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value);

  const commit = (text: string) => {
    setDraft(text);
    if (text.trim() === "") return; // mid-edit, not a value yet
    const v = Number(text);
    if (!Number.isFinite(v)) return;
    // Clamp on the way in: the min/max attributes only bind the steppers.
    const lo = min ?? Number.NEGATIVE_INFINITY;
    const hi = max ?? Number.POSITIVE_INFINITY;
    onChange(Math.min(hi, Math.max(lo, v)));
  };

  return (
    <label className="field fs-num">
      <span>{label}</span>
      <div className="fs-num-wrap">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={shown}
          min={min}
          max={max}
          step={step}
          onChange={(e) => commit(e.target.value)}
          onBlur={() => setDraft(null)}
        />
        {suffix && <i>{suffix}</i>}
      </div>
      {hint && <small>{hint}</small>}
      {more && <Why>{more}</Why>}
    </label>
  );
}

/**
 * The long version of an explanation, folded away until asked for.
 *
 * The studio has a lot to say about why a number matters, and saying all of
 * it next to every field turned the form into prose with occasional inputs —
 * on the components step you had to scroll past six lines about stack
 * heights to reach the battery. A native <details> keeps it one click away
 * and keeps the keyboard and screen-reader behaviour for free.
 */
function Why({ children }: { children: React.ReactNode }) {
  return (
    <details className="fs-why" onClick={(e) => e.stopPropagation()}>
      <summary>Why this matters</summary>
      <p>{children}</p>
    </details>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: string; unit?: string; tone?: string }) {
  return (
    <div className={`fs-stat${tone ? ` ${tone}` : ""}`}>
      <span>{label}</span>
      <b>
        {value}
        {unit && <i>{unit}</i>}
      </b>
    </div>
  );
}

/**
 * Suffix shown beside a propeller size in the selector.
 *
 * Named by direction rather than by verdict: "wrong" covers a prop the motor
 * cannot turn and a prop so small the motor is wasted, and telling someone a
 * 2" prop is "too big" for their 3110 would be worse than saying nothing.
 */
function propNote(motor: MotorSpec, propIn: number): string {
  const { fit } = propFit(motor, propIn);
  if (fit === "ideal") return "";
  if (fit === "workable") return " — flies, but not the usual pairing";
  return propIn > motor.propRange[1] ? " — too big for this motor" : " — too small for this motor";
}

function FindingRow({ f }: { f: Finding }) {
  const Icon = f.severity === "error" ? CircleAlert : AlertTriangle;
  return (
    <li className={`fs-finding ${f.severity}`}>
      <Icon size={16} />
      <div>
        <b>{f.title}</b>
        <small>{f.scope}</small>
        <p>{f.detail}</p>
        {f.measured && (
          <span className="fs-finding-nums">
            {f.measured}
            {f.limit && <> · needs {f.limit}</>}
          </span>
        )}
      </div>
    </li>
  );
}

export function FrameStudioPage() {
  const spec = useStudio((s) => s.spec);
  const setSpec = useStudio((s) => s.setSpec);
  const patchSpec = useStudio((s) => s.patchSpec);
  const step = useStudio((s) => s.step);
  const setStep = useStudio((s) => s.setStep);
  const view = useStudio((s) => s.view);
  const setView = useStudio((s) => s.setView);
  const exploded = useStudio((s) => s.exploded);
  const setExploded = useStudio((s) => s.setExploded);
  const reset = useStudio((s) => s.reset);

  const [showProps, setShowProps] = useState(true);
  const [showDims, setShowDims] = useState(true);
  const [showSection, setShowSection] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);

  // One solve per spec change feeds the drawing, the numbers, the review and
  // the exports, so none of them can disagree with the others.
  const design = useMemo(() => designFrame(spec), [spec]);
  const findings = useMemo(() => validateDesign(design), [design]);

  /*
    One legend row per colour, not per part. A dead cat has "arm-long" and
    "arm-short", which share the arm colour and would otherwise print "Arms"
    twice with two different counts beside it.
  */
  const legend = useMemo(() => {
    const rows = new Map<string, { color: string; label: string; qty: number }>();
    for (const p of design.profiles) {
      const look = lookForPart(p.id);
      const row = rows.get(look.label);
      if (row) row.qty += p.qty;
      else rows.set(look.label, { ...look, qty: p.qty });
    }
    return [...rows.values()];
  }, [design.profiles]);
  const severity = worstSeverity(findings);
  const material = materialById(spec.materialId);
  const motor = motorById(spec.motorId);
  const isCut = material.method === "cut";

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const go = (delta: number) => {
    const next = STEPS[Math.max(0, Math.min(STEPS.length - 1, stepIndex + delta))];
    setStep(next.id);
  };

  const errors = findings.filter((f) => f.severity === "error");
  const warns = findings.filter((f) => f.severity === "warn");

  return (
    <div className="page-pad fs-page">
      <header className="page-head">
        <div>
          <h1>Frame Studio</h1>
          <p>
            Design a frame around the parts you already own. Answer five short questions and the studio works out the
            geometry, sizes the arms against real loads, checks the result and hands you files a cutter or printer can use.
            No CAD required.
          </p>
        </div>
        <div className="actions">
          <button className="btn btn-ghost" onClick={reset}>
            <RotateCcw /> Start over
          </button>
        </div>
      </header>

      {/* ---------------------------------------------------------- steps */}
      <nav className="fs-steps" aria-label="Design steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            className={`fs-step${s.id === step ? " is-current" : ""}${i < stepIndex ? " is-done" : ""}`}
            onClick={() => setStep(s.id)}
          >
            <i>{i + 1}</i>
            <span>
              <b>{s.label}</b>
              <small>{s.blurb}</small>
            </span>
          </button>
        ))}
      </nav>

      <div className="fs-layout">
        {/* ------------------------------------------------------ inputs */}
        <section className="panel fs-inputs">
          <div className="panel-head">
            <h3>{STEPS[stepIndex].label}</h3>
            <span className="pill">{stepIndex + 1} / {STEPS.length}</span>
          </div>
          <div className="panel-body">
            {step === "aircraft" && (
              <div className="fs-fields">
                <label className="field">
                  <span>Propeller size</span>
                  <select
                    className="select"
                    value={spec.propIn}
                    onChange={(e) => setSpec("propIn", Number(e.target.value))}
                  >
                    {PROP_SIZES.map((p) => (
                      <option key={p} value={p}>
                        {p}" propellers{propNote(motor, p)}
                      </option>
                    ))}
                  </select>
                  <small>
                    The single biggest decision — it sets how large the whole aircraft has to be.
                    {" "}Your {motor.size} motors are built for {motor.props.map((p) => `${p}"`).join(" or ")}.
                  </small>
                </label>

                <div className="field">
                  <span id="fs-layout-label">Layout</span>
                  <div className="fs-choices" role="radiogroup" aria-labelledby="fs-layout-label">
                    {LAYOUTS.map((l) => (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={spec.layout === l.id}
                        className={`fs-choice${spec.layout === l.id ? " is-on" : ""}`}
                        onClick={() => setSpec("layout", l.id as Layout)}
                      >
                        <b>{l.name}</b>
                        <small>{LAYOUT_HINT[l.id]}</small>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="field">
                  <span id="fs-style-label">How will you fly it?</span>
                  <div className="fs-choices" role="radiogroup" aria-labelledby="fs-style-label">
                    {FLYING_STYLES.map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        role="radio"
                        aria-checked={spec.styleId === f.id}
                        className={`fs-choice${spec.styleId === f.id ? " is-on" : ""}`}
                        onClick={() => setSpec("styleId", f.id)}
                      >
                        <b>{f.label}</b>
                        <small>{f.note}</small>
                      </button>
                    ))}
                  </div>
                  <small>
                    This is not a style preference — it sets the crash load the arms are sized against, which is what
                    actually decides how thick they are.
                  </small>
                </div>

                <div className="field">
                  <span id="fs-cons-label">How it goes together</span>
                  <div className="fs-choices" role="radiogroup" aria-labelledby="fs-cons-label">
                    {CONSTRUCTIONS.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="radio"
                        aria-checked={spec.construction === c.id}
                        className={`fs-choice${spec.construction === c.id ? " is-on" : ""}`}
                        onClick={() => setSpec("construction", c.id)}
                      >
                        <b>{c.name}</b>
                        <small>{c.blurb}</small>
                      </button>
                    ))}
                  </div>
                  <small>
                    Small frames are usually unibody and big ones usually bolted, but either works at any size — it is a
                    trade between weight and build simplicity on one side and repairability on the other.
                  </small>
                </div>

                <Num
                  label="Propeller clearance"
                  value={spec.clearanceMm}
                  onChange={(v) => setSpec("clearanceMm", v)}
                  suffix="mm"
                  min={0}
                  max={60}
                  hint="Gap between neighbouring propeller discs. 10 mm is a sensible minimum."
                  more="Too little and a bent propeller or a flexing arm lets two discs touch, which takes out both motors. Too much and the frame is larger, heavier and more flexible than the propellers need."
                />
              </div>
            )}

            {step === "components" && (
              <div className="fs-fields">
                <h4 className="fs-group">Motors</h4>
                <label className="field">
                  <span>Motor</span>
                  <select
                    className="select"
                    value={spec.motorId}
                    onChange={(e) => {
                      const m = motorById(e.target.value);
                      patchSpec({ motorId: m.id, motorThrustG: m.thrustG });
                    }}
                  >
                    {MOTORS.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.size} — {m.pattern} mm pattern, M{m.bolt}, for {m.props.join("/")}"
                        {propFit(m, spec.propIn).fit === "ideal" ? "" : ` (not your ${spec.propIn}" prop)`}
                      </option>
                    ))}
                  </select>
                  <small>Sets the bolt pattern on the motor pad and contributes {motor.massG} g each to the weight.</small>
                </label>

                <Num
                  label="Peak thrust per motor"
                  value={spec.motorThrustG}
                  onChange={(v) => setSpec("motorThrustG", v)}
                  suffix="g"
                  min={20}
                  max={8000}
                  step={10}
                  hint={`From your motor's own thrust table. The default is a ${motor.size} on ${motor.thrustCells}S.`}
                  more={
                    Math.abs(spec.motorThrustG - motor.thrustG) < 1e-9
                      ? `${motor.thrustG} g is representative of a ${motor.size} on ${motor.thrustCells}S with a ${motor.kv[0]}–${motor.kv[1]} KV winding. Every number in this design follows from it — the arm section, the all-up weight, the hover throttle — so if you have your motor's thrust table, the real figure is the single input that most changes the result.`
                      : `You have overridden the default. A stock ${motor.size} is around ${motor.thrustG} g on ${motor.thrustCells}S with a ${motor.kv[0]}–${motor.kv[1]} KV winding; if yours differs a lot from that, check you are reading peak thrust per motor rather than the whole aircraft.`
                  }
                />

                <h4 className="fs-group">Flight controller</h4>
                <label className="field">
                  <span>Flight controller stack</span>
                  <select
                    className="select"
                    value={spec.stackPattern}
                    onChange={(e) => {
                      const p = STACK_PATTERNS.find((x) => x.pattern === Number(e.target.value))!;
                      // Carry the height with the pattern: a 16 mm whoop stack
                      // and a 30.5 mm full-size stack are not the same height,
                      // and leaving the old number behind sizes the bolts wrong.
                      patchSpec({ stackPattern: p.pattern, stackBolt: p.bolt, stackHeightMm: p.heightMm });
                    }}
                  >
                    {STACK_PATTERNS.map((p) => (
                      <option key={p.id} value={p.pattern}>{p.label}</option>
                    ))}
                  </select>
                </label>

                <Num
                  label="Stack height"
                  value={spec.stackHeightMm}
                  onChange={(v) => setSpec("stackHeightMm", v)}
                  suffix="mm"
                  min={4}
                  max={60}
                  step={1}
                  hint={`Measured assembled, over the tallest component. ${spec.stackPattern} mm stacks land near ${stackHeightFor(spec.stackPattern)} mm.`}
                  more={`A 4-in-1 ESC board is 3–4 mm, a flight controller 4–5 mm, and the standoff between them 6–8 mm, with at least 2 mm left clear above the tallest part. This is the one measurement a mounting pattern cannot give you — a pattern is a width — and it sets both the stack bolt length and the size of the opening the stack passes through in the top plate.`}
                />

                <h4 className="fs-group">Battery</h4>
                <div className="fs-row3">
                  <Num label="Battery length" value={spec.battery.l} onChange={(v) => setSpec("battery", { ...spec.battery, l: v })} suffix="mm" min={20} />
                  <Num label="Width" value={spec.battery.w} onChange={(v) => setSpec("battery", { ...spec.battery, w: v })} suffix="mm" min={10} />
                  <Num label="Height" value={spec.battery.h} onChange={(v) => setSpec("battery", { ...spec.battery, h: v })} suffix="mm" min={5} />
                </div>

                <div className="field">
                  <span id="fs-batt-label">Where the battery straps</span>
                  <div className="fs-choices" role="radiogroup" aria-labelledby="fs-batt-label">
                    {BATTERY_MOUNTS.map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        role="radio"
                        aria-checked={spec.batteryMount === b.id}
                        className={`fs-choice${spec.batteryMount === b.id ? " is-on" : ""}`}
                        onClick={() => setSpec("batteryMount", b.id)}
                      >
                        <b>{b.name}</b>
                        <small>{b.blurb}</small>
                      </button>
                    ))}
                  </div>
                  <small>
                    The strap slots are cut in whichever plate the pack sits against. On top the mass sits{" "}
                    {n1(design.cg.belowThrustMm)} mm below the propellers; underneath it would hang further.
                  </small>
                </div>

                <h4 className="fs-group">Camera</h4>
                <label className="field">
                  <span>FPV camera</span>
                  <select className="select" value={spec.cameraId} onChange={(e) => setSpec("cameraId", e.target.value)}>
                    {CAMERAS.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <small>
                    {cameraById(spec.cameraId).note}
                    {cameraById(spec.cameraId).widthMm > 0
                      ? ` The size is the spacing between the camera's side mounting holes, so measure yours rather than trusting the product name.`
                      : ""}
                  </small>
                </label>

                <div className="fs-row2">
                  <Num label="Battery mass" value={spec.battery.massG} onChange={(v) => setSpec("battery", { ...spec.battery, massG: v })} suffix="g" min={10} step={5} />
                  <Num
                    label="Everything else"
                    value={spec.electronicsMassG}
                    onChange={(v) => setSpec("electronicsMassG", v)}
                    suffix="g"
                    min={0}
                    step={5}
                    hint="Stack, receiver, camera, VTX, wiring."
                  />
                </div>
              </div>
            )}

            {step === "material" && (
              <div className="fs-fields">
                <div className="field">
                  <span>Make it by</span>
                  <div className="fs-seg">
                    <button
                      className={isCut ? "is-on" : ""}
                      onClick={() => { if (!isCut) patchSpec({ materialId: "cf-plate", fixedDimMm: defaultFixedDim(), plateThicknessMm: null }); }}
                    >
                      Cutting flat sheet
                    </button>
                    <button
                      className={!isCut ? "is-on" : ""}
                      onClick={() => { if (isCut) patchSpec({ materialId: "pa-cf", fixedDimMm: defaultFixedDim(), plateThicknessMm: null }); }}
                    >
                      3D printing
                    </button>
                  </div>
                </div>

                <label className="field">
                  <span>Material</span>
                  <select
                    className="select"
                    value={spec.materialId}
                    onChange={(e) => patchSpec({ materialId: e.target.value, fixedDimMm: defaultFixedDim(), plateThicknessMm: null })}
                  >
                    {MATERIALS.filter((m) => (isCut ? m.method === "cut" : m.method === "print")).map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <small>{material.note}</small>
                </label>

                {/*
                  Thickness is chosen for the user by default. It is the single
                  most consequential number in the design — stiffness goes with
                  its cube — and the published reference for each prop class is
                  a far better starting point than a guess.
                */}
                <div className="fs-chosen">
                  <header>
                    <b>Chosen for you</b>
                    {(spec.fixedDimMm !== null || spec.plateThicknessMm !== null) && (
                      <button className="fs-chosen-reset" onClick={() => patchSpec({ fixedDimMm: null, plateThicknessMm: null })}>
                        Reset to recommended
                      </button>
                    )}
                  </header>
                  <dl>
                    <div>
                      <dt>{isCut ? "Arm stock" : "Arm width"}</dt>
                      {/* For a printed arm the solver may widen past its
                          starting width, so show what was built, not what
                          went in. */}
                      <dd>{n1(isCut ? design.stock.armDimMm : design.section.widthMm)} mm</dd>
                    </div>
                    <div>
                      <dt>Bottom plate</dt>
                      <dd>{n1(design.stock.bottomPlateMm)} mm</dd>
                    </div>
                    <div>
                      <dt>Top plate</dt>
                      <dd>{n1(design.stock.topPlateMm)} mm</dd>
                    </div>
                  </dl>
                  <p>
                    {isCut
                      ? `Production ${spec.propIn}" frames run arms around ${n1(design.stock.referenceArmMm)} mm against plates of 2–3 mm. The arm is a cantilever and wants thickness; the plates only clamp it.`
                      : design.section.hollow
                        ? `The arm is a hollow box ${n1(design.section.widthMm)} × ${n1(design.section.heightMm)} mm with ${n1(design.section.wallMm)} mm walls. Printed plates are thicker than carbon ones because the material is far less stiff.`
                        : `The arm is solid at ${n1(design.section.widthMm)} × ${n1(design.section.heightMm)} mm — too shallow for a cavity to be worth building. Printed plates are thicker than carbon ones because the material is far less stiff.`}
                  </p>
                </div>

                {isCut ? (
                  <label className="field">
                    <span>Arm stock thickness</span>
                    <select
                      className="select"
                      value={spec.fixedDimMm ?? "auto"}
                      onChange={(e) => setSpec("fixedDimMm", e.target.value === "auto" ? null : Number(e.target.value))}
                    >
                      <option value="auto">Recommended — {n1(design.stock.referenceArmMm)} mm</option>
                      {(material.stock ?? [2, 3, 4]).map((t) => (
                        <option key={t} value={t}>{t} mm</option>
                      ))}
                    </select>
                    <small>
                      Stiffness rises with the cube of thickness, so going one size thicker buys more than making the arm much
                      wider — and weighs less doing it.
                    </small>
                  </label>
                ) : (
                  <label className="field">
                    <span>Arm width</span>
                    <input
                      className="input"
                      type="number"
                      inputMode="decimal"
                      value={spec.fixedDimMm ?? ""}
                      placeholder={`Auto — ${n1(design.stock.referenceArmMm)} mm`}
                      min={5}
                      max={60}
                      onChange={(e) => {
                        // Empty means "let the studio choose"; anything that is
                        // not a usable width is ignored rather than stored as 0.
                        const text = e.target.value.trim();
                        if (text === "") return setSpec("fixedDimMm", null);
                        const v = Number(text);
                        if (Number.isFinite(v) && v > 0) setSpec("fixedDimMm", Math.min(60, Math.max(5, v)));
                      }}
                    />
                    <small>
                      Leave blank to let the studio choose. Width is the cheap dimension on a printed arm, so widening it is how
                      the studio keeps the section from growing deep and narrow.
                    </small>
                  </label>
                )}

                {isCut ? (
                  <label className="field">
                    <span>Plate stock thickness</span>
                    <select
                      className="select"
                      value={spec.plateThicknessMm ?? "auto"}
                      onChange={(e) => setSpec("plateThicknessMm", e.target.value === "auto" ? null : Number(e.target.value))}
                    >
                      <option value="auto">Recommended — {n1(design.stock.referenceBottomMm)} mm</option>
                      {(material.stock ?? [2, 3, 4]).map((t) => (
                        <option key={t} value={t}>{t} mm</option>
                      ))}
                    </select>
                    <small>Cut separately from the arms. Two sheets, two files.</small>
                  </label>
                ) : null}

                <label className="fs-check">
                  <input
                    type="checkbox"
                    checked={spec.lightenPlates}
                    onChange={(e) => setSpec("lightenPlates", e.target.checked)}
                  />
                  <span>
                    Lighten the plates
                    <small>
                      {design.lightening.count > 0
                        ? `Cuts ${design.lightening.count} opening${design.lightening.count === 1 ? "" : "s"} from the sectors between the arms, where no load path runs — ${n1(design.lightening.savedG)} g saved. Nothing is cut from an arm, which is the load path the solver sized.`
                        : "No cut-out would fit on these plates with safe material left around the bolts and slots, so none are drawn."}
                    </small>
                  </span>
                </label>

                {!isCut && (
                  <Num
                    label="Wall thickness"
                    value={spec.wallMm}
                    onChange={(v) => setSpec("wallMm", v)}
                    suffix="mm"
                    min={1.2}
                    max={6}
                    step={0.5}
                    hint="Wall of the hollow arm. 2–3 mm is the usual range."
                    more="In a hollow section the walls are the structure — they are what the stiffness was calculated from. Thinner than about 2 mm and a slicer stops being able to make them from whole perimeters, filling them with thin-wall gap fill instead, which is far weaker than the number here assumes."
                  />
                )}

                <Num
                  label="Safety factor"
                  value={spec.safetyFactor}
                  onChange={(v) => setSpec("safetyFactor", v)}
                  min={1}
                  max={6}
                  step={0.5}
                  hint="Margin over the material's published strength. 2 is normal."
                  more="Published strengths are measured on clean laboratory samples. A real part has cut edges, bolt holes, and a crash history, so the allowable stress is the published figure divided by this number. Go to 3 for a first build, an unfamiliar material, or anything you cannot easily replace."
                />
              </div>
            )}

            {step === "review" && (
              <div className="fs-fields">
                <Num
                  label="Wheelbase"
                  value={spec.wheelbaseMm ?? design.wheelbaseMm}
                  onChange={(v) => setSpec("wheelbaseMm", v)}
                  suffix="mm"
                  min={50}
                  max={900}
                  hint={
                    design.referenceBand
                      ? `Clearance needs at least ${design.minWheelbaseMm} mm. Production ${spec.propIn}" frames run ${design.referenceBand.min}–${design.referenceBand.max} mm.`
                      : `Clearance needs at least ${design.minWheelbaseMm} mm.`
                  }
                />
                {spec.wheelbaseMm !== null && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setSpec("wheelbaseMm", null)}>
                    Back to the recommended {design.recommendedWheelbaseMm} mm
                  </button>
                )}

                <div className="fs-review">
                  <h4>
                    {severity === "ok" && <><CheckCircle2 size={16} /> Nothing to fix</>}
                    {severity === "warn" && <><AlertTriangle size={16} /> {warns.length} thing{warns.length === 1 ? "" : "s"} to think about</>}
                    {severity === "error" && <><CircleAlert size={16} /> {errors.length} problem{errors.length === 1 ? "" : "s"} to fix</>}
                  </h4>
                  {findings.length === 0 ? (
                    <p className="fs-review-ok">
                      Every bolt sits in material with proper edge distance, the propellers clear each other, the arms are
                      within their stress and deflection limits, and the aircraft has the thrust to fly. Go and make it.
                    </p>
                  ) : (
                    <ul className="fs-findings">
                      {[...errors, ...warns].map((f) => <FindingRow key={f.id} f={f} />)}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {step === "export" && <ExportPanel design={design} findings={findings} />}

            <div className="fs-nav">
              <button className="btn btn-ghost" onClick={() => go(-1)} disabled={stepIndex === 0}>
                <ChevronLeft /> Back
              </button>
              <button className="btn btn-primary" onClick={() => go(1)} disabled={stepIndex === STEPS.length - 1}>
                Next <ChevronRight />
              </button>
            </div>
          </div>
        </section>

        {/* ----------------------------------------------------- preview */}
        <section className="panel fs-preview">
          <div className="panel-head">
            <div className="fs-seg fs-seg-sm">
              <button className={view === "plan" ? "is-on" : ""} onClick={() => setView("plan")}>
                <Ruler size={14} /> Plan
              </button>
              <button className={view === "solid" ? "is-on" : ""} onClick={() => setView("solid")}>
                <Box size={14} /> Solid
              </button>
              <button className={view === "sheet" ? "is-on" : ""} onClick={() => setView("sheet")}>
                <Grid3x3 size={14} /> {isCut ? "Sheet" : "Parts"}
              </button>
            </div>
            <div className="fs-toggles">
              {view === "plan" && (
                <>
                  <label className="fs-check">
                    <input type="checkbox" checked={showProps} onChange={(e) => setShowProps(e.target.checked)} />
                    <span>Props</span>
                  </label>
                  <label className="fs-check">
                    <input type="checkbox" checked={showDims} onChange={(e) => setShowDims(e.target.checked)} />
                    <span>Dimensions</span>
                  </label>
                  <label className="fs-check">
                    <input type="checkbox" checked={showSection} onChange={(e) => setShowSection(e.target.checked)} />
                    <span>Section</span>
                  </label>
                </>
              )}
              {view === "solid" && (
                <label className="fs-check">
                  <input type="checkbox" checked={exploded} onChange={(e) => setExploded(e.target.checked)} />
                  <span>Exploded</span>
                </label>
              )}
            </div>
          </div>

          <div className="fs-stage">
            {view === "plan" && <PlanView design={design} focus={focus} onFocus={setFocus} showProps={showProps} showDims={showDims} showSection={showSection} />}
            {view === "solid" && (
              <Suspense fallback={<div className="fs-loading"><Shapes /> Building the solid model…</div>}>
                <Frame3D design={design} exploded={exploded} />
                {/* Colour identifies the part; the material shows in the
                    finish. Without a key the palette is just decoration. */}
                <ul className="fs-legend">
                  {legend.map((e) => (
                    <li key={e.label}>
                      <i style={{ background: e.color }} aria-hidden="true" />
                      {e.label}
                      {e.qty > 1 && <b>×{e.qty}</b>}
                    </li>
                  ))}
                </ul>
              </Suspense>
            )}
            {view === "sheet" && <SheetView design={design} />}
          </div>

          <div className={`fs-verdict ${severity}`}>
            {severity === "ok" && <><CheckCircle2 size={15} /> Design checks out</>}
            {severity === "warn" && <><AlertTriangle size={15} /> {warns.length} warning{warns.length === 1 ? "" : "s"}</>}
            {severity === "error" && <><CircleAlert size={15} /> {errors.length} error{errors.length === 1 ? "" : "s"}</>}
            <button className="fs-verdict-go" onClick={() => setStep("review")}>Review</button>
          </div>
        </section>

        {/* ----------------------------------------------------- results */}
        <section className="panel fs-results">
          <div className="panel-head">
            <h3>Worked out</h3>
          </div>
          <div className="panel-body">
            <div className="fs-stats">
              <Stat label="Wheelbase" value={n1(design.wheelbaseMm)} unit="mm" />
              <Stat label="All-up weight" value={n1(design.mass.auwG)} unit="g" />
              <Stat
                label="Thrust : weight"
                value={design.thrustToWeight.toFixed(1)}
                unit=":1"
                tone={design.thrustToWeight < 2 ? "bad" : design.thrustToWeight < 3 ? "warn" : "good"}
              />
              <Stat label="Hover throttle" value={String(Math.round(design.hoverThrottle * 100))} unit="%" />
            </div>

            <h5 className="fs-sub">Made from</h5>
            <dl className="fs-dl">
              <div>
                <dt>Arm{isCut ? " stock" : " section"}</dt>
                <dd>
                  {isCut ? `${n1(design.stock.armDimMm)} mm` : `${n1(design.section.widthMm)} × ${n1(design.section.heightMm)} mm`}
                  {design.stock.escalated && <em className="fs-flag"> stepped up</em>}
                </dd>
              </div>
              <div>
                <dt>Plates</dt>
                <dd>{n1(design.stock.bottomPlateMm)} / {n1(design.stock.topPlateMm)} mm</dd>
              </div>
              {design.section.hollow && (
                <div>
                  <dt>Arm walls</dt>
                  <dd>{n1(design.stock.wallMm)} mm, hollow</dd>
                </div>
              )}
            </dl>

            <h5 className="fs-sub">How it balances</h5>
            <dl className="fs-dl">
              <div>
                <dt>Battery</dt>
                <dd>{spec.batteryMount === "top" ? "On top" : "Underneath"}</dd>
              </div>
              <div>
                <dt>Mass below the discs</dt>
                <dd>{n1(design.cg.belowThrustMm)} mm</dd>
              </div>
              {design.lightening.count > 0 && (
                <div>
                  <dt>Lightening</dt>
                  <dd>{design.lightening.count} cut-outs, −{n1(design.lightening.savedG)} g</dd>
                </div>
              )}
              {design.stackClearance.openingMm > 0 && (
                <div>
                  <dt>Stack opening</dt>
                  <dd>{n1(design.stackClearance.openingMm)} mm square</dd>
                </div>
              )}
            </dl>

            <h5 className="fs-sub">The arm</h5>
            <dl className="fs-dl">
              <div>
                <dt>Section</dt>
                <dd>
                  {n1(design.section.widthMm)} × {n1(design.section.heightMm)} mm
                  {design.section.hollow ? " box" : ""}
                </dd>
              </div>
              <div>
                <dt>Exposed length</dt>
                <dd>{n1(design.armLengthMm)} mm</dd>
              </div>
              <div>
                <dt>Flex at full thrust</dt>
                <dd>{design.section.deflectionMm} mm</dd>
              </div>
              <div>
                <dt>Peak stress</dt>
                <dd>{design.section.stressMPa} of {design.section.allowableMPa} MPa</dd>
              </div>
            </dl>

            {/* The governing case is the most useful thing on this page: it says
                which physical limit actually decided the size. */}
            <div className="fs-governing">
              <span>Sized by</span>
              <b>
                {design.section.governing === "thrust" && "motor thrust"}
                {design.section.governing === "impact" && "crash loads"}
                {design.section.governing === "stiffness" && "stiffness"}
                {design.section.governing === "geometry" && "bolt clearance"}
              </b>
              <p>
                {design.section.governing === "stiffness" &&
                  "Strength was never the limit — keeping the arm from flexing is. A flexible arm reads as vibration to the flight controller and makes tuning hard."}
                {design.section.governing === "geometry" &&
                  "Neither load nor stiffness decided this. The arm is as narrow as it can be and still fit its own bolts with safe edge distance."}
                {design.section.governing === "impact" &&
                  "A hard landing, not hovering, is what sizes this arm. Static thrust needs a fraction of the material."}
                {design.section.governing === "thrust" &&
                  "Unusually, steady thrust is the limiting case here. Check the thrust figure you entered."}
              </p>
            </div>

            <h5 className="fs-sub">Where the weight goes</h5>
            <ul className="fs-mass">
              {[
                ["Frame", design.mass.frameG],
                ["Motors", design.mass.motorsG],
                ["Battery", design.mass.batteryG],
                ["Electronics", design.mass.electronicsG],
                ["Hardware", design.mass.hardwareG],
              ].map(([label, g]) => (
                <li key={label as string}>
                  <span>{label}</span>
                  <div className="fs-mass-bar">
                    <i style={{ width: `${((g as number) / design.mass.auwG) * 100}%` }} />
                  </div>
                  <b>{n1(g as number)} g</b>
                </li>
              ))}
            </ul>

            <h5 className="fs-sub">Parts</h5>
            <ul className="fs-parts">
              {design.profiles.map((p) => (
                <li
                  key={p.id}
                  className={focus === p.id ? "is-on" : ""}
                  onMouseEnter={() => setFocus(p.id)}
                  onMouseLeave={() => setFocus(null)}
                >
                  <b>{p.qty}×</b>
                  <span>{p.name}</span>
                  <i>{n1(p.thicknessMm)} mm</i>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
