/*
  Frame Studio — bill of materials and making instructions.

  A drawing on its own does not get a frame built. What a student needs beside
  it is the list of fasteners to order and the settings to cut or print at, and
  both follow from the design rather than being typed in by hand.

  Bolt lengths are computed from the stack-up they actually pass through, which
  is the single most common thing to get wrong when ordering: a bolt 2 mm too
  short will not engage its nut, and one 3 mm too long bottoms out against the
  motor windings.
*/

import { nestParts } from "./exporters";
import { type FrameDesign } from "./geometry";
import { round } from "./structure";

export interface BomLine {
  qty: number;
  item: string;
  /** Where it goes, in plain words. */
  purpose: string;
  note?: string;
}

/** Nearest standard metric bolt length at or above `mm`. */
export function standardBoltLength(mm: number): number {
  const stock = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40];
  return stock.find((s) => s >= mm) ?? Math.ceil(mm / 5) * 5;
}

export function buildBOM(d: FrameDesign): BomLine[] {
  const arm = d.profiles.find((p) => p.id === "arm")!;
  const bottom = d.profiles.find((p) => p.id === "bottom-plate")!;
  const top = d.profiles.find((p) => p.id === "top-plate")!;
  const rootBolt = d.rootBoltMm;

  /*
    The arm sandwich: bottom plate + arm + standoff up to the top plate. The
    bolt has to clear all three and still take a nut or thread into the
    standoff, so two diameters of engagement are added.
  */
  const standoffMm = Math.max(5, Math.ceil(arm.thicknessMm + 2));
  const clampStack = bottom.thicknessMm + arm.thicknessMm + top.thicknessMm + standoffMm;
  const clampBolt = standardBoltLength(clampStack + rootBolt * 2);

  // Motor bolts thread into the motor bell and must not reach the windings.
  const motorBoltLen = standardBoltLength(arm.thicknessMm + 4);

  const lines: BomLine[] = [
    {
      qty: 16,
      item: `M${d.motor.bolt} × ${motorBoltLen} mm cap head`,
      purpose: "Motor mounting, four per motor",
      note: `Measure your motors before ordering: too long and the bolt reaches the windings. ${arm.thicknessMm} mm of arm plus roughly 4 mm into the bell.`,
    },
    {
      qty: 8,
      item: `M${rootBolt} × ${clampBolt} mm cap head`,
      purpose: "Arm clamp, two per arm through both plates",
      note: `Clamps ${round(clampStack)} mm of plate, arm and standoff.`,
    },
    {
      qty: 8,
      item: `M${rootBolt} nyloc nut`,
      purpose: "Arm clamp bolts",
      note: "Nyloc, not plain — plain nuts back off under vibration.",
    },
    {
      qty: 4,
      item: `M${rootBolt} × ${standoffMm} mm standoff`,
      purpose: "Spacing the top plate clear of the arms",
    },
    {
      qty: 4,
      item: `M${d.spec.stackBolt} × 20 mm cap head + soft mounts`,
      purpose: `Flight controller stack, ${d.spec.stackPattern} × ${d.spec.stackPattern} mm pattern`,
      note: "Rubber grommets isolate the gyro from frame vibration. Do not bolt the stack down rigidly.",
    },
    {
      qty: 2,
      item: "Battery strap, 20 mm wide",
      purpose: "Through the slots in the bottom plate",
    },
  ];

  if (d.material.method === "cut") {
    // Quote the sheet the parts actually nest onto, not a guessed size.
    const nest = nestParts(d.profiles);
    lines.unshift({
      qty: 1,
      item: `${d.material.name}, ${d.spec.fixedDimMm} mm sheet`,
      purpose: "All frame parts",
      note: `Everything nests onto ${Math.ceil(nest.widthMm)} × ${Math.ceil(nest.heightMm)} mm at ${Math.round(nest.utilisation * 100)}% material use. Order at least that, with a margin for the cutter to clamp.`,
    });
  } else {
    const volumeMm3 = d.profiles.reduce((s, p) => s + p.areaMm2 * p.thicknessMm * p.qty, 0);
    const grams = Math.ceil((volumeMm3 / 1000) * d.material.density);
    lines.unshift({
      qty: 1,
      item: `${d.material.name} filament`,
      purpose: "All frame parts",
      note: `About ${grams} g of material at 100% infill, plus waste. Buy a 500 g spool or larger.`,
    });
  }

  return lines;
}

