import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { describeDb, uid } from "../../test/db";

// Server actions kaldes direkte: requireRole returnerer den bruger, testen sætter. Lageret er en midlertidig mappe.
const me = vi.hoisted(() => ({ id: "", role: "ADVISOR" as "ADVISOR" | "ADMIN" }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireRole: vi.fn(async () => ({ id: me.id, role: me.role, name: "Test" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const photo = async (w = 300, h = 300) => new File([new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "#263753" } }).jpeg().toBuffer())], "foto.jpg", { type: "image/jpeg" });
const fd = (o: Record<string, string | File>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

describeDb("server actions: profilbillede (rådgiver selv og admin)", () => {
  const ids: string[] = [];
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "abu-avatar-"));
    process.env.UPLOAD_DIR = dir;
  });
  afterAll(async () => {
    const { prisma } = await import("@/lib/db");
    await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await rm(dir, { recursive: true, force: true });
  });

  it("en rådgiver kan kun ændre sit eget billede – et forfalsket advisorId ignoreres", async () => {
    const { prisma } = await import("@/lib/db");
    const { uploadAdvisorPhotoAction, removeAdvisorPhotoAction } = await import("./advisor-photo");
    const mk = async () => (await prisma.user.create({ data: { email: `${uid("adv")}@test.dk`, name: "R", role: "ADVISOR", advisorProfile: { create: {} } } })).id;
    const a = await mk();
    const b = await mk();
    ids.push(a, b);
    me.id = a;
    me.role = "ADVISOR";
    const r = await uploadAdvisorPhotoAction(fd({ advisorId: b, photo: await photo() }));
    expect(r).toMatchObject({ ok: "Profilbilledet er gemt.", version: expect.any(String) });
    expect((await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: a } })).photoKey).toMatch(new RegExp(`^avatars/${a}/`));
    expect((await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: b } })).photoKey).toBeNull();

    expect(await uploadAdvisorPhotoAction(fd({ photo: await photo(150, 150) }))).toMatchObject({ error: expect.stringMatching(/for lille/) });
    expect(await uploadAdvisorPhotoAction(fd({ photo: new File(["<svg/>"], "x.jpg", { type: "image/jpeg" }) }))).toMatchObject({ error: expect.stringMatching(/ikke et JPEG/) });
    expect(await uploadAdvisorPhotoAction(fd({}))).toMatchObject({ error: "Vælg et billede." });

    // Admin fjerner rådgiverens billede
    me.id = (await prisma.user.create({ data: { email: `${uid("adm")}@test.dk`, name: "Admin", role: "ADMIN" } })).id;
    me.role = "ADMIN";
    ids.push(me.id);
    expect(await removeAdvisorPhotoAction(fd({ advisorId: a }))).toMatchObject({ ok: "Profilbilledet er fjernet.", version: null });
    expect((await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: a } })).photoKey).toBeNull();
    const log = await prisma.auditLog.findMany({ where: { entityId: a, action: { startsWith: "advisor.photo" } }, orderBy: { createdAt: "asc" } });
    expect(log.map((l) => l.action)).toEqual(["advisor.photo.upload", "advisor.photo.remove"]);
  });
});
