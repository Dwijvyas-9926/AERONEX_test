/*
  Frame Studio — the README that travels with an export.

  A cutting service or a print farm gets handed the archive and nothing else,
  so the drawings alone are not a complete brief: they carry no stock
  thickness, no quantity, no material, and no note about which way up a part
  should be made. This file writes that down in plain text beside them.

  It is also the record of what the archive is. Open an export six months
  later and the manifest says which aircraft it belongs to, what the frame
  was sized for, and what the studio decided — none of which is recoverable
  from a DXF.
*/

import { type BomLine, type RecipeStep } from "./bom";
import { LAYOUTS, type FrameDesign } from "./geometry";
import { cameraById } from "./catalog";

const slugify = (s: string) =>
  s
    // Decomposing first turns "ó" into "o" + a combining accent, so dropping
    // the marks keeps the letter. Replacing them instead would split the word:
    // "Avión" came out as "avio-n".
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    // A truncation can land on a separator; a name should not end in one.
    .replace(/-+$/g, "");

/**
 * File-name stem for an export, taken from the active vehicle profile.
 *
 * A frame is built for a particular aircraft, so the files are named after it:
 * rename the profile and the next export follows. The design's own
 * description is the fallback for when no profile is active, or when the
 * profile's name is punctuation that slugs away to nothing.
 */
export function exportSlug(profileName: string | null | undefined, d: FrameDesign): string {
  return (
    slugify(profileName ?? "") ||
    slugify(`aeronex ${d.spec.propIn}in ${d.spec.layout} ${Math.round(d.wheelbaseMm)}mm`)
  );
}

export interface ManifestFile {
  /** File name inside the archive. */
  name: string;
  /** What it holds, one line. */
  detail: string;
}

export interface ManifestInput {
  /** Name of the aircraft this frame belongs to. */
  vehicleName: string;
  design: FrameDesign;
  /**
   * What the archive holds.
   *
   * Not the same question as how the frame is made: a printed design still
   * offers a DXF for anyone who would rather cut the plates, and that archive
   * must carry the do-not-scale note for drawings, not the one for solids. An
   * earlier version read this off the material and told people cutting an
   * acrylic set to print one file per part.
   */
  kind: "drawings" | "solids";
  files: ManifestFile[];
  bom: BomLine[];
  recipe: RecipeStep[];
  /** Export date. Injected so the text is testable. */
  date?: Date;
}

const round = (n: number, dp = 0) => {
  const f = 10 ** dp;
  return String(Math.round(n * f) / f);
};

/** Wrap at `width`, indenting continuation lines to line up under the first. */
function wrap(text: string, width: number, indent: string): string {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join(`\n${indent}`);
}

/** `label` padded out so every value in a block starts at the same column. */
const row = (label: string, value: string) => `  ${label.padEnd(20)}${value}`;

const heading = (text: string) => `${text}\n${"-".repeat(text.length)}`;

