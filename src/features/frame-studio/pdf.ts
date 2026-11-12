/*
  Frame Studio — a small PDF writer.

  The check sheet has to print at exactly 1:1, and a PDF is the only format a
  print dialog treats that way without argument: it carries its own page size,
  so "Actual size" means what it says. An archive of SVGs needed unzipping,
  opening one at a time, and a browser print dialog that scales to fit by
  default — the one thing the sheet exists to prevent.

  Written by hand for the same reason the ZIP writer is. What this needs is a
  narrow corner of the format: vector paths, one of the fourteen fonts every
  reader is required to have, and no compression, encryption or transparency.
  That is a few hundred lines against a dependency, and it keeps the studio
  working with nothing fetched at runtime.

  Everything here takes millimetres, because that is what the rest of the
  studio speaks. PDF's own unit is the point, 1/72 inch, and the conversion
  happens at the boundary.
*/

const MM_TO_PT = 72 / 25.4;

/** Bezier handle length for a quarter circle, as a fraction of the radius. */
const KAPPA = 0.5522847498307936;

export interface Pen {
  /** Stroke colour as #rrggbb. Omit for no stroke. */
  stroke?: string;
  /** Fill colour as #rrggbb. Omit for no fill. */
  fill?: string;
  /** Stroke width in mm. */
  width?: number;
  /** Dash pattern in mm. */
  dash?: [number, number];
}

export interface TextStyle {
  /** Cap height in mm, as a CSS font-size would be. */
  size: number;
  bold?: boolean;
  anchor?: "start" | "middle" | "end";
  /** Colour as #rrggbb; black if omitted. */
  color?: string;
}

export type Pt = [number, number];

/* ----------------------------------------------------------- font metrics */

/*
  Widths for the two base-14 fonts used here, in 1/1000 em, for the printable
  ASCII range. Needed because centring a label means knowing how wide it is,
  and a PDF viewer will not tell us. Carrying the real numbers rather than
  guessing an average width is the difference between a label centred on its
  footprint and one visibly off to one side.
*/
const W_REGULAR =
  "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584";
const W_BOLD =
  "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584";

const widths = (bold: boolean) => (bold ? W_BOLD : W_REGULAR).split(" ").map(Number);

/*
  The handful of non-ASCII characters the studio actually prints, mapped to
  their WinAnsi byte and width. An em dash and a multiplication sign are not
  decoration here — "105 × 35 mm" and "check sheet 1 of 2" read wrong without
  them — and anything outside this set would otherwise silently become a
  different glyph, since PDF has no notion of Unicode in a simple font.
*/
const WINANSI: Record<string, [number, number, number]> = {
  // char: [byte, regular width, bold width]
  "—": [0x97, 1000, 1000],
  "–": [0x96, 556, 556],
  "×": [0xd7, 584, 584],
  "·": [0xb7, 278, 278],
  "°": [0xb0, 400, 400],
  "²": [0xb2, 333, 333],
  "’": [0x92, 222, 278],
  "“": [0x93, 333, 500],
  "”": [0x94, 333, 500],
  "…": [0x85, 1000, 1000],
};

/**
 * Can WinAnsi carry this character at all?
 *
 * `textWidth` and `pdfString` both fall back for anything it cannot, and they
 * fall back differently — one to the width of "?", the other to the glyph
 * "?". So an unmappable character measures and lays out perfectly and then
 * prints as a question mark, which is how "12 × \u2300 3.0 mm" reached a
 * drawing as "12 x ? 3.0 mm". Anything the studio prints is checked against
 * this instead of being assumed.
 */
export function encodable(ch: string): boolean {
  const code = ch.codePointAt(0)!;
  return (code >= 32 && code <= 126) || ch in WINANSI || (code >= 0xa0 && code <= 0xff);
}

/** Width of `text` in millimetres at `size`. */
export function textWidth(text: string, size: number, bold = false): number {
  const w = widths(bold);
  let total = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code >= 32 && code <= 126) total += w[code - 32];
    else if (WINANSI[ch]) total += WINANSI[ch][bold ? 2 : 1];
    else total += w[31]; // "?" stands in for anything unmappable
  }
  return (total / 1000) * size;
}

