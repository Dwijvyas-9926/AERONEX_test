/*
  Frame Studio — the 1:1 print-and-check sheet.

  The cheapest mistake to catch is the one you catch on paper. Published
  guidance on designing a first frame says exactly this: print the design and
  physically measure it before sending it to be cut, because an off-centre
  mounting hole costs nothing to fix on screen and the price of a second cut
  afterwards. This goes a step further than measuring — lay the real motors,
  the real stack and the real battery on the print and see whether they fit.

  One part per page, drawn full size and centred, with its dimensions set out
  beside it. The sheet used to print the whole assembled aircraft instead,
  tiled across four pages of A4: a 5" frame with its propeller discs is well
  over 300 mm across, so every page came out as an off-centre crop of
  something larger and no single page showed a whole part. A part drawing is
  what a person actually checks against — you lay the stack on the bottom
  plate, not on a quarter of an aeroplane.

  Parts are deduplicated for free: the design already carries one profile per
  distinct part with the quantity on it, so a true X yields one arm drawing
  and a dead cat — whose front and rear arms are different lengths — yields
  two.

  The whole exercise depends on one thing: that the print is actually 1:1. A
  printer driver set to "fit to page" will silently shrink the drawing by a
  few percent, every hole will still line up with every other hole, and the
  check will pass while telling you nothing. So every page carries a 100 mm
  ruler to measure first, and says so before it says anything else.
*/

import { cameraById } from "./catalog";
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

/* --------------------------------------------------------------- the page */

/** Title and strapline band below the top margin, mm. */
const HEADER_H = 13;
/** Height of one row in the dimensions table, mm. */
const SPEC_ROW_H = 3.9;
/** The dimensions table's heading and its rule, mm. */
const SPEC_HEAD_H = 5.6;
/** Clear space between the drawing and the table below it, mm. */
const SPEC_GAP = 5;
/** Space the ruler and its warning need above the bottom margin, mm. */
const RULER_BLOCK_H = 13;

interface Layout {
  /** The drawing area, page-space mm with y running down. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Baseline of the dimensions table's heading rule. */
  specTop: number;
  /** Baseline of the ruler. */
  rulerY: number;
}

/**
 * Where everything sits on the page.
 *
 * Shared by the planner and the renderer. Worked out twice they drift, and
 * what drifts is the drawing area — so the planner centres a part in a box
 * the renderer then draws somewhere else.
 */
function layout(page: PageSize, specRows: number): Layout {
  const m = PAGE_MARGIN_MM;
  const rulerY = page.heightMm - m - 4;
  const specH = SPEC_HEAD_H + Math.ceil(specRows / 2) * SPEC_ROW_H;
  const specTop = rulerY - RULER_BLOCK_H - specH;
  return {
    x0: m,
    y0: m + HEADER_H,
    x1: page.widthMm - m,
    y1: specTop - SPEC_GAP,
    specTop,
    rulerY,
  };
}

/* ------------------------------------------------------- what gets drawn */

export interface Guide {
  label: string;
  shape: Pt[];
}

/** One part, in part coordinates, with whatever is laid on top of it. */
export interface PartDrawing {
  outline: Pt[];
  holes: Hole[];
  slots: Pt[][];
  /** Component footprints to lay the real thing against. */
  guides: Guide[];
}

const rect = (w: number, h: number): Pt[] => [
  [-w / 2, -h / 2],
  [w / 2, -h / 2],
  [w / 2, h / 2],
  [-w / 2, h / 2],
];

/** Turn a part a quarter turn, so a long thin one fits the page upright. */
const turnPt = ([x, y]: Pt): Pt => [y, -x];

/**
 * The part as it should be drawn, and what to lay on it.
 *
 * The dashed footprints are the whole reason this sheet exists: a battery
 * outline on paper answers the overhang question in a way no number does.
 * They go on the page of the part they actually bear against, which is also
 * what stopped them all piling up on one drawing on top of each other.
 */
