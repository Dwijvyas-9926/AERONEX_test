import { crcCalculate } from "./crc";
import { MESSAGES, type MessageDef } from "./dialect.generated";

/*
  MAVLink v1/v2 stream framer and payload decoder.

  - Pure TypeScript, no I/O. Feed it bytes from any transport.
  - Every emitted frame has passed CRC validation against the dialect's CRC_EXTRA.
  - Messages missing from the dialect cannot be validated, so they are counted
    and skipped rather than trusted.
  - MAVLink 2 signatures are skipped over (not verified).
*/

const STX_V1 = 0xfe;
const STX_V2 = 0xfd;
const V1_HEADER = 6;
const V2_HEADER = 10;
const CRC_LEN = 2;
const SIG_LEN = 13;
const IFLAG_SIGNED = 0x01;
/** Most bytes ever held waiting for a frame to complete. */
const MAX_BACKLOG = 1 << 20;

const DEFS = new Map<number, MessageDef>();
const BY_NAME = new Map<string, number>();
for (const def of MESSAGES) {
  DEFS.set(def[0], def);
  BY_NAME.set(def[1], def[0]);
}

export const msgIdOf = (name: string) => BY_NAME.get(name);
export const msgNameOf = (id: number) => DEFS.get(id)?.[1] ?? `MSG_${id}`;

export interface MavFrame {
  version: 1 | 2;
  seq: number;
  sysid: number;
  compid: number;
  msgid: number;
  name: string;
  payload: Uint8Array; // as received (v2 may be zero-truncated)
  signed: boolean;
}

export interface ParserStats {
  bytes: number;
  framesOk: number;
  crcErrors: number;
  unknownMsg: number;
  unsupportedFlags: number;
  v1: number;
  v2: number;
}

export class MavlinkParser {
  private buf = new Uint8Array(8192);
  private len = 0;
  readonly stats: ParserStats = {
    bytes: 0,
    framesOk: 0,
    crcErrors: 0,
    unknownMsg: 0,
    unsupportedFlags: 0,
    v1: 0,
    v2: 0,
  };

  /** Append bytes and return all complete, CRC-valid frames. */
  push(chunk: Uint8Array): MavFrame[] {
    this.stats.bytes += chunk.length;
    /*
      A read larger than the whole backlog allowance cannot be a healthy
      stream — it is a stalled tab catching up, or something that is not
      MAVLink at all. Keep its tail, which is where any current frame is, and
      drop the rest. This used to clear the backlog and then copy the entire
      read into a buffer it had declined to grow, which threw and took the
      link's read loop down with it.
    */
    if (chunk.length > MAX_BACKLOG / 2) {
      chunk = chunk.subarray(chunk.length - MAX_BACKLOG / 2);
      this.len = 0;
    }
    // Bound memory: a healthy stream never needs more than a few frames of
    // backlog, so one that has built up this far is stale and is dropped.
    if (this.len + chunk.length > MAX_BACKLOG) this.len = 0;
    this.ensure(this.len + chunk.length);
    this.buf.set(chunk, this.len);
    this.len += chunk.length;

    const out: MavFrame[] = [];
    let i = 0;
    while (i < this.len) {
      const stx = this.buf[i];
      if (stx !== STX_V1 && stx !== STX_V2) {
        i++;
        continue;
      }
      const v2 = stx === STX_V2;
      const header = v2 ? V2_HEADER : V1_HEADER;
      if (this.len - i < header) break; // need more bytes

      const plen = this.buf[i + 1];
      const incompat = v2 ? this.buf[i + 2] : 0;
      if (v2 && incompat & ~IFLAG_SIGNED) {
        this.stats.unsupportedFlags++;
        i++;
        continue;
      }
      const signed = v2 && (incompat & IFLAG_SIGNED) !== 0;
      const total = header + plen + CRC_LEN + (signed ? SIG_LEN : 0);
      if (this.len - i < total) break; // incomplete frame

      const msgid = v2
        ? this.buf[i + 7] | (this.buf[i + 8] << 8) | (this.buf[i + 9] << 16)
        : this.buf[i + 5];
      const def = DEFS.get(msgid);
      if (!def) {
        // Cannot validate without CRC_EXTRA; resync one byte on.
        this.stats.unknownMsg++;
        i++;
        continue;
      }
      const crcEnd = i + header + plen;
      const crc = crcCalculate(this.buf, i + 1, crcEnd, def[2]);
      const rx = this.buf[crcEnd] | (this.buf[crcEnd + 1] << 8);
      if (crc !== rx) {
        this.stats.crcErrors++;
        i++;
        continue;
      }

      this.stats.framesOk++;
      if (v2) this.stats.v2++;
      else this.stats.v1++;
      out.push({
        version: v2 ? 2 : 1,
        seq: this.buf[i + (v2 ? 4 : 2)],
        sysid: this.buf[i + (v2 ? 5 : 3)],
        compid: this.buf[i + (v2 ? 6 : 4)],
        msgid,
        name: def[1],
        payload: this.buf.slice(i + header, crcEnd),
        signed,
      });
      i += total;
    }

    // Drop consumed bytes
    if (i > 0) {
      this.buf.copyWithin(0, i, this.len);
      this.len -= i;
    }
    return out;
  }

  reset() {
    this.len = 0;
  }

  private ensure(n: number) {
    if (n <= this.buf.length) return;
    const next = new Uint8Array(Math.max(n, this.buf.length * 2));
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
  }
}

const SIZES: Record<string, number> = {
  int8: 1,
  uint8: 1,
  char: 1,
  int16: 2,
  uint16: 2,
  int32: 4,
  uint32: 4,
  float: 4,
  int64: 8,
  uint64: 8,
  double: 8,
};

export type Decoded = Record<string, number | string | number[]>;

/** Decode a frame's payload into named fields using the dialect definition. */
export function decode(frame: MavFrame): Decoded | null {
  const def = DEFS.get(frame.msgid);
  if (!def) return null;
  // MAVLink 2 truncates trailing zero bytes; v1 frames omit extensions. Pad to full length.
  const full = new Uint8Array(def[3]);
  full.set(frame.payload.subarray(0, def[3]));
  const dv = new DataView(full.buffer);
  const out: Decoded = {};
  let off = 0;
  for (const [name, type, arr] of def[4]) {
    const size = SIZES[type];
    if (type === "char") {
      const n = Math.max(arr, 1);
      let s = "";
      for (let k = 0; k < n; k++) {
        const c = full[off + k];
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      out[name] = s;
      off += n;
      continue;
    }
    if (arr > 0) {
      const vals: number[] = [];
      for (let k = 0; k < arr; k++) vals.push(readNum(dv, off + k * size, type));
      out[name] = vals;
      off += arr * size;
    } else {
      out[name] = readNum(dv, off, type);
      off += size;
    }
  }
  return out;
}

function readNum(dv: DataView, o: number, t: string): number {
  switch (t) {
    case "int8":
      return dv.getInt8(o);
    case "uint8":
      return dv.getUint8(o);
    case "int16":
      return dv.getInt16(o, true);
    case "uint16":
      return dv.getUint16(o, true);
    case "int32":
      return dv.getInt32(o, true);
    case "uint32":
      return dv.getUint32(o, true);
    case "float":
      return dv.getFloat32(o, true);
    case "double":
      return dv.getFloat64(o, true);
    case "int64":
      return Number(dv.getBigInt64(o, true));
    case "uint64":
      return Number(dv.getBigUint64(o, true));
    default:
      return NaN;
  }
}
