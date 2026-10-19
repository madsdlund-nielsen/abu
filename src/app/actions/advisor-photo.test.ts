import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { asSystem, describeDb, ownerDb, uid } from "../../test/db";

// Upload via ruten PUT /api/avatar/<id> og fjernelse via server action. Brugeren er den, testen sætter. Lageret er en midlertidig mappe.
const me = vi.hoisted(() => ({ id: "", role: "ADVISOR" as "ADVISOR" | "ADMIN" | "CUSTOMER", anonymous: false }));
vi.mock("@/lib/auth", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth")>()),
  requireRole: vi.fn(async () => ({ id: me.id, role: me.role, name: "Test" })),
  getCurrentUser: vi.fn(async () => (me.anonymous ? null : { id: me.id, role: me.role, name: "Test" })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const jpeg = async (w = 300, h = 300) => new Uint8Array(await sharp({ create: { width: w, height: h, channels: 3, background: "#263753" } }).jpeg().toBuffer());
const fd = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};

async function put(advisorId: string, body: Uint8Array | ReadableStream<Uint8Array> | null, headers: Record<string, string> = {}) {
  const { PUT } = await import("../api/avatar/[advisorId]/route");
  const init: RequestInit & { duplex?: string } = { method: "PUT", body: body as BodyInit | null, headers: { "content-type": "image/jpeg", ...headers } };
  if (body instanceof ReadableStream) init.duplex = "half";
  const res = await PUT(new Request(`http://localhost:3000/api/avatar/${advisorId}`, init), { params: Promise.resolve({ advisorId }) });
  return { status: res.status, body: await res.json() };
}

describeDb("profilbillede: upload-ruten (D-2) og fjernelse – rådgiver selv og admin", () => {
  const ids: string[] = [];
  let dir = "";
  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "abu-avatar-"));
    process.env.UPLOAD_DIR = dir;
    // RLS: requestens principal er den bruger, testen sætter (som getSessionContext ville give den indloggede)
    const { setRequestPrincipalResolver } = await import("@/lib/db-context");
    setRequestPrincipalResolver(async () => (me.anonymous ? { userId: null, role: "anon" } : { userId: me.id, role: me.role }));
  });
  afterAll(async () => {
    (await import("@/lib/db-context")).setRequestPrincipalResolver(null);
    const { prisma } = await import("@/lib/db");
    await (await ownerDb()).auditLog.deleteMany({ where: { entityId: { in: ids } } });
    await asSystem(() => prisma.user.deleteMany({ where: { id: { in: ids } } }));
    await rm(dir, { recursive: true, force: true });
  });
  const mkAdvisor = async () => {
    const { prisma } = await import("@/lib/db");
    const id = (await asSystem(() => prisma.user.create({ data: { email: `${uid("adv")}@test.dk`, name: "R", role: "ADVISOR", advisorProfile: { create: {} } } }))).id;
    ids.push(id);
    return id;
  };

  it("en rådgiver kan kun ændre sit eget billede – et andet advisorId afvises med 404", async () => {
    const { prisma } = await import("@/lib/db");
    const { removeAdvisorPhotoAction } = await import("./advisor-photo");
    const a = await mkAdvisor();
    const b = await mkAdvisor();
    me.id = a;
    me.role = "ADVISOR";
    me.anonymous = false;

    expect(await put(b, await jpeg())).toEqual({ status: 404, body: { ok: false, error: "Rådgiveren findes ikke." } });
    expect((await asSystem(() => prisma.advisorProfile.findUniqueOrThrow({ where: { userId: b } }))).photoKey).toBeNull();

    const r = await put(a, await jpeg());
    expect(r).toMatchObject({ status: 200, body: { ok: true, message: "Profilbilledet er gemt.", version: expect.any(String) } });
    expect((await asSystem(() => prisma.advisorProfile.findUniqueOrThrow({ where: { userId: a } }))).photoKey).toMatch(new RegExp(`^avatars/${a}/`));

    expect(await put(a, await jpeg(150, 150))).toMatchObject({ status: 400, body: { error: expect.stringMatching(/for lille/) } });
    expect(await put(a, new TextEncoder().encode("<svg/>"))).toMatchObject({ status: 415, body: { error: expect.stringMatching(/ikke et JPEG/) } });
    expect(await put(a, new Uint8Array(0))).toMatchObject({ status: 400, body: { error: "Vælg et billede." } });

    // Admin fjerner rådgiverens billede (server action)
    const admin = (await asSystem(() => prisma.user.create({ data: { email: `${uid("adm")}@test.dk`, name: "Admin", role: "ADMIN" } }))).id;
    ids.push(admin);
    me.id = admin;
    me.role = "ADMIN";
    expect(await removeAdvisorPhotoAction(fd({ advisorId: a }))).toMatchObject({ ok: "Profilbilledet er fjernet.", version: null });
    expect((await asSystem(() => prisma.advisorProfile.findUniqueOrThrow({ where: { userId: a } }))).photoKey).toBeNull();
    const log = await asSystem(() => prisma.auditLog.findMany({ where: { entityId: a, action: { startsWith: "advisor.photo" } }, orderBy: { createdAt: "asc" } }));
    expect(log.map((l) => l.action)).toEqual(["advisor.photo.upload", "advisor.photo.remove"]);
  });

  it("afviser uden login, for kunder og fra en fremmed oprindelse – før body'en læses", async () => {
    const a = await mkAdvisor();
    me.id = a;
    me.role = "ADVISOR";
    me.anonymous = true;
    expect((await put(a, await jpeg())).status).toBe(401);
    me.anonymous = false;
    me.role = "CUSTOMER";
    expect((await put(a, await jpeg())).status).toBe(401);
    me.role = "ADVISOR";
    expect((await put(a, await jpeg(), { origin: "https://evil.example" })).status).toBe(403);
  });

  it("D-2: for stor Content-Length afvises med 413, uden at body'en læses; en body over 5 MB afbrydes undervejs", async () => {
    const a = await mkAdvisor();
    me.id = a;
    me.role = "ADVISOR";
    me.anonymous = false;
    let pulled = 0;
    const neverRead = new ReadableStream<Uint8Array>({
      pull(c) {
        pulled++;
        c.enqueue(new Uint8Array(64 * 1024));
      },
    });
    const r = await put(a, neverRead, { "content-length": String(6 * 1024 * 1024) });
    expect(r).toMatchObject({ status: 413, body: { error: expect.stringMatching(/for stort/) } });
    // Kun den indledende buffering i Request-objektet – ruten selv læste intet
    expect(pulled).toBeLessThanOrEqual(2);

    // Ingen Content-Length (chunked): læses som stream og afbrydes, så snart der er mere end 5 MB
    let sent = 0;
    const endless = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 256 * 1024;
        c.enqueue(new Uint8Array(256 * 1024));
      },
    });
    expect(await put(a, endless)).toMatchObject({ status: 413 });
    expect(sent).toBeLessThan(8 * 1024 * 1024);
  });

  it("D-2: højst én samtidig upload pr. bruger (429) – pladsen tages, før body'en læses, og frigives bagefter", async () => {
    const a = await mkAdvisor();
    me.id = a;
    me.role = "ADVISOR";
    me.anonymous = false;
    const img = await jpeg();
    // En langsom klient: body'en kommer først, når testen siger til
    let finish: () => void = () => {};
    const gate = new Promise<void>((r) => (finish = r));
    const slow = new ReadableStream<Uint8Array>({
      async pull(c) {
        await gate;
        c.enqueue(img);
        c.close();
      },
    });
    const first = put(a, slow);
    await new Promise((r) => setTimeout(r, 50));
    expect(await put(a, img)).toMatchObject({ status: 429, body: { error: expect.stringMatching(/allerede et billede/) } });
    finish();
    expect((await first).status).toBe(200);
    // Pladsen er frigivet igen
    expect((await put(a, img)).status).toBe(200);
  });
});
