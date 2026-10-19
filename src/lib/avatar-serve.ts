import { Readable } from "node:stream";
import { AVATAR_SIZE, AVATAR_THUMB_SIZE, avatarVersion, canViewAvatar, thumbKeyFor } from "./avatar-url";
import { prisma } from "./db";
import { getStorage } from "./storage";
import type { StorageProvider } from "./storage/types";

type Viewer = { id: string; role: string } | null;

/**
 * Cache-politik (D-1): fotoet er persondata, der kan fjernes eller slettes (GDPR), så det caches aldrig `immutable`.
 * Den aktuelle version caches i højst AVATAR_MAX_AGE_SECONDS og genvalideres derefter med ETag (billigt 304 uden at
 * læse lageret). Et fjernet billede holder derfor op med at blive vist inden for 5 minutter – også fra browser- og
 * proxy-caches. Versionen i URL'en skifter stadig ved hver upload, så et nyt billede vises med det samme.
 */
export const AVATAR_MAX_AGE_SECONDS = 300;
export const CACHE_PUBLIC = `public, max-age=${AVATAR_MAX_AGE_SECONDS}, must-revalidate`;
export const CACHE_PRIVATE = `private, max-age=${AVATAR_MAX_AGE_SECONDS}, must-revalidate`;

/** `Vary: Cookie` (D-4): svaret afhænger af, hvem der er logget ind (inaktive rådgivere), så en cache må aldrig blande. */
const BASE_HEADERS = { "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin", Vary: "Cookie" };

/** Samme svar for «findes ikke», «intet billede», «ingen adgang» og ugyldig størrelse – ingen informationslæk. */
export function avatarNotFound(): Response {
  return new Response("Ikke fundet", { status: 404, headers: { ...BASE_HEADERS, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

/**
 * `GET /api/avatar/<rådgiver-id>?size=512|96&v=<version>`. Bucketten er privat; billedet streames fra lageret gennem appen.
 *  - Aktive rådgivere: offentligt (de vises i onboarding-kataloget før login), `public` med kort levetid + genvalidering.
 *  - Inaktive rådgivere: kun admin og rådgiveren selv (`private`); alle andre får 404.
 *  - Passer `v` ikke til det nuværende billede (eller mangler), serveres det nuværende med `no-cache`.
 *  - Seeren slås altid op (D-3), også når rådgiveren ikke findes eller intet billede har, så svartiden ikke afslører,
 *    om der findes en inaktiv rådgiver med billede.
 */
export async function serveAvatar(
  advisorId: string,
  params: URLSearchParams,
  getViewer: () => Promise<Viewer>,
  storage: Pick<StorageProvider, "openStream"> = getStorage(),
  ifNoneMatch?: string | null,
): Promise<Response> {
  const sizeParam = params.get("size") ?? String(AVATAR_SIZE);
  const size = sizeParam === String(AVATAR_THUMB_SIZE) ? AVATAR_THUMB_SIZE : sizeParam === String(AVATAR_SIZE) ? AVATAR_SIZE : null;
  if (!size || !/^[A-Za-z0-9_-]{1,64}$/.test(advisorId)) return avatarNotFound();

  const [profile, viewer] = await Promise.all([
    prisma.advisorProfile.findUnique({ where: { userId: advisorId }, select: { active: true, photoKey: true, photoUpdatedAt: true } }),
    getViewer(),
  ]);
  if (!profile?.photoKey) return avatarNotFound();
  if (!profile.active && !canViewAvatar({ id: advisorId, active: false }, viewer)) return avatarNotFound();

  const version = avatarVersion(profile.photoUpdatedAt) ?? "0";
  const etag = `"${version}-${size}"`;
  const cache = params.get("v") === version ? (profile.active ? CACHE_PUBLIC : CACHE_PRIVATE) : profile.active ? "public, no-cache" : "private, no-cache";
  if (ifNoneMatch && ifNoneMatch.split(",").map((s) => s.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers: { ...BASE_HEADERS, ETag: etag, "Cache-Control": cache } });
  }

  const key = size === AVATAR_THUMB_SIZE ? thumbKeyFor(profile.photoKey) : profile.photoKey;
  const obj = await storage.openStream(key);
  if (!obj) return avatarNotFound();
  return new Response(Readable.toWeb(obj.body) as ReadableStream<Uint8Array>, {
    status: 200,
    headers: {
      ...BASE_HEADERS,
      "Content-Type": "image/webp",
      ...(obj.size ? { "Content-Length": String(obj.size) } : {}),
      "Content-Disposition": "inline",
      "Cache-Control": cache,
      ETag: etag,
    },
  });
}