export function partDrawing(d: FrameDesign, profile: Profile, turned = false): PartDrawing {
  const guides: Guide[] = [];
  const stack = d.spec.stackPattern + 6;

  if (profile.id === "bottom-plate" || profile.id === "chassis") {
    const { l, w } = d.spec.battery;
    // The pack lies along the frame, so its length runs fore and aft.
    guides.push({ label: `Battery ${l} × ${w} mm`, shape: rect(w, l) });
    guides.push({ label: `Stack ${d.spec.stackPattern} mm`, shape: rect(stack, stack) });
  } else if (profile.id === "top-plate") {
    guides.push({ label: `Stack ${d.spec.stackPattern} mm`, shape: rect(stack, stack) });
  } else if (profile.id === "camera-plate") {
    const camera = cameraById(d.spec.cameraId);
    if (camera.widthMm > 0) {
      /*
        Against the pivot rather than the plate's centre: the camera hangs
        from the pivot bolt, so that is where it has to be checked, and the
        pivot is the topmost hole on the plate.
      */
      const pivot = profile.holes.reduce((a, b) => (b.c[1] > a.c[1] ? b : a), profile.holes[0]);
      const c = pivot ? pivot.c : ([0, 0] as Pt);
      guides.push({
        label: camera.name,
        shape: rect(camera.widthMm, camera.widthMm).map(([x, y]) => [x + c[0], y + c[1] - camera.widthMm / 2 + 2] as Pt),
      });
    }
  }

  const out: PartDrawing = { outline: profile.outline, holes: profile.holes, slots: profile.slots, guides };
  if (!turned) return out;
  return {
    outline: out.outline.map(turnPt),
    holes: out.holes.map((h) => ({ ...h, c: turnPt(h.c) })),
    slots: out.slots.map((s) => s.map(turnPt)),
    guides: out.guides.map((g) => ({ ...g, shape: g.shape.map(turnPt) })),
  };
}

/* -------------------------------------------------------- the dimensions */

export interface SpecRow {
  label: string;
  value: string;
}

const mm = (v: number, dp = 1) => `${(Math.round(v * 10 ** dp) / 10 ** dp).toFixed(dp)} mm`;

function extent(pts: Pt[]): { w: number; l: number; minX: number; minY: number; maxX: number; maxY: number } {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { w: maxX - minX, l: maxY - minY, minX, minY, maxX, maxY };
}

/** Hole diameters present, largest first, with how many of each. */
function holeSchedule(holes: Hole[]): string {
  const byDia = new Map<string, number>();
  for (const h of holes) {
    const key = (Math.round(h.r * 20) / 10).toFixed(1);
    byDia.set(key, (byDia.get(key) ?? 0) + 1);
  }
  if (byDia.size === 0) return "none";
  return [...byDia.entries()]
    .sort((a, b) => Number(b[0]) - Number(a[0]))
    .map(([dia, n]) => `${n} × Ø${dia}`)
    .join(", ");
}

const bearingList = (rad: number[]): string =>
  rad.map((b) => `${Math.round(((b * 180) / Math.PI + 360) % 360)}°`).join(", ");

/**
 * Everything worth stating about one part, as label and value.
 *
 * Measured off the geometry that is actually drawn rather than recited from
 * the spec, so the table cannot disagree with the lines above it.
 */
