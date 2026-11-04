import * as THREE from "three";
import { create } from "zustand";
import { importModel, type ImportResult, type ProgressStep } from "../services/import/modelImport";
import { deleteModel, getModel, idbAvailable, putModel } from "../services/import/modelDB";
import { orientationQuat, type AxisDir } from "../services/import/orient";
import { useProfiles } from "./profileStore";
import { notify } from "./notifyStore";
import type { ModelDescriptor } from "../vehicle/types";

/*
  Runtime store for the currently loaded 3D model. The live THREE object is not
  serialisable, so it lives here (session only); the small descriptor is stored
  on the vehicle profile and the raw bytes in IndexedDB, so the model reloads.
*/

export type ModelStatus = "idle" | "importing" | "ready" | "error";

interface ModelState {
  status: ModelStatus;
  profileId: string | null; // which profile the loaded object belongs to
  object: THREE.Group | null;
  result: Omit<ImportResult, "object"> | null;
  progress: ProgressStep | null;
  error: string | null;
}

export const useModel = create<ModelState>(() => ({
  status: "idle",
  profileId: null,
  object: null,
  result: null,
  progress: null,
  error: null,
}));

function disposeCurrent() {
  const obj = useModel.getState().object;
  obj?.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      m.geometry?.dispose();
      const mat = m.material;
      (Array.isArray(mat) ? mat : [mat]).forEach((x) => x?.dispose());
    }
  });
}

export async function importForProfile(file: File, profileId: string) {
  useModel.setState({ status: "importing", progress: { phase: "read", label: "Reading file" }, error: null });
  try {
    const res = await importModel(file, (p) => useModel.setState({ progress: p }));
    disposeCurrent();
    const { object, ...meta } = res;
    useModel.setState({ status: "ready", object, result: meta, profileId, progress: null, error: null });

    if (idbAvailable()) {
      try {
        await putModel(profileId, { bytes: await file.arrayBuffer(), filename: file.name });
      } catch {
        notify("warn", "Model not saved for next time", "It's loaded now, but your browser blocked storing it, so you'll re-import after a reload.");
      }
    }
    const descriptor: ModelDescriptor = {
      source: "imported",
      filename: file.name,
      format: res.format,
      parts: res.parts,
      triangles: res.triangles,
      size: [res.size.x, res.size.y, res.size.z],
      forward: "-z",
      up: "+y",
      scalePercent: 100,
    };
    useProfiles.getState().update(profileId, { model: descriptor });
    notify("success", "Model imported", `${res.parts} part${res.parts === 1 ? "" : "s"}, ${res.triangles.toLocaleString()} triangles.`);
  } catch (e) {
    useModel.setState({ status: "error", progress: null, error: (e as Error).message });
  }
}

export async function clearModel(profileId: string) {
  disposeCurrent();
  useModel.setState({ status: "idle", object: null, result: null, error: null, profileId: null });
  if (idbAvailable()) await deleteModel(profileId).catch(() => {});
  useProfiles.getState().update(profileId, { model: { source: "default" } });
}

/** Reload a profile's imported model from IndexedDB (e.g. after a page reload or profile switch). */
export async function rehydrateModel(profileId: string, descriptor: ModelDescriptor) {
  if (descriptor.source !== "imported") {
    disposeCurrent();
    useModel.setState({ status: "idle", object: null, result: null, error: null, profileId: null });
    return;
  }
  if (useModel.getState().profileId === profileId && useModel.getState().status === "ready") return;
  if (!idbAvailable()) {
    useModel.setState({ status: "error", error: "This browser can't restore saved models. Re-import the file.", profileId });
    return;
  }
  useModel.setState({ status: "importing", progress: { phase: "read", label: "Restoring saved model" }, error: null });
  try {
    const stored = await getModel(profileId);
    if (!stored) {
      useModel.setState({ status: "error", error: "The saved model wasn't found. Re-import the file.", profileId });
      return;
    }
    const file = new File([stored.bytes], stored.filename);
    const res = await importModel(file, (p) => useModel.setState({ progress: p }));
    disposeCurrent();
    const { object, ...meta } = res;
    useModel.setState({ status: "ready", object, result: meta, profileId, progress: null, error: null });
  } catch (e) {
    useModel.setState({ status: "error", progress: null, error: (e as Error).message, profileId });
  }
}

/*
  Hands the imported model to the simulator as raw geometry arrays, with the
  user's orientation baked in and scaled to the airframe's real span (~0.69 m).
  The twin rebuilds the meshes with its own three.js and re-materialises by part
  name — so there's no GLTF round-trip or version-coupling between app and twin.
*/
const SIM_SPAN_M = 0.69;

export interface SimPart {
  name: string;
  position: Float32Array;
  normal: Float32Array | null;
  index: Uint32Array | null;
}

export function exportSimParts(): SimPart[] | null {
  const raw = useModel.getState().object;
  if (!raw) return null;
  const prof = useProfiles.getState();
  const active = prof.profiles.find((p) => p.id === prof.activeId);
  const desc = active?.model;
  const forward: AxisDir = desc && desc.source === "imported" ? desc.forward : "-z";
  const up: AxisDir = desc && desc.source === "imported" ? desc.up : "+y";

  const q = orientationQuat(forward, up);
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);

  // Measure every mesh relative to `raw`'s OWN frame, not its world frame. The
  // same object is shown in Digital Twin, where it gets reparented under a fit
  // wrapper that carries an orientation + scale; reading matrixWorld here would
  // bake that transform in a second time and the model would land rotated/scaled
  // wrongly in the sim. Using inverse(raw.matrixWorld) cancels any parent/own
  // transform, so the export depends only on the geometry and our orientation.
  raw.updateMatrixWorld(true);
  const rawInv = new THREE.Matrix4().copy(raw.matrixWorld).invert();
  const local = new THREE.Matrix4();
  const toOriented = new THREE.Matrix4();

  // Pass 1: orient each mesh into the body frame and measure the combined box.
  const oriented: { name: string; geom: THREE.BufferGeometry }[] = [];
  const box = new THREE.Box3();
  box.makeEmpty();
  raw.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    // mesh in raw's own frame, then rotated into the app body frame.
    local.multiplyMatrices(rawInv, mesh.matrixWorld);
    toOriented.multiplyMatrices(rot, local);
    const g = mesh.geometry.clone().applyMatrix4(toOriented);
    g.computeBoundingBox();
    if (g.boundingBox) box.union(g.boundingBox);
    oriented.push({ name: mesh.name || mesh.parent?.name || "plate", geom: g });
  });
  if (!oriented.length) return null;

  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const longest = Math.max(size.x, size.z) || 1;
  const scale = SIM_SPAN_M / longest;

  // Pass 2: drop onto the pad (min-Y = 0), centre in X/Z and scale to span.
  const place = new THREE.Matrix4()
    .makeTranslation(-center.x * scale, -box.min.y * scale, -center.z * scale)
    .multiply(new THREE.Matrix4().makeScale(scale, scale, scale));

  const parts: SimPart[] = [];
  for (const { name, geom } of oriented) {
    geom.applyMatrix4(place);
    const pos = geom.getAttribute("position");
    if (pos) {
      const norm = geom.getAttribute("normal");
      const idx = geom.getIndex();
      parts.push({
        name,
        position: new Float32Array(pos.array as ArrayLike<number>),
        normal: norm ? new Float32Array(norm.array as ArrayLike<number>) : null,
        index: idx ? Uint32Array.from(idx.array as ArrayLike<number>) : null,
      });
    }
    geom.dispose();
  }
  return parts.length ? parts : null;
}
