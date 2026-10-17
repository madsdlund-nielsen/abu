import { describe, expect, it } from "vitest";
import { ConsoleEmail } from "./email";
import { maskEmail, maskPhone, redactText } from "./redact";
import { ConsoleSms } from "./sms";

const TOKEN = "VyyWgp8kwSNFQjKUQZU_HOlEqwms_DnpOkLxjyuKyLk";

describe("redigering af logs (H-3)", () => {
  it("maskerer e-mail og telefon", () => {
    expect(maskEmail("mette.lindberg@firma.dk")).toBe("m***@firma.dk");
    expect(maskPhone("+4520304050")).toBe("+45******50");
    expect(maskPhone("20 30 40 50")).toBe("20****50");
  });

  it("fjerner tokens i links, adresser og numre fra tekst", () => {
    const text = `Hej Mette (mette@firma.dk, +45 20 30 40 50). Nulstil: https://abu.dk/set-password?token=${TOKEN}&reset=1 · Afmeld: https://abu.dk/afmeld?t=s4520304050.abc · Mødet: https://abu.dk/meetings/cmabc12345678901234567890`;
    const out = redactText(text);
    expect(out).not.toContain(TOKEN);
    expect(out).not.toContain("mette@firma.dk");
    expect(out).not.toContain("20 30 40 50");
    expect(out).not.toContain("4520304050");
    expect(out).toContain("https://abu.dk/set-password?[fjernet]");
    expect(out).toContain("https://abu.dk/afmeld?[fjernet]");
    expect(out).toContain("https://abu.dk/meetings/[fjernet]");
    expect(out).toContain("m***@firma.dk");
  });

  it("konsol-e-mail logger ikke tokens, og følsomme beskeder slet ikke", async () => {
    const lines: string[] = [];
    const email = new ConsoleEmail((l) => lines.push(l));
    await email.send({ to: "kunde@firma.dk", subject: "Nulstil adgangskode", text: `Link: https://abu.dk/set-password?token=${TOKEN}`, messageId: "1" });
    await email.send({ to: "kunde@firma.dk", subject: "Invitation", text: `Link: https://abu.dk/set-password?token=${TOKEN}`, messageId: "2", sensitive: true });
    const all = lines.join("\n");
    expect(all).not.toContain(TOKEN);
    expect(all).not.toContain("kunde@firma.dk");
    expect(lines[1]).toMatch(/indholdet logges ikke/);
    expect(lines[1]).not.toContain("Link:");
  });

  it("konsol-SMS maskerer modtager og links", async () => {
    const lines: string[] = [];
    await new ConsoleSms((l) => lines.push(l)).send({ to: "+4520304050", from: "ABU", text: "Afmeld: https://abu.dk/afmeld?t=s4520304050.sig", messageId: "x" });
    const all = lines.join("\n");
    expect(all).not.toContain("4520304050");
    expect(all).toContain("+45******50");
  });
});
