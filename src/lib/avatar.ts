import { Readable } from "node:stream";
import type { Role } from "@prisma/client";
import sharp, { type Metadata } from "sharp";
import { audit } from "./audit";
import { AVATAR_SIZE, AVATAR_THUMB_SIZE, avatarObjectKeys, avatarVersion, thumbKeyFor } from "./avatar-url";

export { avatarObjectKeys, thumbKeyFor };
import { prisma } from "./db";
import { detectImageType, IMAGE_SNIFF_BYTES } from "./media-type";
import { tryAcquireStreamSlot } from "./recording-upload";
import { getStorage } from "./storage";
import type { StorageProvider } from "./storage/types";
import { randomToken } from "./tokens";

/**
 * Rådgiverfoto (upload i stedet for en ekstern URL).
 *
 *  - Kun JPEG, PNG og WebP på højst 5 MB, genkendt ud fra filens første bytes (magic bytes) – aldrig SVG (XSS).
 *  - Behandles med sharp (libvips): roteres efter EXIF, ALLE metadata fjernes (EXIF/GPS/XMP/ICC), beskæres centreret
 *    til et kvadrat og gemmes som 512×512 WebP (kvalitet 82) + en 96×96-miniature.
 *  - Mindst 200×200 pixels; højst MAX_INPUT_PIXELS (beskyttelse mod «dekompressionsbomber»), en tidsgrænse pr.
 *    billede og samme grænse for samtidigt tungt arbejde som upload af optagelser (`tryAcquireStreamSlot`).
 *  - Upload går gennem `PUT /api/avatar/<id>` (ikke en server action, D-2): rettigheder, Content-Length, en plads pr.
 *    bruger og den fælles plads tjekkes, FØR body'en læses; body'en læses som stream med loft og tidsgrænse.
 *  - Lagres via storage-adapteren (lokalt / Hetzner Object Storage, privat bucket) under
 *    `avatars/<rådgiver-id>/<tilfældig>.webp` og `…-96.webp`. Et nyt billede sletter de gamle objekter.
 *  - Upload og fjernelse audit-logges (både rådgiveren selv og admin).
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MIN_AVATAR_PX = 200;
/**
 * Højst 25 megapixel ind (fx 6.000 × 4.000 fra et 24 MP-kamera). Større billeder afvises, før de pakkes ud i hukommelsen
 * (D-8: intet profilbillede behøver mere; filer over 5 MB afvises alligevel, og det halverer den værste dekodning).
 */
export const MAX_INPUT_PIXELS = 25_000_000;
export const AVATAR_WEBP_QUALITY = 82;
const PROCESS_TIMEOUT_SECONDS = 15;

// Ingen libvips-cache mellem requests (holder hukommelsen nede; billederne behandles kun én gang).
sharp.cache(false);

export type AvatarRejection = "empty" | "too_large" | "bad_format" | "too_small" | "too_many_pixels" | "corrupt";

export class AvatarRejectedError extends Error {
  constructor(public readonly kind: AvatarRejection, message: string) {
    super(message);
    this.name = "AvatarRejectedError";
  }
}

export const AVATAR_ERRORS: Record<AvatarRejection, string> = {
  empty: "Vælg et billede.",
  too_large: "Billedet er for stort. Vælg et billede på højst 5 MB.",
  bad_format: "Filen er ikke et JPEG-, PNG- eller WebP-billede. Andre formater (fx SVG, GIF og HEIC) kan ikke bruges.",
  too_small: `Billedet er for lille. Vælg et billede på mindst ${MIN_AVATAR_PX} × ${MIN_AVATAR_PX} pixels.`,
  too_many_pixels: `Billedet har for mange pixels (højst ${MAX_INPUT_PIXELS / 1_000_000} megapixel). Gem det i en mindre størrelse, og prøv igen.`,
  corrupt: "Billedet kunne ikke læses. Prøv at gemme det igen som JPEG eller PNG.",
};

