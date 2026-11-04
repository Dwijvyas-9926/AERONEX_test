import { crcCalculate } from "./crc";
import { MESSAGES, type MessageDef } from "./dialect.generated";

/*
  MAVLink 2 frame encoder — the write counterpart of parser.ts.

  Builds valid MAVLink 2 frames for outbound commands and parameter writes,
  packing fields in the dialect's wire order and CRC-validating with the same
  CRC_EXTRA table the parser uses. Trailing zero payload bytes are truncated
  exactly as pymavlink does (MAVLink 2 payload truncation, minimum one byte),
  so frames are byte-identical to a reference GCS.

  This is the ONLY place the app produces bytes for the vehicle. It is pure and
  I/O-free; the link manager owns the actual serial write.
*/

const STX_V2 = 0xfd;
const V2_HEADER = 10;

const BY_NAME = new Map<string, MessageDef>();
for (const def of MESSAGES) BY_NAME.set(def[1], def);

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

export type FieldValue = number | number[] | string;

export interface MavSource {
  sysid: number;
  compid: number;
  /** When omitted, a module-local counter supplies the sequence number. */
  seq?: number;
}

let seqCounter = 0;

/** Pack a message by name into a complete MAVLink 2 frame ready to write. */
export function encode(name: string, fields: Record<string, FieldValue>, src: MavSource): Uint8Array {
  const def = BY_NAME.get(name);
  if (!def) throw new Error(`Unknown MAVLink message: ${name}`);
  const [msgid, , crcExtra, fullLen, defFields] = def;

  const payload = new Uint8Array(fullLen);
  const dv = new DataView(payload.buffer);
  let off = 0;
  for (const [fname, type, arr] of defFields) {
    const size = SIZES[type];
    const val = fields[fname];
    if (type === "char") {
      const n = Math.max(arr, 1);
      const s = typeof val === "string" ? val : "";
      for (let k = 0; k < n; k++) payload[off + k] = k < s.length ? s.charCodeAt(k) & 0xff : 0;
      off += n;
      continue;
    }
    if (arr > 0) {
      const a = Array.isArray(val) ? val : [];
      for (let k = 0; k < arr; k++) writeNum(dv, off + k * size, type, a[k] ?? 0);
      off += arr * size;
    } else {
      writeNum(dv, off, type, typeof val === "number" ? val : 0);
      off += size;
    }
  }

  // MAVLink 2 payload truncation: drop trailing zero bytes, keep at least one.
  let plen = fullLen;
  while (plen > 1 && payload[plen - 1] === 0) plen--;

  const seq = src.seq ?? seqCounter++ & 0xff;
  const frame = new Uint8Array(V2_HEADER + plen + 2);
  frame[0] = STX_V2;
  frame[1] = plen;
  frame[2] = 0; // incompat flags (unsigned)
  frame[3] = 0; // compat flags
  frame[4] = seq & 0xff;
  frame[5] = src.sysid & 0xff;
  frame[6] = src.compid & 0xff;
  frame[7] = msgid & 0xff;
  frame[8] = (msgid >> 8) & 0xff;
  frame[9] = (msgid >> 16) & 0xff;
  frame.set(payload.subarray(0, plen), V2_HEADER);

  const crc = crcCalculate(frame, 1, V2_HEADER + plen, crcExtra);
  frame[V2_HEADER + plen] = crc & 0xff;
  frame[V2_HEADER + plen + 1] = (crc >> 8) & 0xff;
  return frame;
}

function writeNum(dv: DataView, o: number, t: string, v: number) {
  switch (t) {
    case "int8":
      dv.setInt8(o, v);
      break;
    case "uint8":
      dv.setUint8(o, v);
      break;
    case "int16":
      dv.setInt16(o, v, true);
      break;
    case "uint16":
      dv.setUint16(o, v, true);
      break;
    case "int32":
      dv.setInt32(o, v, true);
      break;
    case "uint32":
      dv.setUint32(o, v, true);
      break;
    case "float":
      dv.setFloat32(o, v, true);
      break;
    case "double":
      dv.setFloat64(o, v, true);
      break;
    case "int64":
      dv.setBigInt64(o, BigInt(Math.trunc(v)), true);
      break;
    case "uint64":
      dv.setBigUint64(o, BigInt(Math.trunc(v)), true);
      break;
  }
}
