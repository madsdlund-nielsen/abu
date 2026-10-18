import { Readable } from "node:stream";
import { crc32 } from "node:zlib";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { describeDb, uid } from "../test/db";
import { AVATAR_ERRORS, MAX_AVATAR_BYTES, newAvatarKeys, processAvatar, validateAvatarInput } from "./avatar";
import { avatarObjectKeys, avatarSizeFor, avatarSrc, avatarVersion, canViewAvatar, thumbKeyFor, visibleAvatarVersion } from "./avatar-url";
import { detectImageType } from "./media-type";

const solid = (w: number, h: number, rgb = { r: 200, g: 30, b: 30 }) => sharp({ create: { width: w, height: h, channels: 3, background: rgb } });

/** JPEG med EXIF inkl. GPS-position (som fra en mobiltelefon) og evt. orientering. */
async function jpegWithGps(w: number, h: number, orientation?: number) {
  let img = solid(w, h).jpeg().withExif({
    IFD0: { Make: "TestCam", Model: "Telefon 1" },
    IFD3: { GPSLatitudeRef: "N", GPSLatitude: "55/1 40/1 3000/100", GPSLongitudeRef: "E", GPSLongitude: "12/1 34/1 0/1" },
  });
  if (orientation) img = img.withMetadata({ orientation });
  return img.toBuffer();
}

/** Findes GPS-IFD-pegeren (tag 0x8825) i EXIF-blokkens IFD0? Lille TIFF-parser, så testen ikke stoler på sharp alene. */
function hasGpsIfd(exif: Buffer | undefined): boolean {
  if (!exif) return false;
  const tiff = exif.subarray(exif.indexOf("Exif\0\0") >= 0 ? exif.indexOf("Exif\0\0") + 6 : 0);
  const le = tiff.toString("latin1", 0, 2) === "II";
  const u16 = (o: number) => (le ? tiff.readUInt16LE(o) : tiff.readUInt16BE(o));
  const u32 = (o: number) => (le ? tiff.readUInt32LE(o) : tiff.readUInt32BE(o));
  const ifd0 = u32(4);
  const n = u16(ifd0);
  for (let i = 0; i < n; i++) if (u16(ifd0 + 2 + i * 12) === 0x8825) return true;
  return false;
}

/** En gyldig PNG-header, der påstår et kæmpe billede (dekompressionsbombe) – uden pixeldata. */
function pngHeader(w: number, h: number) {
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", Buffer.alloc(0)), chunk("IEND", Buffer.alloc(0))]);
}

describe("profilbillede: validering (type, størrelse, magic bytes)", () => {
  it("genkender JPEG, PNG og WebP ud fra indholdet", async () => {
    expect(detectImageType(await solid(10, 10).jpeg().toBuffer())?.mime).toBe("image/jpeg");
    expect(detectImageType(await solid(10, 10).png().toBuffer())?.mime).toBe("image/png");
    expect(detectImageType(await solid(10, 10).webp().toBuffer())?.mime).toBe("image/webp");
  });

  it("afviser SVG (XSS), GIF, HEIC, PDF, HTML og andre formater – uanset filnavn", async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(1)</script></svg>');
    const gif = await solid(10, 10).gif().toBuffer();
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
    for (const b of [svg, gif, heic, Buffer.from("%PDF-1.7 ........"), Buffer.from("<!doctype html><script>")]) {
      expect(detectImageType(b)).toBeNull();
      expect(() => validateAvatarInput(b)).toThrow(AVATAR_ERRORS.bad_format);
    }
    // RIFF uden WEBP (fx WAV/AVI) er heller ikke et billede
    expect(detectImageType(Buffer.from("RIFF\0\0\0\0WAVEfmt "))).toBeNull();
  });

  it("afviser tomme filer og filer over 5 MB", async () => {
    expect(() => validateAvatarInput(Buffer.alloc(0))).toThrow(AVATAR_ERRORS.empty);
    const big = Buffer.concat([await solid(10, 10).jpeg().toBuffer(), Buffer.alloc(MAX_AVATAR_BYTES)]);
    expect(() => validateAvatarInput(big)).toThrow(AVATAR_ERRORS.too_large);
  });

  it("afviser billeder under 200 × 200 med en venlig besked", async () => {
    await expect(processAvatar(await solid(199, 400).jpeg().toBuffer())).rejects.toMatchObject({ kind: "too_small", message: AVATAR_ERRORS.too_small });
    await expect(processAvatar(await solid(400, 150).png().toBuffer())).rejects.toMatchObject({ kind: "too_small" });
    expect(AVATAR_ERRORS.too_small).toBe("Billedet er for lille. Vælg et billede på mindst 200 × 200 pixels.");
    await expect(processAvatar(await solid(200, 200).jpeg().toBuffer())).resolves.toBeTruthy();
  });

  it("dekompressionsbombe: en lille fil, der påstår 20.000 × 20.000 pixels, afvises før den pakkes ud", async () => {
    const bomb = pngHeader(20_000, 20_000);
    expect(bomb.length).toBeLessThan(100);
    await expect(processAvatar(bomb)).rejects.toMatchObject({ kind: "too_many_pixels" });
  });

  it("en fil med billedheader, men ødelagt indhold, afvises", async () => {
    const jpeg = await solid(300, 300).jpeg().toBuffer();
    await expect(processAvatar(Buffer.concat([jpeg.subarray(0, 40), Buffer.alloc(200, 7)]))).rejects.toMatchObject({ kind: "corrupt" });
  });
});