const reject = (kind: AvatarRejection) => new AvatarRejectedError(kind, AVATAR_ERRORS[kind]);
const isPixelLimit = (e: unknown) => e instanceof Error && /pixel limit/i.test(e.message);

/** Tjek filen før behandling: størrelse og format ud fra indholdet. */
export function validateAvatarInput(input: Uint8Array): { mime: string } {
  if (input.length === 0) throw reject("empty");
  if (input.length > MAX_AVATAR_BYTES) throw reject("too_large");
  const type = detectImageType(input.subarray(0, IMAGE_SNIFF_BYTES));
  if (!type) throw reject("bad_format");
  return { mime: type.mime };
}

const SHARP_FORMAT: Record<string, string> = { "image/jpeg": "jpeg", "image/png": "png", "image/webp": "webp" };

export interface ProcessedAvatar {
  /** 512×512 WebP uden metadata */
  main: Buffer;
  /** 96×96 WebP uden metadata */
  thumb: Buffer;
  /** Kildebilledets mål efter rotation */
  source: { width: number; height: number };
}

/** Validér og behandl et uploadet billede. Kaster AvatarRejectedError med en dansk besked. */
export async function processAvatar(input: Buffer): Promise<ProcessedAvatar> {
  const { mime } = validateAvatarInput(input);
  const opts = { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" as const, pages: 1 };
  let meta: Metadata;
  try {
    meta = await sharp(input, opts).metadata();
  } catch (e) {
    // sharp afviser allerede her billeder over limitInputPixels (ud fra headeren, uden at pakke pixels ud)
    throw reject(isPixelLimit(e) ? "too_many_pixels" : "corrupt");
  }
  // Indholdet skal også være det format, de første bytes lover (fx ikke en PNG-header foran noget andet)
  if (meta.format !== SHARP_FORMAT[mime]) throw reject("bad_format");
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w * h > MAX_INPUT_PIXELS) throw reject("too_many_pixels");
  // EXIF-orientering 5-8 bytter bredde og højde
  const rotated = (meta.orientation ?? 1) >= 5;
  const source = rotated ? { width: h, height: w } : { width: w, height: h };
  if (Math.min(source.width, source.height) < MIN_AVATAR_PX) throw reject("too_small");

  try {
    // sharp skriver som standard ingen metadata (EXIF, GPS, XMP, IPTC og ICC fjernes; farver konverteres til sRGB)
    const main = await sharp(input, opts)
      .timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
      .autoOrient()
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: "cover", position: "centre" })
      .flatten({ background: "#ffffff" })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer();
    const thumb = await sharp(main)
      .timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
      .resize(AVATAR_THUMB_SIZE, AVATAR_THUMB_SIZE, { fit: "cover" })
      .webp({ quality: AVATAR_WEBP_QUALITY })
      .toBuffer();
    return { main, thumb, source };
  } catch (e) {
    throw reject(isPixelLimit(e) ? "too_many_pixels" : "corrupt");
  }
}

/** Nye, ugættelige nøgler for et billede: `avatars/<id>/<tilfældig>.webp` og miniaturen `…-96.webp`. */
export function newAvatarKeys(advisorId: string): { key: string; thumbKey: string } {
  if (!/^[A-Za-z0-9_-]+$/.test(advisorId)) throw new Error("Ugyldigt rådgiver-id");
  const key = `avatars/${advisorId}/${randomToken(12)}.webp`;
  return { key, thumbKey: thumbKeyFor(key) };
}


type Actor = { id: string; role: Role };
export type PhotoResult = { ok: true; version: string | null; message: string } | { ok: false; error: string };
export interface PhotoDeps {
  storage: Pick<StorageProvider, "putStream" | "delete">;
}

const BUSY = "Der behandles allerede andre uploads. Prøv igen om lidt.";
const BUSY_USER = "Du uploader allerede et billede. Vent, til det er færdigt.";

/** Højst så mange samtidige avatar-uploads pr. bruger i denne proces (D-2; jf. MAX_PENDING_PER_USER for optagelser). */
export const MAX_AVATAR_UPLOADS_PER_USER = 1;
/** Hele filen skal være modtaget inden for denne tid, ellers afbrydes uploaden (en langsom klient holder ikke en plads). */
export const AVATAR_BODY_TIMEOUT_MS = 30_000;
const uploadsInFlight = new Map<string, number>();

