import { describe, expect, it } from "vitest";
import { buildBOM, buildRecipe, standardBoltLength } from "../bom";
import { boundsOf, nestParts, toDXF, toSVG } from "../exporters";
import { designFrame, type FrameSpec } from "../geometry";
import { signedArea, toSTLParts } from "../solid";

const spec = (over: Partial<FrameSpec> = {}): FrameSpec => ({
  layout: "true-x",
  propIn: 5,
  clearanceMm: 10,
  wheelbaseMm: null,
  motorId: "2207",
  motorThrustG: 1350,
  stackPattern: 30.5,
  stackBolt: 3, stackHeightMm: 15,
  battery: { l: 105, w: 35, h: 30, massG: 180 },
  electronicsMassG: 120,
  construction: "bolted",
  materialId: "cf-plate",
  fixedDimMm: 4,
  plateThicknessMm: null,
  wallMm: 2.5, lightenPlates: true,
  styleId: "freestyle",
  safetyFactor: 2,
  ...over,
});

const cutDesign = () => designFrame(spec());
const printDesign = () => designFrame(spec({ materialId: "pa-cf", fixedDimMm: 12 }));

/** Read a DXF back into group-code/value pairs. */
function parsePairs(dxf: string): [number, string][] {
  const lines = dxf.split("\n");
  // A well-formed DXF is an even number of lines plus the trailing newline.
  const pairs: [number, string][] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    if (lines[i] === "" && lines[i + 1] === undefined) break;
    pairs.push([Number(lines[i]), lines[i + 1]]);
  }
  return pairs;
}

const headerValue = (pairs: [number, string][], name: string): string | undefined => {
  const i = pairs.findIndex(([c, v]) => c === 9 && v === name);
  return i >= 0 ? pairs[i + 1][1] : undefined;
};

describe("nesting", () => {
  it("lays every copy of every part out without overlapping", () => {
    const nest = nestParts(cutDesign().profiles, { sheetWidthMm: 300, gapMm: 5 });
    // 1 bottom + 1 top + 4 arms
    expect(nest.parts).toHaveLength(6);

    const boxes = nest.parts.map((p) => boundsOf(p.outline));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i];
        const b = boxes[j];
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
        expect(overlaps, `${nest.parts[i].label} overlaps ${nest.parts[j].label}`).toBe(false);
      }
    }
  });

  it("keeps every part inside the sheet width and the reported extent", () => {
    const nest = nestParts(cutDesign().profiles, { sheetWidthMm: 300, gapMm: 5 });
    for (const p of nest.parts) {
      const b = boundsOf(p.outline);
      expect(b.minX).toBeGreaterThanOrEqual(0);
      expect(b.minY).toBeGreaterThanOrEqual(0);
      expect(b.maxX).toBeLessThanOrEqual(nest.widthMm + 0.01);
      expect(b.maxY).toBeLessThanOrEqual(nest.heightMm + 0.01);
    }
  });

  it("wraps to a new row rather than running off a narrow sheet", () => {
    const wide = nestParts(cutDesign().profiles, { sheetWidthMm: 1000, gapMm: 5 });
    const narrow = nestParts(cutDesign().profiles, { sheetWidthMm: 150, gapMm: 5 });
    expect(narrow.heightMm).toBeGreaterThan(wide.heightMm);
    expect(narrow.widthMm).toBeLessThanOrEqual(150);
  });

  it("moves holes with their part", () => {
    const d = cutDesign();
    const nest = nestParts(d.profiles, { sheetWidthMm: 300, gapMm: 5 });
    for (const part of nest.parts) {
      const source = d.profiles.find((p) => p.id === part.profileId)!;
      expect(part.holes).toHaveLength(source.holes.length);
      const b = boundsOf(part.outline);
      for (const h of part.holes) {
        expect(h.c[0]).toBeGreaterThanOrEqual(b.minX);
        expect(h.c[0]).toBeLessThanOrEqual(b.maxX);
        expect(h.c[1]).toBeGreaterThanOrEqual(b.minY);
        expect(h.c[1]).toBeLessThanOrEqual(b.maxY);
      }
    }
  });
});

