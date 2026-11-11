/*
  Frame Studio — ZIP writer.

  A design exports as several files: one drawing per sheet thickness, or one
  solid per printed part, plus the build notes. Handing those over as separate
  downloads means several browser prompts and a Downloads folder with no
  grouping, so they go out as a single archive instead.

  Written by hand rather than pulled from a package. The format needed here is
  the oldest and smallest corner of PKZIP — no encryption, no spanning, no
  Zip64 — and the only hard part, DEFLATE, is already in the browser as
  CompressionStream. That is a few dozen lines against a dependency, and it
  keeps the studio working with nothing fetched at runtime.

  Where CompressionStream is missing the entries are stored uncompressed
  (method 0), which every unzip tool reads. The archive is bigger; nothing
  else about it changes.
*/

/** One file in the archive. Paths may contain "/" to nest directories. */
export interface ZipEntry {
  path: string;
  data: Uint8Array | string;
}

/** CRC-32 table, built once on first use. */
let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
  if (crcTable) return crcTable;
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  crcTable = t;
  return t;
}

/** CRC-32 of a byte run, as the ZIP format defines it. */
export function crc32(bytes: Uint8Array): number {
  const t = table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const enc = new TextEncoder();

const toBytes = (d: Uint8Array | string): Uint8Array => (typeof d === "string" ? enc.encode(d) : d);

/**
 * Raw DEFLATE, or null when the browser cannot do it.
 *
 * "deflate-raw" is the bare stream ZIP stores; the "deflate" variant wraps it
 * in a zlib header, which would make the entry unreadable. Compression is
 * skipped when it does not pay — already-dense data can come out larger.
 */
async function deflate(bytes: Uint8Array): Promise<Uint8Array | null> {
  const C = (globalThis as { CompressionStream?: typeof CompressionStream }).CompressionStream;
  if (!C) return null;
  try {
    const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new C("deflate-raw"));
    const out = new Uint8Array(await new Response(stream).arrayBuffer());
    return out.length < bytes.length ? out : null;
  } catch {
    return null;
  }
}

/** Little-endian writer over a growing buffer. */
class Buf {
  private bytes = new Uint8Array(1024);
  len = 0;

  private room(n: number) {
    if (this.len + n <= this.bytes.length) return;
    let size = this.bytes.length * 2;
    while (size < this.len + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.bytes.subarray(0, this.len));
    this.bytes = next;
  }

  u16(v: number) {
    this.room(2);
    this.bytes[this.len++] = v & 0xff;
    this.bytes[this.len++] = (v >>> 8) & 0xff;
  }

  u32(v: number) {
    this.room(4);
    this.bytes[this.len++] = v & 0xff;
    this.bytes[this.len++] = (v >>> 8) & 0xff;
    this.bytes[this.len++] = (v >>> 16) & 0xff;
    this.bytes[this.len++] = (v >>> 24) & 0xff;
  }

  raw(v: Uint8Array) {
    this.room(v.length);
    this.bytes.set(v, this.len);
    this.len += v.length;
  }

  done(): Uint8Array {
    return this.bytes.subarray(0, this.len);
  }
}

/** MS-DOS date and time, which is all the ZIP header has room for. */
function dosStamp(d: Date): { time: number; date: number } {
  // Seconds are stored in two-second steps, hence the halving.
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const year = Math.max(1980, d.getFullYear()) - 1980;
  const date = (year << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

/**
 * Build a ZIP archive.
 *
 * Returns a Blob so the caller can hand it straight to an anchor. Entry order
 * is preserved, which is what decides the listing order in most unzip tools.
 */
export async function zip(entries: ZipEntry[], now = new Date()): Promise<Blob> {
  const { time, date } = dosStamp(now);
  const body = new Buf();
  const dir = new Buf();

  for (const entry of entries) {
    const name = enc.encode(entry.path);
    // Bit 11 tells the reader the name is UTF-8 rather than code page 437.
    const flags = entry.path === new TextDecoder("ascii").decode(name) ? 0 : 0x800;
    const raw = toBytes(entry.data);
    const packed = await deflate(raw);
    const method = packed ? 8 : 0;
    const stored = packed ?? raw;
    const crc = crc32(raw);
    const offset = body.len;

    body.u32(0x04034b50); // local file header
    body.u16(20); // version needed: 2.0, which is all DEFLATE requires
    body.u16(flags);
    body.u16(method);
    body.u16(time);
    body.u16(date);
    body.u32(crc);
    body.u32(stored.length);
    body.u32(raw.length);
    body.u16(name.length);
    body.u16(0); // no extra field
    body.raw(name);
    body.raw(stored);

    dir.u32(0x02014b50); // central directory header
    dir.u16(20); // version made by
    dir.u16(20); // version needed
    dir.u16(flags);
    dir.u16(method);
    dir.u16(time);
    dir.u16(date);
    dir.u32(crc);
    dir.u32(stored.length);
    dir.u32(raw.length);
    dir.u16(name.length);
    dir.u16(0); // extra
    dir.u16(0); // comment
    dir.u16(0); // first disk
    dir.u16(0); // internal attributes
    dir.u32(0); // external attributes
    dir.u32(offset);
    dir.raw(name);
  }

  const cdOffset = body.len;
  const cd = dir.done();
  body.raw(cd);
  body.u32(0x06054b50); // end of central directory
  body.u16(0); // this disk
  body.u16(0); // disk holding the directory
  body.u16(entries.length);
  body.u16(entries.length);
  body.u32(cd.length);
  body.u32(cdOffset);
  body.u16(0); // no archive comment

  // Copied out of the growing buffer: the Blob must not alias a view that a
  // later write could reallocate out from under it.
  return new Blob([new Uint8Array(body.done()) as BlobPart], { type: "application/zip" });
}
