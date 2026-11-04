import * as THREE from "three";
import { orientationQuat, type AxisDir } from "../services/import/orient";

/*
  Computes the transform that places an imported model into the app's body frame:
  apply the orientation correction, drop it onto the ground (min-Y = 0), centre it
  horizontally, and auto-fit it to a consistent display size (longest side ->
  TARGET world units) scaled by the user's percentage. The raw geometry is never
  changed — this transform goes on a wrapper object.
*/

export const FIT_TARGET = 1.3;

export interface FitTransform {
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: number;
  /** Fitted bounding size in world units (after scale), for the camera/grid. */
  worldSize: THREE.Vector3;
}

export function fitTransform(object: THREE.Object3D, forward: AxisDir, up: AxisDir, scalePercent: number): FitTransform {
  const q = orientationQuat(forward, up);
  const rot = new THREE.Matrix4().makeRotationFromQuaternion(q);
  const box = new THREE.Box3().setFromObject(object).applyMatrix4(rot);
  const size = new THREE.Vector3();
  box.getSize(size);
  const center = new THREE.Vector3();
  box.getCenter(center);

  const longest = Math.max(size.x, size.y, size.z) || 1;
  const scale = (FIT_TARGET / longest) * (scalePercent / 100);

  return {
    quaternion: [q.x, q.y, q.z, q.w],
    scale,
    position: [-center.x * scale, -box.min.y * scale, -center.z * scale],
    worldSize: size.clone().multiplyScalar(scale),
  };
}
