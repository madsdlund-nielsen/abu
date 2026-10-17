import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_COLORS, buildEmail, escapeHtml, textToHtml } from "./email-layout";
import { makeUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

describe("afmeldingstoken", () => {
  it("kan oprettes og verificeres for e-mail og SMS", () => {
    const e = makeUnsubscribeToken({ channel: "EMAIL", address: "Mette@Firma.dk" });
    expect(verifyUnsubscribeToken(e)).toEqual({ channel: "EMAIL", address: "mette@firma.dk" });
    const s = makeUnsubscribeToken({ channel: "SMS", address: "+4520304050" });
    expect(verifyUnsubscribeToken(s)).toEqual({ channel: "SMS", address: "+4520304050" });
    expect(s.length).toBeLessThan(40); // kort nok til en SMS
  });
  it("afviser ændrede og forfalskede tokens", () => {
    const t = makeUnsubscribeToken({ channel: "EMAIL", address: "a@b.dk" });
    const [p, sig] = t.split(".");
    expect(verifyUnsubscribeToken(`${p}x.${sig}`)).toBeNull();
    expect(verifyUnsubscribeToken(`${p}.${sig.slice(1)}A`)).toBeNull();
    expect(verifyUnsubscribeToken("sladder")).toBeNull();
    expect(verifyUnsubscribeToken("")).toBeNull();
    expect(verifyUnsubscribeToken(makeUnsubscribeToken({ channel: "SMS", address: "+4520304050" }).replace("4520304050", "4520304051"))).toBeNull();
  });
});

describe("e-mail-layout", () => {
  it("bruger de samme farver som design-tokens", () => {
    const css = readFileSync(new URL("../../styles/design-tokens.css", import.meta.url), "utf8");
    const token = (name: string) => new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)?.[1].toLowerCase();
    expect(EMAIL_COLORS.navy).toBe(token("color-navy"));
    expect(EMAIL_COLORS.charcoal).toBe(token("color-charcoal"));
    expect(EMAIL_COLORS.gold).toBe(token("color-gold"));
    expect(EMAIL_COLORS.goldDark).toBe(token("color-gold-dark"));
    expect(EMAIL_COLORS.text).toBe(token("color-text"));
    expect(EMAIL_COLORS.muted).toBe(token("color-text-muted"));
    expect(EMAIL_COLORS.greyBg).toBe(token("color-grey-bg"));
  });
  it("escaper HTML og laver links og afsnit", () => {
    expect(escapeHtml('<b>"x"</b>')).toBe("&lt;b&gt;&quot;x&quot;&lt;/b&gt;");
    const html = textToHtml("Hej <script>\n\nSe https://abu.dk/m/1.");
    expect(html).not.toContain("<script>");
    expect(html.match(/<p /g)).toHaveLength(2);
    expect(html).toContain('<a href="https://abu.dk/m/1"');
    expect(html).toContain("</a>.");
  });
  it("bygger HTML og tekst; afmelding kun når linket gives; logo fra baseUrl", () => {
    const m = buildEmail({ subject: "Emne", bodyText: "Hej\n\nVenlig hilsen", baseUrl: "https://abu.dk/" });
    expect(m.html).toContain('src="https://abu.dk/brand/abu-lockup-22_hvid.svg"');
    expect(m.html).toContain("#1a2528"); // charcoal
    expect(m.html).not.toContain("Afmeld");
    expect(m.text).toContain("Hej");
    const o = buildEmail({ subject: "Emne", bodyText: "Hej", unsubscribeUrl: "https://abu.dk/afmeld?t=x", baseUrl: "https://abu.dk" });
    expect(o.html).toContain("Afmeld</a>");
    expect(o.text).toContain("Afmeld: https://abu.dk/afmeld?t=x");
  });
});