export function partSpecs(d: FrameDesign, profile: Profile): SpecRow[] {
  const e = extent(profile.outline);
  const rows: SpecRow[] = [
    { label: "Quantity", value: `${profile.qty} off` },
    { label: "Material", value: d.material.name },
    { label: "Thickness", value: mm(profile.thicknessMm, 1) },
    { label: "Overall", value: `${mm(e.w, 1)} × ${mm(e.l, 1)}` },
    { label: "Holes", value: holeSchedule(profile.holes) },
  ];

  const functional = profile.lightenedFrom ?? profile.slots.length;
  const lightened = profile.slots.length - functional;
  if (functional > 0) rows.push({ label: "Openings", value: `${functional} cut` });
  if (lightened > 0) rows.push({ label: "Lightening", value: `${lightened} cut-out${lightened === 1 ? "" : "s"}` });

  if (profile.cantileverMm !== undefined) {
    const group = d.armGroups.find((g) => g.id === profile.id);
    rows.push({ label: "Exposed length", value: mm(profile.cantileverMm, 1) });
    rows.push({ label: "Clamped length", value: mm(d.armOverlapMm, 1) });
    rows.push({
      label: "Section",
      value: `${mm(d.section.widthMm, 1)} × ${mm(d.section.heightMm, 1)}`,
    });
    rows.push({ label: "Motor pattern", value: `${d.motor.pattern} mm, M${d.motor.bolt}` });
    if (group) rows.push({ label: "Fitted at", value: bearingList(group.bearings) });
  } else if (profile.id === "bottom-plate" || profile.id === "chassis") {
    rows.push({ label: "Stack pattern", value: `${d.spec.stackPattern} mm square, M${d.spec.stackBolt}` });
    rows.push({ label: "Arm clamp bolts", value: `M${d.rootBoltMm}` });
    rows.push({
      label: "Battery",
      value: `${d.spec.battery.l} × ${d.spec.battery.w} mm, ${d.spec.batteryMount === "top" ? "on top" : "underneath"}`,
    });
  } else if (profile.id === "top-plate") {
    rows.push({ label: "Arm clamp bolts", value: `M${d.rootBoltMm}` });
    rows.push({
      label: "Stack opening",
      value: d.stackClearance.openingMm > 0 ? `${mm(d.stackClearance.openingMm, 1)} square` : "none needed",
    });
    if (d.cameraMount) rows.push({ label: "Camera feet", value: "4 slots, see drawing" });
  } else if (profile.id === "camera-plate") {
    const camera = cameraById(d.spec.cameraId);
    rows.push({ label: "Camera", value: camera.name });
    if (d.cameraMount) rows.push({ label: "Plate spacing", value: mm(d.cameraMount.spacingMm, 1) });
    rows.push({ label: "Pivot bolt", value: `M${camera.bolt}` });
    rows.push({ label: "Tilt holes", value: `${Math.max(0, profile.holes.length - 1)} positions` });
  }

  rows.push({ label: "Cut area", value: `${Math.round(profile.areaMm2)} mm²` });
  return rows;
}

/* --------------------------------------------------------------- planning */

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

export interface PartPage {
  profile: Profile;
  tile: Tile;
  /** Which sheet of this part, 1-based, and how many it takes. */
  index: number;
  of: number;
  cols: number;
  rows: number;
  /** True when the part is drawn a quarter turn round to fit the page. */
  turned: boolean;
  specs: SpecRow[];
}

export interface PrintPlan {
  page: PageSize;
  pages: PartPage[];
}

/** A margin of paper around the drawing, so nothing sits against a crop mark. */
const PART_PAD = 7;

function drawingBounds(p: PartDrawing) {
  const pts: Pt[] = [...p.outline, ...p.guides.flatMap((g) => g.shape)];
  for (const h of p.holes) {
    pts.push([h.c[0] - h.r, h.c[1] - h.r], [h.c[0] + h.r, h.c[1] + h.r]);
  }
  return extent(pts.length > 0 ? pts : [[0, 0]]);
}

/**
 * Work out which pages the sheet needs.
 *
 * One page per part wherever a part fits on one, which — with the drawing
 * turned a quarter round when that helps — is every part of every frame the
 * studio draws up to 10". A part too large for a page is tiled with an
 * overlap to tape along, and that is the only case in which a drawing is
 * split at all.
 */
export function planPrint(d: FrameDesign, page: PageSize): PrintPlan {
  const pages: PartPage[] = [];

  for (const profile of d.profiles) {
    const specs = partSpecs(d, profile);
    const L = layout(page, specs.length);
    const areaW = L.x1 - L.x0;
    const areaH = L.y1 - L.y0;

    /*
      Upright first, then turned. An arm is long and thin, and on a portrait
      page the difference between the two is whether it needs one sheet or
      four.
    */
    let turned = false;
    let draw = partDrawing(d, profile, false);
    let b = drawingBounds(draw);
    const fits = (x: ReturnType<typeof drawingBounds>) =>
      x.w + 2 * PART_PAD <= areaW && x.l + 2 * PART_PAD <= areaH;
    if (!fits(b)) {
      const alt = partDrawing(d, profile, true);
      const altB = drawingBounds(alt);
      if (fits(altB) || altB.w / altB.l < b.w / b.l) {
        turned = true;
        draw = alt;
        b = altB;
      }
    }

    const totalW = b.w + 2 * PART_PAD;
    const totalH = b.l + 2 * PART_PAD;
    const stepW = areaW - TILE_OVERLAP_MM;
    const stepH = areaH - TILE_OVERLAP_MM;
    const cols = totalW <= areaW ? 1 : Math.ceil((totalW - areaW) / stepW) + 1;
    const rows = totalH <= areaH ? 1 : Math.ceil((totalH - areaH) / stepH) + 1;

    /*
      Centre the part in the paper it gets. On one page that is the drawing
      area; across several it is the whole tiled canvas, so the part sits in
      the middle of the taped-up sheet rather than against its first corner.
    */
    const originX = b.minX - (cols * areaW - (cols - 1) * TILE_OVERLAP_MM - b.w) / 2;
    const originY = b.minY - (rows * areaH - (rows - 1) * TILE_OVERLAP_MM - b.l) / 2;

    const of = cols * rows;
    let index = 0;
    for (let row = rows - 1; row >= 0; row--) {
      for (let col = 0; col < cols; col++) {
        index++;
        pages.push({
          profile,
          turned,
          specs,
          index,
          of,
          cols,
          rows,
          tile: {
            col,
            row,
            x: originX + col * stepW,
            y: originY + row * stepH,
            widthMm: areaW,
            heightMm: areaH,
          },
        });
      }
    }
  }

  return { page, pages };
}