/** Tager en plads pr. bruger og en af de fælles pladser – eller ingen. Kaldes FØR body'en læses. */
function tryAcquireUploadSlots(userId: string): { release: () => void } | { status: 429 | 503; error: string } {
  const mine = uploadsInFlight.get(userId) ?? 0;
  if (mine >= MAX_AVATAR_UPLOADS_PER_USER) return { status: 429, error: BUSY_USER };
  const releaseShared = tryAcquireStreamSlot();
  if (!releaseShared) return { status: 503, error: BUSY };
  uploadsInFlight.set(userId, mine + 1);
  let released = false;
  return {
    release: () => {
      if (released) return;
      released = true;
      releaseShared();
      const n = (uploadsInFlight.get(userId) ?? 1) - 1;
      if (n > 0) uploadsInFlight.set(userId, n);
      else uploadsInFlight.delete(userId);
    },
  };
}

/**
 * Læser en request-body som stream med et loft: flere end `maxBytes` bytes afbryder straks (too_large), og en body, der
 * ikke er modtaget inden for `timeoutMs`, afbrydes også. Højst `maxBytes` (+ én chunk) holdes i hukommelsen.
 */
export async function readBodyLimited(body: ReadableStream<Uint8Array> | null, maxBytes: number, timeoutMs = AVATAR_BODY_TIMEOUT_MS): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error("timeout")), timeoutMs);
  });
  try {
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), timeout]);
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw reject("too_large");
      chunks.push(value);
    }
    return Buffer.concat(chunks, total);
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type UploadBody = {
  /** Content-Length fra requesten (null = ukendt, fx chunked). */
  contentLength: number | null;
  /** Læser body'en med det givne loft (kaldes først, når pladserne er taget). */
  read: (maxBytes: number) => Promise<Buffer>;
};

/** Rådgiveren selv eller admin. Returnerer rådgiverens navn, eller null hvis handlingen ikke er tilladt. */
async function authorize(actor: Actor, advisorId: string): Promise<{ name: string } | null> {
  if (actor.role !== "ADMIN" && !(actor.role === "ADVISOR" && actor.id === advisorId)) return null;
  const user = await prisma.user.findFirst({ where: { id: advisorId, role: "ADVISOR", advisorProfile: { isNot: null } }, select: { name: true } });
  return user;
}

const who = (actor: Actor, advisorId: string) => (actor.id === advisorId ? "af rådgiveren" : "af admin");

async function deleteObjects(storage: PhotoDeps["storage"], keys: string[]) {
  for (const k of keys) {
    try {
      await storage.delete(k);
    } catch (e) {
      // Billedet er allerede skiftet i databasen; et efterladt objekt er ikke tilgængeligt, men logges til oprydning
      console.error("[avatar] gammelt objekt kunne ikke slettes", k, e instanceof Error ? e.message : e);
    }
  }
}

/** Sætter nyt photoKey under en rækkelås og returnerer det gamle (så samtidige uploads aldrig efterlader objekter). */
async function swapPhotoKey(advisorId: string, next: string | null, at: Date | null): Promise<string | null> {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ photoKey: string | null }[]>`SELECT "photoKey" FROM "AdvisorProfile" WHERE "userId" = ${advisorId} FOR UPDATE`;
    await tx.advisorProfile.update({ where: { userId: advisorId }, data: { photoKey: next, photoUpdatedAt: at } });
    return rows[0]?.photoKey ?? null;
  });
}

/**
 * Upload eller skift billede (D-2). Rækkefølgen er bevidst: rettigheder → Content-Length → plads pr. bruger og fælles
 * plads → læs body'en (med loft) → behandl → gem. Afvisninger sker, før filen ligger i hukommelsen.
 * Returnerer også en HTTP-status til ruten.
 */
