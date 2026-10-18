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
 *  - Lagres via storage-adapteren (lokalt / Hetzner Object Storage, privat bucket) under
 *    `avatars/<rådgiver-id>/<tilfældig>.webp` og `…-96.webp`. Et nyt billede sletter de gamle objekter.
 *  - Upload og fjernelse audit-logges (både rådgiveren selv og admin).
 */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const MIN_AVATAR_PX = 200;
/** Højst 50 megapixel ind (fx 8.000 × 6.250). Større billeder afvises, før de pakkes ud i hukommelsen. */
export const MAX_INPUT_PIXELS = 50_000_000;
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
  too_many_pixels: "Billedet har for mange pixels (højst 50 megapixel). Gem det i en mindre størrelse, og prøv igen.",
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

/** Upload eller skift billede. */
export async function saveAdvisorPhoto(actor: Actor, advisorId: string, input: Buffer, deps: PhotoDeps = { storage: getStorage() }): Promise<PhotoResult> {
  const advisor = await authorize(actor, advisorId);
  if (!advisor) return { ok: false, error: "Rådgiveren findes ikke." };
  const release = tryAcquireStreamSlot();
  if (!release) return { ok: false, error: BUSY };
  let processed: ProcessedAvatar;
  try {
    processed = await processAvatar(input);
  } catch (e) {
    if (e instanceof AvatarRejectedError) return { ok: false, error: e.message };
    throw e;
  } finally {
    release();
  }

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
