import * as THREE from "three";

/*
  Model-orientation correction. The user says which of the model's own axes is
  the nose (forward) and which is up; we build the rotation that maps those onto
  the app's body convention (nose along -Z, up along +Y, per rendering/frames.ts).
  This is a visual correction applied to a wrapper object — the imported geometry
  is never mutated, and this never touches autopilot orientation parameters.
*/

export type AxisDir = "+x" | "-x" | "+y" | "-y" | "+z" | "-z";

export const AXIS_DIRS: AxisDir[] = ["+x", "-x", "+y", "-y", "+z", "-z"];
export const AXIS_LABEL: Record<AxisDir, string> = {
  "+x": "+X", "-x": "−X", "+y": "+Y", "-y": "−Y", "+z": "+Z", "-z": "−Z",
};

export function axisVec(a: AxisDir): THREE.Vector3 {
  switch (a) {
    case "+x": return new THREE.Vector3(1, 0, 0);
    case "-x": return new THREE.Vector3(-1, 0, 0);
    case "+y": return new THREE.Vector3(0, 1, 0);
    case "-y": return new THREE.Vector3(0, -1, 0);
    case "+z": return new THREE.Vector3(0, 0, 1);
    case "-z": return new THREE.Vector3(0, 0, -1);
  }
}

/** True when the two axes lie on the same line (an invalid forward/up pair). */
export const axesParallel = (a: AxisDir, b: AxisDir) => a[1] === b[1];

const WORLD_FORWARD = new THREE.Vector3(0, 0, -1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);

/** Nearest axis direction to an arbitrary vector (used after snapping 90° rotations). */
export function vecToAxis(v: THREE.Vector3): AxisDir {
  const ax = Math.abs(v.x);
  const ay = Math.abs(v.y);
  const az = Math.abs(v.z);
  if (ax >= ay && ax >= az) return v.x >= 0 ? "+x" : "-x";
  if (ay >= ax && ay >= az) return v.y >= 0 ? "+y" : "-y";
  return v.z >= 0 ? "+z" : "-z";
}

/**
 * Rotate the displayed model 90° about a world axis ("x" pitch, "y" turn, "z" roll)
 * and return the new forward/up axis pair that reproduces it. Keeps orientation as
 * two axis directions while giving intuitive "turn / tilt / roll" buttons.
 */
export function rotateOrientation(forward: AxisDir, up: AxisDir, worldAxis: "x" | "y" | "z", degrees: number): { forward: AxisDir; up: AxisDir } {
  const q = orientationQuat(forward, up);
  const axis = new THREE.Vector3(worldAxis === "x" ? 1 : 0, worldAxis === "y" ? 1 : 0, worldAxis === "z" ? 1 : 0);
  const r = new THREE.Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180);
  const net = r.multiply(q); // apply the extra rotation in world space, after the base orientation
  const inv = net.clone().invert();
  const fwd = vecToAxis(new THREE.Vector3(0, 0, -1).applyQuaternion(inv));
  const u = vecToAxis(new THREE.Vector3(0, 1, 0).applyQuaternion(inv));
  return { forward: fwd, up: u };
}

/** Rotation mapping the chosen model forward/up onto the app's forward(-Z)/up(+Y). */
export function orientationQuat(forward: AxisDir, up: AxisDir): THREE.Quaternion {
  const mF = axisVec(forward);
  const mU = axisVec(up);
  const q1 = new THREE.Quaternion().setFromUnitVectors(mF, WORLD_FORWARD);
  const uRot = mU.clone().applyQuaternion(q1);
  uRot.addScaledVector(WORLD_FORWARD, -uRot.dot(WORLD_FORWARD)); // drop any along-forward component
  if (uRot.lengthSq() < 1e-8) return q1; // up parallel to forward — caller guards against this
  uRot.normalize();
  const q2 = new THREE.Quaternion().setFromUnitVectors(uRot, WORLD_UP);
  return q2.multiply(q1);
}