/* ------------------------------------------------------------- rendering */

/*
  One drawing routine, two backends.

  The page is laid out once, against this interface, and an SVG writer or the
  PDF writer carries it out. Written twice they drift, and the thing that
  drifts first is never the part outline — it is the ruler or the
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
const CUT: Pen = { stroke: "#000000", width: 0.3 };
const CENTRE: Pen = { stroke: "#000000", width: 0.08 };
const GUIDE: Pen = { stroke: "#000000", width: 0.25, dash: [3, 2] };
const CROP: Pen = { stroke: "#000000", width: 0.15 };
const RULE: Pen = { stroke: "#000000", width: 0.25 };
const DIM: Pen = { stroke: "#000000", width: 0.12 };
const ARROW: Pen = { fill: "#000000" };
const HAIR: Pen = { stroke: "#000000", width: 0.15 };

/* ------------------------------------------------------ dimension arrows */

const ARROW_L = 2.2;
const ARROW_W = 0.75;

/** An arrowhead at `tip`, pointing along (dx, dy). */
function arrow(sheet: Sheet, tip: Pt, dx: number, dy: number): void {
  const bx = tip[0] - dx * ARROW_L;
  const by = tip[1] - dy * ARROW_L;
  sheet.poly([tip, [bx - dy * ARROW_W, by + dx * ARROW_W], [bx + dy * ARROW_W, by - dx * ARROW_W]], ARROW);
}

/**
 * A dimension between two page-space positions, with the value on it.
 *
 * Drawn the way a part drawing draws one — witness lines out from the
 * feature, arrows turned inwards, the figure reading along the line — so the
 * page is checked against the same way any other drawing would be.
 */
function dimension(sheet: Sheet, from: Pt, to: Pt, off: number, label: string, vertical: boolean): void {
  const span = vertical ? Math.abs(to[1] - from[1]) : Math.abs(to[0] - from[0]);
  if (span < 6) return;
  if (vertical) {
    const x = off;
    sheet.poly([[from[0], from[1]], [x - 1.5, from[1]]], HAIR, false);
    sheet.poly([[to[0], to[1]], [x - 1.5, to[1]]], HAIR, false);
    sheet.poly([[x, from[1]], [x, to[1]]], DIM, false);
    arrow(sheet, [x, from[1]], 0, Math.sign(from[1] - to[1]));
    arrow(sheet, [x, to[1]], 0, Math.sign(to[1] - from[1]));
    // Upright text is not worth a rotated text API; set it beside the line.
    sheet.text([x - 1.2, (from[1] + to[1]) / 2 + 1], label, { size: 2.8, anchor: "end" });
  } else {
    const y = off;
    sheet.poly([[from[0], from[1]], [from[0], y - 1.5]], HAIR, false);
    sheet.poly([[to[0], to[1]], [to[0], y - 1.5]], HAIR, false);
    sheet.poly([[from[0], y], [to[0], y]], DIM, false);
    arrow(sheet, [from[0], y], Math.sign(from[0] - to[0]), 0);
    arrow(sheet, [to[0], y], Math.sign(to[0] - from[0]), 0);
    sheet.text([(from[0] + to[0]) / 2, y - 1.4], label, { size: 2.8, anchor: "middle" });
  }
}

