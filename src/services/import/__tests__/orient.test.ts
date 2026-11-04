import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { axisVec, orientationQuat, type AxisDir } from "../orient";

const near = (a: THREE.Vector3, b: THREE.Vector3) => a.distanceTo(b) < 1e-6;
const F = new THREE.Vector3(0, 0, -1);
const U = new THREE.Vector3(0, 1, 0);

describe("orientationQuat", () => {
  it("is identity when the model already matches the app convention", () => {
    const q = orientationQuat("-z", "+y");
    expect(near(axisVec("-z").applyQuaternion(q), F)).toBe(true);
    expect(near(axisVec("+y").applyQuaternion(q), U)).toBe(true);
  });

  it("maps chosen forward and up onto -Z and +Y for every valid pair", () => {
    const dirs: AxisDir[] = ["+x", "-x", "+y", "-y", "+z", "-z"];
    for (const f of dirs) {
      for (const u of dirs) {
        if (f[1] === u[1]) continue; // same axis line — invalid
        const q = orientationQuat(f, u);
        expect(near(axisVec(f).applyQuaternion(q), F)).toBe(true);
        expect(near(axisVec(u).applyQuaternion(q), U)).toBe(true);
        // result must be a proper rotation (no reflection/scale)
        const m = new THREE.Matrix4().makeRotationFromQuaternion(q);
        expect(new THREE.Vector3().setFromMatrixColumn(m, 0).length()).toBeCloseTo(1, 6);
      }
    }
  });

  it("handles a common CAD case: Z-up model, nose along +X", () => {
    const q = orientationQuat("+x", "+z");
    expect(near(axisVec("+x").applyQuaternion(q), F)).toBe(true);
    expect(near(axisVec("+z").applyQuaternion(q), U)).toBe(true);
  });
});
