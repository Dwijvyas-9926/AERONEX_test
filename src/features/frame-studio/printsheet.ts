/*
  Frame Studio — the 1:1 print-and-check sheet.

  The cheapest mistake to catch is the one you catch on paper. Published
  guidance on designing a first frame says exactly this: print the design and
  physically measure it before sending it to be cut, because an off-centre
  mounting hole costs nothing to fix on screen and the price of a second cut
  afterwards. This goes a step further than measuring — lay the real motors,
  the real stack and the real battery on the print and see whether they fit.

  The whole exercise depends on one thing: that the print is actually 1:1. A
  printer driver set to "fit to page" will silently shrink the drawing by a
  few percent, every hole will still line up with every other hole, and the
  check will pass while telling you nothing. So every page carries a 100 mm
  ruler to measure first, and says so before it says anything else.

  Pages are SVG at true physical size. An SVG with width and height in
  millimetres and a matching viewBox prints at that size in every browser,
  which is what makes this work without a PDF writer.
*/

import { cameraById, type CameraSpec } from "./catalog";
import { type FrameDesign, type Hole, type Pt, type Profile } from "./geometry";

export interface PageSize {
  id: string;
  name: string;
  widthMm: number;
  heightMm: number;
}

/*
  Margins are generous on purpose. Nearly every consumer printer refuses to
  print within about 5 mm of the edge and will shrink the page to make the
  content fit if asked to print closer — which is the one failure this sheet
  exists to avoid.
*/
export const PAGE_MARGIN_MM = 10;

export const PAGE_SIZES: PageSize[] = [
  { id: "a4", name: "A4", widthMm: 210, heightMm: 297 },
  { id: "letter", name: "US Letter", widthMm: 215.9, heightMm: 279.4 },
];

export const pageSizeById = (id: string) => PAGE_SIZES.find((p) => p.id === id) ?? PAGE_SIZES[0];

/** Overlap between tiles, mm — something to line up and tape along. */
const TILE_OVERLAP_MM = 8;

export interface Tile {
  /** Column and row, zero-based, left to right and top to bottom. */
  col: number;
  row: number;
  /** Model-space rectangle this page shows, mm. */
  x: number;
  y: number;
  widthMm: number;
  heightMm: number;
}