/* ------------------------------------------------------------- the page */

/** Draw one page of the check sheet. */
export function drawPage(sheet: Sheet, d: FrameDesign, plan: PrintPlan, pg: PartPage, vehicleName: string): void {
  const { page } = plan;
  const L = layout(page, pg.specs.length);
  const draw = partDrawing(d, pg.profile, pg.turned);
  const { tile } = pg;

  /*
    Model space to page space. The part is drawn with +y forward, as a
    drawing would; the page counts y downwards, so the sign flips here once
    and nowhere else.
  */
  const toPage = ([x, y]: Pt): Pt => [L.x0 - tile.x + x, L.y0 + tile.y + tile.heightMm - y];

  for (const g of draw.guides) sheet.poly(g.shape.map(toPage), GUIDE);
  sheet.poly(draw.outline.map(toPage), CUT);
  for (const s of draw.slots) sheet.poly(s.map(toPage), CUT);

  for (const h of draw.holes) {
    const c = toPage(h.c);
    sheet.circle(c, h.r, CUT);
    // A cross in every hole, so a bolt can be centred on it by eye.
    sheet.poly([[c[0] - h.r - 1, c[1]], [c[0] + h.r + 1, c[1]]], CENTRE, false);
    sheet.poly([[c[0], c[1] - h.r - 1], [c[0], c[1] + h.r + 1]], CENTRE, false);
  }

  // Footprint labels sit just above their own outline, not at its centre:
  // the battery and the stack share a centre and printed on top of each other.
  for (const g of draw.guides) {
    const b = extent(g.shape);
    const [px, py] = toPage([(b.minX + b.maxX) / 2, b.maxY]);
    if (px < L.x0 || px > L.x1 || py < L.y0 + 4 || py > L.y1) continue;
    sheet.text([px, py - 1.2], g.label, { size: 2.6, anchor: "middle" });
  }

  if (pg.of === 1) drawDimensions(sheet, draw, L, toPage);
  drawSpecs(sheet, L, pg, page);
  drawCropMarks(sheet, page, pg);
  drawRuler(sheet, page, L);
  drawHeader(sheet, page, pg, d, vehicleName);
}

/**
 * Overall width and length, called out on the drawing itself.
 *
 * Only on a part that fits one page: across tiles neither extent is wholly
 * on any one sheet, and half a dimension line with one arrow is worse than
 * none — the table below still carries the figures.
 */
function drawDimensions(sheet: Sheet, draw: PartDrawing, L: Layout, toPage: (p: Pt) => Pt): void {
  const b = extent(draw.outline);
  const tl = toPage([b.minX, b.maxY]);
  const br = toPage([b.maxX, b.minY]);
  const below = br[1] + PART_PAD - 1.5;
  const left = tl[0] - PART_PAD + 1.5;
  if (below < L.y1 && left > L.x0) {
    dimension(sheet, [tl[0], br[1]], [br[0], br[1]], below, mm(b.w, 1), false);
    dimension(sheet, [tl[0], tl[1]], [tl[0], br[1]], left, mm(b.l, 1), true);
  }
}

/** The dimensions table, in two columns under the drawing. */
function drawSpecs(sheet: Sheet, L: Layout, pg: PartPage, page: PageSize): void {
  sheet.poly([[L.x0, L.specTop], [L.x1, L.specTop]], RULE, false);
  sheet.text([L.x0, L.specTop + 3.6], "DIMENSIONS", { size: 2.8, bold: true });
  sheet.text([L.x1, L.specTop + 3.6], `${pg.profile.name} · ${pg.profile.qty} off`, { size: 2.8, anchor: "end" });

  const perCol = Math.ceil(pg.specs.length / 2);
  const colW = (L.x1 - L.x0) / 2;
  pg.specs.forEach((row, i) => {
    const col = Math.floor(i / perCol);
    const x = L.x0 + col * colW;
    const y = L.specTop + SPEC_HEAD_H + ((i % perCol) + 1) * SPEC_ROW_H;
    sheet.text([x, y], row.label, { size: 2.7 });
    sheet.text([x + colW - (col === 0 ? 6 : 0), y], row.value, { size: 2.7, bold: true, anchor: "end" });
  });
  void page;
}

