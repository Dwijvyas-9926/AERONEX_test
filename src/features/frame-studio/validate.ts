/*
  Frame Studio — design validation.

  A design studio that only draws shapes is a liability: it will happily hand a
  student a frame whose bolts miss the plate, whose props overlap, or that
  cannot lift itself. Every check here is one a person would otherwise have to
  know to make, expressed in the same units as the rest of the studio.

  Checks are geometric and physical facts about the design, not opinions. Each
  returns the measured number alongside the limit, so the user can see how much
  margin they have rather than just being told "ok".
*/

import { MATERIALS, propFit, cameraById } from "./catalog";
import {
  cameraPlateHeightMm,
  distanceToBoundary,
  distanceToSegment,
  pointInPolygon,
  requiredEdgeClearance,
  type FrameDesign,
  type Hole,
  type Pt,
  type Profile,
} from "./geometry";
import { round } from "./structure";

export type Severity = "error" | "warn" | "ok";

export interface Finding {
  id: string;
  severity: Severity;
  /** Which part or aspect this concerns, for grouping in the UI. */
  scope: string;
  title: string;
  detail: string;
  /** Measured value and the limit it was compared against, where meaningful. */
  measured?: string;
  limit?: string;
}

/** Minimum wall of material left between two holes, mm. */
const MIN_WALL_BETWEEN_HOLES = 1.5;

/* ------------------------------------------------------------ part checks */

function checkPart(part: Profile): Finding[] {
  const out: Finding[] = [];

  for (const [i, h] of part.holes.entries()) {
    if (!pointInPolygon(h.c, part.outline)) {
      out.push({
        id: `${part.id}-hole-${i}-outside`,
        severity: "error",
        scope: part.name,
        title: "Hole falls outside the part",
        detail: `A ${round(h.r * 2)} mm hole sits off the edge of the ${part.name.toLowerCase()}, so this part cannot be made as drawn.`,
      });
      continue;
    }
    const required = requiredEdgeClearance(h);
    const clear = distanceToBoundary(h.c, part.outline) - h.r;
    if (clear < required - 0.05) {
      out.push({
        id: `${part.id}-hole-${i}-edge`,
        severity: clear < h.r ? "error" : "warn",
        scope: part.name,
        title: "Bolt too close to the edge",
        detail: `A bolt needs about ${round(required)} mm of material between its hole and the part edge, or the edge tears out under load.`,
        measured: `${round(clear)} mm`,
        limit: `${round(required)} mm`,
      });
    }
  }

  /*
    Slots were previously never looked at — not for containment, not for edge
    distance, not for how close they run to a bolt. A strap slot cut through
    the plate is as much a stress raiser as a hole is.
  */
  for (const [i, slot] of part.slots.entries()) {
    for (const p of slot) {
      if (!pointInPolygon(p, part.outline)) {
        out.push({
          id: `${part.id}-slot-${i}-outside`,
          severity: "error",
          scope: part.name,
          title: "Slot runs off the part",
          detail: "A battery strap slot extends past the edge of the plate, so this part cannot be made as drawn.",
        });
        break;
      }
    }
    for (const [j, h] of part.holes.entries()) {
      const gap = Math.min(...slot.map((p) => Math.hypot(p[0] - h.c[0], p[1] - h.c[1]))) - h.r;
      if (gap < MIN_WALL_BETWEEN_HOLES - 0.05) {
        out.push({
          id: `${part.id}-slot-${i}-hole-${j}`,
          severity: gap <= 0 ? "error" : "warn",
          scope: part.name,
          title: gap <= 0 ? "A slot runs into a bolt hole" : "Slot nearly touches a bolt hole",
          detail: "Material between a strap slot and a bolt is what stops the plate tearing between them.",
          measured: `${round(gap)} mm`,
          limit: `${MIN_WALL_BETWEEN_HOLES} mm`,
        });
      }
    }
  }

  /*
    Slot against slot.

    Previously unchecked, which was survivable while every part had exactly
    two parallel strap slots that could not reach each other. The moment a
    part carries a stack opening and lightening cut-outs as well, two cut-outs
    merging into one is a real way to produce a plate with a hole through the
    middle of a load path and no warning about it.
  */
  for (let i = 0; i < part.slots.length; i++) {
    for (let j = i + 1; j < part.slots.length; j++) {
      const gap = polygonGap(part.slots[i], part.slots[j]);
      if (gap < MIN_WALL_BETWEEN_HOLES - 0.05) {
        out.push({
          id: `${part.id}-slots-${i}-${j}`,
          severity: gap <= 0 ? "error" : "warn",
          scope: part.name,
          title: gap <= 0 ? "Two cut-outs run into each other" : "Cut-outs nearly touch",
          detail:
            gap <= 0
              ? `Two openings in the ${part.name.toLowerCase()} overlap, which makes them one larger opening the studio never sized.`
              : `Only a sliver of material is left between two openings in the ${part.name.toLowerCase()}.`,
          measured: `${round(gap)} mm`,
          limit: `${MIN_WALL_BETWEEN_HOLES} mm`,
        });
      }
    }
  }

  // Hole-to-hole walls, within this part only.
  for (let i = 0; i < part.holes.length; i++) {
    for (let j = i + 1; j < part.holes.length; j++) {
      const a = part.holes[i];
      const b = part.holes[j];
      const gap = Math.hypot(a.c[0] - b.c[0], a.c[1] - b.c[1]) - a.r - b.r;
      if (gap < MIN_WALL_BETWEEN_HOLES - 0.05) {
        out.push({
          id: `${part.id}-holes-${i}-${j}`,
          severity: gap <= 0 ? "error" : "warn",
          scope: part.name,
          title: gap <= 0 ? "Two holes overlap" : "Holes nearly touch",
          detail:
            gap <= 0
              ? `Two holes on the ${part.name.toLowerCase()} run into each other. Move the stack or change its mounting pattern.`
              : `Only a sliver of material is left between two holes on the ${part.name.toLowerCase()}.`,
          measured: `${round(gap)} mm`,
          limit: `${MIN_WALL_BETWEEN_HOLES} mm`,
        });
      }
    }
  }
  return out;
}

