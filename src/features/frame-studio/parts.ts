/*
  Frame Studio — what colour each part is drawn in.

  Kept out of the 3D component on purpose. That module pulls in three.js and
  is loaded lazily, so the page cannot import a palette from it without
  dragging a megabyte of renderer along to draw four swatches in a legend.

  Colour says which part it is; the material shows in the finish instead —
  metalness and roughness, which is where a material actually reads. Carrying
  both on colour was tried and failed at both jobs: carbon is a near-black
  #3a352f, so a carbon frame rendered as a silhouette, and four parts sharing
  one shade cannot tell a reader which piece is which.

  The hues are picked to stay apart on the light ground the solid view uses,
  and to differ in lightness as well as hue so they survive being looked at
  by someone who does not separate red from green.
*/

export interface PartLook {
  color: string;
  label: string;
}

export const PART_LOOK: Record<string, PartLook> = {
  "bottom-plate": { color: "#3f6b86", label: "Bottom plate" },
  chassis: { color: "#3f6b86", label: "Chassis" },
  arm: { color: "#c08436", label: "Arms" },
  "top-plate": { color: "#7d5a86", label: "Top plate" },
  "camera-plate": { color: "#4f8257", label: "Camera mount" },
};

const FALLBACK: PartLook = { color: "#8a6a4e", label: "Part" };

/**
 * The palette entry for a part id.
 *
 * Every arm variant shares the arm colour: a dead cat has "arm-long" and
 * "arm-short", and coding them differently would say they are different kinds
 * of thing when they are the same part at two lengths.
 */
export function lookForPart(id: string): PartLook {
  if (id.startsWith("arm")) return PART_LOOK.arm;
  return PART_LOOK[id] ?? { ...FALLBACK, label: id };
}