describe("DXF R12", () => {
  const dxf = () => toDXF(nestParts(cutDesign().profiles));

  it("declares the R12 dialect and millimetre units", () => {
    const pairs = parsePairs(dxf());
    expect(headerValue(pairs, "$ACADVER")).toBe("AC1009");
    expect(headerValue(pairs, "$INSUNITS")).toBe("4"); // 4 = mm
  });

  it("is structurally well formed — sections open, close, and end at EOF", () => {
    const text = dxf();
    const pairs = parsePairs(text);
    expect(pairs.length % 1).toBe(0);
    const sections = pairs.filter(([c, v]) => c === 0 && v === "SECTION").length;
    const ends = pairs.filter(([c, v]) => c === 0 && v === "ENDSEC").length;
    expect(sections).toBe(ends);
    expect(sections).toBe(4); // HEADER, TABLES, BLOCKS, ENTITIES
    expect(text.trimEnd().endsWith("EOF")).toBe(true);
    expect(pairs.filter(([c, v]) => c === 0 && v === "EOF")).toHaveLength(1);
  });

  it("uses POLYLINE/VERTEX/SEQEND, not the R13+ LWPOLYLINE", () => {
    const text = dxf();
    expect(text).not.toContain("LWPOLYLINE");
    const pairs = parsePairs(text);
    const polys = pairs.filter(([c, v]) => c === 0 && v === "POLYLINE").length;
    const seqends = pairs.filter(([c, v]) => c === 0 && v === "SEQEND").length;
    expect(polys).toBeGreaterThan(0);
    expect(seqends).toBe(polys);
  });

  it("declares every layer it draws on", () => {
    const pairs = parsePairs(dxf());
    const declared = new Set<string>();
    for (let i = 0; i < pairs.length; i++) {
      if (pairs[i][0] === 0 && pairs[i][1] === "LAYER" && pairs[i + 1]?.[0] === 2) declared.add(pairs[i + 1][1]);
    }
    const used = new Set(pairs.filter(([c]) => c === 8).map(([, v]) => v));
    for (const layer of used) expect(declared, `layer ${layer}`).toContain(layer);
  });

  it("writes one circle per hole and no exponent notation", () => {
    const nest = nestParts(cutDesign().profiles);
    const text = toDXF(nest);
    const circles = parsePairs(text).filter(([c, v]) => c === 0 && v === "CIRCLE").length;
    const holes = nest.parts.reduce((s, p) => s + p.holes.length, 0);
    expect(circles).toBe(holes);
    // "1e-7" in a coordinate is rejected outright by most DXF readers
    expect(text).not.toMatch(/\de[+-]\d/i);
  });

  it("draws at 1:1 — part sizes in the file equal the designed sizes", () => {
    const d = cutDesign();
    const gapMm = 5;
    const nest = nestParts(d.profiles, { gapMm });
    const pairs = parsePairs(toDXF(nest));

    // Pull each POLYLINE back out of the file as a list of vertices.
    const polys: [number, number][][] = [];
    let current: [number, number][] | null = null;
    for (let i = 0; i < pairs.length; i++) {
      const [code, value] = pairs[i];
      if (code === 0 && value === "POLYLINE") current = [];
      else if (code === 0 && value === "VERTEX" && current) current.push([Number(pairs[i + 2][1]), Number(pairs[i + 3][1])]);
      else if (code === 0 && value === "SEQEND" && current) {
        polys.push(current);
        current = null;
      }
    }
    expect(polys.length).toBeGreaterThan(0);

    // Every outline in the file must measure the same as the profile it came
    // from. This is the check that catches a unit or scale mistake.
    const sizeOf = (pts: [number, number][]) => {
      const xs = pts.map((p) => p[0]);
      const ys = pts.map((p) => p[1]);
      return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
    };
    for (const profile of d.profiles) {
      const b = boundsOf(profile.outline);
      const want = [b.maxX - b.minX, b.maxY - b.minY];
      const matched = polys.some((p) => {
        const got = sizeOf(p);
        return Math.abs(got[0] - want[0]) < 0.01 && Math.abs(got[1] - want[1]) < 0.01;
      });
      expect(matched, `${profile.name} at ${want[0]}×${want[1]} mm not found at 1:1`).toBe(true);
    }

    // The laid-out content sits inside the reported extent, one gap in from
    // each edge, so a cutter sees a sheet with a margin rather than parts
    // running off the side.
    const allX = polys.flat().map((p) => p[0]);
    const allY = polys.flat().map((p) => p[1]);
    expect(Math.min(...allX)).toBeCloseTo(gapMm, 1);
    expect(Math.min(...allY)).toBeCloseTo(gapMm, 1);
    expect(Math.max(...allX)).toBeLessThanOrEqual(nest.widthMm - gapMm + 0.01);
    expect(Math.max(...allY)).toBeLessThanOrEqual(nest.heightMm - gapMm + 0.01);
  });

  it("omits labels when asked", () => {
    const nest = nestParts(cutDesign().profiles);
    expect(toDXF(nest, { labels: false })).not.toContain("TEXT");
    expect(toDXF(nest, { labels: true })).toContain("TEXT");
  });
});