export interface PrintPlan {
  tiles: Tile[];
  cols: number;
  rows: number;
  /** Model-space extent being covered, mm. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  page: PageSize;
}

/* ------------------------------------------------------------- assembling */

/** Rotate a local arm outline onto its bearing and shift it out to the root. */
function placeArm(pts: Pt[], bearing: number, shift: number): Pt[] {
  const cos = Math.cos(bearing);
  const sin = Math.sin(bearing);
  return pts.map(([x, y]) => {
    const X = x + shift;
    return [X * cos - y * sin, X * sin + y * cos] as Pt;
  });
}

export interface Assembled {
  /** Closed outlines to draw as cut lines. */
  outlines: Pt[][];
  holes: Hole[];
  /** Openings — strap slots, stack clearance, lightening. */
  slots: Pt[][];
  /** Component footprints to lay real parts against. */
  guides: { label: string; shape: Pt[]; dashed: true }[];
  /** Propeller discs, drawn faintly. */
  discs: { c: Pt; r: number }[];
}

/**
 * The frame as it will be assembled, in frame coordinates.
 *
 * Deliberately the assembled view rather than the nested cutting layout: the
 * point of this sheet is to put real components on it, and a nest tells you
 * nothing about whether the battery clears the arms.
 */
export function assembleForPrint(d: FrameDesign): Assembled {
  const outlines: Pt[][] = [];
  const holes: Hole[] = [];
  const slots: Pt[][] = [];

  const plate = d.profiles.find((p) => p.id === "bottom-plate" || p.id === "chassis");
  if (plate) {
    outlines.push(plate.outline);
    holes.push(...plate.holes);
    slots.push(...plate.slots);
  }

  // Arms, each copy rotated onto its own bearing.
  const shift = d.rootRadiusMm - d.armOverlapMm;
  for (const part of d.profiles.filter((p: Profile) => p.cantileverMm !== undefined)) {
    const group = d.armGroups.find((gr) => gr.id === part.id);
    for (const bearing of group?.bearings ?? []) {
      outlines.push(placeArm(part.outline, bearing, shift));
      for (const h of part.holes) holes.push({ ...h, c: placeArm([h.c], bearing, shift)[0] });
    }
  }

  /*
    Component footprints, dashed so they read as "put the real thing here"
    rather than as something to cut. These are the whole reason for the
    sheet: a battery outline on paper answers the overhang question in a way
    no number does.
  */
  const guides: Assembled["guides"] = [];
  const { l, w } = d.spec.battery;
  guides.push({
    label: `Battery ${l} × ${w} mm`,
    shape: rect(l, w).map(([x, y]) => [y, x] as Pt),
    dashed: true,
  });
  guides.push({
    label: `Stack ${d.spec.stackPattern} mm`,
    shape: rect(d.spec.stackPattern + 6, d.spec.stackPattern + 6),
    dashed: true,
  });

  const camera: CameraSpec = cameraById(d.spec.cameraId);
  if (camera.widthMm > 0) {
    guides.push({
      label: `${camera.name}`,
      shape: rect(camera.widthMm, camera.widthMm).map(([x, y]) => [x, y + d.bodyLmm / 2 - camera.widthMm / 2] as Pt),
      dashed: true,
    });
  }

  const discs = d.motors.map((m) => ({ c: m, r: d.propDiaMm / 2 }));
  return { outlines, holes, slots, guides, discs };
}

const rect = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/* ---------------------------------------------------------------- tiling */

function boundsOf(a: Assembled): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const eat = ([x, y]: Pt) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const o of a.outlines) o.forEach(eat);
  for (const g of a.guides) g.shape.forEach(eat);
  for (const h of a.holes) {
    eat([h.c[0] - h.r, h.c[1] - h.r]);
    eat([h.c[0] + h.r, h.c[1] + h.r]);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Work out how many pages the frame needs and what each one shows.
 *
 * Tiles overlap so there is material to line up and tape along; a butt joint
 * between two sheets of paper cannot be registered accurately by hand.
 */
export function planPrint(d: FrameDesign, page: PageSize): PrintPlan {
  const a = assembleForPrint(d);
  const bounds = boundsOf(a);
  // A margin of frame around the drawing, so nothing sits against a crop mark.
  const pad = 6;
  const totalW = bounds.maxX - bounds.minX + 2 * pad;
  const totalH = bounds.maxY - bounds.minY + 2 * pad;

  const usableW = page.widthMm - 2 * PAGE_MARGIN_MM;
  const usableH = page.heightMm - 2 * PAGE_MARGIN_MM;
  // Each tile past the first contributes its width less the overlap.
  const stepW = usableW - TILE_OVERLAP_MM;
  const stepH = usableH - TILE_OVERLAP_MM;
  const cols = Math.max(1, Math.ceil((totalW - usableW) / stepW) + 1);
  const rows = Math.max(1, Math.ceil((totalH - usableH) / stepH) + 1);

  const tiles: Tile[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      tiles.push({
        col,
        row,
        x: bounds.minX - pad + col * stepW,
        y: bounds.minY - pad + row * stepH,
        widthMm: usableW,
        heightMm: usableH,
      });
    }
  }
  return { tiles, cols, rows, bounds, page };
}

/* ------------------------------------------------------------------- SVG */

const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
const path = (pts: Pt[]) => `M ${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L ")} Z`;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * One page, at true physical size.
 *
 * The y axis is flipped on the way in: the frame's coordinates put forward at
 * +y as any drawing would, while SVG counts downwards.
 */
