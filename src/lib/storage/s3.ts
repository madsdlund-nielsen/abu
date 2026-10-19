import { createWriteStream, openAsBlob } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createPresignedPost } from "@aws-sdk/s3-presigned-post";
import { guardStream } from "./stream-guard";
import type { PutStreamOptions, StorageProvider } from "./types";

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /**
   * Path-style (`https://fsn1.your-objectstorage.com/<bucket>/<nøgle>`) i stedet for virtual-hosted
   * (`https://<bucket>.fsn1.your-objectstorage.com/<nøgle>`). Hetzner understøtter begge; standard er path-style.
   */
  forcePathStyle?: boolean;
}

const MAX_SERVER_PUT_BYTES = 10 * 1024 * 1024;

/** S3-kompatibel lagring (Hetzner Object Storage). Kun klientbibliotek – ingen AWS-tjenester. */
export class S3Storage implements StorageProvider {
  readonly name = "s3" as const;
  private client: S3Client;
  constructor(private cfg: S3Config) {
    this.client = new S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      forcePathStyle: cfg.forcePathStyle ?? true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }

  /**
   * Store filer går direkte fra browseren til lageret (createDirectUpload). Serveren skriver kun små filer selv; derfor
   * afvises alt over 10 MB her, så en optagelse aldrig ender i serverens hukommelse.
   */
  async putStream(key: string, body: Readable, opts: PutStreamOptions) {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const c of guardStream(body, { ...opts, maxBytes: Math.min(opts.maxBytes, MAX_SERVER_PUT_BYTES) })) {
      chunks.push(c);
      bytes += c.length;
    }
    await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: key, Body: Buffer.concat(chunks), ContentType: opts.contentType }));
    return { bytes };
  }

  async createDirectUpload(key: string, opts: { maxBytes: number; expiresSeconds: number }) {
    const { url, fields } = await createPresignedPost(this.client, {
      Bucket: this.cfg.bucket,
      Key: key,
      // Lageret selv afviser filer uden for intervallet; indholdet tjekkes (magic bytes) ved afslutning
      Conditions: [["content-length-range", 1, opts.maxBytes]],
      Fields: { "Content-Type": "application/octet-stream" },
      Expires: opts.expiresSeconds,
    });
    return { url, fields };
  }

  async stat(key: string) {
    try {
      const res = await this.client.send(new HeadObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      return { size: Number(res.ContentLength ?? 0) };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw e;
    }
  }

  async readHead(key: string, n: number) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key, Range: `bytes=0-${n - 1}` }));
    if (!res.Body) return Buffer.alloc(0);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  /** Henter objektet som stream til en midlertidig fil (ikke i RAM) og åbner den som Blob. */
  async openBlob(key: string, mime: string) {
    const dir = await mkdtemp(path.join(os.tmpdir(), "abu-rec-"));
    const file = path.join(dir, "recording");
    const cleanup = () => rm(dir, { recursive: true, force: true });
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      if (!res.Body) throw new Error("Tomt objekt fra S3");
      await pipeline(res.Body as Readable, createWriteStream(file));
      return { blob: await openAsBlob(file, { type: mime }), cleanup };
    } catch (e) {
      await cleanup();
      throw e;
    }
  }

  async openStream(key: string) {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
      if (!res.Body) return null;
      return { body: res.Body as Readable, size: Number(res.ContentLength ?? 0) };
    } catch (e) {
      const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
      if (status === 404) return null;
      throw e;
    }
  }

  async delete(key: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: key }));
  }
}