describe("SVG", () => {
  it("declares real millimetre dimensions matched to its viewBox", () => {
    const nest = nestParts(cutDesign().profiles);
    const svg = toSVG(nest);
    expect(svg).toContain(`width="${nest.widthMm.toFixed(4)}mm"`);
    expect(svg).toContain(`viewBox="0 0 ${nest.widthMm.toFixed(4)} ${nest.heightMm.toFixed(4)}"`);
  });

  it("flips Y, so the drawing is not mirrored against the DXF", () => {
    const nest = nestParts(cutDesign().profiles);
    const svg = toSVG(nest);
    const circles = [...svg.matchAll(/<circle cx="([-\d.]+)" cy="([-\d.]+)"/g)];
    expect(circles.length).toBeGreaterThan(0);
    for (const m of circles) {
      const cy = Number(m[2]);
      expect(cy).toBeGreaterThanOrEqual(-0.01);
      expect(cy).toBeLessThanOrEqual(nest.heightMm + 0.01);
    }
    // the topmost DXF feature must be the bottommost SVG feature
    const dxfTop = Math.max(...nest.parts.flatMap((p) => p.holes.map((h) => h.c[1])));
    const svgMin = Math.min(...circles.map((m) => Number(m[2])));
    expect(svgMin).toBeCloseTo(nest.heightMm - dxfTop, 2);
  });

  it("escapes text so a part name can never break the document", () => {
    const d = cutDesign();
    const nest = nestParts([{ ...d.profiles[0], name: 'Plate <"A"> & co' }]);
    const svg = toSVG(nest);
    expect(svg).toContain("&lt;");
    expect(svg).toContain("&amp;");
    expect(svg).not.toContain('<"A">');
  });

  it("is a single root element with balanced tags", () => {
    const svg = toSVG(nestParts(cutDesign().profiles));
    expect(svg.match(/<svg/g)).toHaveLength(1);
    expect(svg.match(/<\/svg>/g)).toHaveLength(1);
    expect(svg.match(/<g /g)?.length).toBe(svg.match(/<\/g>/g)?.length);
  });
});

