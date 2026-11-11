import { describe, expect, it } from "vitest";
import { designFrame, type FrameSpec } from "../geometry";
import { PAGE_MARGIN_MM, PAGE_SIZES, assembleForPrint, pageSizeById, planPrint, toPrintSVG } from "../printsheet";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x", propIn: 5, clearanceMm: 10, wheelbaseMm: null,
  motorId: "2207", motorThrustG: 1350, stackPattern: 30.5, stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 }, electronicsMassG: 120,
  construction: "bolted", materialId: "cf-plate", fixedDimMm: 4, plateThicknessMm: null,
  wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro",
  styleId: "freestyle", safetyFactor: 2, ...over,
});

const a4 = pageSizeById("a4");
const svgOf = (s: FrameSpec, page = a4) => {
  const d = designFrame(s);
  const plan = planPrint(d, page);
  return { d, plan, pages: plan.tiles.map((t) => toPrintSVG(d, plan, t, "Avion")) };
};

describe("printing at true size", () => {
  it("declares its page in millimetres, with a matching viewBox", () => {
    /*
      This is the whole mechanism. An SVG whose width and height are in mm and
      whose viewBox matches those numbers prints at that physical size; get
      the two out of step and every page is silently scaled.
    */
    for (const page of PAGE_SIZES) {
      const [svg] = svgOf(spec(), page).pages;
      expect(svg).toContain(`width="${page.widthMm}mm"`);
      expect(svg).toContain(`height="${page.heightMm}mm"`);
      expect(svg).toContain(`viewBox="0 0 ${page.widthMm} ${page.heightMm}"`);
    }
  });

  it("carries a 100 mm ruler on every page", () => {
    const { pages } = svgOf(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 }));
    expect(pages.length).toBeGreaterThan(1);
    for (const svg of pages) {
      // The ruler runs from the margin to exactly 100 mm further along.
      expect(svg).toContain(`M ${PAGE_MARGIN_MM},`);
      expect(svg).toMatch(new RegExp(`L ${PAGE_MARGIN_MM + 100},`));
      expect(svg).toContain("measure this first");
      expect(svg).toContain("The print is scaled");
      expect(svg).toContain("100");
    }
  });

  it("warns against fit-to-page on every single sheet", () => {
    // A scaled print passes every other check on the page while telling the
    // user nothing, so the warning cannot be on page one only.
    for (const svg of svgOf(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 })).pages) {
      expect(svg).toContain("PRINT AT 100%");
    }
  });

  it("names the aircraft and numbers the pages", () => {
    const { pages } = svgOf(spec());
    pages.forEach((svg, i) => {
      expect(svg).toContain("Avion");
      expect(svg).toContain(`check sheet ${i + 1} of ${pages.length}`);
    });
  });
});

