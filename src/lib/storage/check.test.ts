import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { runStorageCheck } from "./check";
import { LocalStorage } from "./local";

let dir = "";
beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "abu-check-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("npm run storage:check", () => {
  it("skriver, læser og sletter et testobjekt", async () => {
    const s = new LocalStorage(dir);
    const lines = await runStorageCheck(s);
    expect(lines.every((l) => l.ok && !l.warn)).toBe(true);
    expect(lines.map((l) => l.text).join("\n")).toMatch(/Skrev testobjektet healthcheck\/storage-check-.*\n.*identisk\.\nSlettede testobjektet igen\./);
  });

  it("S3: privat bucket og CORS tjekkes; en offentlig bucket er en fejl", async () => {
    const s = new LocalStorage(dir);
    const target = (anonStatus: number, allowOrigin: string | null) => ({
      objectUrl: (k: string) => `https://fsn1.your-objectstorage.com/abu/${k}`,
      uploadUrl: "https://fsn1.your-objectstorage.com/abu",
      appOrigin: "https://abu.example.dk",
      fetch: vi.fn(async (_url: string | URL | Request, init?: RequestInit) =>
        init?.method === "OPTIONS"
          ? new Response(null, { status: allowOrigin ? 200 : 403, headers: allowOrigin ? { "access-control-allow-origin": allowOrigin } : {} })
          : new Response("x", { status: anonStatus }),
      ) as unknown as typeof fetch,
    });
    const good = await runStorageCheck(s, target(403, "https://abu.example.dk"));
    expect(good.every((l) => l.ok && !l.warn)).toBe(true);
    expect(good.some((l) => /privat/.test(l.text))).toBe(true);

    const pub = await runStorageCheck(s, target(200, null));
    expect(pub.find((l) => /OFFENTLIG/.test(l.text))?.ok).toBe(false);
    expect(pub.find((l) => /CORS mangler/.test(l.text))?.warn).toBe(true);
  });

  it("melder en læsbar fejl, når lageret ikke kan skrives", async () => {
    const broken = { name: "s3" as const, putStream: vi.fn().mockRejectedValue(Object.assign(new Error("Access Denied"), { name: "AccessDenied", $metadata: { httpStatusCode: 403 } })), openStream: vi.fn(), stat: vi.fn(), delete: vi.fn() };
    const lines = await runStorageCheck(broken);
    expect(lines).toEqual([{ ok: false, text: expect.stringMatching(/Kunne ikke skrive til lageret: AccessDenied \(HTTP 403\)/) }]);
  });
});
