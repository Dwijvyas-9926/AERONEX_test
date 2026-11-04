import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { loadOcct, type OcctMesh } from "./occt";
import { repairProps, styleByName } from "./styleModel";

/*
  Unified drone-model importer.

  Mesh formats (GLB/glTF/OBJ/STL) are read by the matching three.js loader.
  STEP/STP is a CAD boundary-representation format that a browser cannot read
  directly, so it is tessellated to triangles by occt-import-js (OpenCascade in
  WebAssembly). Everything runs in the browser — the file never leaves the device.

  The returned group is in its own local space, un-reoriented and un-scaled; the
  Digital Twin stores a separate orientation/scale correction so the original is
  never mutated.
*/

export type ModelFormat = "glb" | "gltf" | "obj" | "stl" | "step";

export const ACCEPT = ".glb,.gltf,.obj,.stl,.step,.stp";
export const MAX_BYTES = 80 * 1024 * 1024; // 80 MB guard against runaway assemblies

export interface ImportedPart {
  name: string;
  mesh: THREE.Mesh;
}

export interface ImportResult {
  object: THREE.Group;
  format: ModelFormat;
  parts: number;
  triangles: number;
  /** Bounding-box size in the file's own units, before any scaling. */
  size: THREE.Vector3;
  warnings: string[];
}

export function formatOf(filename: string): ModelFormat | null {
  const ext = filename.toLowerCase().split(".").pop() ?? "";
  if (ext === "glb") return "glb";
  if (ext === "gltf") return "gltf";
  if (ext === "obj") return "obj";
  if (ext === "stl") return "stl";
  if (ext === "step" || ext === "stp") return "step";
  return null;
}

export const FORMAT_LABEL: Record<ModelFormat, string> = {
  glb: "glTF binary",
  gltf: "glTF",
  obj: "OBJ",
  stl: "STL",
  step: "STEP",
};

const DEFAULT_MAT = () => new THREE.MeshStandardMaterial({ color: "#c9cdd4", metalness: 0.15, roughness: 0.62 });

export interface ProgressStep {
  phase: "read" | "kernel" | "tessellate" | "build";
  label: string;
}

export async function importModel(file: File, onProgress?: (p: ProgressStep) => void): Promise<ImportResult> {
  const fmt = formatOf(file.name);
  if (!fmt) throw new ImportError(`${file.name} isn't a supported format. Use GLB, glTF, OBJ, STL or STEP.`);
  if (file.size > MAX_BYTES) throw new ImportError(`That file is ${(file.size / 1048576).toFixed(0)} MB, over the ${MAX_BYTES / 1048576} MB limit. Try exporting a lighter mesh.`);

  onProgress?.({ phase: "read", label: "Reading file" });
  const warnings: string[] = [];
  let object: THREE.Group;

  if (fmt === "step") {
    onProgress?.({ phase: "kernel", label: "Loading CAD kernel" });
    const occt = await loadOcct();
    const buf = new Uint8Array(await file.arrayBuffer());
    onProgress?.({ phase: "tessellate", label: "Converting CAD to mesh" });
    // occt is synchronous and CPU-heavy; yield first so the progress paint lands.
    await new Promise((r) => setTimeout(r, 16));
    const res = occt.ReadStepFile(buf, null);
    if (!res.success || res.meshes.length === 0) throw new ImportError("The STEP file couldn't be read. It may be corrupt or empty.");
    onProgress?.({ phase: "build", label: "Building model" });
    object = groupFromOcct(res.meshes);
  } else {
    const { object3d, hasMaterials } = await loadMesh(file, fmt, warnings);
    onProgress?.({ phase: "build", label: "Building model" });
    object = new THREE.Group();
    object.add(object3d);
    if (!hasMaterials) {
      // CAD/mesh export with no materials: colour parts by name so the airframe is legible.
      styleByName(object);
      object.updateMatrixWorld(true);
      repairProps(object);
      warnings.push("This model had no materials, so parts were coloured by name. Props that collapsed to the centre were moved onto the motors.");
    }
  }

  let parts = 0;
  let triangles = 0;
  object.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.isMesh && mesh.geometry) {
      parts++;
      const g = mesh.geometry as THREE.BufferGeometry;
      const idx = g.getIndex();
      triangles += (idx ? idx.count : g.getAttribute("position").count) / 3;
    }
  });
  if (parts === 0) throw new ImportError("No geometry was found in that file.");

  const box = new THREE.Box3().setFromObject(object);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (size.length() === 0 || !isFinite(size.length())) throw new ImportError("The model has no measurable size.");

  if (fmt === "stl") warnings.push("STL has no colours, parts or units. You'll set the scale and the model is shown as one piece.");
  if (fmt === "obj") warnings.push("OBJ was imported as geometry only (no separate .mtl). Parts may appear as one object.");

  return { object, format: fmt, parts, triangles: Math.round(triangles), size, warnings };
}

async function loadMesh(file: File, fmt: ModelFormat, warnings: string[]): Promise<{ object3d: THREE.Object3D; hasMaterials: boolean }> {
  if (fmt === "glb" || fmt === "gltf") {
    const buf = await file.arrayBuffer();
    const loader = new GLTFLoader();
    const gltf = await loader.parseAsync(buf, "");
    const hasMaterials = Array.isArray(gltf.parser.json.materials) && gltf.parser.json.materials.length > 0;
    return { object3d: gltf.scene, hasMaterials };
  }
  if (fmt === "obj") {
    const text = await file.text();
    const hasMaterials = /^usemtl\s+\S/m.test(text) && /^mtllib/m.test(text);
    return { object3d: new OBJLoader().parse(text), hasMaterials };
  }
  // STL — never carries materials
  const buf = await file.arrayBuffer();
  const geom = new STLLoader().parse(buf);
  geom.computeVertexNormals();
  if (!geom.getIndex() && geom.getAttribute("position").count > 300000) warnings.push("Large STL: this may be slower to display.");
  return { object3d: new THREE.Mesh(geom, DEFAULT_MAT()), hasMaterials: false };
}

function groupFromOcct(meshes: OcctMesh[]): THREE.Group {
  const group = new THREE.Group();
  for (const m of meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(new Float32Array(m.attributes.position.array), 3));
    if (m.attributes.normal) g.setAttribute("normal", new THREE.Float32BufferAttribute(new Float32Array(m.attributes.normal.array), 3));
    g.setIndex(new THREE.Uint32BufferAttribute(new Uint32Array(m.index.array), 1));
    if (!m.attributes.normal) g.computeVertexNormals();
    const mat = DEFAULT_MAT();
    if (m.color) mat.color.setRGB(m.color[0], m.color[1], m.color[2], THREE.SRGBColorSpace);
    const mesh = new THREE.Mesh(g, mat);
    mesh.name = m.name || "part";
    group.add(mesh);
  }
  return group;
}

export class ImportError extends Error {}
