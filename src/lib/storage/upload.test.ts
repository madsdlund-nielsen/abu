import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asSystem, asUser, deleteTestUsers, describeDb, uid } from "../../test/db";
import { detectMediaType } from "../media-type";
import { LocalStorage } from "./local";
import { guardStream } from "./stream-guard";
import { UploadRejectedError } from "./types";

const MP3 = Buffer.concat([Buffer.from("ID3"), Buffer.from([4, 0, 0, 0, 0, 0])]);
const chunks = (...parts: Buffer[]) => Readable.from(parts);
const accept = (h: Buffer) => detectMediaType(h) !== null;

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "abu-upload-test-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("streamet upload (H-5)", () => {
  it("guardStream videresender i bidder og tjekker kun de første bytes", async () => {
    const out: Buffer[] = [];
    const body = chunks(MP3.subarray(0, 3), Buffer.concat([MP3.subarray(3), Buffer.alloc(100)]), Buffer.alloc(1000, 1));
    for await (const c of guardStream(body, { maxBytes: 10_000, headBytes: 12, acceptHead: accept })) out.push(c);
    expect(Buffer.concat(out).length).toBe(MP3.length + 1100);
    expect(out.length).toBeGreaterThan(1); // ikke samlet til én buffer
  });

  it("afviser forkert indhold, før resten læses, og for store filer undervejs", async () => {
    const pdf = chunks(Buffer.from("%PDF-1.7 ......................................................"), Buffer.alloc(10));
    await expect(async () => {
      for await (const c of guardStream(pdf, { maxBytes: 10_000, headBytes: 12, acceptHead: accept })) void c;
    }).rejects.toMatchObject({ kind: "bad_format" });
    const big = chunks(MP3, Buffer.alloc(600), Buffer.alloc(600));
    await expect(async () => {
      for await (const c of guardStream(big, { maxBytes: 1000, headBytes: 12, acceptHead: accept })) void c;
    }).rejects.toBeInstanceOf(UploadRejectedError);
  });

  it("LocalStorage skriver via stream og efterlader intet ved afvisning", async () => {
    const s = new LocalStorage(dir);
    const r = await s.putStream("rec/ok", chunks(MP3, Buffer.alloc(5000)), { maxBytes: 10_000, headBytes: 12, acceptHead: accept });
    expect(r.bytes).toBe(MP3.length + 5000);
    expect((await s.stat("rec/ok"))?.size).toBe(MP3.length + 5000);
    expect((await s.readHead("rec/ok", 3)).toString()).toBe("ID3");
    const blob = (await s.openBlob("rec/ok", "audio/mpeg")).blob;
    expect(blob.size).toBe(MP3.length + 5000);

    await expect(s.putStream("rec/pdf", chunks(Buffer.from("%PDF-1.7 aaaaaaaa")), { maxBytes: 10_000, headBytes: 12, acceptHead: accept })).rejects.toMatchObject({ kind: "bad_format" });
    await expect(s.putStream("rec/big", chunks(MP3, Buffer.alloc(20_000)), { maxBytes: 10_000, headBytes: 12, acceptHead: accept })).rejects.toMatchObject({ kind: "too_large" });
    expect((await readdir(path.join(dir, "rec"))).sort()).toEqual(["ok"]);
    expect((await readFile(path.join(dir, "rec/ok"))).subarray(0, 3).toString()).toBe("ID3");
  });

  it("LocalStorage.openStream streamer et objekt og giver null, når det ikke findes", async () => {
    const s = new LocalStorage(dir);
    await s.putStream("avatars/a/x.webp", chunks(Buffer.from("RIFF\0\0\0\0WEBPVP8 "), Buffer.alloc(100)), { maxBytes: 1000, contentType: "image/webp" });
    const obj = await s.openStream("avatars/a/x.webp");
    expect(obj?.size).toBe(116);
    const parts: Buffer[] = [];
    for await (const c of obj!.body) parts.push(Buffer.from(c));
    expect(Buffer.concat(parts).subarray(8, 12).toString()).toBe("WEBP");
    expect(await s.openStream("avatars/a/findes-ikke.webp")).toBeNull();
    expect(await s.openStream("avatars/a")).toBeNull(); // mappe, ikke fil
    await expect(s.openStream("../udenfor")).rejects.toThrow(/Ugyldig/);
  });

  it("afviser stier uden for lageret", async () => {
    const s = new LocalStorage(dir);
    await expect(s.putStream("../udenfor", chunks(MP3), { maxBytes: 100 })).rejects.toThrow(/Ugyldig/);
  });
});