describe("STL", () => {
  it("normalises winding so extruded parts are not inside out", () => {
    expect(signedArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBeGreaterThan(0);
    expect(signedArea([[0, 0], [0, 10], [10, 10], [10, 0]])).toBeLessThan(0);
  });

  it("exports one binary STL per part, at the thickness the solver chose", () => {
    const d = printDesign();
    const parts = toSTLParts(d.profiles);
    expect(parts).toHaveLength(d.profiles.length);
    for (const [i, p] of parts.entries()) {
      expect(p.thicknessMm).toBe(d.profiles[i].thicknessMm);
      expect(p.qty).toBe(d.profiles[i].qty);
      expect(p.filename).toMatch(/\.stl$/);
      // binary STL: 80-byte header + 4-byte triangle count + 50 bytes each
      expect(p.data.byteLength).toBeGreaterThan(84);
      const count = new DataView(p.data).getUint32(80, true);
      expect(count).toBeGreaterThan(0);
      expect(p.data.byteLength).toBe(84 + count * 50);
    }
  });

  it("gives the printed arm the depth the structural solver asked for", () => {
    const d = printDesign();
    const arm = d.profiles.find((p) => p.id === "arm")!;
    expect(arm.thicknessMm).toBe(d.section.heightMm);
    expect(arm.thicknessMm).toBeGreaterThan(4);
  });
});

describe("bill of materials", () => {
  it("rounds bolt lengths up to a size that is actually sold", () => {
    expect(standardBoltLength(9.2)).toBe(10);
    expect(standardBoltLength(10)).toBe(10);
    expect(standardBoltLength(13.1)).toBe(14);
  });

  it("specifies motor, clamp and stack hardware in the right quantities", () => {
    const bom = buildBOM(cutDesign());
    const motor = bom.find((l) => l.purpose.startsWith("Motor mounting"))!;
    const clamp = bom.find((l) => l.purpose.startsWith("Arm clamp,"))!;
    expect(motor.qty).toBe(16); // four bolts, four motors
    expect(clamp.qty).toBe(8); // two bolts, four arms
    expect(motor.item).toContain("M3");
    expect(bom.some((l) => l.item.includes("nyloc"))).toBe(true);
  });

  it("matches the clamp bolt to the stack it has to pass through", () => {
    const d = cutDesign();
    const clamp = buildBOM(d).find((l) => l.purpose.startsWith("Arm clamp,"))!;
    const length = Number(clamp.item.match(/× (\d+) mm/)![1]);
    const bottom = d.profiles.find((p) => p.id === "bottom-plate")!;
    const top = d.profiles.find((p) => p.id === "top-plate")!;
    const arm = d.profiles.find((p) => p.id === "arm")!;
    expect(length).toBeGreaterThan(bottom.thicknessMm + arm.thicknessMm + top.thicknessMm);
  });

  it("asks for sheet on a cut frame and filament on a printed one", () => {
    expect(buildBOM(cutDesign())[0].item).toContain("sheet");
    expect(buildBOM(printDesign())[0].item).toContain("filament");
  });
});

describe("making instructions", () => {
  it("tells a printed build to lay the arms flat along the bed", () => {
    /*
      This reverses earlier guidance in this file, deliberately. Bending an arm
      stresses it along its length; printed flat, that stress is in-plane
      within each layer, and the layer bonds only see transverse shear (well
      under 1 MPa here against tens of MPa of capability). Standing the arm on
      edge would put bending stress across the layer lines instead.
    */
    const steps = buildRecipe(printDesign());
    expect(steps[0].title.toLowerCase()).toContain("flat");
    expect(steps[0].title.toLowerCase()).not.toContain("on edge");
    expect(steps.some((s) => /dry/i.test(s.title))).toBe(true);
    expect(steps.some((s) => /solid/i.test(s.title))).toBe(true);
  });

  it("tells a cut build that arms and plates are different thicknesses", () => {
    const steps = buildRecipe(cutDesign());
    expect(steps.some((s) => s.title.toLowerCase().includes("two thicknesses"))).toBe(true);
  });

  it("gives a unibody its own instructions, not the bolted ones", () => {
    const uni = buildRecipe(designFrame(spec({ construction: "unibody" })));
    const bolted = buildRecipe(cutDesign());
    expect(uni[0].title.toLowerCase()).toContain("one piece");
    expect(bolted[0].title.toLowerCase()).toContain("arms");
    // The two-plate simplification makes no sense when there is one plate.
    expect(uni.some((s) => /one plate thickness/i.test(s.title))).toBe(false);
    expect(bolted.some((s) => /one plate thickness/i.test(s.title))).toBe(true);
  });

  it("tells a cut build not to let the file be scaled", () => {
    const steps = buildRecipe(cutDesign());
    expect(steps.some((s) => /scale/i.test(s.detail))).toBe(true);
  });

  it("warns about carbon dust only when the frame is carbon", () => {
    const carbon = buildRecipe(cutDesign()).map((s) => s.detail).join(" ");
    const ply = buildRecipe(designFrame(spec({ materialId: "ply-birch", fixedDimMm: 4 }))).map((s) => s.detail).join(" ");
    expect(carbon).toMatch(/respiratory|dust/i);
    expect(ply).not.toMatch(/conductive/i);
  });
});

/**
 * Signed volume of a binary STL, mm³.
 *
 * Summing the signed volume of each triangle's tetrahedron to the origin gives
 * the enclosed volume of a closed mesh, and gives it correctly for a part with
 * an inward-facing internal void: the void's triangles carry the opposite sign
 * and subtract themselves out.
 */
function stlVolume(data: ArrayBuffer): number {
  const view = new DataView(data);
  const count = view.getUint32(80, true);
  let v = 0;
  for (let i = 0; i < count; i++) {
    const o = 84 + i * 50 + 12; // skip the facet normal
    const p: number[][] = [];
    for (let k = 0; k < 3; k++) {
      p.push([view.getFloat32(o + k * 12, true), view.getFloat32(o + k * 12 + 4, true), view.getFloat32(o + k * 12 + 8, true)]);
    }
    const [a, b, c] = p;
    v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
  }
  return Math.abs(v);
}

describe("exported solids match the quoted design", () => {
  const bigPrint = () =>
    designFrame(
      spec({
        propIn: 10,
        motorId: "3110",
        motorThrustG: 2600,
        materialId: "pa-cf",
        styleId: "gentle",
        electronicsMassG: 300,
        battery: { l: 170, w: 55, h: 50, massG: 900 },
      }),
    );

  it("hollows a deep printed arm, and the void is real volume removed", () => {
    const d = bigPrint();
    const arm = d.profiles.find((p) => p.id === "arm")!;
    expect(d.section.hollow, "a 10\" printed arm is deep enough to hollow").toBe(true);
    expect(arm.cavity).toBeTruthy();

    const armStl = toSTLParts(d.profiles).find((p) => p.name === "Arm")!;
    const hollowVolume = stlVolume(armStl.data);
    const solidVolume = arm.areaMm2 * arm.thicknessMm;

    // A box section only pays for its walls, so the real part must come in
    // well under the solid bar it would otherwise be.
    expect(hollowVolume).toBeLessThan(solidVolume * 0.9);
    expect(hollowVolume).toBeGreaterThan(solidVolume * 0.3);
  });

  it("leaves a shallow section solid rather than pretending to hollow it", () => {
    /*
      A 5" printed arm comes out about 6 mm deep. With 2.5 mm walls that
      leaves a 1 mm slot, which is not worth building and which no slicer
      would render usefully. The solver must agree with that decision, or it
      quotes the weight of a hollow part and exports a solid one.
    */
    const d = printDesign();
    const arm = d.profiles.find((p) => p.id === "arm")!;
    expect(arm.thicknessMm).toBeLessThanOrEqual(2 * 2.5 + 1);
    expect(d.section.hollow).toBe(false);
    expect(arm.cavity).toBeUndefined();
  });

  it("the quoted frame mass matches the volume actually exported", () => {
    /*
      The weight shown to the user is computed from the solved cross-section,
      while the STL is built from the drawn outline. Nothing forces those two
      to agree, so this checks them against each other — if the mass model and
      the geometry ever drift apart, the studio starts quoting a weight for a
      part it does not export.
    */
    for (const d of [cutDesign(), printDesign()]) {
      const exported = toSTLParts(d.profiles).reduce(
        (sum, p, i) => sum + stlVolume(p.data) * d.profiles[i].qty,
        0,
      );
      const quotedVolume = (d.mass.frameG / d.material.density) * 1000; // g → mm³
      expect(Math.abs(exported - quotedVolume) / quotedVolume, `${d.material.name}`).toBeLessThan(0.05);
    }
  });
});
