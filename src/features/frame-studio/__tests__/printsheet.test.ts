import { describe, expect, it } from "vitest";
import { designFrame, type FrameSpec } from "../geometry";
import { encodable, textWidth, type Pen, type TextStyle } from "../pdf";
import {
  PAGE_MARGIN_MM,
  PAGE_SIZES,
  RULER_MM,
  drawPage,
  pageSizeById,
  partSpecs,
  planPrint,
  toPrintPDF,
  toPrintSVG,
  type PartPage,
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

const tiny = spec({ propIn: 3, motorId: "1404", motorThrustG: 350, stackPattern: 20, stackBolt: 2, cameraId: "nano" });
const huge = spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 });

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
  return plan.pages.map((pg) => {
    const r = new Recorder();
    drawPage(r, d, plan, pg, "Avion");
    return { r, pg };
  });
};
const said = (r: Recorder) => r.texts.map((t) => t.s).join("\n");

/*
  The extent of the drawing itself — the cut lines and the dashed component
  footprints — as distinct from the page furniture around it. Picked out by
  pen width, which is what tells a cut line from a dimension line.
*/
const isCut = (pen: Pen) => pen.width === 0.3 && !pen.dash;
const isGuide = (pen: Pen) => pen.width === 0.25 && !!pen.dash;
const drawn = (pen: Pen) => isCut(pen) || isGuide(pen);
function drawnBounds(r: Recorder) {
  const pts: Pt[] = [];
  for (const p of r.polys) if (drawn(p.pen)) pts.push(...p.pts);
  for (const c of r.circles) {
    if (!drawn(c.pen)) continue;
    pts.push([c.c[0] - c.r, c.c[1] - c.r], [c.c[0] + c.r, c.c[1] + c.r]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

describe("the scale ruler", () => {
  it("is exactly 100 mm long on every page", () => {
    // Everything else on the sheet is meaningless if this is not true size.
    for (const pages of [record(spec()), record(huge)]) {
      for (const { r } of pages) {
        const runs = r.polys.filter((p) => p.pts.length === 2 && Math.abs(p.pts[0][1] - p.pts[1][1]) < 1e-9);
        const hundred = runs.find((p) => Math.abs(Math.abs(p.pts[1][0] - p.pts[0][0]) - RULER_MM) < 1e-9);
        expect(hundred, "no 100 mm horizontal run on the page").toBeDefined();
        expect(hundred!.pts[0][0]).toBe(PAGE_MARGIN_MM);
      }
    }
  });

  it("is ticked every 10 mm and labelled at every 50", () => {
    const [{ r }] = record(spec());
    const y = r.polys.find((p) => Math.abs(Math.abs(p.pts[1][0] - p.pts[0][0]) - RULER_MM) < 1e-9)!.pts[0][1];
    const ticks = r.polys.filter((p) => p.pts.length === 2 && Math.abs(p.pts[0][0] - p.pts[1][0]) < 1e-9 && Math.abs(p.pts[0][1] - y) < 1e-9);
    expect(ticks).toHaveLength(11);
    expect(r.texts.filter((t) => ["0", "50", "100"].includes(t.s))).toHaveLength(3);
  });

  it("warns against fit-to-page on every single sheet", () => {
    // A scaled print passes every other check while telling the user nothing,
    // so this cannot be on page one only.
    for (const { r } of record(huge)) {
      expect(said(r)).toContain("PRINT AT 100%");
      expect(said(r)).toContain("measure this first");
      expect(said(r)).toContain("The print is scaled");
    }
  });
});

describe("one part per page", () => {
  it("draws every part the design has, and each one only once", () => {
    const d = designFrame(spec());
    const plan = planPrint(d, a4);
    expect(plan.pages.map((p) => p.profile.id)).toEqual(d.profiles.map((p) => p.id));
  });

  it("draws one arm when the arms are identical and two when they are not", () => {
    /*
      The thing the user has to be able to trust: a true X gets one arm
      drawing because all four arms are the same part, and a dead cat — whose
      front arms are swept and therefore a different length — gets two.
    */
    const x = planPrint(designFrame(spec()), a4);
    const cat = planPrint(designFrame(spec({ layout: "deadcat" })), a4);
    const arms = (p: typeof x) => [...new Set(p.pages.filter((g) => g.profile.cantileverMm !== undefined).map((g) => g.profile.id))];
    expect(arms(x)).toHaveLength(1);
    expect(arms(cat)).toHaveLength(2);
    // And each drawing says how many of that arm to cut, and at what bearings.
    for (const pg of cat.pages.filter((g) => g.profile.cantileverMm !== undefined)) {
      expect(pg.profile.qty).toBe(2);
      expect(pg.specs.find((s) => s.label === "Fitted at")?.value).toMatch(/\d+°, \d+°/);
    }
  });

  it("fits every part of a bolted frame on a single page", () => {
    /*
      This is what the sheet got wrong before: it tiled the assembled
      aircraft, so a 5" frame came out as four pages each showing an
      off-centre crop and no page showing a whole part. Turning a long arm a
      quarter round is what keeps even a 10" to one page per part.
    */
    for (const s of [tiny, spec(), spec({ propIn: 7, motorId: "2806", motorThrustG: 1900 }), huge]) {
      for (const pg of planPrint(designFrame(s), a4).pages) {
        expect(pg.of, `${s.propIn}" ${pg.profile.id}`).toBe(1);
      }
    }
  });

  it("tiles the one part that genuinely cannot fit — a unibody chassis", () => {
    // It is the whole aircraft in one piece, so it is wider than the paper
    // whatever is done with it. Everything else on that frame still gets a
    // page of its own.
    const plan = planPrint(designFrame(spec({ construction: "unibody" })), a4);
    const chassis = plan.pages.filter((p) => p.profile.id === "chassis");
    expect(chassis.length).toBeGreaterThan(1);
    expect(plan.pages.filter((p) => p.profile.id !== "chassis").every((p) => p.of === 1)).toBe(true);
  });

  it("centres the drawing and keeps it clear of the page furniture", () => {
    for (const s of [tiny, spec(), spec({ layout: "deadcat" }), huge]) {
      for (const { r, pg } of record(s)) {
        const b = drawnBounds(r);
        const where = `${s.propIn}" ${pg.profile.id}`;
        // Inside the printable area, under the header, above the table.
        const specY = r.texts.find((t) => t.s === "DIMENSIONS")!.at[1];
        expect(b.minX, `${where} left`).toBeGreaterThanOrEqual(PAGE_MARGIN_MM);
        expect(b.maxX, `${where} right`).toBeLessThanOrEqual(a4.widthMm - PAGE_MARGIN_MM);
        expect(b.minY, `${where} top`).toBeGreaterThanOrEqual(PAGE_MARGIN_MM);
        expect(b.maxY, `${where} bottom`).toBeLessThan(specY);
        // And centred in whatever is left, which is what "not cropped" means
        // once it fits: equal paper on both sides, and on top and bottom.
        expect(b.minX - PAGE_MARGIN_MM, `${where} centred across`)
          .toBeCloseTo(a4.widthMm - PAGE_MARGIN_MM - b.maxX, 6);
      }
    }
  });

  it("puts each component footprint on the part it bears against", () => {
    const pages = record(spec());
    const page = (id: string) => said(pages.find((p) => p.pg.profile.id === id)!.r);
    expect(page("bottom-plate")).toContain("Battery 105 × 35 mm");
    expect(page("bottom-plate")).toContain("Stack 30.5 mm");
    expect(page("camera-plate")).toContain("Micro — 19 mm");
    // Not all piled onto one drawing on top of each other, as they used to be.
    expect(page("arm")).not.toContain("Battery");
    expect(page("arm")).not.toContain("Micro");
    expect(page("camera-plate")).not.toContain("Battery");
  });

  it("leaves the camera out entirely when there is no camera", () => {
    const pages = record(spec({ cameraId: "none" }));
    expect(pages.some((p) => p.pg.profile.id === "camera-plate")).toBe(false);
    expect(pages.map((p) => said(p.r)).join("\n")).not.toContain("Micro");
  });

  it("puts a centre cross in every hole of the part it draws", () => {
    for (const { r, pg } of record(spec())) {
      const crosses = r.polys.filter((p) => p.pen.width === 0.08).length;
      expect(crosses, pg.profile.id).toBe(pg.profile.holes.length * 2);
    }
  });

  it("names the aircraft and the part on every page", () => {
    for (const { r, pg } of record(spec())) {
      expect(said(r)).toContain(`Avion — ${pg.profile.name}`);
    }
  });
});

describe("the dimensions", () => {
  it("states what someone cutting the part needs to know", () => {
    const d = designFrame(spec());
    const plate = d.profiles.find((p) => p.id === "bottom-plate")!;
    const rows = Object.fromEntries(partSpecs(d, plate).map((x) => [x.label, x.value]));
    expect(rows.Quantity).toBe("1 off");
    expect(rows.Material).toBe(d.material.name);
    expect(rows.Thickness).toBe(`${plate.thicknessMm.toFixed(1)} mm`);
    expect(rows.Overall).toMatch(/^\d+\.\d mm × \d+\.\d mm$/);
    expect(rows.Holes).toMatch(/\d+ × Ø\d/);
    expect(rows["Stack pattern"]).toContain("30.5 mm square");
  });

  it("measures the overall size off the geometry that is actually drawn", () => {
    // So the table can never disagree with the lines above it.
    for (const s of [spec(), spec({ layout: "deadcat" }), huge]) {
      const d = designFrame(s);
      for (const p of d.profiles) {
        const xs = p.outline.map((q) => q[0]);
        const ys = p.outline.map((q) => q[1]);
        const w = (Math.max(...xs) - Math.min(...xs)).toFixed(1);
        const l = (Math.max(...ys) - Math.min(...ys)).toFixed(1);
        const row = partSpecs(d, p).find((x) => x.label === "Overall")!.value;
        expect(row, `${s.propIn}" ${p.id}`).toBe(`${w} mm × ${l} mm`);
      }
    }
  });

  it("gives an arm its lengths and a plate its openings", () => {
    const d = designFrame(spec());
    const arm = partSpecs(d, d.profiles.find((p) => p.cantileverMm !== undefined)!);
    expect(arm.find((x) => x.label === "Exposed length")).toBeDefined();
    expect(arm.find((x) => x.label === "Clamped length")).toBeDefined();
    expect(arm.find((x) => x.label === "Section")?.value).toMatch(/mm × .* mm/);
    expect(arm.find((x) => x.label === "Motor pattern")?.value).toBe("16 mm, M3");

    const top = partSpecs(d, d.profiles.find((p) => p.id === "top-plate")!);
    expect(top.find((x) => x.label === "Stack opening")?.value).toMatch(/square|none/);
  });

  it("prints only characters the PDF can actually carry", () => {
    // Anything else measures and lays out perfectly and then prints as "?".
    for (const s of [spec(), spec({ layout: "deadcat" }), huge, spec({ construction: "unibody" })]) {
      for (const { r, pg } of record(s)) {
        for (const t of r.texts) {
          for (const ch of t.s) {
            expect(encodable(ch), `${pg.profile.id}: "${t.s}" contains ${ch}`).toBe(true);
          }
        }
      }
    }
  });

  it("prints the table on every page, both columns and nothing clipped", () => {
    /*
      Every frame, not just the default one. Checked on the 5" alone this
      passed while the 10" ran its strapline off the edge of the page —
      because only a part drawn turned carries the clause that made it too
      long, and nothing on a 5" is drawn turned.
    */
    const every = [tiny, spec(), spec({ layout: "deadcat" }), huge, spec({ construction: "unibody" })]
      .flatMap((s) => record(s));
    // And the sweep has to actually contain one, or it covers nothing.
    expect(every.some((p) => p.pg.turned), "no turned page in the sweep").toBe(true);
    for (const { r, pg } of every) {
      const labels = pg.specs.map((s) => s.label);
      for (const label of labels) {
        const at = r.texts.find((t) => t.s === label);
        expect(at, `${pg.profile.id} ${label}`).toBeDefined();
        expect(at!.at[0]).toBeGreaterThanOrEqual(PAGE_MARGIN_MM);
      }
      for (const t of r.texts) {
        const w = textWidth(t.s, t.style.size, t.style.bold);
        const left = t.style.anchor === "end" ? t.at[0] - w : t.style.anchor === "middle" ? t.at[0] - w / 2 : t.at[0];
        expect(left, `${pg.profile.id}: "${t.s}" runs off the left`).toBeGreaterThan(-0.5);
        expect(left + w, `${pg.profile.id}: "${t.s}" runs off the right`).toBeLessThan(a4.widthMm + 0.5);
      }
    }
  });

  it("calls the overall sizes out on the drawing too", () => {
    const { r, pg } = record(spec()).find((p) => p.pg.profile.id === "bottom-plate")!;
    const overall = pg.specs.find((s) => s.label === "Overall")!.value;
    // Each figure also stands alone on the drawing, as a dimension label.
    for (const fig of overall.split(" × ")) {
      expect(r.texts.some((t) => t.s === fig), fig).toBe(true);
    }
    expect(r.texts.some((t) => t.s === overall), overall).toBe(true);
    // Drawn with arrowheads: filled triangles, four of them.
    expect(r.polys.filter((p) => p.pen.fill && p.pts.length === 3)).toHaveLength(4);
  });
});

describe("tiling, when a part really is too big", () => {
  const sheetOfPaper = { id: "slip", name: "Slip", widthMm: 90, heightMm: 120 };

  it("splits it with an overlap to tape along, and says so", () => {
    const d = designFrame(spec());
    const plan = planPrint(d, sheetOfPaper);
    const split = plan.pages.filter((p) => p.of > 1);
    expect(split.length).toBeGreaterThan(0);
    const r = new Recorder();
    drawPage(r, d, plan, split[0], "Avion");
    expect(said(r)).toContain("tape");
    expect(said(r)).toMatch(/Column \d+ of \d+, row \d+ of \d+/);
    expect(said(r)).toContain(`sheet 1 of ${split[0].of}`);
  });

  it("covers the whole part across its tiles", () => {
    const d = designFrame(spec());
    for (const profile of d.profiles) {
      const group = planPrint(d, sheetOfPaper).pages.filter((p) => p.profile.id === profile.id);
      const axis = (i: 0 | 1) => profile.outline.map((q) => q[i]);
      const lo = (t: PartPage, i: 0 | 1) => (i === 0 ? t.tile.x : t.tile.y);
      const size = (t: PartPage, i: 0 | 1) => (i === 0 ? t.tile.widthMm : t.tile.heightMm);
      for (const i of [0, 1] as const) {
        // A turned part has its axes swapped, so compare against both.
        const lows = group.map((t) => lo(t, i));
        const highs = group.map((t) => lo(t, i) + size(t, i));
        const span = group[0].turned ? axis(i === 0 ? 1 : 0) : axis(i);
        const reach = group[0].turned ? span.map((v) => (i === 0 ? v : -v)) : span;
        expect(Math.min(...lows), `${profile.id} axis ${i}`).toBeLessThanOrEqual(Math.min(...reach) + 1e-6);
        expect(Math.max(...highs), `${profile.id} axis ${i}`).toBeGreaterThanOrEqual(Math.max(...reach) - 1e-6);
      }
    }
  });

  it("never asks for a tile larger than the printable area", () => {
    for (const page of [...PAGE_SIZES, sheetOfPaper]) {
      for (const pg of planPrint(designFrame(spec()), page).pages) {
        expect(pg.tile.widthMm).toBeLessThanOrEqual(page.widthMm - 2 * PAGE_MARGIN_MM + 1e-9);
        expect(pg.tile.heightMm).toBeLessThanOrEqual(page.heightMm - 2 * PAGE_MARGIN_MM + 1e-9);
      }
    }
  });

  it("says nothing about taping when a part fits one page", () => {
    expect(said(record(tiny)[0].r)).not.toContain("tape");
  });
});

describe("the PDF", () => {
  const pdf = (s: FrameSpec, page = a4) => {
    const d = designFrame(s);
    return toPrintPDF(d, planPrint(d, page), "Avion");
  };
  const text = (b: Uint8Array) => new TextDecoder("latin1").decode(b);

  it("is a well-formed PDF with one page per part drawing", () => {
    const d = designFrame(spec());
    const plan = planPrint(d, a4);
    const body = text(toPrintPDF(d, plan, "Avion"));
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(plan.pages.length).toBe(d.profiles.length);
    expect(body).toContain(`/Count ${plan.pages.length}`);
    expect((body.match(/\/Type \/Page\b/g) ?? []).length).toBe(plan.pages.length);
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

  it("grows with the number of parts and carries real content", () => {
    const withCamera = pdf(spec());
    const without = pdf(spec({ cameraId: "none" }));
    expect(withCamera.length).toBeGreaterThan(without.length);
    expect(without.length).toBeGreaterThan(2000);
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
    for (const ch of ["—", "×", "·", "°", "²", "Ø"]) {
      expect(textWidth(ch, 10), ch).toBeGreaterThan(0);
      expect(encodable(ch), ch).toBe(true);
    }
    // The diameter sign proper is not in WinAnsi; a width alone does not mean
    // it prints, and it reached a drawing as a question mark on the strength
    // of having one. "Ø" is what an engineering drawing uses anyway.
    expect(textWidth("⌀", 10)).toBeGreaterThan(0);
    expect(encodable("⌀")).toBe(false);
  });
});

describe("the SVG backend", () => {
  it("still renders a page at true size, for looking at in a browser", () => {
    const d = designFrame(spec());
    const plan = planPrint(d, a4);
    const svg = toPrintSVG(d, plan, plan.pages[0], "Avion");
    expect(svg).toContain(`width="${a4.widthMm}mm"`);
    expect(svg).toContain(`viewBox="0 0 ${a4.widthMm} ${a4.heightMm}"`);
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
    expect(/NaN|Infinity|undefined/.test(svg)).toBe(false);
  });
});
