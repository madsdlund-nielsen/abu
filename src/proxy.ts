import { NextResponse, type NextRequest } from "next/server";
import { loginUrlFor } from "@/lib/consent";
import { appEnv, getEnv } from "@/lib/env";
import { makeNonce, securityHeaders } from "@/lib/security-headers";
import { directUploadOrigin } from "@/lib/storage/origin";

const PROTECTED = [
  "/dashboard",
  "/subscribe",
  "/book",
  "/meetings",
  "/account",
  "/samtykke",
  "/availability",
  "/profile",
  "/admin",
];

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Kører før hver side (Node-runtime):
 *  1. Letvægts-gate: uden session-cookie sendes man til login. Rolle- og sessionkontrol sker serverside i layouts/sider.
 *  2. Sikkerhedsheaders (M-6): CSP med en ny nonce pr. request (Next.js påfører den sine egne scripts), HSTS i produktion
 *     og Permissions-Policy, der kun åbner for kamera/mikrofon på mødesiderne.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!req.cookies.get("abu_session")?.value) {
      // Dybe links (fx /meetings/<id> fra en påmindelse) bevares som ?next= (plan #21)
      return NextResponse.redirect(new URL(loginUrlFor(`${pathname}${req.nextUrl.search}`), req.url));
    }
  }

  const env = getEnv();
  const nonce = makeNonce();
  const headers = securityHeaders({
    nonce,
    pathname,
    videoProvider: env.VIDEO_PROVIDER,
    uploadOrigin: env.STORAGE_PROVIDER === "s3" ? directUploadOrigin({ endpoint: env.S3_ENDPOINT, bucket: env.S3_BUCKET, forcePathStyle: env.S3_FORCE_PATH_STYLE }) : null,
    appOrigin: originOf(env.APP_URL),
    production: appEnv() === "production",
    dev: process.env.NODE_ENV === "development",
  });
  // Next.js læser noncen fra CSP-headeren på requesten og sætter den på framework-scripts og inline-scripts
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  // Stien til requireUser(), så også en udløbet session sender brugeren tilbage hertil efter login
  requestHeaders.set("x-abu-path", `${pathname}${req.nextUrl.search}`);
  requestHeaders.set("Content-Security-Policy", headers["Content-Security-Policy"]);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: [
    {
      // Sider (ikke API, statiske filer og billeder). Prefetch-requests springes over (som anbefalet af Next.js).
      source: "/((?!api|_next/static|_next/image|favicon.ico|brand/|icon.svg|apple-icon.png|manifest.webmanifest).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
