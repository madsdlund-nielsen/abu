import { afterEach, describe, expect, it, vi } from "vitest";
import { buildEmailBody, buildSmsBody, extractProviderId, inmobileAuthHeader, inmobileSendSms, parseFromAddress, parseIncomingStop, parseStatusEvents } from "./inmobile";
import { validateSmsSender } from "./sms";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("inMobile-adapter (gæt på API'et – se OPEN_ITEMS)", () => {
  it("bygger Basic-auth med API-nøglen som adgangskode", () => {
    expect(inmobileAuthHeader("abc")).toBe(`Basic ${Buffer.from(":abc").toString("base64")}`);
  });
  it("bygger SMS-body med countryHint, messageId og status-callback", () => {
    const b = buildSmsBody({ to: "+4520304050", text: "Hej", from: "ABUnlimited", messageId: "m1" });
    expect(b.messages[0]).toMatchObject({ to: "+4520304050", text: "Hej", from: "ABUnlimited", countryHint: "45", messageId: "m1" });
    expect(b.messages[0].statusCallbackUrl).toMatch(/\/api\/webhooks\/inmobile/);
  });
  it("bygger e-mail-body og fortolker afsender", () => {
    expect(parseFromAddress('Advisory Board Unlimited <noreply@abu.dk>')).toEqual({ name: "Advisory Board Unlimited", email: "noreply@abu.dk" });
    expect(parseFromAddress("noreply@abu.dk")).toEqual({ email: "noreply@abu.dk" });
    const b = buildEmailBody({ to: "a@b.dk", subject: "S", text: "t", html: "<p>t</p>", messageId: "m" }, "ABU <n@abu.dk>");
    expect(b).toMatchObject({ from: { email: "n@abu.dk" }, to: [{ email: "a@b.dk" }], subject: "S", html: "<p>t</p>", messageId: "m" });
  });
  it("henter besked-id fra svaret med fallback", () => {
    expect(extractProviderId({ results: [{ messageId: "x1" }] }, "f")).toBe("x1");
    expect(extractProviderId({ messageId: 7 }, "f")).toBe("7");
    expect(extractProviderId({}, "f")).toBe("f");
  });
  it("sender via fetch med korrekt URL, headers og body", async () => {
    vi.stubEnv("INMOBILE_API_KEY", "nøgle");
    vi.resetModules();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ messageId: "p-1" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const { inmobileSendSms: send } = await import("./inmobile");
    const res = await send({ to: "+4520304050", text: "Hej", from: "ABUnlimited", messageId: "m1" });
    expect(res.providerMessageId).toBe("p-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.inmobile.com/v4/sms/outgoing");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toMatch(/^Basic /);
    expect(JSON.parse(init.body).messages[0].to).toBe("+4520304050");
    void inmobileSendSms;
  });
  it("kaster en forståelig fejl ved HTTP-fejl og uden nøgle", async () => {
    vi.stubEnv("INMOBILE_API_KEY", "nøgle");
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nej", { status: 401 })));
    const { inmobileSendSms: send } = await import("./inmobile");
    await expect(send({ to: "+4520304050", text: "x", from: "ABU", messageId: "m" })).rejects.toThrow(/401/);
    vi.stubEnv("INMOBILE_API_KEY", "");
    vi.resetModules();
    const { inmobileSendSms: send2 } = await import("./inmobile");
    await expect(send2({ to: "+4520304050", text: "x", from: "ABU", messageId: "m" })).rejects.toThrow(/INMOBILE_API_KEY/);
  });
  it("fortolker statuswebhooks i flere former", () => {
    expect(parseStatusEvents({ messageId: "a", status: "Delivered" })).toEqual([{ messageId: "a", status: "DELIVERED", error: undefined }]);
    expect(parseStatusEvents([{ messageId: "b", status: "Failed", errorMessage: "Ugyldigt nummer" }])[0]).toMatchObject({ messageId: "b", status: "FAILED", error: "Ugyldigt nummer" });
    expect(parseStatusEvents({ events: [{ id: "c", statusCode: 200 }, { id: "d", statusCode: 500 }] }).map((e) => e.status)).toEqual(["DELIVERED", "FAILED"]);
    expect(parseStatusEvents({ messageId: "e", status: "undelivered" })[0].status).toBe("FAILED");
    expect(parseStatusEvents({ foo: 1 })).toEqual([]);
    expect(parseStatusEvents(null)).toEqual([]);
  });
  it("genkender STOP i indgående SMS", () => {
    expect(parseIncomingStop({ from: "+4520304050", text: "STOP" })).toBe("+4520304050");
    expect(parseIncomingStop([{ msisdn: "4520304050", message: "  stop tak" }])).toBe("4520304050");
    expect(parseIncomingStop({ from: "+4520304050", text: "Hej" })).toBeNull();
  });
});

describe("validateSmsSender", () => {
  it("kræver 3-11 tegn uden æøå og mellemrum, eller et nummer", () => {
    expect(validateSmsSender("ABUnlimited")).toBeNull();
    expect(validateSmsSender("+4520304050")).toBeNull();
    expect(validateSmsSender("AB")).toMatch(/mindst 3/);
    expect(validateSmsSender("ABUnlimited1")).toMatch(/højst/);
    expect(validateSmsSender("Æble")).toMatch(/kun bogstaver/i);
    expect(validateSmsSender("AB U")).toMatch(/kun bogstaver/i);
  });
});
