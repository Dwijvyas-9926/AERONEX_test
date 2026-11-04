import * as THREE from "three";

/*
  Many CAD exports (trimesh STEP->GLB, STL, OBJ) arrive with no materials, so a
  viewer shows one flat grey blob and you can't read the airframe. When that
  happens we assign materials by part name, using the common names a multicopter
  export uses. This only runs when the file carried no materials of its own; a
  properly textured model is left untouched.
*/

interface Style {
  color: string;
  metalness?: number;
  roughness?: number;
}

const RULES: [RegExp, Style][] = [
  [/prop|blade|rotor/i, { color: "#0e0f13", roughness: 0.5, metalness: 0.1 }],
  [/motor|bell/i, { color: "#3b414b", roughness: 0.3, metalness: 0.85 }],
  [/guard|duct|ring/i, { color: "#d9d3c5", roughness: 0.55, metalness: 0.05 }],
  [/cam|lens|sensor|realsense/i, { color: "#0a0c10", roughness: 0.15, metalness: 0.7 }],
  [/gps|gnss|compass|antenna/i, { color: "#d8a648", roughness: 0.45, metalness: 0.3 }],
  [/avionic|pixhawk|fc|flight|pi|board|controller|electronic/i, { color: "#1b1d22", roughness: 0.5, metalness: 0.4 }],
  [/batt|lipo|power/i, { color: "#23242a", roughness: 0.6 }],
  [/arm|rail|tube|frame|boom|plate|spar/i, { color: "#202228", roughness: 0.45, metalness: 0.35 }],
  [/foot|leg|landing|skid/i, { color: "#2a2c33", roughness: 0.5, metalness: 0.25 }],
  [/payload|hook|release|servo/i, { color: "#4a4f58", roughness: 0.4, metalness: 0.6 }],
];

const DEFAULT: Style = { color: "#b7bcc5", roughness: 0.5, metalness: 0.45 };

function styleFor(name: string): Style {
  for (const [re, s] of RULES) if (re.test(name)) return s;
  return DEFAULT;
}

/** Colour every mesh by its (or its parent's) name. */
export function styleByName(root: THREE.Object3D) {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = m.name || m.parent?.name || "";
    const s = styleFor(name);
    const mat = new THREE.MeshStandardMaterial({ color: s.color, roughness: s.roughness ?? 0.5, metalness: s.metalness ?? 0.3 });
    m.material = mat;
    if (!m.geometry.getAttribute("normal")) m.geometry.computeVertexNormals();
  });
}

/*
  Repair for a known export quirk: propellers that collapsed onto the model
  centre while the motors sit out at the arms. If we find prop meshes clustered
  at the centre and a matching set of motor meshes at the perimeter, move each
  prop out onto a motor so the aircraft looks right in flight.
*/
export function repairProps(root: THREE.Object3D) {
  const props: THREE.Mesh[] = [];
  const motors: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const n = (m.name || m.parent?.name || "").toLowerCase();
    if (/prop|blade|rotor/.test(n)) props.push(m);
    else if (/motor|bell/.test(n)) motors.push(m);
  });
  if (props.length === 0 || motors.length !== props.length) return;

  const box = new THREE.Box3().setFromObject(root);
  const span = box.getSize(new THREE.Vector3()).length();
  const center = (m: THREE.Mesh) => {
    m.geometry.computeBoundingBox();
    return m.geometry.boundingBox!.getCenter(new THREE.Vector3()).applyMatrix4(m.matrixWorld);
  };
  root.updateMatrixWorld(true);
  const motorC = motors.map(center);
  const propC = props.map(center);
  const originXZ = new THREE.Vector2(box.getCenter(new THREE.Vector3()).x, box.getCenter(new THREE.Vector3()).z);

  // Only act if props really are clustered near the centre.
  const clustered = propC.every((p) => new THREE.Vector2(p.x, p.z).distanceTo(originXZ) < span * 0.08);
  const motorsOut = motorC.every((p) => new THREE.Vector2(p.x, p.z).distanceTo(originXZ) > span * 0.12);
  if (!clustered || !motorsOut) return;

  const sortKey = (c: THREE.Vector3) => Math.atan2(c.z - originXZ.y, c.x - originXZ.x);
  const motorOrder = motors.map((_, i) => i).sort((a, b) => sortKey(motorC[a]) - sortKey(motorC[b]));
  props.forEach((prop, i) => {
    const mc = motorC[motorOrder[i % motorOrder.length]];
    const pc = propC[i];
    prop.position.x += mc.x - pc.x;
    prop.position.z += mc.z - pc.z;
  });
}
