/**
 * E-mail kan ikke bruge CSS-variabler, så farverne gentages her. De spejler src/styles/design-tokens.css
 * (en enhedstest sikrer, at de er ens). Open Sans kan ikke forventes i mailklienter: Arial er reserveskrift.
 */
export const EMAIL_COLORS = {
  navy: "#263753",
  charcoal: "#1a2528",
  gold: "#b4965d",
  goldDark: "#a3854f",
  text: "#333333",
  muted: "#4e4e4e",
  greyBg: "#eeeeee",
  white: "#ffffff",
} as const;

const FONT = "'Open Sans', Arial, Helvetica, sans-serif";

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Gør URL'er i ren tekst til links (efter HTML-escaping). Tegnsætning til sidst hører ikke til linket. */
function linkify(escaped: string): string {
  return escaped.replace(/\bhttps?:\/\/[^\s<]+/g, (url) => {
    const m = /[.,;:!?)]+$/.exec(url);
    const trail = m ? m[0] : "";
    const clean = trail ? url.slice(0, -trail.length) : url;
    return `<a href="${clean}" style="color:${EMAIL_COLORS.navy};text-decoration:underline;">${clean}</a>${trail}`;
  });
}

/** Ren tekst -> HTML-afsnit (tomme linjer skiller afsnit, enkelte linjeskift bliver <br>). */
export function textToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 16px 0;font-family:${FONT};font-size:16px;line-height:1.7;color:${EMAIL_COLORS.text};">${linkify(escapeHtml(p)).replace(/\n/g, "<br>")}</p>`,
    )
    .join("\n");
}

export interface EmailLayoutInput {
  subject: string;
  bodyText: string;
  /** Afmeldingslink (kun for ikke-obligatoriske beskeder) */
  unsubscribeUrl?: string;
  /** Appens adresse (til logoet), fx https://abu.example.dk */
  baseUrl: string;
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
}

/** Brandet HTML-mail (logo, navy/charcoal, guldstreg) plus tekstversion. */
export function buildEmail(input: EmailLayoutInput): RenderedEmail {
  const base = input.baseUrl.replace(/\/$/, "");
  const c = EMAIL_COLORS;
  const footerText = input.unsubscribeUrl
    ? `Du modtager denne besked, fordi du har givet samtykke til at blive kontaktet. Afmeld: ${input.unsubscribeUrl}`
    : "Du modtager denne besked som en del af din aftale med Advisory Board Unlimited.";
  const text = `${input.bodyText.trim()}\n\n--\n${footerText}\n`;
  const footerHtml = input.unsubscribeUrl
    ? `Du modtager denne besked, fordi du har givet samtykke til at blive kontaktet. <a href="${escapeHtml(input.unsubscribeUrl)}" style="color:${c.white};text-decoration:underline;">Afmeld</a>`
    : "Du modtager denne besked som en del af din aftale med Advisory Board Unlimited.";
  const html = `<!doctype html>
<html lang="da">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.subject)}</title>
</head>
<body style="margin:0;padding:0;background:${c.greyBg};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${c.greyBg};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;">
    <tr><td style="background:${c.charcoal};padding:20px 32px;">
      <img src="${base}/brand/abu-lockup-22_hvid.svg" width="300" alt="Advisory Board Unlimited" style="display:block;border:0;max-width:100%;height:auto;font-family:${FONT};font-size:14px;letter-spacing:1px;text-transform:uppercase;color:${c.white};">
    </td></tr>
    <tr><td style="background:${c.white};padding:32px;">
      <p style="margin:0 0 8px 0;font-family:${FONT};font-size:24px;font-weight:300;line-height:1.3;color:${c.navy};">${escapeHtml(input.subject)}</p>
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px 0;"><tr><td width="55" height="2" style="width:55px;height:2px;line-height:2px;font-size:2px;background:${c.gold};">&nbsp;</td></tr></table>
      ${textToHtml(input.bodyText)}
    </td></tr>
    <tr><td style="background:${c.navy};padding:16px 32px;font-family:${FONT};font-size:12px;line-height:1.6;color:${c.white};">
      ${footerHtml}
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
  return { subject: input.subject, text, html };
}
