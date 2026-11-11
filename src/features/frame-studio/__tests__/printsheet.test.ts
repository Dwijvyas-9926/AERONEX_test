import { describe, expect, it } from "vitest";
import { designFrame, type FrameSpec } from "../geometry";
import { textWidth, type Pen, type TextStyle } from "../pdf";
import {
  PAGE_MARGIN_MM,
  PAGE_SIZES,
  RULER_MM,
  assembleForPrint,
  drawPage,
  pageSizeById,
  planPrint,
  toPrintPDF,
  toPrintSVG,
  type Sheet,
} from "../printsheet";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null,
  motorId: "2207", motorThrustG: 1350, stackPattern: 30.5, stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4, plateThicknessMm: null,
  wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro",
  styleId: "freestyle", safetyFactor: 2, ...over,
});

type Pt = [number, number];

/*
  A recording backend.

  The page is laid out once against the Sheet interface and carried out by
  either SVG or PDF, so the assertions worth making are about what was drawn
  rather than about either format's spelling of it. Matching strings in SVG
  output tested the writer, not the drawing.
*/
class Recorder implements Sheet {
  polys: { pts: Pt[]; pen: Pen; close: boolean }[] = [];
  circles: { c: Pt; r: number; pen: Pen }[] = [];
  texts: { at: Pt; s: string; style: TextStyle }[] = [];
  poly(pts: Pt[], pen: Pen, close = true) { this.polys.push({ pts, pen, close }); }
  circle(c: Pt, r: number, pen: Pen) { this.circles.push({ c, r, pen }); }
  text(at: Pt, s: string, style: TextStyle) { this.texts.push({ at, s, style }); }
}

const a4 = pageSizeById("a4");
const record = (s: FrameSpec, page = a4) => {
  const d = designFrame(s);
  const plan = planPrint(d, page);
  return plan.tiles.map((t) => {
    const r = new Recorder();
    drawPage(r, d, plan, t, "Avion");
    return r;
  });
};
const said = (r: Recorder) => r.texts.map((t) => t.s).join("\n");

describe("the scale ruler", () => {
  it("is exactly 100 mm long on every page", () => {
    // Everything else on the sheet is meaningless if this is not true size.
    for (const pages of [record(spec()), record(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 }))]) {
      for (const r of pages) {
        const runs = r.polys.filter((p) => p.pts.length === 2 && Math.abs(p.pts[0][1] - p.pts[1][1]) < 1e-9);
        const hundred = runs.find((p) => Math.abs(Math.abs(p.pts[1][0] - p.pts[0][0]) - RULER_MM) < 1e-9);
        expect(hundred, "no 100 mm horizontal run on the page").toBeDefined();
        expect(hundred!.pts[0][0]).toBe(PAGE_MARGIN_MM);
      }
    }
  });

  it("is ticked every 10 mm and labelled at every 50", () => {
    const [r] = record(spec());
    const y = r.polys.find((p) => Math.abs(Math.abs(p.pts[1][0] - p.pts[0][0]) - RULER_MM) < 1e-9)!.pts[0][1];
    const ticks = r.polys.filter((p) => p.pts.length === 2 && Math.abs(p.pts[0][0] - p.pts[1][0]) < 1e-9 && Math.abs(p.pts[0][1] - y) < 1e-9);
    expect(ticks).toHaveLength(11);
    expect(r.texts.filter((t) => ["0", "50", "100"].includes(t.s))).toHaveLength(3);
  });

  it("warns against fit-to-page on every single sheet", () => {
    // A scaled print passes every other check while telling the user nothing,
    // so this cannot be on page one only.
    for (const r of record(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 }))) {
      expect(said(r)).toContain("PRINT AT 100%");
      expect(said(r)).toContain("measure this first");
      expect(said(r)).toContain("The print is scaled");
    }
  });
});

