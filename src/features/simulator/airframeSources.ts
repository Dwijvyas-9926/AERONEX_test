import { designFrame } from "../frame-studio/geometry";
import { useStudio } from "../frame-studio/store";
import { G, type Airframe } from "../../sim/airframe";
import type { VehicleProfile } from "../../vehicle/types";

/** The parts of an airframe the Aircraft Profile knows. */
export function fromProfile(p: VehicleProfile | null, base: Airframe): { airframe: Airframe; filled: string[] } {
  const filled: string[] = [];
  const next = { ...base };
  if (p?.massGrams) {
    next.massKg = p.massGrams / 1000;
    filled.push("weight");
  }
  if (p?.diagonalMm) {
    next.diagonalM = p.diagonalMm / 1000;
    filled.push("diagonal");
  }
  if (p && filled.length) next.name = p.name;
  return { airframe: next, filled };
}

/**
 * The airframe the Frame Studio design describes.
 *
 * Weight, size, propeller and motor thrust come straight from the design. The
 * studio records the battery's weight but not its capacity, so capacity is
 * estimated from weight at 150 Wh/kg, a typical LiPo; correct it if you know it.
 */
export function fromFrameStudio(): Airframe {
  const d = designFrame(useStudio.getState().spec);
  const cells = d.motor.thrustCells;
  // An estimate, said so in the notice shown on copying. Motor thrust is the
  // catalogue's representative figure for the motor class, not a test-stand reading.
  const wh = (d.spec.battery.massG / 1000) * 150;
  return {
    name: `Frame Studio ${d.spec.propIn}" design`,
    massKg: Math.round(d.mass.auwG) / 1000,
    diagonalM: Math.round(d.wheelbaseMm) / 1000,
    motorMaxThrustN: Math.round((d.spec.motorThrustG / 1000) * G * 100) / 100,
    propDiaM: Math.round(d.propDiaMm) / 1000,
    cells,
    capacityMah: Math.max(200, Math.round(((wh / (cells * 3.7)) * 1000) / 50) * 50),
  };
}
