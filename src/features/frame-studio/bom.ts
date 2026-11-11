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

import { cameraById, STACK_CLEARANCE_MM } from "./catalog";
import { planSheets } from "./exporters";
import { type FrameDesign } from "./geometry";
import { round } from "./structure";

export interface BomLine {
  qty: number;
  item: string;
  /** Where it goes, in plain words. */
  purpose: string;
  note?: string;
}

/** Standard metric standoff lengths, mm. */
const STANDOFF_STOCK = [5, 6, 8, 10, 12, 15, 16, 20, 25, 30, 35, 40, 45, 50];

/**
 * Standoff height for a unibody, mm.
 *
 * Here the standoff's job is to clear the flight-controller stack, which is a
 * completely different requirement from the bolted case's "match the arm".
 *
 * This used to be guessed from the mounting pattern — 30 mm for a 30.5 mm
 * stack, 20 mm for a 20 mm one. A mounting pattern is a width, and a width
 * cannot tell you a height: it happened to land near enough for a full-size
 * stack and was 8 mm too tall for a short one. Now the user states the height
 * and the standoff is the next stocked size above it plus clearance.
 */
function stackStandoffMm(d: FrameDesign): number {
  const needed = d.spec.stackHeightMm + STACK_CLEARANCE_MM;
  return STANDOFF_STOCK.find((s) => s >= needed) ?? Math.ceil(needed / 5) * 5;
}

/** Widest strap the plate's slots will actually pass, rounded to a size sold. */
function strapWidthMm(d: FrameDesign): number {
  return d.strapSlotMm >= 20 ? 20 : Math.max(10, Math.floor(d.strapSlotMm / 5) * 5);
}

/** Nearest standard metric bolt length at or above `mm`. */
export function standardBoltLength(mm: number): number {
  const stock = [4, 5, 6, 8, 10, 12, 14, 16, 18, 20, 25, 30, 35, 40];
  return stock.find((s) => s >= mm) ?? Math.ceil(mm / 5) * 5;
}

