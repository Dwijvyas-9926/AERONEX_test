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
import { PdfDoc, type Pen, type TextStyle } from "./pdf";
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

/** Length of the scale ruler on every page, mm. The whole sheet rests on it. */
export const RULER_MM = 100;

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

/* ------------------------------------------------------------- rendering */

/*
  One drawing routine, two backends.

  The page is laid out once, against this interface, and an SVG writer or the
  PDF writer carries it out. Written twice they drift, and the thing that
  drifts first is never the frame outline — it is the ruler or the
  print-at-100% warning, which is the one part of the sheet that must be
  identical everywhere because everything else depends on it.

  Coordinates are page-space millimetres with y running down, matching SVG
  and the way the tiles are planned. The PDF backend flips it.
*/
export interface Sheet {
  poly(pts: Pt[], pen: Pen, close?: boolean): void;
  circle(c: Pt, r: number, pen: Pen): void;
  text(at: Pt, s: string, style: TextStyle): void;
}

/* Pens, named once so both backends and both formats agree. */
const CUT: Pen = { stroke: "#000000", width: 0.2 };
const CENTRE: Pen = { stroke: "#000000", width: 0.08 };
const GUIDE: Pen = { stroke: "#000000", width: 0.25, dash: [3, 2] };
const DISC: Pen = { stroke: "#bbbbbb", width: 0.2, dash: [1, 3] };
const CROP: Pen = { stroke: "#000000", width: 0.15 };
const RULE: Pen = { stroke: "#000000", width: 0.25 };

/** Draw one page of the check sheet. */
export function drawPage(sheet: Sheet, d: FrameDesign, plan: PrintPlan, tile: Tile, vehicleName: string): void {
  const a = assembleForPrint(d);
  const { page } = plan;
  const index = plan.tiles.indexOf(tile) + 1;

  /*
    Model space to page space. The design has +y forward, as a drawing would;
    the page counts y downwards, so the sign flips here once and nowhere else.
  */
  const toPage = ([x, y]: Pt): Pt => [
    PAGE_MARGIN_MM - tile.x + x,
    PAGE_MARGIN_MM + tile.y + tile.heightMm - y,
  ];

  for (const disc of a.discs) sheet.circle(toPage(disc.c), disc.r, DISC);
  for (const g of a.guides) sheet.poly(g.shape.map(toPage), GUIDE);
  for (const o of a.outlines) sheet.poly(o.map(toPage), CUT);
  for (const s of a.slots) sheet.poly(s.map(toPage), CUT);

  for (const h of a.holes) {
    const c = toPage(h.c);
    sheet.circle(c, h.r, CUT);
    // A cross in every hole, so a bolt can be centred on it by eye.
    sheet.poly([[c[0] - h.r - 1, c[1]], [c[0] + h.r + 1, c[1]]], CENTRE, false);
    sheet.poly([[c[0], c[1] - h.r - 1], [c[0], c[1] + h.r + 1]], CENTRE, false);
  }

  /*
    Guide labels hang just inside the top edge of their own outline rather
    than at its centre. Every footprint is centred on the frame, so centring
    the labels too printed the battery's and the stack's on top of each other.
  */
  for (const g of a.guides) {
    const cx = g.shape.reduce((s, p) => s + p[0], 0) / g.shape.length;
    const top = Math.max(...g.shape.map((p) => p[1]));
    const [px, py] = toPage([cx, top]);
    if (px < 2 || px > page.widthMm - 2 || py < PAGE_MARGIN_MM || py > page.heightMm - PAGE_MARGIN_MM) continue;
    sheet.text([px, py + 3.2], g.label, { size: 2.6, anchor: "middle" });
  }

  drawCropMarks(sheet, page, tile, plan);
  drawRuler(sheet, page);
  drawHeader(sheet, page, plan, index, d, vehicleName);
}

/** Corner marks and the note on joining pages. */
function drawCropMarks(sheet: Sheet, page: PageSize, tile: Tile, plan: PrintPlan): void {
  const m = PAGE_MARGIN_MM;
  const x2 = page.widthMm - m;
  const y2 = page.heightMm - m;
  const arm = 4;
  sheet.poly([[m, m + arm], [m, m], [m + arm, m]], CROP, false);
  sheet.poly([[x2 - arm, m], [x2, m], [x2, m + arm]], CROP, false);
  sheet.poly([[x2, y2 - arm], [x2, y2], [x2 - arm, y2]], CROP, false);
  sheet.poly([[m + arm, y2], [m, y2], [m, y2 - arm]], CROP, false);
  if (plan.tiles.length > 1) {
    sheet.text(
      [x2, y2 + 6],
      `Trim to the marks, overlap ${TILE_OVERLAP_MM} mm and tape. Column ${tile.col + 1} of ${plan.cols}, row ${tile.row + 1} of ${plan.rows}.`,
      { size: 2.8, anchor: "end" },
    );
  }
}

/**
 * The scale ruler — the most important thing on the page.
 *
 * Everything else is only meaningful if this measures 100 mm against a real
 * ruler, so it is drawn in reading order before the rest of the furniture and
 * labelled as a check rather than as decoration.
 */
