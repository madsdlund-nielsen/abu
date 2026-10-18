import { createReadStream, createWriteStream, openAsBlob } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { guardStream } from "./stream-guard";
import type { PutStreamOptions, StorageProvider } from "./types";

/** Lokal disk (udvikling). I produktion kræves S3 (opstarts-guarden). */
export class LocalStorage implements StorageProvider {
  readonly name = "local" as const;
  constructor(private root: string) {}

  private resolve(key: string) {
    const full = path.resolve(this.root, key);
    if (!full.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Ugyldig storage-nøgle");
    return full;
  }

  async putStream(key: string, body: Readable, opts: PutStreamOptions) {
    const full = this.resolve(key);
    const tmp = `${full}.part`;
    await mkdir(path.dirname(full), { recursive: true });
    let bytes = 0;
    try {
      await pipeline(
        body,
        async function* (source) {
          for await (const chunk of guardStream(source, opts)) {
            bytes += chunk.length;
            yield chunk;
          }
        },
        createWriteStream(tmp, { flags: "wx" }),
      );
      await rename(tmp, full);
      return { bytes };
    } catch (e) {
      await rm(tmp, { force: true });
      throw e;
    }
  }

  async stat(key: string) {
    try {
      const s = await stat(this.resolve(key));
      return { size: s.size };
    } catch {
      return null;
    }
  }

  async readHead(key: string, n: number) {
    const fh = await open(this.resolve(key), "r");
    try {
      const buf = Buffer.alloc(n);
      const { bytesRead } = await fh.read(buf, 0, n, 0);
      return buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  }

  async openBlob(key: string, mime: string) {
    return { blob: await openAsBlob(this.resolve(key), { type: mime }), cleanup: async () => {} };
  }

  async openStream(key: string) {
    const full = this.resolve(key);
    try {
      const s = await stat(full);
      if (!s.isFile()) return null;
      return { body: createReadStream(full), size: s.size };
    } catch {
      return null;
    }
  }

  async delete(key: string) {
    await rm(this.resolve(key), { force: true });
  }
}