/* ----------------------------------------------------------- whole design */

/** Air a pack over the discs has to leave above the propellers, mm. */
const PROP_AIR_MM = 6;

export function validateDesign(d: FrameDesign): Finding[] {
  const out: Finding[] = [];
  for (const p of d.profiles) out.push(...checkPart(p));

  /* --- propeller clearance ------------------------------------------- */
  const needed = d.propDiaMm + d.spec.clearanceMm;
  if (d.minMotorSpacingMm < d.propDiaMm) {
    out.push({
      id: "prop-overlap",
      severity: "error",
      scope: "Layout",
      title: "Propellers overlap",
      detail: "Adjacent propeller discs intersect. The frame cannot be flown at this wheelbase.",
      measured: `${d.minMotorSpacingMm} mm apart`,
      limit: `${round(d.propDiaMm)} mm minimum`,
    });
  } else if (d.minMotorSpacingMm < needed - 0.5) {
    out.push({
      id: "prop-clearance",
      severity: "warn",
      scope: "Layout",
      title: "Tight propeller clearance",
      detail: "The discs clear each other but by less than the gap you asked for, which leaves little room for flex or a bent prop.",
      measured: `${round(d.minMotorSpacingMm - d.propDiaMm)} mm gap`,
      limit: `${d.spec.clearanceMm} mm`,
    });
  }

  /* --- arm roots must be clamped by both plates ---------------------- */
  // A unibody has no arm clamp to check — the arms are the plate.
  const arm = d.profiles.find((p) => p.cantileverMm !== undefined);
  const bottom = d.profiles.find((p) => p.id === "bottom-plate");
  const top = d.profiles.find((p) => p.id === "top-plate");
  if (d.spec.construction === "bolted" && arm && bottom && top) {
    // Root bolt positions in global coordinates, derived from the design.
    const rootBolts = bottom.holes.filter((h) => {
      const r = Math.hypot(h.c[0], h.c[1]);
      return r > d.rootRadiusMm - d.armOverlapMm - 0.5 && r < d.rootRadiusMm + 0.5;
    });
    const uncovered = rootBolts.filter((h) => !holeFullyInside(h, top.outline));
    if (uncovered.length > 0) {
      out.push({
        id: "root-clamp",
        severity: "error",
        scope: "Top plate",
        title: "Top plate does not reach every arm bolt",
        detail: "The arms are clamped between the plates, so the top plate has to cover all of their bolts. As drawn it misses some, and those arms would be held by one plate only.",
        measured: `${uncovered.length} of ${rootBolts.length} bolts uncovered`,
      });
    }
  }

  /* --- structure ----------------------------------------------------- */
  const s = d.section;
  if (s.stressMPa > s.allowableMPa) {
    out.push({
      id: "arm-stress",
      severity: "error",
      scope: "Arm",
      title: "Arm overstressed",
      detail: `Peak bending stress at the arm root exceeds the allowable for ${d.material.name} with a safety factor of ${d.spec.safetyFactor}. Use a thicker section, a shorter arm, or a stronger material.`,
      measured: `${s.stressMPa} MPa`,
      limit: `${s.allowableMPa} MPa`,
    });
  }
  /*
    Deflection, with the severity scaled to how badly it misses.

    A little over the target is a tuning nuisance. Several times over is an
    aircraft that cannot be flown: the arms wave about under thrust, the gyro
    reads that as attitude, and no amount of PID work fixes it. Reporting both
    as "warning" would let a student build an acrylic 10" frame believing it
    was merely a bit flexible.
  */
  const deflLimit = Math.max(0.5, d.armLengthMm / 150);
  const deflRatio = s.deflectionMm / deflLimit;
  if (deflRatio > 1.05) {
    const severe = deflRatio > 3;
    out.push({
      id: "arm-deflection",
      severity: severe ? "error" : "warn",
      scope: "Arm",
      title: severe ? "Arms are far too flexible to fly" : "Arm flexes more than is comfortable",
      detail: severe
        ? `These arms deflect about ${Math.round(deflRatio)} times the design target under full thrust. An arm that waves about is read by the flight controller as the aircraft moving, so it is unflyable no matter how it is tuned. ${stiffnessAdvice(d)}`
        : "A floppy arm lowers the frame's natural frequency, which the flight controller sees as vibration and which makes tuning harder.",
      measured: `${s.deflectionMm} mm at full thrust`,
      limit: `${round(deflLimit)} mm`,
    });
  }

  if (!d.material.structural) {
    out.push({
      id: "material-structural",
      severity: "warn",
      scope: "Material",
      title: `${d.material.name} is not suited to arms`,
      detail: d.material.note,
    });
  }
  if (d.material.method === "cut" && d.material.stock && !d.material.stock.includes(d.stock.armDimMm)) {
    out.push({
      id: "stock-thickness",
      severity: "warn",
      scope: "Material",
      title: "Unusual sheet thickness",
      detail: `${d.stock.armDimMm} mm is not a commonly stocked thickness for ${d.material.name}. Stocked sizes: ${d.material.stock.join(", ")} mm.`,
    });
  }
  if (d.stock.escalated) {
    out.push({
      id: "stock-escalated",
      severity: "warn",
      scope: "Material",
      title: `Stepped up to ${d.stock.armDimMm} mm arm stock`,
      detail: `${d.stock.referenceArmMm} mm is what frames this size normally use, but at this arm length and weight that would need an arm wider than the motor pad it feeds. At ${d.stock.armDimMm} mm the arm comes out ${Math.round(d.section.widthMm)} mm — thicker stock is lighter and stronger than a wider arm, because stiffness rises with the cube of thickness.`,
    });
  }

  /*
    The arm-is-really-a-plate check.

    This looks at what the stiffness calculation *demanded*, not at what was
    built — the builder clamps the width so the drawing stays sane, which
    would otherwise hide the problem. Because stiffness rises with t³ and mass
    only with t, going thicker is strictly better than going wider, so when
    the demand exceeds the proportion limit the fix is named explicitly.
  */
  // Whichever case demanded the most material, not just stiffness — an
  // impact-governed design was previously left with no guidance at all.
  const demanded = Math.max(...Object.values(d.section.required));
  if (d.material.method === "cut" && demanded > d.stock.widthCapMm + 0.5) {
    const canFix = d.stock.suggestedArmMm > d.stock.armDimMm + 1e-6 && d.stock.suggestedWidthMm <= d.stock.widthCapMm + 0.5;
    out.push({
      id: "arm-too-wide",
      severity: "warn",
      scope: "Arm",
      title: "This material cannot make an arm this long stiff enough",
      detail: canFix
        ? `At ${d.stock.armDimMm} mm thick the arm would have to be ${Math.round(demanded)} mm wide to hit the stiffness target — wider than the motor pad it feeds. Use ${d.stock.suggestedArmMm} mm stock and it comes down to about ${Math.round(d.stock.suggestedWidthMm)} mm.`
        : `Hitting the stiffness target would need an arm ${Math.round(demanded)} mm wide, which is not a frame. The arm has been capped at ${Math.round(d.stock.widthCapMm)} mm, so expect the flex figure above. ${stiffnessAdvice(d)}`,
      measured: `${Math.round(demanded)} mm needed`,
      limit: `${Math.round(d.stock.widthCapMm)} mm`,
    });
  }

  if (d.material.method === "print" && d.section.heightMm > d.section.widthMm * 0.85) {
    out.push({
      id: "arm-too-deep",
      severity: "warn",
      scope: "Arm",
      title: "Arm section is deeper than it is wide",
      detail:
        "A tall narrow section resists vertical bending well but twists easily, and it is a tall thin wall to print. Widen the arm and the studio can take depth out of it.",
      measured: `${d.section.heightMm} × ${d.section.widthMm} mm`,
    });
  }

  /* --- powertrain ----------------------------------------------------- */
  /*
    Nothing used to connect the motor and the propeller, so a 1103 could be
    asked to turn a 10" prop and the studio would size a frame around it
    without comment. The two selectors are independent by design — the user may
    own an odd combination — so this reports rather than forbids.
  */
  const fit = propFit(d.motor, d.spec.propIn);
  if (fit.fit === "wrong") {
    const [lo, hi] = d.motor.propRange;
    const ways: string[] = [];
    if (fit.betterMotor) ways.push(`a ${fit.betterMotor.size} is the usual motor for a ${d.spec.propIn}" prop`);
    if (fit.betterProp !== undefined) ways.push(`a ${fit.betterProp}" prop is what a ${d.motor.size} is built for`);
    const tooBig = d.spec.propIn > hi;
    out.push({
      id: "motor-prop-mismatch",
      severity: "error",
      scope: "Powertrain",
      title: `A ${d.motor.size} cannot turn a ${d.spec.propIn}" propeller`,
      detail: tooBig
        ? `The torque a propeller demands rises steeply with its diameter, and a ${d.motor.size} stator cannot supply what a ${d.spec.propIn}" disc asks for. It would draw heavy current, overheat the motor and the ESC, and still not produce the thrust this design assumes. ${ways.join(", or ")}.`
        : `A ${d.spec.propIn}" propeller is far too small for a ${d.motor.size}. The motor would spin up against almost no load, which wastes its mass and gives the aircraft no thrust to speak of. ${ways.join(", or ")}.`,
      measured: `${d.spec.propIn}" on a ${d.motor.size}`,
      limit: `${lo}–${hi}" for this stator`,
    });
  } else if (fit.fit === "workable") {
    out.push({
      id: "motor-prop-unusual",
      severity: "warn",
      scope: "Powertrain",
      title: `A ${d.motor.size} is not usually flown on a ${d.spec.propIn}" propeller`,
      detail: `It is inside what the stator will turn, so this will fly, but it sits at the edge of the envelope: ${d.motor.size} motors are normally paired with ${d.motor.props.map((p) => `${p}"`).join(" or ")} props. Watch motor temperature on the first few packs, and treat the thrust figure below as a guess until you have measured yours.`,
      measured: `${d.spec.propIn}"`,
      limit: `${d.motor.props.map((p) => `${p}"`).join(" or ")} usual`,
    });
  }

  /* --- flight performance -------------------------------------------- */
  const tw = d.thrustToWeight;
  if (tw < 1.5) {
    out.push({
      id: "tw-cannot-hover",
      severity: "error",
      scope: "Performance",
      title: "Not enough thrust to fly",
      detail: "The four motors cannot lift the aircraft with any authority left over for control. Lighter build, bigger motors, or a smaller battery.",
      measured: `${tw}:1`,
      limit: "1.5:1 to leave the ground",
    });
  } else if (tw < 2) {
    out.push({
      id: "tw-marginal",
      severity: "warn",
      scope: "Performance",
      title: "Marginal thrust-to-weight",
      detail: "Below about 2:1 the aircraft struggles to arrest a descent and has little margin for a recovery. Fine for a tethered bench test, not for free flight.",
      measured: `${tw}:1`,
      limit: "2:1",
    });
  } else if (tw > 14) {
    out.push({
      id: "tw-very-high",
      severity: "warn",
      scope: "Performance",
      title: "Very high thrust-to-weight",
      detail: "Plenty of power, but hover sits very low on the stick and the aircraft will feel twitchy to a new pilot. Consider a smaller prop or a heavier payload.",
      measured: `${tw}:1`,
    });
  }
  if (d.hoverThrottle > 0.6) {
    out.push({
      id: "hover-high",
      severity: "warn",
      scope: "Performance",
      title: "Hovers high on the throttle",
      detail: "Holding altitude needs most of the available thrust, which leaves little authority for manoeuvring and runs the motors hot.",
      measured: `${Math.round(d.hoverThrottle * 100)}%`,
      limit: "60%",
    });
  }

  /* --- how the mass sits ---------------------------------------------- */
  /*
    A top-mounted pack stands up into the plane the propellers sweep. Published
    guidance on battery mounting names this directly: on a flat frame, a strap
    that works loose lets a propeller reach the pack, which on a lithium pack
    is the worst failure on the aircraft.
  */
  if (d.spec.batteryMount === "top" && d.stackUp.packOverDiscs) {
    /*
      Only where the pack and the discs overlap in plan, and only by how far
      its underside falls short of clearing them. Measuring the pack's top
      against the propellers flagged every top-mounted pack on every frame,
      including the ones whose pack sits between the discs and cannot be
      reached by a blade at any height.
    */
    const shortBy = round(d.cg.thrustPlaneZMm + PROP_AIR_MM - d.stackUp.packZMm);
    if (shortBy > 0) {
      out.push({
        id: "battery-in-the-discs",
        severity: shortBy > PROP_AIR_MM ? "error" : "warn",
        scope: "Fit",
        title: "A top-mounted pack reaches into the propeller discs",
        detail:
          "The pack's corners sit under the propeller tips and not far enough above them, so a blade coning upwards under load — or a strap that works loose — reaches a lithium cell. A shorter or narrower pack, a wider frame, or strapping it underneath all fix it.",
        measured: `${round(d.stackUp.packZMm - d.cg.thrustPlaneZMm)} mm above the discs`,
        limit: `${PROP_AIR_MM} mm`,
      });
    }
  }
  const cage = d.stackUp.deckZMm !== null ? d.stackUp.deckStandoffMm : d.stackUp.topStandoffMm;
  // A full-size camera needs a tall cage whatever else is done; that is the
  // camera's height, not a fault, so the limit never sits below it.
  const cageLimit = Math.max(40, cameraPlateHeightMm(cameraById(d.spec.cameraId)));
  if (cage > cageLimit) {
    out.push({
      id: "cage-tall",
      severity: "warn",
      scope: "Fit",
      title: "The top plate stands on very tall standoffs",
      detail:
        "Standoffs this long let the plate above rack sideways in a crash and carry the pack a long way above the arms. A shorter stack, a smaller camera or a pack that stays clear of the propellers would bring it down.",
      measured: `${cage} mm`,
      limit: `${cageLimit} mm`,
    });
  }
  if (!d.cameraFits) {
    const camera = cameraById(d.spec.cameraId);
    out.push({
      id: "camera-no-room",
      severity: "error",
      scope: "Fit",
      title: `No room for a ${camera.name.split(" ")[0].toLowerCase()} camera mount`,
      detail:
        "The side plates stand in slots ahead of the stack, and on this frame there is not enough plate between the stack and the nose to cut them without running into a bolt or the stack opening. The mount has been left off rather than drawn where it does not fit. A smaller camera class, a smaller stack or a larger frame makes room.",
    });
  }

  /*
    How far the weight hangs below where the thrust acts. A long pendulum is
    the known cost of mounting the pack underneath: the aircraft swings about
    the thrust plane rather than rotating around its own mass.
  */
  /*
    Scaled to the frame, because what matters is the lever arm relative to
    the aircraft's size, not an absolute height: 30 mm below the discs is
    unremarkable on a 10" and a long way down on a 3". Calibrated so an
    ordinary 5" build on a 30 mm pack stays quiet (about 22 mm against a
    31 mm limit) while a tall heavy pack slung underneath trips it.
  */
  const pendulumLimit = Math.max(28, d.wheelbaseMm * 0.15);
  const pendulum = d.cg.belowThrustMm;
  if (pendulum > pendulumLimit) {
    out.push({
      id: "cg-pendulous",
      severity: "warn",
      scope: "Performance",
      title: "The weight hangs a long way below the propellers",
      detail:
        d.spec.batteryMount === "bottom"
          ? "Thrust acts well above the centre of gravity, which adds rotational inertia and gives the aircraft a pendulum feel — it swings rather than rotating cleanly. Strapping the pack on top is the usual fix, and brings the mass up near the thrust plane."
          : "Thrust acts well above the centre of gravity, which adds rotational inertia and gives the aircraft a pendulum feel. A lighter pack or a shorter stack would bring the mass up.",
      measured: `${pendulum} mm below the discs`,
      limit: `${round(pendulumLimit)} mm`,
    });
  }

  /* --- fit ------------------------------------------------------------ */
  /*
    The plate is always sized at least `battery width + 8`, so the old
    width check could never fire. What does overhang is the length: the plate
    is deliberately shorter than the pack, so this measures the real
    cantilever of battery hanging off each end.
  */
  const overhangMm = round((d.spec.battery.l - d.bodyLmm) / 2);
  if (overhangMm > Math.max(25, d.bodyLmm * 0.45)) {
    out.push({
      id: "battery-overhang",
      severity: "warn",
      scope: "Fit",
      title: "Battery overhangs the frame a long way",
      detail:
        "A pack hanging well past the plate at both ends is exposed in a crash and adds pitch inertia, which makes the aircraft feel sluggish. Either a shorter pack or a longer plate.",
      measured: `${overhangMm} mm each end`,
      limit: `${round(d.bodyLmm * 0.45)} mm`,
    });
  }
  if (d.strapSlotMm < 18) {
    out.push({
      id: "strap-slot",
      severity: "warn",
      scope: "Fit",
      title: "Strap slots are narrow",
      detail: `This plate only fits a ${Math.floor(d.strapSlotMm)} mm strap. Order one to match — a 20 mm strap will not pass through.`,
      measured: `${d.strapSlotMm} mm`,
    });
  }
  if (d.wheelbaseCrowded) {
    out.push({
      id: "wheelbase-crowded",
      severity: "warn",
      scope: "Layout",
      title: "The frame is bigger than the propellers need",
      detail:
        d.spec.construction === "bolted"
          ? `The propellers would clear at ${d.propMinWheelbaseMm} mm, but the stack and the arm clamp bolts need ${d.minWheelbaseMm} mm of frame to sit in. A smaller flight controller stack, or unibody construction — which has no clamp bolts to make room for — would let this frame shrink to what the propellers actually want.`
          : `The propellers would clear at ${d.propMinWheelbaseMm} mm, but the stack needs ${d.minWheelbaseMm} mm of frame around it. A smaller flight controller stack would let this frame shrink.`,
      measured: `${d.minWheelbaseMm} mm`,
      limit: `${d.propMinWheelbaseMm} mm`,
    });
  }

  /*
    Only when the size was a choice. A stretched X or an H measures longer on
    the diagonal than a true X on the same propellers, and a small bolted
    frame cannot be smaller than its clamp bolts allow — warning that the
    frame is "larger than typical" when it is already the smallest this
    layout can be told the user to fix something they had not chosen.
  */
  if (d.referenceBand && d.wheelbaseMm > d.referenceBand.max && d.wheelbaseMm > d.minWheelbaseMm + 0.5) {
    out.push({
      id: "wheelbase-large",
      severity: "warn",
      scope: "Layout",
      title: "Larger than typical for this prop",
      detail: `Frames for ${d.spec.propIn}" props usually run ${d.referenceBand.min}–${d.referenceBand.max} mm. A longer arm is heavier and more flexible for no extra lift.`,
      measured: `${d.wheelbaseMm} mm`,
      limit: `${d.referenceBand.max} mm`,
    });
  }

  return out;
}