describeDb("upload-flow: prepare → stream → finalize (H-5)", () => {
  it("verificerer magic bytes efter upload, begrænser samtidige uploads og kasserer ugyldige filer", async () => {
    process.env.UPLOAD_DIR = dir;
    const { prisma } = await import("../db");
    const { prepareRecordingUpload, finalizeRecordingUpload, MAX_PENDING_PER_USER } = await import("../recording-upload");
    const { getStorage } = await import("./index");
    const { customer, advisor, outsider, meeting } = await asSystem(async () => {
      const customer = await prisma.user.create({
        data: { email: `${uid("c")}@test.dk`, name: "Kunde", role: "CUSTOMER", customerProfile: { create: { companyName: "X", cvr: "1", billingEmail: "x@test.dk" } } },
      });
      const advisor = await prisma.user.create({ data: { email: `${uid("a")}@test.dk`, name: "Rådgiver", role: "ADVISOR" } });
      const outsider = await prisma.user.create({ data: { email: `${uid("a")}@test.dk`, name: "Anden rådgiver", role: "ADVISOR" } });
      const sub = await prisma.subscription.create({ data: { customerId: customer.id, advisorCount: 2, frequencyWeeks: 8, monthlyPriceDkk: 1000 } });
      const meeting = await prisma.meeting.create({
        data: { subscriptionId: sub.id, startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(), participants: { create: [{ userId: customer.id }, { userId: advisor.id }] } },
      });
      return { customer, advisor, outsider, meeting };
    });
    const actor = { id: advisor.id, role: "ADVISOR" as const };
    const asAdvisor = <T>(fn: () => Promise<T>) => asUser(actor, fn);
    const db = <T>(fn: () => Promise<T>) => asSystem(fn);

    expect(await asUser(customer, () => prepareRecordingUpload({ id: customer.id, role: "CUSTOMER" }, meeting.id, 100))).toMatchObject({ ok: false });
    // RLS: en rådgiver, der ikke deltager, ser slet ikke mødet
    expect(await asUser(outsider, () => prepareRecordingUpload({ id: outsider.id, role: "ADVISOR" }, meeting.id, 100))).toMatchObject({ ok: false, error: "Mødet findes ikke." });
    expect(await asAdvisor(() => prepareRecordingUpload(actor, meeting.id, 600 * 1024 * 1024))).toMatchObject({ ok: false, error: expect.stringMatching(/for stor/) });

    const good = await asAdvisor(() => prepareRecordingUpload(actor, meeting.id, 5000));
    expect(good).toMatchObject({ ok: true, target: { kind: "server" } });
    if (!good.ok) return;
    const rec = await db(() => prisma.recording.findUniqueOrThrow({ where: { id: good.recordingId } }));
    await getStorage().putStream(rec.storageKey!, chunks(MP3, Buffer.alloc(5000)), { maxBytes: 10_000 });
    const fin = await asAdvisor(() => finalizeRecordingUpload(actor, good.recordingId));
    expect(fin).toEqual({ ok: true, meetingId: meeting.id });
    const after = await db(() => prisma.recording.findUniqueOrThrow({ where: { id: good.recordingId } }));
    expect(after).toMatchObject({ status: "RECEIVED", mime: "audio/mpeg", sizeBytes: MP3.length + 5000 });

    // Uden magic bytes-tjek i strømmen (S3-direkte): finalize afviser og sletter
    const bad = await asAdvisor(() => prepareRecordingUpload(actor, meeting.id, 100));
    if (!bad.ok) throw new Error(bad.error);
    const badRec = await db(() => prisma.recording.findUniqueOrThrow({ where: { id: bad.recordingId } }));
    await getStorage().putStream(badRec.storageKey!, chunks(Buffer.from("MZ executable payload ......")), { maxBytes: 10_000 });
    expect(await asAdvisor(() => finalizeRecordingUpload(actor, bad.recordingId))).toMatchObject({ ok: false, error: expect.stringMatching(/ikke en lyd/) });
    expect(await db(() => prisma.recording.findUnique({ where: { id: bad.recordingId } }))).toBeNull();
    expect(await getStorage().stat(badRec.storageKey!)).toBeNull();

    // Grænse for samtidige uploads pr. bruger
    for (let i = 0; i < MAX_PENDING_PER_USER; i++) expect((await asAdvisor(() => prepareRecordingUpload(actor, meeting.id, 100))).ok).toBe(true);
    expect(await asAdvisor(() => prepareRecordingUpload(actor, meeting.id, 100))).toMatchObject({ ok: false, error: expect.stringMatching(/allerede uploads/) });
    // Andre kan ikke afslutte min upload (kunden ser optagelsen, men den er ikke kundens)
    const pending = await db(() => prisma.recording.findFirstOrThrow({ where: { meetingId: meeting.id, status: "UPLOADING" } }));
    expect(await asUser(customer, () => finalizeRecordingUpload({ id: customer.id, role: "CUSTOMER" }, pending.id))).toMatchObject({ ok: false });
    // En afbrudt/afvist upload ryddes op med det samme, så en ny kan startes
    const { cancelRecordingUpload } = await import("../recording-upload");
    expect(await asUser(customer, () => cancelRecordingUpload(customer.id, pending.id))).toBe(false);
    expect(await asAdvisor(() => cancelRecordingUpload(advisor.id, pending.id))).toBe(true);
    expect((await asAdvisor(() => prepareRecordingUpload(actor, meeting.id, 100))).ok).toBe(true);

    await deleteTestUsers([customer.id, advisor.id, outsider.id]);

  });
});
