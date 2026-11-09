/*
  Frame Studio — 2D export.

  Everything a cutting service needs, in the formats they actually accept:

    DXF R12 (AC1009)  the universal CAM interchange. Deliberately the oldest
                      dialect — every laser, router and waterjet front end
                      reads it, which newer dialects cannot be relied on for.
    SVG               for checking the drawing in a browser or sending to a
                      hobby laser whose software prefers it.

  Both are written at 1:1 in millimetres. Nothing here is scaled, so a part
  that measures 80 mm in the studio measures 80 mm on the sheet.

  DXF carries no unit of its own — the numbers *are* the unit — so a file whose
  coordinates were written in centimetres cuts at a tenth size with no warning.
  Writing mm and declaring $INSUNITS = 4 is what avoids that.
*/

import { type Hole, type Pt, type Profile } from "./geometry";
import { round } from "./structure";

export interface NestOptions {
  /** Usable sheet width, mm. Parts wrap to a new row past this. */
  sheetWidthMm: number;
  /** Clear space left between parts, mm. Covers kerf plus handling. */
  gapMm: number;
  /** Write a part name beside each piece. */
  labels: boolean;
}

export const DEFAULT_NEST: NestOptions = { sheetWidthMm: 300, gapMm: 5, labels: true };

export interface PlacedPart {
  profileId: string;
  name: string;
  /** 1-based copy number, for multi-part profiles like the four arms. */
  copy: number;
  outline: Pt[];
  holes: Hole[];
  slots: Pt[][];
  label: string;
  labelAt: Pt;
}

export interface Nest {
  parts: PlacedPart[];
  /** Overall extent of the laid-out sheet, mm. */
  widthMm: number;
  heightMm: number;
  /** Total part area as a fraction of the sheet area used. */
  utilisation: number;
  thicknessMm: number;
}

/* ------------------------------------------------------------------ bounds */

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export function boundsOf(pts: Pt[]): Bounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

const translate = (pts: Pt[], dx: number, dy: number): Pt[] => pts.map(([x, y]) => [x + dx, y + dy] as Pt);

/**
 * Shelf-pack the parts into rows.
 *
 * Not an optimal nest — true nesting is NP-hard and a cutting service will
 * re-nest anyway. The job here is a tidy, predictable, non-overlapping layout
 * whose every part is the right size, which is what matters for a quote.
 */
export function nestParts(profiles: Profile[], opts: Partial<NestOptions> = {}): Nest {
  const o = { ...DEFAULT_NEST, ...opts };
  const parts: PlacedPart[] = [];
  let cursorX = o.gapMm;
  let cursorY = o.gapMm;
  let rowHeight = 0;
  let sheetRight = 0;
  let partArea = 0;

  for (const profile of profiles) {
    const b = boundsOf(profile.outline);
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    for (let copy = 1; copy <= profile.qty; copy++) {
      if (cursorX > o.gapMm && cursorX + w > o.sheetWidthMm - o.gapMm) {
        cursorX = o.gapMm;
        cursorY += rowHeight + o.gapMm;
        rowHeight = 0;
      }
      const dx = cursorX - b.minX;
      const dy = cursorY - b.minY;
      parts.push({
        profileId: profile.id,
        name: profile.name,
        copy,
        outline: translate(profile.outline, dx, dy),
        holes: profile.holes.map((hole) => ({ ...hole, c: [hole.c[0] + dx, hole.c[1] + dy] as Pt })),
        slots: profile.slots.map((s) => translate(s, dx, dy)),
        label: profile.qty > 1 ? `${profile.name} ${copy}/${profile.qty}` : profile.name,
        /*
          Seat the label inside the gap below the part. Text grows away from
          its baseline in both DXF and SVG, so a baseline one text-height
          clear of the part edge keeps it off the part in either file.
        */
        labelAt: [cursorX, cursorY - o.gapMm + 0.5],
      });
      partArea += profile.areaMm2;
      cursorX += w + o.gapMm;
      sheetRight = Math.max(sheetRight, cursorX);
      rowHeight = Math.max(rowHeight, h);
    }
  }

  /*
    Round the sheet extent UP, never to nearest. This figure is what someone
    orders stock against, so a value rounded down by even a hundredth of a
    millimetre describes a sheet the parts do not fit on.
  */
  const ceilTo = (v: number, dp = 1) => Math.ceil(v * 10 ** dp) / 10 ** dp;
  const widthMm = ceilTo(Math.max(sheetRight, o.gapMm * 2));
  const heightMm = ceilTo(cursorY + rowHeight + o.gapMm);
  const sheetArea = widthMm * heightMm;
  return {
    parts,
    widthMm,
    heightMm,
    utilisation: sheetArea > 0 ? round(partArea / sheetArea, 3) : 0,
    thicknessMm: profiles[0]?.thicknessMm ?? 0,
  };
}

/* --------------------------------------------------------------------- DXF */

/**
 * Fixed-point formatting, always. `toString()` on a small number can produce
 * exponent notation ("1e-7"), which DXF readers reject outright.
 */
const n = (v: number): string => {
  const safe = Object.is(v, -0) ? 0 : v;
  return safe.toFixed(4);
};

const CUT_LAYER = "CUT";
const LABEL_LAYER = "LABEL";

