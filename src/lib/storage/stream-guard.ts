import type { Readable } from "node:stream";
import { UploadRejectedError, type PutStreamOptions } from "./types";

/**
 * Tæller bytes og tjekker filens start, mens den streames (H-5): intet bufres ud over de første `headBytes`.
 * Kaster UploadRejectedError, så snart grænsen overskrides eller formatet afvises.
 */
export async function* guardStream(source: Readable | AsyncIterable<Uint8Array>, opts: PutStreamOptions): AsyncGenerator<Buffer> {
  const headBytes = opts.headBytes ?? 64;
  let total = 0;
  let head: Buffer | null = Buffer.alloc(0);
  for await (const raw of source) {
    const chunk = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
    total += chunk.length;
    if (total > opts.maxBytes) throw new UploadRejectedError("too_large", "Filen er for stor.");
    if (head) {
      head = Buffer.concat([head, chunk]);
      if (head.length < headBytes) continue; // vent med at skrive, til formatet er kendt
      if (opts.acceptHead && !opts.acceptHead(head.subarray(0, headBytes))) throw new UploadRejectedError("bad_format", "Filen er ikke en lyd- eller videofil.");
      const pending = head;
      head = null;
      yield pending;
      continue;
    }
    yield chunk;
  }
  if (total === 0) throw new UploadRejectedError("empty", "Filen er tom.");
  if (head) {
    // Hele filen var kortere end headBytes
    if (opts.acceptHead && !opts.acceptHead(head)) throw new UploadRejectedError("bad_format", "Filen er ikke en lyd- eller videofil.");
    yield head;
  }
}
