import { describe, expect, it } from "vitest";
import { designFrame, type FrameSpec } from "../geometry";
import { buildBOM, buildRecipe } from "../bom";
import { buildManifest, exportSlug } from "../manifest";
import { planSheets, toDXF } from "../exporters";
import { crc32, zip, type ZipEntry } from "../zip";

/*
  The archive is verified by reading it back the way an unzip tool does:
  find the end-of-central-directory record, walk the central directory, then
  follow each entry's offset to its local header and inflate the payload. A
  writer that only agrees with its own reader proves nothing, so the sizes,
  offsets and CRCs are all cross-checked between the two copies of the
  metadata, which is exactly where a hand-rolled writer goes wrong.
*/

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
  wallMm: 2.5, lightenPlates: true, batteryMount: "bottom", cameraId: "micro",
  styleId: "freestyle",
  safetyFactor: 2,
  ...over,
});

interface ReadEntry {
  path: string;
  method: number;
  crc: number;
  uncompressedSize: number;
  body: Uint8Array;
}

/** Minimal ZIP reader: central directory first, then each local header. */
async function unzip(blob: Blob): Promise<ReadEntry[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  // The EOCD sits at the very end; there is no archive comment, so it is the
  // last 22 bytes exactly.
  const eocd = buf.length - 22;
  expect(view.getUint32(eocd, true)).toBe(0x06054b50);
  const count = view.getUint16(eocd + 10, true);
  expect(view.getUint16(eocd + 8, true)).toBe(count); // entries on this disk
  const cdSize = view.getUint32(eocd + 12, true);
  const cdOffset = view.getUint32(eocd + 16, true);
  expect(cdOffset + cdSize).toBe(eocd); // directory must butt up against the EOCD

  const dec = new TextDecoder();
  const out: ReadEntry[] = [];
  let p = cdOffset;

  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const flags = view.getUint16(p + 8, true);
    const method = view.getUint16(p + 10, true);
    const crc = view.getUint32(p + 16, true);
    const compSize = view.getUint32(p + 20, true);
    const uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const path = dec.decode(buf.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // A name with bytes above 0x7f must declare itself UTF-8, or readers fall
    // back to code page 437 and mangle it.
    const ascii = [...path].every((c) => c.charCodeAt(0) < 0x80);
    expect(Boolean(flags & 0x800)).toBe(!ascii);

    // Now the local header, which must agree with the directory in every field.
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    expect(view.getUint16(local + 8, true)).toBe(method);
    expect(view.getUint32(local + 14, true)).toBe(crc);
    expect(view.getUint32(local + 18, true)).toBe(compSize);
    expect(view.getUint32(local + 22, true)).toBe(uncompSize);
    const localNameLen = view.getUint16(local + 26, true);
    expect(dec.decode(buf.subarray(local + 30, local + 30 + localNameLen))).toBe(path);
    const dataAt = local + 30 + localNameLen + view.getUint16(local + 28, true);
    const stored = buf.subarray(dataAt, dataAt + compSize);

    const body =
      method === 0
        ? stored
        : new Uint8Array(
            await new Response(
              new Blob([stored as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw")),
            ).arrayBuffer(),
          );

    expect(body.length).toBe(uncompSize);
    expect(crc32(body)).toBe(crc);
    out.push({ path, method, crc, uncompressedSize: uncompSize, body });
  }

  expect(p).toBe(eocd); // the walk must consume the directory exactly
  return out;
}

const text = (b: Uint8Array) => new TextDecoder().decode(b);

describe("crc32", () => {
  it("matches the published check values", () => {
    // The standard CRC-32 check vector, and the empty-input identity.
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    expect(crc32(new TextEncoder().encode("The quick brown fox jumps over the lazy dog"))).toBe(0x414fa339);
    expect(crc32(new Uint8Array(0))).toBe(0);
  });

  it("is order-sensitive", () => {
    expect(crc32(new TextEncoder().encode("ab"))).not.toBe(crc32(new TextEncoder().encode("ba")));
  });
});

describe("zip", () => {
  const compressible = "0 SECTION\n2 ENTITIES\n".repeat(400);
  const binary = (() => {
    const b = new Uint8Array(5000);
    for (let i = 0; i < b.length; i++) b[i] = (i * 7) % 251;
    return b;
  })();

  const sample: ZipEntry[] = [
    { path: "avion-5mm.dxf", data: compressible },
    { path: "parts/avion-arm-x4-5mm.stl", data: binary },
    { path: "empty.txt", data: "" },
    { path: "unicode-ø.txt", data: "ø" },
  ];

  it("round-trips every entry byte for byte", async () => {
    const entries = await unzip(await zip(sample));
    expect(entries.map((e) => e.path)).toEqual(sample.map((e) => e.path));
    expect(text(entries[0].body)).toBe(compressible);
    expect([...entries[1].body]).toEqual([...binary]);
    expect(entries[2].body.length).toBe(0);
    expect(text(entries[3].body)).toBe("ø");
  });

  it("actually compresses the text it can", async () => {
    const archive = await zip(sample);
    const entries = await unzip(archive);
    const dxf = entries.find((e) => e.path.endsWith(".dxf"))!;
    expect(dxf.method).toBe(8);
    // The DXF alone is 8.4 kB of repeated text; the whole archive must come
    // out far smaller than that, or compression is not running.
    expect(archive.size).toBeLessThan(compressible.length / 4);
  });

  it("falls back to stored entries when the browser has no CompressionStream", async () => {
    const g = globalThis as Record<string, unknown>;
    const saved = g.CompressionStream;
    delete g.CompressionStream;
    try {
      const archive = await zip(sample);
      const entries = await unzip(archive);
      expect(entries.every((e) => e.method === 0)).toBe(true);
      expect(text(entries[0].body)).toBe(compressible);
      expect([...entries[1].body]).toEqual([...binary]);
      // Stored means the payload is in there verbatim, so it cannot shrink.
      expect(archive.size).toBeGreaterThan(compressible.length);
    } finally {
      g.CompressionStream = saved;
    }
  });

  it("writes a well-formed empty archive", async () => {
    const archive = await zip([]);
    expect(archive.size).toBe(22); // EOCD and nothing else
    expect(await unzip(archive)).toEqual([]);
  });

  it("is deterministic for a fixed timestamp", async () => {
    const at = new Date("2026-03-04T05:06:08Z");
    const a = new Uint8Array(await (await zip(sample, at)).arrayBuffer());
    const b = new Uint8Array(await (await zip(sample, at)).arrayBuffer());
    expect([...a]).toEqual([...b]);
  });

  it("keeps dates inside the DOS epoch", async () => {
    // Pre-1980 cannot be represented; it must clamp rather than write a
    // negative year that readers reject.
    const archive = await zip([{ path: "a.txt", data: "a" }], new Date("1970-01-01T00:00:00Z"));
    const buf = new Uint8Array(await archive.arrayBuffer());
    const view = new DataView(buf.buffer);
    const year = 1980 + (view.getUint16(12, true) >> 9);
    expect(year).toBeGreaterThanOrEqual(1980);
    expect(await unzip(archive)).toHaveLength(1);
  });
});

describe("exportSlug", () => {
  const d = designFrame(spec());

  it("uses the vehicle profile name", () => {
    expect(exportSlug("Avion", d)).toBe("avion");
    expect(exportSlug("Dwij's Rig Mk II", d)).toBe("dwij-s-rig-mk-ii");
    expect(exportSlug("  Spaced  Out  ", d)).toBe("spaced-out");
  });

  it("strips accents rather than dropping the whole word", () => {
    expect(exportSlug("Avión", d)).toBe("avion");
    expect(exportSlug("Fenêtre", d)).toBe("fenetre");
  });

  it("describes the design when there is no usable profile name", () => {
    const fallback = `aeronex-5in-true-x-${Math.round(d.wheelbaseMm)}mm`;
    expect(exportSlug(null, d)).toBe(fallback);
    expect(exportSlug(undefined, d)).toBe(fallback);
    expect(exportSlug("", d)).toBe(fallback);
    expect(exportSlug("!!!", d)).toBe(fallback); // slugs away to nothing
    expect(exportSlug("日本語", d)).toBe(fallback); // no Latin characters at all
  });

  it("stays a legal file name", () => {
    const slug = exportSlug('bad/name\\with:"*?<>| chars', d);
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug.length).toBeLessThanOrEqual(48);
    expect(exportSlug("x".repeat(200), d).length).toBe(48);
  });
});

describe("buildManifest", () => {
  const d = designFrame(spec());
  const sheets = planSheets(d.profiles, { sheetWidthMm: 300 });
  const files = sheets.map((s) => ({
    name: `avion-${s.thicknessMm}mm.dxf`,
    detail: `${s.partNames.join(", ")} — ${s.thicknessMm} mm stock.`,
  }));
  const readme = buildManifest({
    vehicleName: "Avion",
    design: d,
    kind: "drawings",
    files,
    bom: buildBOM(d),
    recipe: buildRecipe(d),
    date: new Date("2026-03-04T05:06:07Z"),
  });

  it("names the aircraft and the export date", () => {
    expect(readme).toContain("AERONEX FRAME STUDIO — Avion");
    expect(readme).toContain("2026-03-04");
  });

  it("records the stock the parts are cut from", () => {
    expect(readme).toContain(`${d.stock.armDimMm} mm sheet`);
    expect(readme).toMatch(/Plate stock\s+2\.5 mm bottom/);
  });

  it("lists every file in the archive, plus itself", () => {
    for (const f of files) expect(readme).toContain(f.name);
    expect(readme).toContain("README.txt");
  });

  it("carries the bolts to order and the build steps", () => {
    const bom = buildBOM(d);
    for (const line of bom) expect(readme).toContain(line.item);
    expect(readme).toContain(buildRecipe(d)[0].title);
  });

  it("warns against scaling the drawings", () => {
    expect(readme).toMatch(/1:1 in millimetres/);
  });

  it("keys the do-not-scale note to the archive, not the material", () => {
    /*
      A printed design still offers a DXF for anyone who would rather cut the
      plates. That archive holds drawings, so it must carry the drawing note.
      Reading this off the material told people cutting a printed design to
      "print one file per part".
    */
    const printed = designFrame(spec({ materialId: "pa-cf", fixedDimMm: 12 }));
    const args = { vehicleName: "Avion", design: printed, files: [], bom: buildBOM(printed), recipe: buildRecipe(printed) };
    const asDrawings = buildManifest({ ...args, kind: "drawings" });
    const asSolids = buildManifest({ ...args, kind: "solids" });

    expect(asDrawings).toMatch(/1:1 in millimetres/);
    expect(asDrawings).not.toMatch(/Print one file per part/);
    expect(asSolids).toMatch(/Print one file per part/);
    expect(asSolids).not.toMatch(/1:1 in millimetres/);
    // Both still describe the same frame, which is a printed one.
    for (const t of [asDrawings, asSolids]) expect(t).toContain("3D printing it");
  });

  it("names the material once, without doubling up the process", () => {
    // The material's own name says "(printed)", so appending "(3D printed)"
    // read as "PA-CF — carbon-filled nylon (printed) (3D printed)".
    expect(readme).not.toMatch(/\(sheet, cut\)|\(3D printed\)/);
    expect(readme).toMatch(/Material\s+Carbon fibre plate/);
    expect(readme).toMatch(/Made by\s+Cutting it from sheet/);
  });

  it("switches to printing language for a printed frame", () => {
    const printed = designFrame(spec({ materialId: "pa-cf", fixedDimMm: 12 }));
    const txt = buildManifest({
      vehicleName: "Avion",
      design: printed,
      kind: "solids",
      files: [],
      bom: buildBOM(printed),
      recipe: buildRecipe(printed),
    });
    expect(txt).toContain("3D printing it");
    expect(txt).toContain("hollow box");
    expect(txt).not.toMatch(/1:1 in millimetres/);
  });

  it("wraps to a width a plain text viewer can read", () => {
    for (const line of readme.split("\n")) expect(line.length).toBeLessThanOrEqual(84);
  });
});

describe("the export bundle", () => {
  it("packs one drawing per thickness plus a manifest", async () => {
    const d = designFrame(spec());
    const sheets = planSheets(d.profiles, { sheetWidthMm: 300 });
    const stem = exportSlug("Avion", d);
    const entries: ZipEntry[] = sheets.map((s) => ({
      path: `${stem}-${s.thicknessMm}mm.dxf`,
      data: toDXF(s.nest, { labels: true }),
    }));
    entries.push({
      path: "README.txt",
      data: buildManifest({
        vehicleName: "Avion",
        design: d,
        kind: "drawings",
        files: entries.map((e) => ({ name: e.path, detail: "x" })),
        bom: buildBOM(d),
        recipe: buildRecipe(d),
      }),
    });

    const read = await unzip(await zip(entries));
    expect(read).toHaveLength(sheets.length + 1);
    expect(read.every((e) => e.path.startsWith("avion-") || e.path === "README.txt")).toBe(true);
    // Every drawing must survive the round trip as a complete DXF.
    for (const e of read.filter((x) => x.path.endsWith(".dxf"))) {
      const dxf = text(e.body);
      expect(dxf.startsWith("0\nSECTION")).toBe(true);
      expect(dxf.trimEnd().endsWith("EOF")).toBe(true);
    }
  });
});