/** One group code / value pair per two lines, which is the DXF file format. */
class DxfWriter {
  private lines: string[] = [];

  pair(code: number, value: string | number): this {
    this.lines.push(String(code), String(value));
    return this;
  }

  polyline(pts: Pt[], layer: string): this {
    // R12 uses POLYLINE + VERTEX + SEQEND. LWPOLYLINE is R13+ and will not
    // load in the older front ends this dialect exists to support.
    this.pair(0, "POLYLINE").pair(8, layer).pair(66, 1).pair(10, n(0)).pair(20, n(0)).pair(30, n(0)).pair(70, 1);
    for (const [x, y] of pts) {
      this.pair(0, "VERTEX").pair(8, layer).pair(10, n(x)).pair(20, n(y)).pair(30, n(0));
    }
    return this.pair(0, "SEQEND").pair(8, layer);
  }

  circle(c: Pt, r: number, layer: string): this {
    return this.pair(0, "CIRCLE").pair(8, layer).pair(10, n(c[0])).pair(20, n(c[1])).pair(30, n(0)).pair(40, n(r));
  }

  text(at: Pt, height: number, value: string, layer: string): this {
    return this.pair(0, "TEXT").pair(8, layer).pair(10, n(at[0])).pair(20, n(at[1])).pair(30, n(0)).pair(40, n(height)).pair(1, value);
  }

  toString(): string {
    return `${this.lines.join("\n")}\n`;
  }
}

export function toDXF(nest: Nest, opts: { labels?: boolean } = {}): string {
  const w = new DxfWriter();
  const labels = opts.labels ?? true;

  w.pair(0, "SECTION").pair(2, "HEADER");
  w.pair(9, "$ACADVER").pair(1, "AC1009");
  w.pair(9, "$INSUNITS").pair(70, 4); // 4 = millimetres
  w.pair(9, "$EXTMIN").pair(10, n(0)).pair(20, n(0)).pair(30, n(0));
  w.pair(9, "$EXTMAX").pair(10, n(nest.widthMm)).pair(20, n(nest.heightMm)).pair(30, n(0));
  w.pair(0, "ENDSEC");

  // A minimal TABLES section. Layers must reference a line type that exists,
  // so CONTINUOUS is declared rather than assumed.
  w.pair(0, "SECTION").pair(2, "TABLES");
  w.pair(0, "TABLE").pair(2, "LTYPE").pair(70, 1);
  w.pair(0, "LTYPE").pair(2, "CONTINUOUS").pair(70, 0).pair(3, "Solid line").pair(72, 65).pair(73, 0).pair(40, n(0));
  w.pair(0, "ENDTAB");
  w.pair(0, "TABLE").pair(2, "LAYER").pair(70, 2);
  w.pair(0, "LAYER").pair(2, CUT_LAYER).pair(70, 0).pair(62, 7).pair(6, "CONTINUOUS");
  w.pair(0, "LAYER").pair(2, LABEL_LAYER).pair(70, 0).pair(62, 1).pair(6, "CONTINUOUS");
  w.pair(0, "ENDTAB");
  w.pair(0, "ENDSEC");

  w.pair(0, "SECTION").pair(2, "BLOCKS").pair(0, "ENDSEC");

  w.pair(0, "SECTION").pair(2, "ENTITIES");
  for (const part of nest.parts) {
    w.polyline(part.outline, CUT_LAYER);
    for (const s of part.slots) w.polyline(s, CUT_LAYER);
    for (const h of part.holes) w.circle(h.c, h.r, CUT_LAYER);
    if (labels) w.text(part.labelAt, 3, part.label, LABEL_LAYER);
  }
  w.pair(0, "ENDSEC");
  w.pair(0, "EOF");

  return w.toString();
}

/* --------------------------------------------------------------------- SVG */

const path = (pts: Pt[], flipY: number): string =>
  `${pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${n(x)},${n(flipY - y)}`).join(" ")} Z`;

/**
 * SVG at 1 mm per user unit, with the Y axis flipped.
 *
 * SVG counts Y downward and DXF counts it upward, so a drawing copied between
 * them without flipping comes out mirrored — which for an asymmetric layout
 * like a dead cat means parts that cannot be assembled.
 */
export function toSVG(nest: Nest, opts: { labels?: boolean } = {}): string {
  const labels = opts.labels ?? true;
  const H = nest.heightMm;
  const body: string[] = [];

  for (const part of nest.parts) {
    const d = [path(part.outline, H), ...part.slots.map((s) => path(s, H))].join(" ");
    body.push(`    <path d="${d}" />`);
    for (const h of part.holes) {
      body.push(`    <circle cx="${n(h.c[0])}" cy="${n(H - h.c[1])}" r="${n(h.r)}" />`);
    }
  }

  const labelEls = labels
    ? nest.parts.map((p) => `    <text x="${n(p.labelAt[0])}" y="${n(H - p.labelAt[1])}">${escapeXml(p.label)}</text>`)
    : [];

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${n(nest.widthMm)}mm" height="${n(H)}mm" viewBox="0 0 ${n(nest.widthMm)} ${n(H)}">
  <g fill="none" stroke="#000000" stroke-width="0.1">
${body.join("\n")}
  </g>
  <g font-family="sans-serif" font-size="3" fill="#d00000" stroke="none">
${labelEls.join("\n")}
  </g>
</svg>
`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
}