export interface RecipeStep {
  title: string;
  detail: string;
}

/**
 * How to make the parts. These are process settings, not shape data, and they
 * are where printed frames are usually lost — a part printed flat on the bed
 * has its layer lines running across the arm, which is the weak direction.
 */
export function buildRecipe(d: FrameDesign): RecipeStep[] {
  if (d.material.method === "cut") {
    return [
      {
        title: "Send the DXF as it is",
        detail:
          "The file is 1:1 in millimetres on a single CUT layer, with part names on a separate LABEL layer the cutter can ignore. Do not let anyone scale it to fit.",
      },
      {
        title: `Specify ${d.spec.fixedDimMm} mm ${d.material.name}`,
        detail:
          d.material.id === "cf-plate"
            ? "Carbon must be cut by a service or a shop with proper extraction. The dust is a respiratory hazard and is electrically conductive, so it also ruins electronics and tooling."
            : d.material.note,
      },
      {
        title: "Ask for holes cut, not drilled after",
        detail:
          "Cutting the holes in the same operation keeps them concentric with the outline. Drilling laminate afterwards chips the surface and wanders off centre.",
      },
      {
        title: "Check two dimensions on arrival",
        detail: `Measure the arm root width (${d.section.widthMm} mm) and the stack hole spacing (${d.spec.stackPattern} mm) before you build. If either is off, the file was scaled.`,
      },
      {
        title: "Dress the edges",
        detail:
          "A light pass with fine abrasive on every cut edge removes the micro-cracks a cut leaves behind. On carbon this is the single cheapest thing you can do for crash survival — wear a mask.",
      },
    ];
  }

  return [
    {
      title: "Print the arms on edge, not flat",
      detail:
        "This is the one that matters. Lay an arm flat and its layer lines run across the arm, which is the direction it bends in — the weak axis of a printed part. Stand it on edge so the layers run along the arm and the load is carried along the layer lines instead of trying to peel them apart.",
    },
    {
      title: "Walls, not infill",
      detail:
        "Set 5 or more perimeters and 30–40% infill. In a part this slender the perimeters carry nearly all the bending load, so extra walls buy far more strength per gram than extra infill.",
    },
    {
      title: `Dry the ${d.material.name} first`,
      detail:
        d.material.id.startsWith("pa")
          ? "Nylon absorbs water from the air within hours and prints weak, stringy and visibly bubbled when it is wet. Dry at 70 °C for at least 6 hours and print straight from a dry box."
          : "Even forgiving filaments lose inter-layer strength when damp. A few hours in a dryer is cheap insurance for a structural part.",
    },
    {
      title: "Print hot and slow",
      detail:
        "Layer adhesion is what fails in a crash, and it improves with nozzle temperature and time. Run near the top of the material's range, 30–40 mm/s on the perimeters, and turn part cooling down to the minimum the geometry allows.",
    },
    {
      title: "Add washers under every bolt head",
      detail:
        "Printed material creeps under a concentrated clamp load, so a bolt tightened directly against plastic works loose within a few flights. Spread the load with a washer and re-check the bolts after your first pack.",
    },
    {
      title: "Test before you trust it",
      detail: `This design holds ${d.section.deflectionMm} mm of tip deflection at full thrust on paper. Confirm the real part: clamp the root, hang ${Math.round((d.spec.motorThrustG / 1000) * 100) / 100} kg at the motor mount, and check it neither deflects far more than that nor shows any whitening at the root.`,
    },
  ];
}