describe("what is on the sheet", () => {
  it("shows the assembled frame, not the cutting nest", () => {
    const a = assembleForPrint(designFrame(spec()));
    expect(a.outlines.length).toBeGreaterThanOrEqual(5); // plate + four arms
    expect(a.discs).toHaveLength(4);
  });

  it("draws footprints for the parts you are meant to lay on it", () => {
    const [r] = record(spec());
    expect(said(r)).toContain("Battery 105 × 35 mm");
    expect(said(r)).toContain("Stack 30.5 mm");
    expect(said(r)).toContain("Micro — 19 mm");
    expect(said(r)).toContain("Lay your motors, stack and battery");
  });

  it("leaves the camera footprint off when there is no camera", () => {
    const [r] = record(spec({ cameraId: "none" }));
    expect(said(r)).not.toContain("Micro");
    expect(said(r)).toContain("Battery");
  });

  it("puts a centre cross in every hole", () => {
    const d = designFrame(spec());
    const a = assembleForPrint(d);
    const pages = record(spec());
    const crosses = pages.reduce((n, r) => n + r.polys.filter((p) => p.pen.width === 0.08).length, 0);
    // Two strokes per hole, and a hole is drawn on every page it falls on.
    expect(crosses % 2).toBe(0);
    expect(crosses / 2).toBeGreaterThanOrEqual(a.holes.length);
  });

  it("names the aircraft and numbers the pages", () => {
    const pages = record(spec());
    pages.forEach((r, i) => {
      expect(said(r)).toContain("Avion");
      expect(said(r)).toContain(`check sheet ${i + 1} of ${pages.length}`);
    });
  });
});

describe("tiling", () => {
  it("fits a small frame on one page and a large one on several", () => {
    const small = planPrint(designFrame(spec({ propIn: 3, motorId: "1404", motorThrustG: 350, stackPattern: 20, stackBolt: 2, cameraId: "nano" })), a4);
    const large = planPrint(designFrame(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 })), a4);
    expect(small.tiles.length).toBe(1);
    expect(large.tiles.length).toBeGreaterThan(small.tiles.length);
  });

  it("covers the whole drawing, with overlap between neighbours", () => {
    for (const propIn of [2, 5, 7, 10]) {
      const motor = propIn >= 8 ? "3110" : propIn >= 7 ? "2806" : "2207";
      const d = designFrame(spec({ propIn, motorId: motor, motorThrustG: 1500, fixedDimMm: null }));
      const plan = planPrint(d, a4);
      expect(Math.max(...plan.tiles.map((t) => t.x + t.widthMm)), `${propIn}"`).toBeGreaterThanOrEqual(plan.bounds.maxX);
      expect(Math.max(...plan.tiles.map((t) => t.y + t.heightMm)), `${propIn}"`).toBeGreaterThanOrEqual(plan.bounds.maxY);
      expect(Math.min(...plan.tiles.map((t) => t.x))).toBeLessThanOrEqual(plan.bounds.minX);
      expect(Math.min(...plan.tiles.map((t) => t.y))).toBeLessThanOrEqual(plan.bounds.minY);
      if (plan.cols > 1) {
        const a = plan.tiles.find((t) => t.col === 0 && t.row === 0)!;
        const b = plan.tiles.find((t) => t.col === 1 && t.row === 0)!;
        expect(a.x + a.widthMm - b.x, `${propIn}" overlap`).toBeGreaterThan(4);
      }
    }
  });

  it("tells the user how to join the pages, but only when there are several", () => {
    expect(said(record(spec({ propIn: 3, motorId: "1404", motorThrustG: 350, stackPattern: 20, stackBolt: 2, cameraId: "nano" }))[0])).not.toContain("tape");
    const many = said(record(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 }))[0]);
    expect(many).toContain("tape");
    expect(many).toMatch(/Column \d+ of \d+, row \d+ of \d+/);
  });

  it("never puts a tile outside the printable area", () => {
    for (const page of PAGE_SIZES) {
      for (const t of planPrint(designFrame(spec()), page).tiles) {
        expect(t.widthMm).toBeLessThanOrEqual(page.widthMm - 2 * PAGE_MARGIN_MM + 1e-9);
        expect(t.heightMm).toBeLessThanOrEqual(page.heightMm - 2 * PAGE_MARGIN_MM + 1e-9);
      }
    }
  });
});

