/**
 * Sikkerhedsheaders (M-6). Ren funktion, så politikken kan testes; proxy.ts sætter dem pr. request med en ny nonce.
 *  - CSP med nonce + 'strict-dynamic' til scripts (Next.js sætter selv noncen på sine scripts), ingen inline scripts uden nonce.
 *  - frame-src kun videoudbyderen (Whereby) – i mock-tilstand kun 'self'.
 *  - Permissions-Policy: kamera, mikrofon og skærmdeling er slået fra overalt undtagen på mødesiderne (/meetings/*).
 *  - HSTS kun i produktion (https).
 */
export interface SecurityHeaderInput {
  nonce: string;
  pathname: string;
  /** "mock" | "whereby" */
  videoProvider: string;
  /** Origin for direkte upload til objektlager (S3), hvis det bruges */
  uploadOrigin?: string | null;
  /** Appens egen origin (APP_URL), fx til logoet i e-mail-forhåndsvisningen */
  appOrigin?: string | null;
  production: boolean;
  /** next dev kræver 'unsafe-eval' (React-fejlstakke) */
  dev: boolean;
}

/** Whereby-rum ligger på <subdomæne>.whereby.com */
export const WHEREBY_ORIGIN = "https://*.whereby.com";

export function videoOrigins(videoProvider: string): string[] {
  return videoProvider === "whereby" ? [WHEREBY_ORIGIN] : [];
}

export function isMeetingPath(pathname: string): boolean {
  return /^\/meetings\/[^/]+\/?$/.test(pathname);
}

export function buildCsp(i: SecurityHeaderInput): string {
  const video = videoOrigins(i.videoProvider);
  const extra = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" ");
  const directives: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${i.nonce}' 'strict-dynamic'${i.dev ? " 'unsafe-eval'" : ""}`],
    // Inline style-attributter (fx bredden på fremdriftslinjer) kræver 'unsafe-inline' for styles; scripts er nonce-låst.
    ["style-src", "'self' 'unsafe-inline'"],
    // Rådgiverfotos er eksterne https-billeder
    ["img-src", `'self' data: blob: https:${i.appOrigin && !i.appOrigin.startsWith("https:") ? ` ${i.appOrigin}` : ""}`],
    ["font-src", "'self'"],
    ["connect-src", `'self' ${extra([i.uploadOrigin])}`.trim()],
    ["media-src", "'self' blob:"],
    ["frame-src", video.length ? video.join(" ") : "'self'"],
    ["frame-ancestors", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["worker-src", "'self' blob:"],
    ["manifest-src", "'self'"],
  ];
  if (i.production) directives.push(["upgrade-insecure-requests", ""]);
  return directives.map(([k, v]) => (v ? `${k} ${v}` : k)).join("; ");
}

export function buildPermissionsPolicy(i: Pick<SecurityHeaderInput, "pathname" | "videoProvider">): string {
  // Kun funktioner, Chromium genkender (ukendte navne giver advarsler i konsollen)
  const off = ["geolocation=()", "payment=()", "usb=()"];
  if (!isMeetingPath(i.pathname)) return ["camera=()", "microphone=()", "display-capture=()", ...off].join(", ");
  const allow = ["self", ...videoOrigins(i.videoProvider).map((o) => `"${o}"`)].join(" ");
  return [`camera=(${allow})`, `microphone=(${allow})`, `display-capture=(${allow})`, `autoplay=(${allow})`, `fullscreen=(${allow})`, ...off].join(", ");
}

export const HSTS = "max-age=63072000; includeSubDomains";

export function securityHeaders(i: SecurityHeaderInput): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Security-Policy": buildCsp(i),
    "Permissions-Policy": buildPermissionsPolicy(i),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "SAMEORIGIN",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (i.production) h["Strict-Transport-Security"] = HSTS;
  return h;
}

/** 128 bit tilfældig nonce, base64. */
export function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
