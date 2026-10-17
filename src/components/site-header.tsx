import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";
import { Logo } from "./logo";
import { NavLinks, type NavItem } from "./nav-links";

const NAV: Record<string, NavItem[]> = {
  CUSTOMER: [
    { href: "/dashboard", label: "Overblik" },
    { href: "/book", label: "Book møde" },
    { href: "/meetings", label: "Møder" },
    { href: "/account", label: "Konto" },
  ],
  ADVISOR: [
    { href: "/dashboard", label: "Overblik" },
    { href: "/availability", label: "Tilgængelighed" },
    { href: "/profile", label: "Profil" },
    { href: "/meetings", label: "Møder" },
    { href: "/account", label: "Konto" },
  ],
  ADMIN: [
    { href: "/admin", label: "Admin", exact: true },
    { href: "/admin/advisors", label: "Rådgivere" },
    { href: "/admin/onboarding", label: "Onboarding" },
    { href: "/admin/tags", label: "Tags" },
    { href: "/admin/customers", label: "Kunder" },
    { href: "/admin/leads", label: "Leads" },
    { href: "/admin/notifikationer", label: "Notifikationer" },
    { href: "/admin/subscriptions", label: "Abonnementer" },
    { href: "/admin/meetings", label: "Møder" },
    { href: "/account", label: "Konto" },
  ],
};

export function HeaderLogo() {
  return (
    <Link href="/" className="no-underline hover:no-underline" aria-label="Advisory Board Unlimited – forside">
      <Logo variant="dark" />
    </Link>
  );
}

/** Header-bar: charcoal, logoet i invers venstrestillet, navigation i små versaler (guld på aktiv). */
export async function SiteHeader() {
  const user = await getCurrentUser();
  const links: NavItem[] = user ? NAV[user.role] : [{ href: "/priser", label: "Priser" }];
  // Mange menupunkter (admin, rådgiver) foldes sammen bag «Menu» på mobil i stedet for at fylde flere linjer (plan #25)
  const collapse = links.length > 3;
  const logout = (
    <form action={logoutAction}>
      <button className="btn-outline-light btn-sm" type="submit">
        Log ud
      </button>
    </form>
  );
  return (
    <header className="on-dark relative bg-charcoal">
      <div className="container-abu flex flex-wrap items-center justify-between gap-x-8 gap-y-1 py-2">
        <HeaderLogo />
        {collapse && (
          <details className="group sm:hidden" data-testid="mobile-menu">
            <summary className="nav-link flex cursor-pointer list-none items-center gap-2 py-2 [&::-webkit-details-marker]:hidden">
              <span aria-hidden="true" className="text-base leading-none">☰</span> Menu
            </summary>
            <nav aria-label="Hovedmenu (mobil)" className="absolute inset-x-0 z-40 mt-2 flex flex-col gap-3 border-t border-divider-light bg-charcoal px-4 py-4 shadow-panel">
              <NavLinks links={links} />
              {user && logout}
            </nav>
          </details>
        )}
        <nav aria-label="Hovedmenu" className={`${collapse ? "hidden sm:flex" : "flex"} flex-wrap items-center gap-x-6 gap-y-2`}>
          <NavLinks links={links} />
          {user ? (
            logout
          ) : (
            <>
              <Link href="/login" className="nav-link">
                Log ind
              </Link>
              <Link href="/kom-i-gang" className="btn btn-sm">
                Opret konto
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="on-dark bg-charcoal text-on-dark-soft">
      <div className="container-abu py-space-6">
        <div className="flex flex-col gap-space-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Logo variant="dark" />
            <p className="mt-4 text-sm">Dit eget advisory board som abonnement.</p>
          </div>
          <nav aria-label="Sidefod" className="flex flex-wrap gap-x-6 gap-y-2">
            <Link href="/priser" className="nav-link">Priser</Link>
            <Link href="/privatliv" className="nav-link">Privatlivspolitik</Link>
            <Link href="/vilkaar" className="nav-link">Vilkår</Link>
          </nav>
        </div>
        <p className="mt-space-5 border-t border-divider-light pt-space-3 text-xs">
          © {new Date().getFullYear()} Advisory Board Unlimited
        </p>
      </div>
    </footer>
  );
}

/**
 * Sideramme. `app` (standard): grå flade med hvide kort, til indloggede sider.
 * `bare`: ingen indpakning, siden sammensætter selv sine bånd (landing, priser, login mv.).
 */
export async function PageShell({
  children,
  variant = "app",
}: {
  children: React.ReactNode;
  variant?: "app" | "bare";
  /** @deprecated bredden er altid container-max */
  wide?: boolean;
}) {
  return (
    <>
      {/* Tastatur og skærmlæser: spring navigationen over (plan #25) */}
      <a href="#indhold" className="skip-link">Spring til indhold</a>
      <SiteHeader />
      {variant === "app" ? (
        <main id="indhold" tabIndex={-1} className="app-main bg-grey-bg py-space-5 outline-none sm:py-space-6">
          <div className="container-abu">{children}</div>
        </main>
      ) : (
        <main id="indhold" tabIndex={-1} className="outline-none">{children}</main>
      )}
      <SiteFooter />
    </>
  );
}