describe("profilbillede: behandling (privatliv og ydelse)", () => {
  it("fjerner ALLE metadata: EXIF med GPS ind → ingen EXIF ud", async () => {
    const input = await jpegWithGps(800, 600);
    const inMeta = await sharp(input).metadata();
    expect(hasGpsIfd(inMeta.exif)).toBe(true); // testbilledet har faktisk en GPS-position
    expect(inMeta.exif?.toString("latin1")).toContain("TestCam");

    const { main, thumb } = await processAvatar(input);
    for (const out of [main, thumb]) {
      const m = await sharp(out).metadata();
      expect(m.exif).toBeUndefined();
      expect(m.xmp).toBeUndefined();
      expect(m.iptc).toBeUndefined();
      expect(m.icc).toBeUndefined();
      expect(out.includes("Exif")).toBe(false);
      expect(out.includes("TestCam")).toBe(false);
    }
  });

  it("skalerer til 512 × 512 og 96 × 96 WebP (centreret beskæring af et ikke-kvadratisk billede)", async () => {
    const { main, thumb, source } = await processAvatar(await solid(1200, 400).png().toBuffer());
    expect(source).toEqual({ width: 1200, height: 400 });
    expect(await sharp(main).metadata()).toMatchObject({ format: "webp", width: 512, height: 512 });
    expect(await sharp(thumb).metadata()).toMatchObject({ format: "webp", width: 96, height: 96 });
    expect(main.length).toBeLessThan(100_000);
  });

  it("roterer efter EXIF-orienteringen, før der beskæres", async () => {
    // 400 × 200: venstre halvdel rød, højre blå. Orientering 6 = drejet 90°, så billedet vises 200 × 400 (rød/blå over hinanden).
    const left = await solid(200, 200, { r: 255, g: 0, b: 0 }).png().toBuffer();
    const base = solid(400, 200, { r: 0, g: 0, b: 255 }).composite([{ input: left, left: 0, top: 0 }]);
    const input = await sharp(await base.png().toBuffer()).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    const { main, source } = await processAvatar(input);
    expect(source).toEqual({ width: 200, height: 400 });
    const { data, info } = await sharp(main).raw().toBuffer({ resolveWithObject: true });
    const px = (x: number, y: number) => Array.from(data.subarray((y * info.width + x) * info.channels, (y * info.width + x) * info.channels + 3));
    const red = (p: number[]) => p[0] > 150 && p[2] < 100;
    const blue = (p: number[]) => p[2] > 150 && p[0] < 100;
    // Efter rotation ligger farverne over hinanden (øverst/nederst), ikke side om side
    expect(red(px(256, 40)) !== red(px(256, 470))).toBe(true);
    expect(red(px(40, 40))).toBe(red(px(470, 40)));
    expect(blue(px(256, 40)) || blue(px(256, 470))).toBe(true);
  });

  it("bevarer ikke animation/flere sider og gør gennemsigtighed hvid", async () => {
    const png = await sharp({ create: { width: 300, height: 300, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    const { main } = await processAvatar(png);
    const m = await sharp(main).metadata();
    expect(m.hasAlpha).toBe(false);
    expect(m.pages ?? 1).toBe(1);
  });
});

describe("profilbillede: nøgler og URL'er", () => {
  it("nøgler er avatars/<id>/<tilfældig>.webp og -96.webp", () => {
    const a = newAvatarKeys("cm123abc");
    const b = newAvatarKeys("cm123abc");
    expect(a.key).toMatch(/^avatars\/cm123abc\/[A-Za-z0-9_-]{16}\.webp$/);
    expect(a.thumbKey).toBe(a.key.replace(/\.webp$/, "-96.webp"));
    expect(a.key).not.toBe(b.key);
    expect(thumbKeyFor("avatars/x/abc.webp")).toBe("avatars/x/abc-96.webp");
    expect(avatarObjectKeys("avatars/x/abc.webp")).toEqual(["avatars/x/abc.webp", "avatars/x/abc-96.webp"]);
    expect(avatarObjectKeys(null)).toEqual([]);
    expect(() => newAvatarKeys("../etc")).toThrow();
  });

  it("versioneret URL og miniature til små visninger", () => {
    const v = avatarVersion(new Date("2026-10-18T10:00:00Z"));
    expect(v).toMatch(/^[a-z0-9]+$/);
    expect(avatarSrc("cm1", v!, 96)).toBe(`/api/avatar/cm1?size=96&v=${v}`);
    expect(avatarSizeFor(36)).toBe(96);
    expect(avatarSizeFor(48)).toBe(96);
    expect(avatarSizeFor(160)).toBe(512);
    expect(avatarVersion(null)).toBeNull();
  });

  it("adgang: aktive er offentlige, inaktive kun for admin og rådgiveren selv", () => {
    expect(canViewAvatar({ id: "a", active: true }, null)).toBe(true);
    expect(canViewAvatar({ id: "a", active: false }, null)).toBe(false);
    expect(canViewAvatar({ id: "a", active: false }, { id: "k", role: "CUSTOMER" })).toBe(false);
    expect(canViewAvatar({ id: "a", active: false }, { id: "b", role: "ADVISOR" })).toBe(false);
    expect(canViewAvatar({ id: "a", active: false }, { id: "a", role: "ADVISOR" })).toBe(true);
    expect(canViewAvatar({ id: "a", active: false }, { id: "x", role: "ADMIN" })).toBe(true);
    const at = new Date();
    expect(visibleAvatarVersion({ id: "a", active: false, photoKey: "k", photoUpdatedAt: at }, { id: "k", role: "CUSTOMER" })).toBeNull();
    expect(visibleAvatarVersion({ id: "a", active: true, photoKey: null, photoUpdatedAt: null }, null)).toBeNull();
    expect(visibleAvatarVersion({ id: "a", active: true, photoKey: "k", photoUpdatedAt: at }, null)).toBe(avatarVersion(at));
  });
});

/** Lager i hukommelsen (samme interface som local/s3). */
function memStorage() {
  const m = new Map<string, Buffer>();
  return {
    m,
    async putStream(key: string, body: Readable) {
      const chunks: Buffer[] = [];
      for await (const c of body) chunks.push(Buffer.from(c));
      m.set(key, Buffer.concat(chunks));
      return { bytes: m.get(key)!.length };
    },
    async delete(key: string) {
      m.delete(key);
    },
    async openStream(key: string) {
      const b = m.get(key);
      return b ? { body: Readable.from([b]), size: b.length } : null;
    },
  };
}

describeDb("profilbillede mod databasen: upload, skift, fjern, adgang og sletning", () => {
  const ids: string[] = [];
  afterAll(async () => {
    const { prisma } = await import("./db");
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  async function mkUser(role: "ADVISOR" | "ADMIN" | "CUSTOMER", active = false) {
    const { prisma } = await import("./db");
    const u = await prisma.user.create({
      data: { email: `${uid(role.toLowerCase())}@test.dk`, name: `${role} Test`, role, ...(role === "ADVISOR" ? { advisorProfile: { create: { active } } } : {}) },
    });
    ids.push(u.id);
    return { id: u.id, role };
  }

  it("upload gemmer begge størrelser; et nyt billede sletter de gamle objekter; fjern sletter alt – alt audit-logges", async () => {
    const { prisma } = await import("./db");
    const { saveAdvisorPhoto, removeAdvisorPhoto } = await import("./avatar");
    const storage = memStorage();
    const adv = await mkUser("ADVISOR");
    const admin = await mkUser("ADMIN");

    const first = await saveAdvisorPhoto(adv, adv.id, await jpegWithGps(640, 480), { storage });
    expect(first).toMatchObject({ ok: true, message: "Profilbilledet er gemt." });
    const p1 = await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: adv.id } });
    expect(p1.photoKey).toMatch(new RegExp(`^avatars/${adv.id}/[A-Za-z0-9_-]+\\.webp$`));
    expect(first.ok && first.version).toBe(avatarVersion(p1.photoUpdatedAt));
    expect([...storage.m.keys()].sort()).toEqual(avatarObjectKeys(p1.photoKey).sort());
    expect(hasGpsIfd((await sharp(storage.m.get(p1.photoKey!)!).metadata()).exif)).toBe(false);

    // Admin skifter billedet: de gamle objekter slettes
    const second = await saveAdvisorPhoto(admin, adv.id, await solid(300, 300, { r: 10, g: 120, b: 10 }).png().toBuffer(), { storage });
    expect(second).toMatchObject({ ok: true, message: "Profilbilledet er skiftet." });
    const p2 = await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: adv.id } });
    expect(p2.photoKey).not.toBe(p1.photoKey);
    expect([...storage.m.keys()].sort()).toEqual(avatarObjectKeys(p2.photoKey).sort());
    for (const k of avatarObjectKeys(p1.photoKey)) expect(storage.m.has(k)).toBe(false);

    // Afvist billede ændrer intet
    expect(await saveAdvisorPhoto(adv, adv.id, Buffer.from("<svg onload=alert(1)>"), { storage })).toEqual({ ok: false, error: AVATAR_ERRORS.bad_format });
    expect((await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: adv.id } })).photoKey).toBe(p2.photoKey);

    // Admin fjerner billedet
    expect(await removeAdvisorPhoto(admin, adv.id, { storage })).toMatchObject({ ok: true, version: null, message: "Profilbilledet er fjernet." });
    expect(storage.m.size).toBe(0);
    expect(await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: adv.id } })).toMatchObject({ photoKey: null, photoUpdatedAt: null });
    expect(await removeAdvisorPhoto(adv, adv.id, { storage })).toMatchObject({ ok: true, message: "Der er intet profilbillede at fjerne." });

    const logs = await prisma.auditLog.findMany({ where: { entityId: adv.id, action: { startsWith: "advisor.photo" } }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.action, l.userId, l.detail])).toEqual([
      ["advisor.photo.upload", adv.id, "Profilbillede uploadet af rådgiveren"],
      ["advisor.photo.replace", admin.id, "Profilbillede skiftet af admin"],
      ["advisor.photo.remove", admin.id, "Profilbillede fjernet af admin"],
    ]);
  });

  it("kun rådgiveren selv og admin kan uploade og fjerne", async () => {
    const { saveAdvisorPhoto, removeAdvisorPhoto } = await import("./avatar");
    const storage = memStorage();
    const adv = await mkUser("ADVISOR");
    const other = await mkUser("ADVISOR");
    const customer = await mkUser("CUSTOMER");
    const img = await solid(300, 300).jpeg().toBuffer();
    expect(await saveAdvisorPhoto(other, adv.id, img, { storage })).toEqual({ ok: false, error: "Rådgiveren findes ikke." });
    expect(await saveAdvisorPhoto(customer, adv.id, img, { storage })).toEqual({ ok: false, error: "Rådgiveren findes ikke." });
    expect(await removeAdvisorPhoto(other, adv.id, { storage })).toEqual({ ok: false, error: "Rådgiveren findes ikke." });
    // Admin kan ikke give en kunde et rådgiverfoto
    expect(await saveAdvisorPhoto({ id: "x", role: "ADMIN" }, customer.id, img, { storage })).toEqual({ ok: false, error: "Rådgiveren findes ikke." });
    expect(storage.m.size).toBe(0);
  });

  it("GET /api/avatar: aktive er offentlige og immutable; inaktive giver 404 for alle andre end admin og rådgiveren selv", async () => {
    const { prisma } = await import("./db");
    const { saveAdvisorPhoto } = await import("./avatar");
    const { serveAvatar, IMMUTABLE_PUBLIC, IMMUTABLE_PRIVATE } = await import("./avatar-serve");
    const storage = memStorage();
    const active = await mkUser("ADVISOR", true);
    const inactive = await mkUser("ADVISOR", false);
    const noPhoto = await mkUser("ADVISOR", true);
    const customer = await mkUser("CUSTOMER");
    const admin = await mkUser("ADMIN");
    const img = await solid(400, 400).jpeg().toBuffer();
    const va = await saveAdvisorPhoto(active, active.id, img, { storage });
    const vi = await saveAdvisorPhoto(inactive, inactive.id, img, { storage });
    if (!va.ok || !vi.ok) throw new Error("upload fejlede");
    const get = (id: string, q: string, viewer: { id: string; role: string } | null, inm?: string) => serveAvatar(id, new URLSearchParams(q), async () => viewer, storage, inm);

    // Aktiv rådgiver: alle (også uden login – onboarding-kataloget)
    const ok = await get(active.id, `size=96&v=${va.version}`, null);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/webp");
    expect(ok.headers.get("cache-control")).toBe(IMMUTABLE_PUBLIC);
    expect(ok.headers.get("x-content-type-options")).toBe("nosniff");
    const body = Buffer.from(await ok.arrayBuffer());
    expect(await sharp(body).metadata()).toMatchObject({ format: "webp", width: 96, height: 96 });
    expect((await sharp(Buffer.from(await (await get(active.id, `size=512&v=${va.version}`, null)).arrayBuffer())).metadata()).width).toBe(512);
    // Forkert/manglende version: det nuværende billede, men ikke immutable
    const stale = await get(active.id, "size=512&v=gammel", null);
    expect(stale.status).toBe(200);
    expect(stale.headers.get("cache-control")).toBe("public, no-cache");
    expect((await get(active.id, `size=512&v=${va.version}`, null, `"${va.version}-512"`)).status).toBe(304);

    // Inaktiv rådgiver: 404 for anonym, kunde og anden rådgiver – med præcis samme svar som «findes ikke»
    const notFound = await get("findes-ikke", "size=512", null);
    for (const viewer of [null, customer, active]) {
      const r = await get(inactive.id, `size=512&v=${vi.version}`, viewer);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(await notFound.clone().text());
      expect(r.headers.get("cache-control")).toBe("no-store");
    }
    for (const viewer of [admin, inactive]) {
      const r = await get(inactive.id, `size=512&v=${vi.version}`, viewer);
      expect(r.status).toBe(200);
      expect(r.headers.get("cache-control")).toBe(IMMUTABLE_PRIVATE);
    }

    // Intet billede, ugyldig størrelse eller manglende objekt: 404
    expect((await get(noPhoto.id, "size=512", null)).status).toBe(404);
    expect((await get(active.id, "size=2000", null)).status).toBe(404);
    expect((await get("../../etc/passwd", "size=512", null)).status).toBe(404);
    const key = (await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: active.id } })).photoKey!;
    storage.m.delete(key);
    expect((await get(active.id, "size=512", null)).status).toBe(404);
  });
});