/** Corner marks and the note on joining pages. */
function drawCropMarks(sheet: Sheet, page: PageSize, pg: PartPage): void {
  const m = PAGE_MARGIN_MM;
  const x2 = page.widthMm - m;
  const y2 = page.heightMm - m;
  const arm = 4;
  sheet.poly([[m, m + arm], [m, m], [m + arm, m]], CROP, false);
  sheet.poly([[x2 - arm, m], [x2, m], [x2, m + arm]], CROP, false);
  sheet.poly([[x2, y2 - arm], [x2, y2], [x2 - arm, y2]], CROP, false);
  sheet.poly([[m + arm, y2], [m, y2], [m, y2 - arm]], CROP, false);
  if (pg.of > 1) {
    sheet.text(
      [x2, y2 + 6],
      `${pg.profile.name}: trim to the marks, overlap ${TILE_OVERLAP_MM} mm and tape. Column ${pg.tile.col + 1} of ${pg.cols}, row ${pg.rows - pg.tile.row} of ${pg.rows}.`,
      { size: 2.8, anchor: "end" },
    );
  }
}

/**
 * The scale ruler — the most important thing on the page.
 *
 * Everything else is only meaningful if this measures 100 mm against a real
 * ruler, so it is labelled as a check rather than as decoration.
 */
function drawRuler(sheet: Sheet, page: PageSize, L: Layout): void {
  const x0 = PAGE_MARGIN_MM;
  const y = L.rulerY;
  sheet.poly([[x0, y], [x0 + RULER_MM, y]], RULE, false);
  for (let i = 0; i <= 10; i++) {
    const x = x0 + i * 10;
    const h = i % 5 === 0 ? 3.5 : 2;
    sheet.poly([[x, y], [x, y - h]], RULE, false);
    if (i % 5 === 0) sheet.text([x, y - 4.5], String(i * 10), { size: 2.4, anchor: "middle" });
  }
  /*
    The caption sits beside the ruler and the warning goes above it, across
    the full width. Set as two lines to the right of a 100 mm rule there are
    only 97 mm of paper left, and the sentence ran off the edge of A4 and
    lost its last clause — on the one piece of text the whole sheet depends
    on.
  */
  sheet.text([x0 + RULER_MM + 3, y - 1.4], "mm — measure this first.", { size: 3.2, bold: true });
  sheet.text(
    [x0, y - 8],
    "Not exactly 100 mm? The print is scaled; nothing else on this page can be trusted.",
    { size: 2.8 },
  );
  void page;
}

function drawHeader(sheet: Sheet, page: PageSize, pg: PartPage, d: FrameDesign, vehicleName: string): void {
  const y = PAGE_MARGIN_MM - 4.5;
  const sheetOf = pg.of > 1 ? ` — sheet ${pg.index} of ${pg.of}` : "";
  sheet.text([PAGE_MARGIN_MM, y], `${vehicleName} — ${pg.profile.name}${sheetOf}`, { size: 3.6, bold: true });
  sheet.text([page.widthMm - PAGE_MARGIN_MM, y], 'PRINT AT 100% — NOT "FIT TO PAGE"', { size: 3.2, bold: true, anchor: "end" });

  /*
    The quantity, the stock and the thickness are all in the table below, so
    the strapline says the one thing the table cannot: what to do with the
    page. Repeating them here as well made the line 240 mm long on a part
    drawn turned, and the last clause ran off the edge of A4.
  */
  const turned = pg.turned ? " Drawn a quarter turn round to fit." : "";
  sheet.text(
    [PAGE_MARGIN_MM, y + 3.4],
    `Full size — lay the real part or component on the drawing before you pay for a cut.${turned}`,
    { size: 2.8 },
  );
  void d;
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
export function toPrintSVG(d: FrameDesign, plan: PrintPlan, pg: PartPage, vehicleName: string): string {
  const sheet = new SvgSheet();
  drawPage(sheet, d, plan, pg, vehicleName);
  const { page } = plan;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${f(page.widthMm)}mm" height="${f(page.heightMm)}mm" viewBox="0 0 ${f(page.widthMm)} ${f(page.heightMm)}">`,
    `<title>${esc(vehicleName)} — ${esc(pg.profile.name)}</title>`,
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
  for (const pg of plan.pages) {
    drawPage(doc, d, plan, pg, vehicleName);
    doc.endPage();
  }
  return doc.build(`${vehicleName} — frame part drawings`);
}