export function buildBOM(d: FrameDesign): BomLine[] {
  const unibody = d.spec.construction === "unibody";
  // In a unibody the chassis is the arm — same piece, same thickness.
  const arm = d.profiles.find((p) => p.cantileverMm !== undefined) ?? d.profiles.find((p) => p.id === "chassis")!;
  const bottom = d.profiles.find((p) => p.id === "bottom-plate" || p.id === "chassis")!;
  const top = d.profiles.find((p) => p.id === "top-plate")!;
  const rootBolt = d.rootBoltMm;

  /*
    The arm clamp is a sandwich, not a column.

    Bottom plate, arm, top plate — the standoffs sit *beside* the arms, in
    parallel with them, not stacked in series. Adding the standoff height to
    the bolt length made every clamp bolt 9-15 mm too long, and the note that
    went with it contradicted its own arithmetic.

    The standoff has to be exactly as thick as the arm it sits next to. One
    even a millimetre taller and the top plate rests on the standoffs with the
    arms swinging loose underneath, which is the failure this list exists to
    prevent.
  */
  const standoffMm = unibody
    ? stackStandoffMm(d)
    : round(arm.thicknessMm, 1);
  const clampStack = unibody
    ? bottom.thicknessMm + top.thicknessMm + standoffMm
    : bottom.thicknessMm + arm.thicknessMm + top.thicknessMm;
  // Two diameters of thread engagement past the sandwich for the nut.
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
    ...(unibody
      ? [
          {
            qty: 8,
            item: `M${rootBolt} × ${standardBoltLength(Math.max(bottom.thicknessMm, top.thicknessMm) + rootBolt * 2)} mm cap head`,
            purpose: "Top plate to standoffs, and standoffs to the chassis",
            note: "Four down into the standoffs from the top plate, four up from underneath the chassis.",
          },
          {
            qty: 4,
            item: `M${rootBolt} × ${standoffMm} mm standoff, female both ends`,
            purpose: "Holding the top plate off the chassis",
            note: `Sits in the gaps between the arms. ${standoffMm} mm clears a ${d.spec.stackPattern} mm stack with its soft mounts — measure yours before ordering.`,
          },
        ]
      : [
          {
            qty: 8,
            item: `M${rootBolt} × ${clampBolt} mm cap head`,
            purpose: "Arm clamp, two per arm through both plates",
            note: `Clamps ${round(clampStack)} mm of plate and arm.`,
          },
          {
            qty: 8,
            item: `M${rootBolt} nyloc nut`,
            purpose: "Arm clamp bolts",
            note: "Nyloc, not plain — plain nuts back off under vibration.",
          },
          {
            qty: 8,
            item: `M${rootBolt} × ${standoffMm} mm standoff`,
            purpose: "Two per arm, holding the top plate off the arms",
            note: `Exactly as thick as the arm (${round(arm.thicknessMm, 1)} mm). They sit beside the arms and set the top plate's height — a taller standoff leaves the arms loose.`,
          },
        ]),
    {
      /*
        The stack bolt runs up from under the bottom plate, through the
        grommet, the ESC, the inter-board standoff and the flight controller,
        and still has to take a nut. That is the plate plus the stated stack
        height plus thread engagement — not the flat 20 mm this used to quote,
        which was right only for a full-size stack and far too long for a
        whoop.
      */
      qty: 4,
      item: `M${d.spec.stackBolt} × ${standardBoltLength(bottom.thicknessMm + d.spec.stackHeightMm + d.spec.stackBolt)} mm cap head + soft mounts`,
      purpose: `Flight controller stack, ${d.spec.stackPattern} × ${d.spec.stackPattern} mm pattern`,
      note: `Sized for a ${d.spec.stackHeightMm} mm stack on a ${bottom.thicknessMm} mm plate. Rubber grommets isolate the gyro from frame vibration — do not bolt the stack down rigidly, and re-measure if your stack is taller than stated.`,
    },
    {
      /*
        Strap length finally uses the battery height, which the studio has
        always asked for and never read. A strap has to go over the pack and
        back under the plate, so it is twice the height plus the width plus
        the plate, with a little for the buckle.
      */
      qty: 2,
      item: `Battery strap, ${strapWidthMm(d)} mm wide × ${Math.ceil((2 * d.spec.battery.h + d.spec.battery.w + bottom.thicknessMm + 30) / 10) * 10} mm long`,
      purpose: `Through the slots in the ${d.spec.batteryMount === "top" ? "top" : "bottom"} plate`,
      note: `Long enough to go over a ${d.spec.battery.h} mm tall pack and back through. Buy a little longer rather than shorter — the tail tucks away.`,
    },
  ];

  const camera = cameraById(d.spec.cameraId);
  if (camera.widthMm > 0) {
    lines.push({
      qty: 2,
      item: `M${camera.bolt} × 12 mm cap head + nut`,
      purpose: `Camera pivot, through the ${camera.widthMm} mm side plates`,
      note: `One through the fixed pivot hole and one through whichever of the tilt holes gives the angle you want. ${camera.widthMm} mm is the spacing between your camera's own mounting holes — measure it before cutting.`,
    });
    lines.push({
      qty: 1,
      item: "Thread-lock or epoxy, small tube",
      purpose: "Securing the camera side plates in their slots",
      note: "The side plates locate by tab and slot, which holds them square but not down. A drop in each slot is enough; use thread-lock if you want to be able to take them out again.",
    });
  }

  if (d.material.method === "cut") {
    /*
      One line per thickness. Arms and plates are different stock, so quoting
      them as one sheet would have the student order material they cannot use
      and leave out material they need.
    */
    const sheets = planSheets(d.profiles);
    for (const sheet of [...sheets].reverse()) {
      lines.unshift({
        qty: 1,
        item: `${d.material.name}, ${sheet.thicknessMm} mm sheet`,
        purpose: sheet.partNames.join(", "),
        note: `Nests onto ${Math.ceil(sheet.nest.widthMm)} × ${Math.ceil(sheet.nest.heightMm)} mm at ${Math.round(sheet.nest.utilisation * 100)}% material use. Order a little larger so the cutter has something to clamp.`,
      });
    }
  } else {
    /*
      Use the design's own frame mass rather than recomputing it. Charging
      every part as solid area × thickness over-states a hollow arm, and left
      the "what to order" tab quoting a different weight from the results
      panel for the same frame.
    */
    const grams = Math.ceil(d.mass.frameG);
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
  const unibody = d.spec.construction === "unibody";

  if (d.material.method === "cut") {
    return [
      ...(unibody
        ? [
            {
              title: "One piece, so get the orientation right first time",
              detail:
                "The arms and the centre plate are a single part. That makes the build far simpler — there are no arm bolts to torque and nothing to work loose — but it also means a snapped arm is a whole new chassis. Cut a spare while the setup is on the machine; it costs a fraction of a second cut later.",
            },
          ]
        : [
            {
              title: "Fit the arms before you fit anything else",
              detail:
                "Bolt all four arms between the plates and tighten evenly before the stack or the motors go on. Doing it the other way round means fighting the stack wiring every time an arm needs adjusting.",
            },
          ]),
      {
        title: "Order two thicknesses, not one",
        detail: `${unibody ? `The chassis is ${d.stock.armDimMm} mm — its arms set the thickness — and the top plate is ${d.stock.topPlateMm} mm` : `The arms are ${d.stock.armDimMm} mm and the plates are ${d.stock.bottomPlateMm} mm (top plate ${d.stock.topPlateMm} mm)`}. This is how production frames are made and it is not an oversight: the arm is a cantilever and wants thickness, while the plates are only a clamp. Cutting the whole frame from one sheet gives you either floppy arms or a needlessly heavy centre.`,
      },
      ...(unibody ? [] : [{
        title: "If you would rather cut one plate thickness",
        detail: `The plates differ by ${round(Math.abs(d.stock.bottomPlateMm - d.stock.topPlateMm), 1)} mm, which is worth a few grams and one less setup at the cutter. Cutting both from the thicker ${d.stock.bottomPlateMm} mm stock is a perfectly reasonable simplification — just do not do the same with the arms, which need every bit of their ${d.stock.armDimMm} mm.`,
      }]),
      {
        title: "Send the DXF as it is",
        detail:
          "The file is 1:1 in millimetres on a single CUT layer, with part names on a separate LABEL layer the cutter can ignore. Do not let anyone scale it to fit.",
      },
      {
        title: `Specify ${d.stock.armDimMm} mm and ${d.stock.bottomPlateMm} mm ${d.material.name}`,
        detail:
          d.material.id === "cf-plate"
            ? "Carbon must be cut by a service or a shop with proper extraction. The dust is a respiratory hazard and is electrically conductive, so it also ruins electronics and tooling."
            : d.material.note,
      },
      {
        title: "Ask for the arms to be cut along the weave",
        detail:
          "Carbon plate is strongest along its weave and markedly weaker at 45° to it. Nest the arms so their length runs with the weave, not diagonally across it — it costs nothing and it is one of the few free gains in frame strength.",
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
      title: "Print the arms flat, length along the bed",
      detail:
        "Lay each arm down with its length in the X-Y plane. Bending an arm stretches and compresses material along its length, and in this orientation that stress runs inside each layer, where the part is strongest. The layer bonds are left carrying transverse shear instead, which here is well under 1 MPa against the tens of MPa a printed bond will take. Standing the arm on end would put the bending stress straight across the layer lines.",
    },
    {
      title: "Walls, not infill",
      detail:
        "Run 6-8 perimeters and 30-50% gyroid or cubic infill. In a hollow section like this one the perimeters are the structure — they are the box walls the stiffness was calculated from — so extra walls buy far more strength per gram than extra infill ever will.",
    },
    {
      title: "Solid for the first 15 mm at the root",
      detail:
        "The root carries the whole bending moment and both clamp bolts. Set a modifier to 100% infill for the first 15 mm out from the inboard tip so the bolts are not pulling against a hollow shell.",
    },
    {
      title: `Dry the ${d.material.name} first`,
      detail:
        d.material.id.startsWith("pa")
          ? "Nylon absorbs water from the air within hours and prints weak, stringy and visibly bubbled when it is wet. Dry at 70 \u00b0C for at least 6 hours and print straight from a dry box."
          : "Even forgiving filaments lose inter-layer strength when damp. A few hours in a dryer is cheap insurance for a structural part.",
    },
    {
      title: "Print hot and slow",
      detail:
        "Layer adhesion is what fails in a crash, and it improves with nozzle temperature and time. Run near the top of the material's range, 30-40 mm/s on the perimeters, and turn part cooling down to the minimum the geometry allows.",
    },
    {
      title: "Fillet the root and cap the bolts with washers",
      detail:
        "Blend the arm into the motor pad with at least a 5 mm radius — a sharp change of section is where printed arms break. Printed material also creeps under a concentrated clamp load, so put a washer under every bolt head and re-check them after the first pack.",
    },
    {
      title: "Test before you trust it",
      detail: `This design holds ${d.section.deflectionMm} mm of tip deflection at full thrust on paper. Confirm the real part: clamp the root, hang ${Math.round((d.spec.motorThrustG / 1000) * 100) / 100} kg at the motor mount, and check it neither deflects far more than that nor shows any whitening at the root.`,
    },
  ];
}
