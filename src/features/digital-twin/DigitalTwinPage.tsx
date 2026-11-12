import { Box, ChevronDown, ChevronUp, FileUp, Gamepad2, Info, Radio, RotateCcw, RotateCw, Scan, TriangleAlert, Upload, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hasWebGL2 } from "../../services/capabilities";
import { ACCEPT, FORMAT_LABEL, formatOf } from "../../services/import/modelImport";
import { AXIS_DIRS, AXIS_LABEL, axesParallel, rotateOrientation, type AxisDir } from "../../services/import/orient";
import { isLinkLive, useLink } from "../../state/linkStore";
import { useNow } from "../../hooks/useNow";
import { RAD } from "../../utils/format";
import { clearModel, importForProfile, rehydrateModel, useModel } from "../../state/modelStore";
import { confirmAction, notify } from "../../state/notifyStore";
import { useActiveProfile, useProfiles } from "../../state/profileStore";
import { useSettings } from "../../state/settingsStore";
import type { ModelDescriptor } from "../../vehicle/types";
import { FlightHud } from "./FlightHud";
import { useKeys } from "./useKeys";
import type { TwinMode } from "./TwinScene";

const TwinScene = lazy(() => import("./TwinScene"));

function Dropzone({ onFile, disabled }: { onFile: (f: File) => void; disabled: boolean }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div
      className={`dropzone${over ? " over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const f = e.dataTransfer.files[0];
        if (f) onFile(f);
      }}
    >
      <Upload />
      <h3>Drop your drone model here</h3>
      <p>STEP or STP from your CAD tool, or GLB, glTF, OBJ or STL. The file is read in your browser and never uploaded.</p>
      <button className="btn btn-primary" disabled={disabled} onClick={() => inputRef.current?.click()}>
        <FileUp /> Choose file
      </button>
      <input ref={inputRef} type="file" accept={ACCEPT} hidden onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
      <small>STEP files are converted to a mesh with OpenCascade (WebAssembly) on first use — a one-time ~2 MB download.</small>
    </div>
  );
}

function Progress() {
  const progress = useModel((s) => s.progress);
  const status = useModel((s) => s.status);
  if (status !== "importing") return null;
  return (
    <div className="import-progress">
      <div className="spinner" />
      <strong>{progress?.label ?? "Working"}…</strong>
      {progress?.phase === "tessellate" && <span>Converting CAD surfaces to triangles. Large assemblies can take a few seconds.</span>}
      {progress?.phase === "kernel" && <span>Loading the CAD kernel (first STEP import only).</span>}
    </div>
  );
}

function AxisSelect({ label, value, onChange, exclude }: { label: string; value: AxisDir; onChange: (a: AxisDir) => void; exclude: AxisDir }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select className="select" value={value} onChange={(e) => onChange(e.target.value as AxisDir)}>
        {AXIS_DIRS.map((a) => (
          <option key={a} value={a} disabled={axesParallel(a, exclude)}>
            {AXIS_LABEL[a]}
          </option>
        ))}
      </select>
    </label>
  );
}

function OrientationPanel({ profileId, model }: { profileId: string; model: Extract<ModelDescriptor, { source: "imported" }> }) {
  const update = useProfiles((s) => s.update);
  const patch = (p: Partial<typeof model>) => update(profileId, { model: { ...model, ...p } });
  const set = (k: "forward" | "up", a: AxisDir) => {
    const next = { ...model, [k]: a };
    if (axesParallel(next.forward, next.up)) return; // guard: nose and up can't share an axis
    patch({ [k]: a });
  };
  const [lx, ly, lz] = model.size;
  const longest = Math.max(lx, ly, lz);
  return (
    <section className="panel">
      <div className="panel-head">
        <h3>Orientation &amp; scale</h3>
        <button
          className="btn btn-ghost"
          style={{ height: 30 }}
          onClick={() => patch({ forward: "-z", up: "+y", scalePercent: 100 })}
          title="Reset to the app convention"
        >
          <RotateCcw size={14} /> Reset
        </button>
      </div>
      <div className="panel-body" style={{ display: "grid", gap: "var(--s4)" }}>
        <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
          Rotate the model until the <strong style={{ color: "var(--accent)" }}>Forward</strong> arrow points out the nose and{" "}
          <strong style={{ color: "var(--ok)" }}>Up</strong> points up. This is a visual correction only — it never changes autopilot parameters.
        </p>
        <div className="rotate-grid">
          <span>Turn</span>
          <button className="btn btn-icon" title="Turn left" onClick={() => patch(rotateOrientation(model.forward, model.up, "y", 90))}>
            <RotateCcw />
          </button>
          <button className="btn btn-icon" title="Turn right" onClick={() => patch(rotateOrientation(model.forward, model.up, "y", -90))}>
            <RotateCw />
          </button>
          <span>Tilt</span>
          <button className="btn btn-icon" title="Tilt nose up" onClick={() => patch(rotateOrientation(model.forward, model.up, "x", -90))}>
            <ChevronUp />
          </button>
          <button className="btn btn-icon" title="Tilt nose down" onClick={() => patch(rotateOrientation(model.forward, model.up, "x", 90))}>
            <ChevronDown />
          </button>
          <span>Roll</span>
          <button className="btn btn-icon" title="Roll left" onClick={() => patch(rotateOrientation(model.forward, model.up, "z", 90))}>
            <RotateCcw />
          </button>
          <button className="btn btn-icon" title="Roll right" onClick={() => patch(rotateOrientation(model.forward, model.up, "z", -90))}>
            <RotateCw />
          </button>
        </div>
        <details>
          <summary className="muted" style={{ fontSize: "var(--t-xs)", cursor: "pointer" }}>Set axes directly</summary>
          <div className="row2" style={{ marginTop: "var(--s3)" }}>
            <AxisSelect label="Nose points along" value={model.forward} onChange={(a) => set("forward", a)} exclude={model.up} />
            <AxisSelect label="Top points along" value={model.up} onChange={(a) => set("up", a)} exclude={model.forward} />
          </div>
        </details>
        <label className="field">
          <span>Display scale · {model.scalePercent}%</span>
          <input type="range" min={20} max={300} step={5} value={model.scalePercent} onChange={(e) => patch({ scalePercent: Number(e.target.value) })} />
          <small>Visual size in the viewport. The model is auto-fitted first; this nudges it.</small>
        </label>
        <dl className="readouts" style={{ margin: 0 }}>
          <div className="readout">
            <dt>Bounding size (model units)</dt>
            <dd style={{ fontSize: "var(--t-base)" }}>
              {lx.toFixed(1)} × {ly.toFixed(1)} × {lz.toFixed(1)}
            </dd>
          </div>
          <div className="readout">
            <dt>Longest side</dt>
            <dd>
              {longest.toFixed(1)}
              <small>units</small>
            </dd>
          </div>
        </dl>
      </div>
    </section>
  );
}

const MODES: { id: TwinMode; label: string; icon: typeof Scan; needsLink?: boolean }[] = [
  { id: "inspect", label: "Inspect", icon: Scan },
  { id: "scripted", label: "Scripted flight", icon: Box },
  { id: "manual", label: "Manual flight", icon: Gamepad2 },
  { id: "live", label: "Live (Pixhawk)", icon: Radio, needsLink: true },
];

export function DigitalTwinPage() {
  const profile = useActiveProfile();
  const graphics = useSettings((s) => s.graphics);
  const webgl = useMemo(() => hasWebGL2(), []);
  const status = useModel((s) => s.status);
  const object = useModel((s) => s.object);
  const result = useModel((s) => s.result);
  const error = useModel((s) => s.error);
  const linkLive = useLink((s) => isLinkLive(s.status));
  const [requestedMode, setMode] = useState<TwinMode>("inspect");
  // Fall back to Inspect if Live is selected but the vehicle link isn't live.
  const mode: TwinMode = requestedMode === "live" && !linkLive ? "inspect" : requestedMode;
  const keys = useKeys(mode === "manual");

  const model = profile?.model;
  const imported = model?.source === "imported" ? model : null;

  // Keep the live model in sync with the active profile.
  useEffect(() => {
    if (profile) void rehydrateModel(profile.id, profile.model);
  }, [profile?.id, profile?.model.source]); // eslint-disable-line react-hooks/exhaustive-deps

  const onFile = useCallback(
    (f: File) => {
      if (!profile) return;
      if (!formatOf(f.name)) {
        notify("error", "Unsupported file", "Use STEP, STP, GLB, glTF, OBJ or STL.");
        return;
      }
      void importForProfile(f, profile.id);
    },
    [profile],
  );

  if (!profile) {
    return (
      <div className="page-pad">
        <div className="empty">
          <Box />
          <h3>No aircraft profile</h3>
          <p>Create a profile first — the model is saved with it.</p>
        </div>
      </div>
    );
  }

  const forward = imported?.forward ?? "-z";
  const up = imported?.up ?? "+y";
  const scalePercent = imported?.scalePercent ?? 100;
  const showViewer = webgl && (imported || status === "importing" || !imported); // default quad is always viewable

  return (
    <div className="page-pad">
      <header className="page-head">
        <div>
          <h1>Digital Twin</h1>
          <p>Import the real assembly of {profile.name}, set which way is forward and up, then fly it — scripted or by hand — to check it loads and reads correctly.</p>
        </div>
        <div className="actions">
          {imported && (
            <>
              <span className="pill accent plain">{imported.filename}</span>
              <button
                className="btn btn-danger"
                onClick={async () => {
                  const ok = await confirmAction({
                    title: "Remove this model?",
                    body: `${imported.filename} will be removed from ${profile.name} and the default quadcopter used again.`,
                    confirmLabel: "Remove model",
                    tone: "danger",
                  });
                  if (ok) {
                    await clearModel(profile.id);
                    notify("info", "Model removed", "Back to the default quadcopter.");
                  }
                }}
              >
                <X /> Remove
              </button>
            </>
          )}
        </div>
      </header>

      {!webgl ? (
        <section className="panel">
          <div className="empty">
            <Box />
            <h3>WebGL 2 isn&rsquo;t available</h3>
            <p>The 3D viewport needs WebGL 2. Everything else in the app still works.</p>
          </div>
        </section>
      ) : (
        <div className="twin-layout">
          <div className="stack">
            <section className="panel" style={{ overflow: "hidden" }}>
              <div className="twin-toolbar">
                <div className="segmented">
                  {MODES.map((m) => {
                    const locked = m.needsLink && !linkLive;
                    return (
                      <button
                        key={m.id}
                        aria-pressed={mode === m.id}
                        disabled={locked}
                        title={locked ? "Connect aircraft to mirror its live attitude" : undefined}
                        onClick={() => setMode(m.id)}
                      >
                        <m.icon /> {m.label}
                      </button>
                    );
                  })}
                </div>
                <span className="pill virtual plain">{imported ? "Your model" : "Default quadcopter"}</span>
              </div>
              <div className="twin-viewport">
                {showViewer && (
                  <Suspense fallback={null}>
                    <TwinScene mode={mode} object={object} forward={forward} up={up} scalePercent={scalePercent} graphics={graphics} keys={keys} />
                  </Suspense>
                )}
                <Progress />
                {mode !== "inspect" && mode !== "live" && <FlightHud active />}
                {mode === "manual" && (
                  <div className="key-help">
                    <KeyRow keys={["W", "S"]} label="Pitch" />
                    <KeyRow keys={["A", "D"]} label="Roll" />
                    <KeyRow keys={["Q", "E"]} label="Yaw" />
                    <KeyRow keys={["Shift", "Ctrl"]} label="Up / Down" />
                  </div>
                )}
                <div className="twin-vignette" aria-hidden />
                {mode === "live" && <TwinLiveReadout />}
                <div className="twin-caption">
                  {mode === "inspect"
                    ? "Drag to orbit · scroll to zoom"
                    : mode === "scripted"
                      ? "Scripted preview flight — not a physics model"
                      : mode === "live"
                        ? "Mirroring the Pixhawk's live attitude and vertical motion · drag to orbit"
                        : "Kinematic manual control — not a physics model. Click the viewport, then use the keys."}
                </div>
              </div>
            </section>

            {error && (
              <div className="callout danger">
                <TriangleAlert />
                <div>
                  <strong>Import failed.</strong> {error}
                </div>
              </div>
            )}

            {imported && (
              <section className="panel">
                <div className="panel-head">
                  <h3>Imported model</h3>
                  <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
                    {FORMAT_LABEL[imported.format]}
                  </span>
                </div>
                <dl className="readouts" style={{ margin: 0, borderRadius: 0 }}>
                  <div className="readout">
                    <dt>Parts</dt>
                    <dd>{(result?.parts ?? imported.parts).toLocaleString()}</dd>
                  </div>
                  <div className="readout">
                    <dt>Triangles</dt>
                    <dd>{(result?.triangles ?? imported.triangles).toLocaleString()}</dd>
                  </div>
                  <div className="readout">
                    <dt>Saved with</dt>
                    <dd style={{ fontSize: "var(--t-base)" }}>{profile.name}</dd>
                  </div>
                </dl>
                {result?.warnings.map((w) => (
                  <div className="callout" key={w} style={{ margin: "var(--s4)" }}>
                    <Info />
                    <span>{w}</span>
                  </div>
                ))}
              </section>
            )}
          </div>

          <div className="stack">
            {imported ? (
              <OrientationPanel profileId={profile.id} model={imported} />
            ) : (
              <section className="panel" style={{ padding: 0 }}>
                <Dropzone onFile={onFile} disabled={status === "importing"} />
              </section>
            )}
            {imported && (
              <section className="panel" style={{ padding: 0 }}>
                <Dropzone onFile={onFile} disabled={status === "importing"} />
              </section>
            )}
            <section className="panel">
              <div className="panel-head">
                <h3>How to test it</h3>
              </div>
              <ol className="test-steps">
                <li>
                  <strong>Loads &amp; looks right</strong> — import, then in <em>Inspect</em> check the geometry, parts and proportions. Use the nose/up controls until the arrows match your real airframe.
                </li>
                <li>
                  <strong>Reads in motion</strong> — switch to <em>Scripted flight</em>: the model banks through a figure-eight so you can confirm orientation holds while moving.
                </li>
                <li>
                  <strong>Responds</strong> — <em>Manual flight</em>: fly it with the keyboard to feel how it sits and turns.
                </li>
              </ol>
              <div className="callout info" style={{ margin: "0 var(--s5) var(--s5)" }}>
                <Info />
                <span>The flight here is a visual preview, not a validated physics simulation. True 6-DOF dynamics from your mass and frame size are planned for the full simulator.</span>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}

function TwinLiveReadout() {
  const att = useLink((s) => s.telemetry.attitude);
  const hud = useLink((s) => s.telemetry.hud);
  const posAlt = useLink((s) => s.telemetry.position?.value.relAlt);
  const now = useNow(200);
  const stale = !att || now - att.at > 3000;
  const r = att ? att.value.roll * RAD : 0;
  const p = att ? att.value.pitch * RAD : 0;
  const y = att ? (((att.value.yaw * RAD) % 360) + 360) % 360 : 0;
  const climb = hud?.value.climb ?? 0;
  const alt = posAlt ?? hud?.value.alt ?? null;
  return (
    <div className={`twin-hud${stale ? " stale" : ""}`}>
      <div className="twin-hud-title">Live · Pixhawk</div>
      <div className="twin-hud-row"><span>Roll</span><strong>{att ? `${r.toFixed(1)}°` : "—"}</strong></div>
      <div className="twin-hud-row"><span>Pitch</span><strong>{att ? `${p.toFixed(1)}°` : "—"}</strong></div>
      <div className="twin-hud-row"><span>Yaw</span><strong>{att ? `${y.toFixed(0)}°` : "—"}</strong></div>
      <div className="twin-hud-row"><span>Alt</span><strong>{alt != null ? `${alt.toFixed(2)} m` : "—"}</strong></div>
      <div className="twin-hud-row"><span>V/S</span><strong>{hud ? `${climb >= 0 ? "+" : ""}${climb.toFixed(1)}` : "—"}</strong></div>
    </div>
  );
}

function KeyRow({ keys, label }: { keys: string[]; label: string }) {
  return (
    <div className="key-row">
      <span>
        {keys.map((k) => (
          <span className="key" key={k}>
            {k}
          </span>
        ))}
      </span>
      <span className="muted">{label}</span>
    </div>
  );
}