describe("tiling", () => {
  it("fits a small frame on one page and a large one on several", () => {
    const small = planPrint(designFrame(spec({ propIn: 3, motorId: "1404", motorThrustG: 350, cameraId: "nano" })), a4);
    const large = planPrint(designFrame(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 })), a4);
    expect(small.tiles.length).toBe(1);
    expect(large.tiles.length).toBeGreaterThan(small.tiles.length);
  });

  it("covers the whole drawing, with overlap between neighbours", () => {
    for (const propIn of [2, 5, 7, 10]) {
      const motor = propIn >= 8 ? "3110" : propIn >= 7 ? "2806" : "2207";
      const d = designFrame(spec({ propIn, motorId: motor, motorThrustG: 1500, fixedDimMm: null }));
      const plan = planPrint(d, a4);
      const right = Math.max(...plan.tiles.map((t) => t.x + t.widthMm));
      const bottom = Math.max(...plan.tiles.map((t) => t.y + t.heightMm));
      expect(right, `${propIn}" right edge`).toBeGreaterThanOrEqual(plan.bounds.maxX);
      expect(bottom, `${propIn}" bottom edge`).toBeGreaterThanOrEqual(plan.bounds.maxY);
      expect(Math.min(...plan.tiles.map((t) => t.x))).toBeLessThanOrEqual(plan.bounds.minX);
      expect(Math.min(...plan.tiles.map((t) => t.y))).toBeLessThanOrEqual(plan.bounds.minY);

      // Neighbouring tiles must share material to tape along.
      if (plan.cols > 1) {
        const a = plan.tiles.find((t) => t.col === 0 && t.row === 0)!;
        const b = plan.tiles.find((t) => t.col === 1 && t.row === 0)!;
        expect(a.x + a.widthMm - b.x, `${propIn}" overlap`).toBeGreaterThan(4);
      }
    }
  });

  it("tells the user how to join the pages, but only when there are several", () => {
    const one = svgOf(spec({ propIn: 3, motorId: "1404", motorThrustG: 350, cameraId: "nano" })).pages;
    const many = svgOf(spec({ propIn: 10, motorId: "3110", motorThrustG: 2600 })).pages;
    expect(one[0]).not.toContain("tape");
    expect(many[0]).toContain("tape");
    expect(many[0]).toMatch(/Column \d+ of \d+, row \d+ of \d+/);
  });

  it("never puts drawing outside the printable area of a page", () => {
    // Content is placed relative to the margin, so a tile's own rectangle has
    // to sit inside the paper with the margin left clear on all sides.
    for (const page of PAGE_SIZES) {
      const plan = planPrint(designFrame(spec()), page);
      for (const t of plan.tiles) {
        expect(t.widthMm).toBeLessThanOrEqual(page.widthMm - 2 * PAGE_MARGIN_MM + 1e-9);
        expect(t.heightMm).toBeLessThanOrEqual(page.heightMm - 2 * PAGE_MARGIN_MM + 1e-9);
      }
    }
  });
});

describe("what is on the sheet", () => {
  it("shows the assembled frame, not the cutting nest", () => {
    // Four arms placed on their own bearings, plus the plate.
    const a = assembleForPrint(designFrame(spec()));
    expect(a.outlines.length).toBeGreaterThanOrEqual(5);
    expect(a.discs).toHaveLength(4);
  });

  it("draws footprints for the parts you are meant to lay on it", () => {
    const [svg] = svgOf(spec()).pages;
    expect(svg).toContain("Battery 105 × 35 mm");
    expect(svg).toContain("Stack 30.5 mm");
    expect(svg).toContain("Micro — 19 mm");
    expect(svg).toContain("Lay your motors, stack and battery");
  });

  it("leaves the camera footprint off when there is no camera", () => {
    const [svg] = svgOf(spec({ cameraId: "none" })).pages;
    expect(svg).not.toContain("Micro");
    expect(svg).toContain("Battery");
  });

  it("puts a centre cross in every hole", () => {
    const d = designFrame(spec());
    const a = assembleForPrint(d);
    const [svg] = svgOf(spec()).pages;
    const crosses = (svg.match(/class="centre"/g) ?? []).length;
    expect(crosses).toBe(a.holes.length);
  });

  it("emits well-formed, finite SVG for every size and layout", () => {
    for (const propIn of [2, 3, 5, 7, 10]) {
      for (const cameraId of ["none", "micro", "full"]) {
        const motor = propIn >= 8 ? "3110" : propIn >= 7 ? "2806" : "2207";
        const s = spec({ propIn, cameraId, motorId: motor, motorThrustG: 1500, fixedDimMm: null });
        for (const svg of svgOf(s).pages) {
          expect(/NaN|Infinity|undefined/.test(svg), `${propIn}" ${cameraId}`).toBe(false);
          expect(svg.startsWith("<?xml")).toBe(true);
          expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
          // Tags must balance for the common containers.
          expect((svg.match(/<g /g) ?? []).length).toBe((svg.match(/<\/g>/g) ?? []).length);
        }
      }
    }
  });
});
