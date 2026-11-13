import net from "node:net";

/*
  The app's real serial path, pointed at ArduPilot's own simulator.

  ArduCopter built for a desktop ("SITL") is the same flight code that runs on
  a Pixhawk, with simulated sensors, speaking MAVLink on a TCP port. This
  wraps that port up as the SerialPort the browser would hand the app, so
  linkManager.connect() runs exactly as it does over a USB cable: the same
  read loop, parser, session, command link and timeouts. Nothing in the app
  knows it is not hardware.
*/
export function tcpSerialPort(host: string, port: number): { serial: SerialPort; socket: net.Socket; sent: () => number; received: () => number; link: { loss: number; dropped: number } } {
  const socket = new net.Socket();
  // A poor radio link: this share of the chunks in each direction never arrives.
  const link = { loss: 0, dropped: 0 };
  let seed = 12345;
  const lost = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const gone = seed / 4294967296 < link.loss;
    if (gone) link.dropped++;
    return gone;
  };
  let sent = 0;
  let received = 0;
  let readable: ReadableStream<Uint8Array> | null = null;
  let writable: WritableStream<Uint8Array> | null = null;
  const serial = {
    getInfo: () => ({ usbVendorId: 0x26ac, usbProductId: 0x0011 }),
    open: () =>
      new Promise<void>((resolve, reject) => {
        socket.once("error", reject);
        socket.connect(port, host, () => {
          socket.setNoDelay(true);
          readable = new ReadableStream<Uint8Array>({
            start(c) {
              socket.on("data", (b) => {
                received += b.length;
                if (!lost()) c.enqueue(new Uint8Array(b));
              });
              socket.on("close", () => {
                try {
                  c.close();
                } catch {
                  /* already closed */
                }
              });
            },
          });
          writable = new WritableStream<Uint8Array>({
            write(chunk) {
              sent += chunk.length;
              if (!lost()) socket.write(chunk);
            },
          });
          resolve();
        });
      }),
    close: async () => void socket.destroy(),
    get readable() {
      return readable;
    },
    get writable() {
      return writable;
    },
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  } as unknown as SerialPort;
  return { serial, socket, sent: () => sent, received: () => received, link };
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until `test` is true, or fails with `what` after `ms`. */
export async function until(what: string, test: () => boolean, ms = 30000, step = 100): Promise<void> {
  const end = Date.now() + ms;
  while (!test()) {
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`);
    await sleep(step);
  }
}
