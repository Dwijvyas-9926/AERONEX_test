import { useCallback, useEffect, useRef } from "react";
import { exportSimParts, rehydrateModel, useModel } from "../../state/modelStore";
import { useActiveProfile } from "../../state/profileStore";

/*
  The Flight Simulator hosts the Avion digital twin exactly as authored (its own
  3D world, relief-mission logic, telemetry, inspector and cameras), loaded in an
  isolated frame. The app supplies the model to fly: when a model is imported in
  Digital Twin Studio it is exported to GLB and handed to the twin as a blob URL
  in the frame's query string; otherwise the twin falls back to its built-in
  Avion. The only edits to the original file were vendoring its three.js and
  reading that model parameter — no sim logic or visuals were changed.
*/
const SIM_URL = `${import.meta.env.BASE_URL}avion-simulator.html`;

export function SimulatorPage() {
  const profile = useActiveProfile();
  const object = useModel((s) => s.object);
  const status = useModel((s) => s.status);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const imported = profile?.model.source === "imported" ? profile.model : null;

  // Load the active profile's imported model so it's ready to hand over.
  useEffect(() => {
    if (profile) void rehydrateModel(profile.id, profile.model);
  }, [profile?.id, profile?.model.source]); // eslint-disable-line react-hooks/exhaustive-deps

  // The twin asks for its model once its own scripts are up ('avion:ready');
  // we answer with the imported geometry (or null -> built-in). Responding only
  // after readiness keeps the heavy export off the frame's init path.
  const sendModel = useCallback(() => {
    const win = iframeRef.current?.contentWindow;
    if (!win) return;
    const parts = exportSimParts();
    win.postMessage({ type: "avion:model", parts: parts ?? null }, "*");
  }, []);

  useEffect(() => {
    const onMsg = (ev: MessageEvent) => {
      if ((ev.data as { type?: string })?.type === "avion:ready") sendModel();
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, [sendModel]);

  // Reload the frame when the model OR its orientation/scale changes, so the
  // twin re-bakes the geometry (exportSimParts reads the current orientation).
  const frameKey = object
    ? `${object.uuid}:${imported?.forward ?? "-z"}:${imported?.up ?? "+y"}:${imported?.scalePercent ?? 100}`
    : "builtin";

  return (
    <div className="sim-page">
      {status === "importing" ? (
        <div className="sim-stage" style={{ display: "grid", placeItems: "center" }}>
          <div className="import-progress" style={{ position: "static", background: "transparent" }}>
            <div className="spinner" />
            <strong>Preparing your model…</strong>
          </div>
        </div>
      ) : (
        <iframe key={frameKey} ref={iframeRef} className="sim-frame" src={SIM_URL} title="Avion flight simulator" allow="fullscreen; gamepad; accelerometer" />
      )}
    </div>
  );
}
