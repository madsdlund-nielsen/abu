import type { Readable } from "node:stream";

/** Upload afvist under streaming (format eller størrelse). */
export class UploadRejectedError extends Error {
  constructor(public readonly kind: "too_large" | "bad_format" | "empty", message: string) {
    super(message);
    this.name = "UploadRejectedError";
  }
}

export interface PutStreamOptions {
  maxBytes: number;
  /** Kaldes med de første bytes (fx 64), før resten skrives. false = afvis (magic bytes). */
  acceptHead?: (head: Buffer) => boolean;
  headBytes?: number;
}

/** Presigned POST direkte fra browseren til objektlageret (serveren er ikke i datastrømmen). */
export interface DirectUpload {
  url: string;
  fields: Record<string, string>;
}

export interface StorageProvider {
  readonly name: "local" | "s3";
  /** Streamer til lageret uden at holde filen i hukommelsen; afbryder ved for stor fil eller forkert format. */
  putStream(key: string, body: Readable, opts: PutStreamOptions): Promise<{ bytes: number }>;
  /** Størrelse, eller null hvis objektet ikke findes. */
  stat(key: string): Promise<{ size: number } | null>;
  /** De første `n` bytes (til magic bytes-tjek efter direkte upload). */
  readHead(key: string, n: number): Promise<Buffer>;
  /** Filen som en Blob, der læses fra disk ved brug (til transskription uden at buffere i RAM). */
  openBlob(key: string, mime: string): Promise<{ blob: Blob; cleanup: () => Promise<void> }>;
  delete(key: string): Promise<void>;
  /** Kun S3: presigned POST med størrelsesgrænse håndhævet af lageret. */
  createDirectUpload?(key: string, opts: { maxBytes: number; expiresSeconds: number }): Promise<DirectUpload>;
}