/**
 * What would actually make this frame stiff enough, in order of effect.
 *
 * Stiffness goes with E·b·t³, so the levers are, in descending order: a
 * stiffer material, thicker stock, and a shorter arm. Suggesting a wider arm
 * is almost never the right answer.
 */
function stiffnessAdvice(d: FrameDesign): string {
  const better = MATERIALS.filter(
    (m) => m.method === d.material.method && m.structural && m.modulus > d.material.modulus * 1.5,
  ).sort((a, b) => b.modulus - a.modulus)[0];
  const parts: string[] = [];
  if (better) parts.push(`${better.name} is about ${Math.round(better.modulus / d.material.modulus)} times stiffer`);
  parts.push(`a smaller propeller shortens the arms, which helps most of all because stiffness falls with the cube of length`);
  return `Try ${parts.join(", or ")}.`;
}

/**
 * Smallest gap between two closed polygons, mm. Negative when they overlap.
 *
 * Point-to-edge rather than point-to-point: two rectangles can have every
 * vertex far from every other vertex while their edges cross, so comparing
 * corners alone would miss exactly the overlap this is looking for.
 */
function polygonGap(a: Pt[], b: Pt[]): number {
  let best = Infinity;
  for (const [poly, other] of [[a, b], [b, a]] as const) {
    for (const p of poly) {
      for (let i = 0, j = other.length - 1; i < other.length; j = i++) {
        best = Math.min(best, distanceToSegment(p, other[j], other[i]));
      }
    }
  }
  // Any vertex of one inside the other means they overlap, not merely touch.
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return -best;
  return best;
}

function holeFullyInside(h: Hole, poly: Pt[]): boolean {
  return pointInPolygon(h.c, poly) && distanceToBoundary(h.c, poly) >= h.r;
}

/** Worst severity present, for a single status line in the UI. */
export function worstSeverity(findings: Finding[]): Severity {
  if (findings.some((f) => f.severity === "error")) return "error";
  if (findings.some((f) => f.severity === "warn")) return "warn";
  return "ok";
}
