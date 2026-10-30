// Estado del servidor: le pregunta como lo hace la lista de servidores de Minecraft ("Server List Ping"): encendido,
// jugadores conectados y version. Sin librerias: un socket TCP y el protocolo de estado (handshake + status).
import * as net from "node:net";

export interface ServerStatus {
  online: boolean;
  players?: number;
  max?: number;
  names?: string[];
  version?: string;
  pingMs?: number;
}

function varint(n: number): Buffer {
  const out: number[] = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return Buffer.from(out);
}

function packet(id: number, ...fields: Buffer[]): Buffer {
  const body = Buffer.concat([varint(id), ...fields]);
  return Buffer.concat([varint(body.length), body]);
}

function mcString(s: string): Buffer {
  const b = Buffer.from(s, "utf-8");
  return Buffer.concat([varint(b.length), b]);
}

/** Lee un varint de buf desde pos; null si aun no ha llegado entero. */
function readVarint(buf: Buffer, pos: number): { value: number; next: number } | null {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (pos + i >= buf.length) return null;
    const b = buf[pos + i];
    value |= (b & 0x7f) << (7 * i);
    if ((b & 0x80) === 0) return { value, next: pos + i + 1 };
  }
  throw new Error("varint demasiado largo");
}

export function queryStatus(host: string, port: number, timeoutMs = 4000): Promise<ServerStatus> {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.connect({ host, port });
    let data = Buffer.alloc(0);
    let finished = false;
    const done = (s: ServerStatus) => {
      if (finished) return;
      finished = true;
      socket.destroy();
      resolve(s);
    };
    socket.setTimeout(timeoutMs, () => done({ online: false }));
    socket.on("error", () => done({ online: false }));
    socket.on("connect", () => {
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(port);
      // Protocolo 767 = Minecraft 1.21.1; estado siguiente 1 = status
      socket.write(packet(0x00, varint(767), mcString(host), portBuf, varint(1)));
      socket.write(packet(0x00));
    });
    socket.on("data", (chunk) => {
      data = Buffer.concat([data, chunk]);
      try {
        const len = readVarint(data, 0);
        if (!len || data.length < len.next + len.value) return;
        const id = readVarint(data, len.next)!;
        const strLen = readVarint(data, id.next)!;
        const json = JSON.parse(data.subarray(strLen.next, strLen.next + strLen.value).toString("utf-8"));
        done({
          online: true,
          players: json.players?.online ?? 0,
          max: json.players?.max ?? 0,
          names: (json.players?.sample ?? []).map((p: { name: string }) => p.name).filter((n: string) => /^\w{1,16}$/.test(n)),
          version: json.version?.name,
          pingMs: Date.now() - started,
        });
      } catch {
        done({ online: false });
      }
    });
  });
}