/**
 * Encode a string as a PDF literal in WinAnsi, escaping what must be escaped.
 *
 * Characters outside the encoding become "?" rather than being dropped: a
 * missing glyph is a silent lie about what the sheet says, while a question
 * mark is visibly wrong and can be reported.
 */
function pdfString(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    let byte: number;
    if (code >= 32 && code <= 126) byte = code;
    else if (WINANSI[ch]) byte = WINANSI[ch][0];
    else if (code >= 0xa0 && code <= 0xff) byte = code; // WinAnsi matches Latin-1 here
    else byte = 0x3f;
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else if (byte < 32 || byte > 126) out += `\\${byte.toString(8).padStart(3, "0")}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

/**
 * A string for the document's metadata, rather than for drawing on a page.
 *
 * These are read with PDFDocEncoding, not with whatever encoding a font
 * declares, so the WinAnsi bytes used for page text are wrong here: an em
 * dash written as 0x97 came back out of a reader as "Š". Anything beyond
 * ASCII therefore goes as UTF-16BE behind a byte-order mark, which is the
 * encoding the format defines for exactly this.
 */
function pdfTextString(text: string): string {
  if (!/[^ -~]/.test(text)) return pdfString(text);
  let out = "\\376\\377"; // BOM
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    const units = code > 0xffff
      ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)]
      : [code];
    for (const u of units) {
      out += `\\${((u >> 8) & 0xff).toString(8).padStart(3, "0")}`;
      out += `\\${(u & 0xff).toString(8).padStart(3, "0")}`;
    }
  }
  return out;
}

/* ------------------------------------------------------------- the writer */

const n = (v: number) => (Math.round(v * 1000) / 1000).toString();

function rgb(hex: string): string {
  const v = parseInt(hex.slice(1), 16);
  const c = (x: number) => n(x / 255);
  return `${c((v >> 16) & 255)} ${c((v >> 8) & 255)} ${c(v & 255)}`;
}

/**
 * Builds a multi-page PDF.
 *
 * Each page carries its own size, so a long part can have a landscape sheet
 * among portrait ones.
 * Coordinates arrive in millimetres with y running down the page, matching
 * SVG and the rest of the drawing code; the flip to PDF's y-up happens here
 * so no caller has to think about it.
 */
export class PdfDoc {
  private pages: string[] = [];
  private ops: string[] = [];

  private widthMm: number;
  private heightMm: number;
  private sizes: Array<[number, number]> = [];

  constructor(widthMm: number, heightMm: number) {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
  }

  /** Set the size of the page about to be drawn. */
  beginPage(widthMm: number, heightMm: number): void {
    this.widthMm = widthMm;
    this.heightMm = heightMm;
  }

  clip(x0: number, y0: number, x1: number, y1: number): void {
    this.ops.push(`q ${this.x(x0)} ${this.y(y1)} ${n((x1 - x0) * MM_TO_PT)} ${n((y1 - y0) * MM_TO_PT)} re W n`);
  }

  unclip(): void {
    this.ops.push("Q");
  }

  /** Finish the current page and start a new one. */
  endPage(): void {
    this.sizes.push([this.widthMm, this.heightMm]);
    this.pages.push(this.ops.join("\n"));
    this.ops = [];
  }

  private x(v: number): string {
    return n(v * MM_TO_PT);
  }

  /** Flip y: page space counts down from the top, PDF counts up from the bottom. */
  private y(v: number): string {
    return n((this.heightMm - v) * MM_TO_PT);
  }

  private applyPen(pen: Pen): string {
    const parts: string[] = [];
    parts.push(`${n((pen.width ?? 0.2) * MM_TO_PT)} w`);
    if (pen.stroke) parts.push(`${rgb(pen.stroke)} RG`);
    if (pen.fill) parts.push(`${rgb(pen.fill)} rg`);
    parts.push(pen.dash ? `[${n(pen.dash[0] * MM_TO_PT)} ${n(pen.dash[1] * MM_TO_PT)}] 0 d` : "[] 0 d");
    return parts.join(" ");
  }

  private paint(pen: Pen): string {
    if (pen.fill && pen.stroke) return "B";
    if (pen.fill) return "f";
    return "S";
  }

  poly(pts: Pt[], pen: Pen, close = true): void {
    if (pts.length < 2) return;
    const d = [`${this.x(pts[0][0])} ${this.y(pts[0][1])} m`];
    for (let i = 1; i < pts.length; i++) d.push(`${this.x(pts[i][0])} ${this.y(pts[i][1])} l`);
    if (close) d.push("h");
    this.ops.push(`q ${this.applyPen(pen)} ${d.join(" ")} ${this.paint(pen)} Q`);
  }

  /** A circle, as the four Bezier arcs PDF has no primitive for. */
  circle(c: Pt, r: number, pen: Pen): void {
    const k = r * KAPPA;
    const [cx, cy] = c;
    const d = [
      `${this.x(cx + r)} ${this.y(cy)} m`,
      `${this.x(cx + r)} ${this.y(cy - k)} ${this.x(cx + k)} ${this.y(cy - r)} ${this.x(cx)} ${this.y(cy - r)} c`,
      `${this.x(cx - k)} ${this.y(cy - r)} ${this.x(cx - r)} ${this.y(cy - k)} ${this.x(cx - r)} ${this.y(cy)} c`,
      `${this.x(cx - r)} ${this.y(cy + k)} ${this.x(cx - k)} ${this.y(cy + r)} ${this.x(cx)} ${this.y(cy + r)} c`,
      `${this.x(cx + k)} ${this.y(cy + r)} ${this.x(cx + r)} ${this.y(cy + k)} ${this.x(cx + r)} ${this.y(cy)} c`,
      "h",
    ];
    this.ops.push(`q ${this.applyPen(pen)} ${d.join(" ")} ${this.paint(pen)} Q`);
  }

  text(at: Pt, s: string, style: TextStyle): void {
    if (!s) return;
    const font = style.bold ? "/F2" : "/F1";
    const w = textWidth(s, style.size, style.bold);
    const shift = style.anchor === "middle" ? -w / 2 : style.anchor === "end" ? -w : 0;
    this.ops.push(
      `q ${rgb(style.color ?? "#000000")} rg BT ${font} ${n(style.size * MM_TO_PT)} Tf ` +
        `1 0 0 1 ${this.x(at[0] + shift)} ${this.y(at[1])} Tm (${pdfString(s)}) Tj ET Q`,
    );
  }

  /** Serialise the document. Call after the last `endPage`. */
  build(title: string): Uint8Array {
    const enc = new TextEncoder();
    const objects: string[] = [];
    const pageCount = this.pages.length;

    // 1 catalog, 2 pages, then per page: page object and content stream,
    // then the two fonts.
    const pageIds = this.pages.map((_, i) => 3 + i * 2);
    const fontId = 3 + pageCount * 2;

    objects[1] = `<< /Type /Catalog /Pages 2 0 R >>`;
    objects[2] =
      `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageCount} >>`;

    this.pages.forEach((content, i) => {
      const id = pageIds[i];
      objects[id] =
        `<< /Type /Page /Parent 2 0 R ` +
        `/MediaBox [0 0 ${n(this.sizes[i][0] * MM_TO_PT)} ${n(this.sizes[i][1] * MM_TO_PT)}] ` +
        `/Resources << /Font << /F1 ${fontId} 0 R /F2 ${fontId + 1} 0 R >> >> ` +
        `/Contents ${id + 1} 0 R >>`;
      objects[id + 1] = `<< /Length ${enc.encode(content).length} >>\nstream\n${content}\nendstream`;
    });

    objects[fontId] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`;
    objects[fontId + 1] = `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`;

    const head = `%PDF-1.4\n%âãÏÓ\n`;
    let body = "";
    const offsets: number[] = [];
    let at = enc.encode(head).length;
    for (let i = 1; i < objects.length; i++) {
      const obj = `${i} 0 obj\n${objects[i]}\nendobj\n`;
      offsets[i] = at;
      body += obj;
      at += enc.encode(obj).length;
    }

    const count = objects.length;
    let xref = `xref\n0 ${count}\n0000000000 65535 f \n`;
    for (let i = 1; i < count; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
    const trailer =
      `trailer\n<< /Size ${count} /Root 1 0 R /Info << /Title (${pdfTextString(title)}) ` +
      `/Producer (AERONEX Frame Studio) >> >>\nstartxref\n${at}\n%%EOF\n`;

    return enc.encode(head + body + xref + trailer);
  }
}
