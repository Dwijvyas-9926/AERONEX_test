/** CRC-16/MCRF4XX (X.25) as used by MAVLink. */
export function crcAccumulate(byte: number, crc: number): number {
  let tmp = byte ^ (crc & 0xff);
  tmp = (tmp ^ (tmp << 4)) & 0xff;
  return ((crc >> 8) ^ (tmp << 8) ^ (tmp << 3) ^ (tmp >> 4)) & 0xffff;
}

export function crcCalculate(buf: Uint8Array, start: number, end: number, crcExtra: number): number {
  let crc = 0xffff;
  for (let i = start; i < end; i++) crc = crcAccumulate(buf[i], crc);
  return crcAccumulate(crcExtra, crc);
}