/** The manifest text, as it is written into the archive. */
export function buildManifest({ vehicleName, design: d, kind, files, bom, recipe, date = new Date() }: ManifestInput): string {
  const layout = LAYOUTS.find((l) => l.id === d.spec.layout)?.name ?? d.spec.layout;
  const cut = d.material.method === "cut";
  const unibody = d.spec.construction === "unibody";
  const stamp = date.toISOString().slice(0, 10);

  const out: string[] = [];

  out.push(`AERONEX FRAME STUDIO — ${vehicleName}`);
  out.push(`${layout} airframe for ${d.spec.propIn}" propellers · exported ${stamp}`);
  out.push("");

  out.push(heading("The design"));
  out.push(row("Vehicle", vehicleName));
  out.push(row("Layout", `${layout}, ${d.spec.propIn}" propellers`));
  out.push(row("Wheelbase", `${round(d.wheelbaseMm)} mm motor to motor`));
  out.push(row("Construction", unibody ? "Unibody — arms and bottom plate are one piece" : "Bolted — arms clamped between two plates"));
  out.push(row("Material", d.material.name));
  out.push(row("Made by", cut ? "Cutting it from sheet — laser, router or waterjet" : "3D printing it"));
  if (cut) {
    out.push(row("Arm stock", `${round(d.stock.armDimMm, 1)} mm sheet, ${round(d.section.widthMm, 1)} mm wide at the root`));
    if (!unibody) out.push(row("Plate stock", `${round(d.stock.bottomPlateMm, 1)} mm bottom, ${round(d.stock.topPlateMm, 1)} mm top`));
  } else {
    out.push(row("Arm section", `${round(d.section.widthMm, 1)} × ${round(d.section.heightMm, 1)} mm hollow box, ${round(d.stock.wallMm, 1)} mm walls`));
    out.push(row("Plates", `${round(d.stock.bottomPlateMm, 1)} mm bottom, ${round(d.stock.topPlateMm, 1)} mm top`));
  }
  out.push(row("Motors", `${d.motors.length} × ${d.motor.size} stator, ${round(d.spec.motorThrustG)} g peak thrust each`));
  out.push(
    row(
      "Propellers",
      `${d.spec.propIn}" — ${d.motor.size} motors are built for ${d.motor.props.map((p) => `${p}"`).join(" or ")}`,
    ),
  );
  // The thrust figure above is only meaningful with a voltage behind it, and
  // every number in this design follows from that one input.
  if (Math.abs(d.spec.motorThrustG - d.motor.thrustG) < 1e-9) {
    out.push(row("Thrust assumed at", `${d.motor.thrustCells}S, ${d.motor.kv[0]}–${d.motor.kv[1]} KV (studio default)`));
  }
  out.push(row("Battery", `${d.spec.batteryMount === "top" ? "Strapped on top" : "Strapped underneath"}, ${d.spec.battery.l} × ${d.spec.battery.w} × ${d.spec.battery.h} mm`));
  if (d.spec.cameraId !== "none") {
    out.push(row("Camera", `${cameraById(d.spec.cameraId).name} — side plates ${d.spec.cameraId === "none" ? "" : `${cameraById(d.spec.cameraId).widthMm} mm apart`}`));
  }
  out.push(row("Frame mass", `${round(d.mass.frameG)} g bare, ${round(d.mass.auwG)} g all-up`));
  out.push(row("Mass below discs", `${d.cg.belowThrustMm} mm — centre of gravity to the propeller plane`));
  if (d.lightening.count > 0) {
    out.push(row("Lightening", `${d.lightening.count} cut-outs, ${d.lightening.savedG} g saved`));
  }
  out.push(row("Thrust / weight", `${round(d.thrustToWeight, 1)} : 1 — hovers near ${round(d.hoverThrottle * 100)}% throttle`));
  out.push(row("Sized by", `${d.section.governing} load case`));
  out.push(
    row(
      "Arm deflection",
      `${round(d.section.deflectionMm, 1)} mm at the motor under one motor's full thrust`,
    ),
  );
  out.push("");

  out.push(heading("Files in this archive"));
  for (const f of files) {
    out.push(`  ${f.name}`);
    out.push(`      ${wrap(f.detail, 68, "      ")}`);
  }
  out.push("  README.txt");
  out.push("      This file.");
  out.push("");
  out.push(
    `  ${wrap(
      kind === "drawings"
        ? "Every drawing is 1:1 in millimetres. Cut each file from its own stock thickness — the thickness is in the file name — and do not scale anything to fit."
        : "Every solid is in millimetres at final size. Print one file per part at the quantity in the file name; do not scale to fit the bed.",
      68,
      "  ",
    )}`,
  );
  out.push("");

  out.push(heading("What to order"));
  for (const l of bom) {
    out.push(`  ${String(l.qty).padStart(3)}×  ${l.item}`);
    out.push(`        ${wrap(l.purpose, 66, "        ")}`);
    if (l.note) out.push(`        ${wrap(`Note: ${l.note}`, 66, "        ")}`);
  }
  out.push("");

  out.push(heading("Making it"));
  recipe.forEach((s, i) => {
    out.push(`  ${i + 1}. ${s.title}`);
    out.push(`     ${wrap(s.detail, 69, "     ")}`);
    out.push("");
  });

  out.push(
    wrap(
      "Generated by AERONEX Frame Studio. The numbers above come from beam theory calibrated against production frames, not from a simulation of your exact build — check the fit of the first set of parts before cutting or printing a batch.",
      72,
      "",
    ),
  );
  out.push("");

  return out.join("\n");
}