export function toPrintSVG(d: FrameDesign, plan: PrintPlan, tile: Tile, vehicleName: string): string {
  const a = assembleForPrint(d);
  const { page } = plan;
  const n = plan.tiles.indexOf(tile) + 1;

  const body: string[] = [];

  // Everything is drawn inside a group that maps model mm to page mm.
  body.push(`<g transform="translate(${f(PAGE_MARGIN_MM - tile.x)} ${f(PAGE_MARGIN_MM + tile.y + tile.heightMm)}) scale(1 -1)">`);

  for (const disc of a.discs) {
    body.push(`<circle cx="${f(disc.c[0])}" cy="${f(disc.c[1])}" r="${f(disc.r)}" class="disc"/>`);
  }
  for (const g of a.guides) {
    body.push(`<path d="${path(g.shape)}" class="guide"/>`);
  }
  for (const o of a.outlines) body.push(`<path d="${path(o)}" class="cut"/>`);
  for (const s of a.slots) body.push(`<path d="${path(s)}" class="cut"/>`);
  for (const h of a.holes) {
    body.push(`<circle cx="${f(h.c[0])}" cy="${f(h.c[1])}" r="${f(h.r)}" class="cut"/>`);
    // A cross in every hole, so a bolt can be centred by eye.
    body.push(
      `<path d="M ${f(h.c[0] - h.r - 1)},${f(h.c[1])} L ${f(h.c[0] + h.r + 1)},${f(h.c[1])} M ${f(h.c[0])},${f(h.c[1] - h.r - 1)} L ${f(h.c[0])},${f(h.c[1] + h.r + 1)}" class="centre"/>`,
    );
  }
  body.push(`</g>`);

  /*
    Guide labels, drawn upright rather than inside the flipped group, and
    hung just inside the top edge of their own outline rather than at its
    centre. Every footprint is centred on the frame, so centring the labels
    too printed the battery's and the stack's on top of each other.
  */
  for (const g of a.guides) {
    const cx = g.shape.reduce((s, p) => s + p[0], 0) / g.shape.length;
    const topY = Math.max(...g.shape.map((p) => p[1]));
    const px = PAGE_MARGIN_MM - tile.x + cx;
    const py = PAGE_MARGIN_MM + tile.y + tile.heightMm - topY + 3.2;
    if (px < 2 || px > page.widthMm - 2 || py < PAGE_MARGIN_MM || py > page.heightMm - PAGE_MARGIN_MM) continue;
    body.push(`<text x="${f(px)}" y="${f(py)}" class="glabel">${esc(g.label)}</text>`);
  }

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(page.widthMm)}mm" height="${f(page.heightMm)}mm" viewBox="0 0 ${f(page.widthMm)} ${f(page.heightMm)}">`,
    `<title>${esc(vehicleName)} — check sheet ${n} of ${plan.tiles.length}</title>`,
    style(),
    `<rect width="${f(page.widthMm)}" height="${f(page.heightMm)}" fill="#fff"/>`,
    ...body,
    cropMarks(page, tile, plan),
    ruler(page),
    header(page, plan, tile, d, vehicleName),
    `</svg>`,
  ].join("\n");
}

function style(): string {
  /*
    Hairlines throughout. A thick line has a middle, and when you are laying a
    motor on a bolt circle to see whether it fits, the middle of a 1 mm line
    is half a millimetre of doubt.
  */
  return `<style>
    .cut { fill: none; stroke: #000; stroke-width: 0.2; }
    .centre { fill: none; stroke: #000; stroke-width: 0.08; }
    .guide { fill: none; stroke: #000; stroke-width: 0.25; stroke-dasharray: 3 2; }
    .disc { fill: none; stroke: #bbb; stroke-width: 0.2; stroke-dasharray: 1 3; }
    .crop { fill: none; stroke: #000; stroke-width: 0.15; }
    .rule { fill: none; stroke: #000; stroke-width: 0.25; }
    text { font-family: Helvetica, Arial, sans-serif; fill: #000; }
    .glabel { font-size: 2.6px; text-anchor: middle; }
    .h1 { font-size: 3.6px; font-weight: bold; }
    .h2 { font-size: 2.8px; }
    .warn { font-size: 3.2px; font-weight: bold; }
    .tick { font-size: 2.4px; text-anchor: middle; }
  </style>`;
}