describe("the PDF", () => {
  const pdf = (s: FrameSpec, page = a4) => {
    const d = designFrame(s);
    return toPrintPDF(d, planPrint(d, page), "Avion");
  };
  const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

  it("is a well-formed PDF with one page per tile", () => {
    const d = designFrame(spec());
    const plan = planPrint(d, a4);
    const body = text(toPrintPDF(d, plan, "Avion"));
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(body).toContain(`/Count ${plan.tiles.length}`);
    expect((body.match(/\/Type \/Page\b/g) ?? []).length).toBe(plan.tiles.length);
    // Every object the cross-reference table claims must exist.
    const size = Number(/\/Size (\d+)/.exec(body)![1]);
    for (let i = 1; i < size; i++) expect(body).toContain(`${i} 0 obj`);
  });

  it("states the page size in points, so a print dialog can honour it", () => {
    for (const page of PAGE_SIZES) {
      const body = text(pdf(spec(), page));
      const w = (page.widthMm * 72) / 25.4;
      const h = (page.heightMm * 72) / 25.4;
      expect(body).toContain(`/MediaBox [0 0 ${Math.round(w * 1000) / 1000} ${Math.round(h * 1000) / 1000}]`);
    }
  });

  it("points its xref entries at real object headers", () => {
    // A wrong offset is the classic hand-rolled-PDF bug: readers either
    // repair it silently or refuse the file, and neither is acceptable here.
    const bytes = pdf(spec());
    const body = text(bytes);
    const xrefAt = Number(/startxref\n(\d+)/.exec(body)![1]);
    const size = Number(/\/Size (\d+)/.exec(body)![1]);
    expect(body.slice(xrefAt, xrefAt + 4)).toBe("xref");
    /*
      After dropping "xref" and the "0 N" subsection header, row i is the
      entry for object i — row 0 being object 0, the free head of the list.
    */
    const rows = body.slice(xrefAt).split("\n").slice(2);
    let checked = 0;
    rows.forEach((row, i) => {
      const m = /^(\d{10}) 00000 n/.exec(row);
      if (!m) return;
      checked++;
      expect(body.slice(Number(m[1])), `object ${i}`).toMatch(new RegExp(`^${i} 0 obj`));
    });
    expect(checked).toBe(size - 1);
  });

  it("declares a stream length that matches the stream", () => {
    const body = text(pdf(spec()));
    const re = /<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g;
    let m: RegExpExecArray | null;
    let seen = 0;
    while ((m = re.exec(body))) {
      seen++;
      expect(new TextEncoder().encode(m[2]).length).toBe(Number(m[1]));
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("escapes what a PDF string cannot hold literally", () => {
    const d = designFrame(spec());
    const body = text(toPrintPDF(d, planPrint(d, a4), "A (tricky) name \\ with — dashes"));
    expect(body).toContain("A \\(tricky\\) name \\\\ with");
    // The em dash becomes its WinAnsi byte rather than a UTF-8 pair.
    expect(body).toContain("\\227");
  });

  it("grows with the number of pages and carries real content", () => {
    const one = pdf(spec({ propIn: 3, motorId: "1404", motorThrustG: 350, stackPattern: 20, stackBolt: 2, cameraId: "nano" }));
    const many = pdf(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 }));
    expect(many.length).toBeGreaterThan(one.length);
    expect(one.length).toBeGreaterThan(2000);
  });
});

describe("text measurement", () => {
  it("scales with the string and the size", () => {
    expect(textWidth("", 10)).toBe(0);
    expect(textWidth("iii", 10)).toBeLessThan(textWidth("WWW", 10));
    expect(textWidth("hello", 20)).toBeCloseTo(textWidth("hello", 10) * 2, 6);
  });

  it("measures bold wider than regular for the same text", () => {
    expect(textWidth("Bottom plate", 3, true)).toBeGreaterThan(textWidth("Bottom plate", 3, false));
  });

  it("gives the characters the studio prints a real width", () => {
    for (const ch of ["—", "×", "·", "°", "²"]) {
      expect(textWidth(ch, 10), ch).toBeGreaterThan(0);
    }
  });
});

describe("the SVG backend", () => {
  it("still renders a page at true size, for looking at in a browser", () => {
    const d = designFrame(spec());
    const plan = planPrint(d, a4);
    const svg = toPrintSVG(d, plan, plan.tiles[0], "Avion");
    expect(svg).toContain(`width="${a4.widthMm}mm"`);
    expect(svg).toContain(`viewBox="0 0 ${a4.widthMm} ${a4.heightMm}"`);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(/NaN|Infinity|undefined/.test(svg)).toBe(false);
  });
});