function drawRuler(sheet: Sheet, page: PageSize): void {
  const x0 = PAGE_MARGIN_MM;
  const y = page.heightMm - PAGE_MARGIN_MM - 4;
  sheet.poly([[x0, y], [x0 + RULER_MM, y]], RULE, false);
  for (let i = 0; i <= 10; i++) {
    const x = x0 + i * 10;
    const h = i % 5 === 0 ? 3.5 : 2;
    sheet.poly([[x, y], [x, y - h]], RULE, false);
    if (i % 5 === 0) sheet.text([x, y - 4.5], String(i * 10), { size: 2.4, anchor: "middle" });
  }
  /*
    Two short lines rather than one long one. A single sentence ran off the
    right-hand edge of A4 and lost its last clause — on the one piece of text
    the whole sheet depends on.
  */
  sheet.text([x0 + RULER_MM + 3, y - 1.4], "mm — measure this first.", { size: 3.2, bold: true });
  sheet.text(
    [x0 + RULER_MM + 3, y + 2.4],
    "Not exactly 100 mm? The print is scaled; nothing else here can be trusted.",
    { size: 2.8 },
  );
}

function drawHeader(sheet: Sheet, page: PageSize, plan: PrintPlan, index: number, d: FrameDesign, vehicleName: string): void {
  const y = PAGE_MARGIN_MM - 4.5;
  sheet.text([PAGE_MARGIN_MM, y], `${vehicleName} — check sheet ${index} of ${plan.tiles.length}`, { size: 3.6, bold: true });
  sheet.text([page.widthMm - PAGE_MARGIN_MM, y], 'PRINT AT 100% — NOT "FIT TO PAGE"', { size: 3.2, bold: true, anchor: "end" });
  sheet.text(
    [PAGE_MARGIN_MM, y + 3.4],
    `${d.spec.propIn}" ${d.spec.layout}, ${Math.round(d.wheelbaseMm)} mm wheelbase. Lay your motors, stack and battery on the dashed outlines before you pay for a cut.`,
    { size: 2.8 },
  );
}

/* ------------------------------------------------------------------- SVG */

const f = (v: number) => (Math.round(v * 1000) / 1000).toString();

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** An SVG backend, for looking at a page in a browser. */
class SvgSheet implements Sheet {
  readonly parts: string[] = [];

  private attrs(pen: Pen): string {
    const out = [`fill="${pen.fill ?? "none"}"`, `stroke="${pen.stroke ?? "none"}"`, `stroke-width="${f(pen.width ?? 0.2)}"`];
    if (pen.dash) out.push(`stroke-dasharray="${f(pen.dash[0])} ${f(pen.dash[1])}"`);
    return out.join(" ");
  }

  poly(pts: Pt[], pen: Pen, close = true): void {
    if (pts.length < 2) return;
    const d = `M ${pts.map(([x, y]) => `${f(x)},${f(y)}`).join(" L ")}${close ? " Z" : ""}`;
    this.parts.push(`<path d="${d}" ${this.attrs(pen)}/>`);
  }

  circle(c: Pt, r: number, pen: Pen): void {
    this.parts.push(`<circle cx="${f(c[0])}" cy="${f(c[1])}" r="${f(r)}" ${this.attrs(pen)}/>`);
  }

  text(at: Pt, s: string, style: TextStyle): void {
    const anchor = style.anchor === "middle" ? "middle" : style.anchor === "end" ? "end" : "start";
    this.parts.push(
      `<text x="${f(at[0])}" y="${f(at[1])}" font-family="Helvetica, Arial, sans-serif" ` +
        `font-size="${f(style.size)}" ${style.bold ? 'font-weight="bold" ' : ""}` +
        `text-anchor="${anchor}" fill="${style.color ?? "#000000"}">${esc(s)}</text>`,
    );
  }
}

/**
 * One page as an SVG at true physical size.
 *
 * Width and height in millimetres with a matching viewBox is what makes a
 * browser print this at the size it says; get the two out of step and every
 * page is silently scaled.
 */
export function toPrintSVG(d: FrameDesign, plan: PrintPlan, tile: Tile, vehicleName: string): string {
  const sheet = new SvgSheet();
  drawPage(sheet, d, plan, tile, vehicleName);
  const { page } = plan;
  const index = plan.tiles.indexOf(tile) + 1;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(page.widthMm)}mm" height="${f(page.heightMm)}mm" viewBox="0 0 ${f(page.widthMm)} ${f(page.heightMm)}">`,
    `<title>${esc(vehicleName)} — check sheet ${index} of ${plan.tiles.length}</title>`,
    `<rect width="${f(page.widthMm)}" height="${f(page.heightMm)}" fill="#fff"/>`,
    ...sheet.parts,
    `</svg>`,
  ].join("\n");
}

/* ------------------------------------------------------------------- PDF */

/**
 * The whole check sheet as one PDF, every page at true size.
 *
 * What the user actually wants to print. A print dialog honours a PDF's own
 * page size, so "Actual size" means 1:1 without argument — where a folder of
 * SVGs meant opening each in a browser whose print dialog scales to fit by
 * default, which is the single failure this sheet exists to prevent.
 */
export function toPrintPDF(d: FrameDesign, plan: PrintPlan, vehicleName: string): Uint8Array {
  const doc = new PdfDoc(plan.page.widthMm, plan.page.heightMm);
  for (const tile of plan.tiles) {
    drawPage(doc, d, plan, tile, vehicleName);
    doc.endPage();
  }
  return doc.build(`${vehicleName} — frame check sheet`);
}
