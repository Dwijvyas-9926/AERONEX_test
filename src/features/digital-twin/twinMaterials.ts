import * as THREE from "three";

/*
  Exact material scheme from the Avion digital-twin simulator, so an imported
  model renders identically in Digital Twin Studio and in the simulator. Parts
  are matched by the prefix of their name (e.g. "motor_12" -> "motor"); anything
  unrecognised falls back to "plate". This mirrors the twin's onModel() exactly.
*/

export interface CatEntry {
  label: string;
  color: string | null; // null => keep the mesh's own vertex colours
  desc: string;
  mat: Record<string, number>;
}

export const CAT: Record<string, CatEntry> = {
  tube: { label: "Carbon-fibre tubes", color: "#1c1b22", desc: "Square and 8 mm round carbon-fibre tubes: lateral rails, straight and cross members, and the landing-leg tubes.", mat: { roughness: 0.32, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.25 } },
  node: { label: "Printed joint nodes", color: "#2C9C93", desc: "Custom 3D-printed T-mounts and L-mounts that join the carbon tubes.", mat: { roughness: 0.55 } },
  plate: { label: "Bottom plate", color: "#EDE9F2", desc: "Printed bottom plate that ties the centre frame together and carries the payload release.", mat: { roughness: 0.6 } },
  rail: { label: "Rail plates", color: "#EDE9F2", desc: "Front and rear rail plates that carry the camera mount and GPS mast.", mat: { roughness: 0.6 } },
  pod: { label: "Avionics pod", color: "#2C9C93", desc: 'Printed pod that shields the flight stack. The pod reads "TEAM AVION".', mat: { roughness: 0.5 } },
  avionics: { label: "Avionics tray", color: null, desc: "Tray holding the Pixhawk 2.4.8 flight controller and the Raspberry Pi 4 companion computer.", mat: { roughness: 0.5, metalness: 0.2 } },
  camera: { label: "Depth camera", color: null, desc: "Intel RealSense D455 on a printed clamp mount, angled to see the drop zone.", mat: { roughness: 0.45, metalness: 0.3 } },
  gps: { label: "GPS mast", color: "#F1C84B", desc: "GPS/GNSS module on a printed mast mount, raised clear of the power wiring.", mat: { roughness: 0.5 } },
  motor: { label: "Motors", color: "#26252c", desc: "Four 5010 750 KV brushless outrunner motors.", mat: { roughness: 0.28, metalness: 0.85 } },
  prop: { label: "Propellers", color: "#111014", desc: "Four 10-inch propellers in counter-rotating pairs.", mat: { roughness: 0.4, metalness: 0.1 } },
  guard: { label: "Prop guards", color: "#F4F1F7", desc: "Printed guard ring, collar and posts at each corner.", mat: { roughness: 0.55 } },
  foot: { label: "Landing feet", color: "#F1C84B", desc: "Printed landing feet at the end of each leg tube.", mat: { roughness: 0.6 } },
};

export const categoryOf = (name: string): string => {
  const prefix = (name || "").split("_")[0];
  return prefix in CAT ? prefix : "plate";
};

/** Apply the twin material scheme to every mesh, by part name. */
export function applyTwinMaterials(root: THREE.Object3D, env: THREE.Texture | null) {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const cat = CAT[categoryOf(mesh.name || mesh.parent?.name || "")];
    const opts: Record<string, unknown> = { ...cat.mat };
    if (cat.color) opts.color = new THREE.Color(cat.color);
    else opts.vertexColors = true;
    if (env) {
      opts.envMap = env;
      opts.envMapIntensity = 0.9;
    }
    const mat = new THREE.MeshPhysicalMaterial(opts);
    mesh.material = mat;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (!mesh.geometry.getAttribute("normal")) mesh.geometry.computeVertexNormals();
  });
}