/** Corner marks and tile edges, for lining pages up and taping them. */
function cropMarks(page: PageSize, tile: Tile, plan: PrintPlan): string {
  const m = PAGE_MARGIN_MM;
  const x2 = page.widthMm - m;
  const y2 = page.heightMm - m;
  const arm = 4;
  const marks = [
    `M ${f(m)},${f(m + arm)} L ${f(m)},${f(m)} L ${f(m + arm)},${f(m)}`,
    `M ${f(x2 - arm)},${f(m)} L ${f(x2)},${f(m)} L ${f(x2)},${f(m + arm)}`,
    `M ${f(x2)},${f(y2 - arm)} L ${f(x2)},${f(y2)} L ${f(x2 - arm)},${f(y2)}`,
    `M ${f(m + arm)},${f(y2)} L ${f(m)},${f(y2)} L ${f(m)},${f(y2 - arm)}`,
  ];
  const note =
    plan.tiles.length > 1
      ? `<text x="${f(x2)}" y="${f(y2 + 6)}" class="h2" text-anchor="end">Trim to the marks, overlap ${TILE_OVERLAP_MM} mm and tape. Column ${tile.col + 1} of ${plan.cols}, row ${tile.row + 1} of ${plan.rows}.</text>`
      : "";
  return `<path d="${marks.join(" ")}" class="crop"/>${note}`;
}

/**
 * The scale ruler.
 *
 * The most important thing on the page. Everything else is only meaningful if
 * this measures 100 mm against a real ruler, so it is drawn first in reading
 * order and labelled as a check rather than as decoration.
 */
function ruler(page: PageSize): string {
  const x0 = PAGE_MARGIN_MM;
  const y = page.heightMm - PAGE_MARGIN_MM - 4;
  const parts: string[] = [`M ${f(x0)},${f(y)} L ${f(x0 + 100)},${f(y)}`];
  const labels: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const x = x0 + i * 10;
    const h = i % 5 === 0 ? 3.5 : 2;
    parts.push(`M ${f(x)},${f(y)} L ${f(x)},${f(y - h)}`);
    if (i % 5 === 0) labels.push(`<text x="${f(x)}" y="${f(y - 4.5)}" class="tick">${i * 10}</text>`);
  }
  /*
    Two short lines rather than one long one. A single sentence ran off the
    right-hand edge of A4 and the warning lost its last clause — on the one
    piece of text the whole sheet depends on.
  */
  return [
    `<path d="${parts.join(" ")}" class="rule"/>`,
    ...labels,
    `<text x="${f(x0 + 103)}" y="${f(y - 1.4)}" class="warn">mm — measure this first.</text>`,
    `<text x="${f(x0 + 103)}" y="${f(y + 2.4)}" class="h2">Not exactly 100 mm? The print is scaled; nothing else here can be trusted.</text>`,
  ].join("\n");
}

function header(page: PageSize, plan: PrintPlan, tile: Tile, d: FrameDesign, vehicleName: string): string {
  const y = PAGE_MARGIN_MM - 4.5;
  const n = plan.tiles.indexOf(tile) + 1;
  return [
    `<text x="${f(PAGE_MARGIN_MM)}" y="${f(y)}" class="h1">${esc(vehicleName)} — check sheet ${n} of ${plan.tiles.length}</text>`,
    `<text x="${f(page.widthMm - PAGE_MARGIN_MM)}" y="${f(y)}" class="warn" text-anchor="end">PRINT AT 100% — NOT "FIT TO PAGE"</text>`,
    `<text x="${f(PAGE_MARGIN_MM)}" y="${f(y + 3.4)}" class="h2">${d.spec.propIn}" ${d.spec.layout}, ${Math.round(d.wheelbaseMm)} mm wheelbase. Lay your motors, stack and battery on the dashed outlines before you pay for a cut.</text>`,
  ].join("\n");
}
