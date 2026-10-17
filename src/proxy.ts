import { NextResponse, type NextRequest } from "next/server";

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

/**
 * Letvægts-gate: uden session-cookie sendes man til login. Selve rolle- og sessionkontrollen sker
 * serverside i layouts/sider (requireRole) mod databasen – middleware kører på edge og har ikke DB.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    if (!req.cookies.get("abu_session")?.value) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.search = "";
      return NextResponse.redirect(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
