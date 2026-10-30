// El juego escribe el principio del registro en XML (configuracion de log4j de Mojang, hasta que NeoForge pone la
// suya). Esto lo pasa a lineas normales "[hh:mm:ss] [hilo/NIVEL] [logger]: mensaje" para que "Ver registro" se lea bien.
import { Transform, type TransformCallback } from "node:stream";

const EVENT_START = /<log4j:Event logger="([^"]*)" timestamp="(\d+)" level="([^"]*)" thread="([^"]*)">/;
const CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/g;

function time(ms: number): string {
  const d = new Date(ms);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export class GameLogText extends Transform {
  private pending = "";
  private event: { head: string; body: string } | null = null;

  _transform(chunk: Buffer, _enc: BufferEncoding, done: TransformCallback): void {
    this.pending += chunk.toString("utf-8");
    let nl: number;
    while ((nl = this.pending.indexOf("\n")) >= 0) {
      this.line(this.pending.slice(0, nl + 1));
      this.pending = this.pending.slice(nl + 1);
    }
    done();
  }

  _flush(done: TransformCallback): void {
    if (this.pending) {
      this.line(this.pending + "\n");
    }
    if (this.event) {
      this.push(this.event.head + this.event.body + "\n");
    }
    done();
  }

  private line(text: string): void {
    if (this.event) {
      if (text.includes("</log4j:Event>")) {
        const parts = [...this.event.body.matchAll(CDATA)].map((m) => m[1].trimEnd());
        this.push(this.event.head + parts.join("\n") + "\n");
        this.event = null;
      } else {
        this.event.body += text;
      }
      return;
    }
    const m = EVENT_START.exec(text);
    if (m) {
      const logger = m[1].split(".").pop();
      this.event = { head: `[${time(Number(m[2]))}] [${m[4]}/${m[3]}] [${logger}]: `, body: "" };
      return;
    }
    this.push(text);
  }
}
