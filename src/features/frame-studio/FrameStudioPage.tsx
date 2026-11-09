import { AlertTriangle, Box, CheckCircle2, ChevronLeft, ChevronRight, CircleAlert, Grid3x3, RotateCcw, Ruler, Shapes } from "lucide-react";
import { lazy, Suspense, useMemo, useState } from "react";
import { FLYING_STYLES, MATERIALS, MOTORS, PROP_SIZES, STACK_PATTERNS, materialById, motorById } from "./catalog";
import { ExportPanel } from "./components/ExportPanel";
import { PlanView } from "./components/PlanView";
import { SheetView } from "./components/SheetView";
import { CONSTRUCTIONS, LAYOUTS, designFrame, type Layout } from "./geometry";
import { LAYOUT_HINT, STEPS, defaultFixedDim, useStudio } from "./store";
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
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  min?: number;
  max?: number;
  step?: number;
  hint?: string;
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
    </label>
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
                      <option key={p} value={p}>{p}" propellers</option>
                    ))}
                  </select>
                  <small>The single biggest decision — it sets how large the whole aircraft has to be.</small>
                </label>

                <div className="field">
                  <span>Layout</span>
                  <div className="fs-choices">
                    {LAYOUTS.map((l) => (
                      <button
                        key={l.id}
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
                  <span>How will you fly it?</span>
                  <div className="fs-choices">
                    {FLYING_STYLES.map((f) => (
                      <button
                        key={f.id}
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
                  <span>How it goes together</span>
                  <div className="fs-choices">
                    {CONSTRUCTIONS.map((c) => (
                      <button
                        key={c.id}
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
                />
              </div>
            )}

            {step === "components" && (
              <div className="fs-fields">
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
                  hint="From your motor's own thrust table, at your cell count and prop. The default is typical for the size — replace it with yours."
                />

                <label className="field">
                  <span>Flight controller stack</span>
                  <select
                    className="select"
                    value={spec.stackPattern}
                    onChange={(e) => {
                      const p = STACK_PATTERNS.find((x) => x.pattern === Number(e.target.value))!;
                      patchSpec({ stackPattern: p.pattern, stackBolt: p.bolt });
                    }}
                  >
                    {STACK_PATTERNS.map((p) => (
                      <option key={p.id} value={p.pattern}>{p.label}</option>
                    ))}
                  </select>
                </label>

                <div className="fs-row3">
                  <Num label="Battery length" value={spec.battery.l} onChange={(v) => setSpec("battery", { ...spec.battery, l: v })} suffix="mm" min={20} />
                  <Num label="Width" value={spec.battery.w} onChange={(v) => setSpec("battery", { ...spec.battery, w: v })} suffix="mm" min={10} />
                  <Num label="Height" value={spec.battery.h} onChange={(v) => setSpec("battery", { ...spec.battery, h: v })} suffix="mm" min={5} />
                </div>

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
                ) : (
                  <Num
                    label="Wall thickness"
                    value={spec.wallMm}
                    onChange={(v) => setSpec("wallMm", v)}
                    suffix="mm"
                    min={1.2}
                    max={6}
                    step={0.5}
                    hint="Wall of the hollow arm. 2–3 mm is the usual range — thinner and the walls stop being whole perimeters."
                  />
                )}

                <Num
                  label="Safety factor"
                  value={spec.safetyFactor}
                  onChange={(v) => setSpec("safetyFactor", v)}
                  min={1}
                  max={6}
                  step={0.5}
                  hint="How much margin over the material's published strength. 2 is normal; go to 3 for a first build or an unfamiliar material."
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