export async function uploadAdvisorPhoto(actor: Actor, advisorId: string, body: UploadBody, deps: PhotoDeps = { storage: getStorage() }): Promise<{ status: number; result: PhotoResult }> {
  const fail = (status: number, error: string) => ({ status, result: { ok: false as const, error } });
  const advisor = await authorize(actor, advisorId);
  if (!advisor) return fail(404, "Rådgiveren findes ikke.");
  if (body.contentLength !== null && body.contentLength > MAX_AVATAR_BYTES) return fail(413, AVATAR_ERRORS.too_large);
  if (body.contentLength === 0) return fail(400, AVATAR_ERRORS.empty);

  const slot = tryAcquireUploadSlots(actor.id);
  if ("error" in slot) return fail(slot.status, slot.error);
  let processed: ProcessedAvatar;
  try {
    let input: Buffer;
    try {
      input = await body.read(MAX_AVATAR_BYTES);
    } catch (e) {
      if (e instanceof AvatarRejectedError) return fail(413, e.message);
      return fail(400, "Billedet blev ikke modtaget helt. Prøv igen.");
    }
    processed = await processAvatar(input);
  } catch (e) {
    if (e instanceof AvatarRejectedError) return fail(e.kind === "too_large" ? 413 : e.kind === "bad_format" ? 415 : 400, e.message);
    throw e;
  } finally {
    slot.release();
  }
  const result = await storeAdvisorPhoto(actor, advisorId, processed, deps);
  return { status: result.ok ? 200 : 500, result };
}

/** Upload af et billede, der allerede er i hukommelsen (samme vej og pladser som ruten). */
export async function saveAdvisorPhoto(actor: Actor, advisorId: string, input: Buffer, deps: PhotoDeps = { storage: getStorage() }): Promise<PhotoResult> {
  return (await uploadAdvisorPhoto(actor, advisorId, { contentLength: input.length, read: async () => input }, deps)).result;
}

async function storeAdvisorPhoto(actor: Actor, advisorId: string, processed: ProcessedAvatar, deps: PhotoDeps): Promise<PhotoResult> {
  const { key, thumbKey } = newAvatarKeys(advisorId);
  const put = (k: string, buf: Buffer) => deps.storage.putStream(k, Readable.from([buf]), { maxBytes: MAX_AVATAR_BYTES, contentType: "image/webp" });
  const at = new Date();
  let old: string | null;
  try {
    await put(key, processed.main);
    await put(thumbKey, processed.thumb);
    old = await swapPhotoKey(advisorId, key, at);
  } catch (e) {
    console.error("[avatar] billedet kunne ikke gemmes", e instanceof Error ? e.message : e);
    await deleteObjects(deps.storage, [key, thumbKey]);
    return { ok: false, error: "Billedet kunne ikke gemmes. Prøv igen." };
  }
  await deleteObjects(deps.storage, avatarObjectKeys(old));
  await audit(actor.id, old ? "advisor.photo.replace" : "advisor.photo.upload", "User", advisorId, `Profilbillede ${old ? "skiftet" : "uploadet"} ${who(actor, advisorId)}`);
  return { ok: true, version: avatarVersion(at), message: old ? "Profilbilledet er skiftet." : "Profilbilledet er gemt." };
}

/** Fjern billedet (rådgiveren vises igen med initialer). */
export async function removeAdvisorPhoto(actor: Actor, advisorId: string, deps: Pick<PhotoDeps, "storage"> = { storage: getStorage() }): Promise<PhotoResult> {
  const advisor = await authorize(actor, advisorId);
  if (!advisor) return { ok: false, error: "Rådgiveren findes ikke." };
  const old = await swapPhotoKey(advisorId, null, null);
  if (!old) return { ok: true, version: null, message: "Der er intet profilbillede at fjerne." };
  await deleteObjects(deps.storage, avatarObjectKeys(old));
  await audit(actor.id, "advisor.photo.remove", "User", advisorId, `Profilbillede fjernet ${who(actor, advisorId)}`);
  return { ok: true, version: null, message: "Profilbilledet er fjernet." };
}
