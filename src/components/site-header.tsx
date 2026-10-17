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
  return (
    <header className="on-dark bg-charcoal">
      <div className="container-abu flex flex-wrap items-center justify-between gap-x-8 gap-y-1 py-2">
        <HeaderLogo />
        <nav aria-label="Hovedmenu" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <NavLinks links={links} />
          {user ? (
            <form action={logoutAction}>
              <button className="btn-outline-light btn-sm" type="submit">
                Log ud
              </button>
            </form>
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
            <p className="mt-4 text-sm">Din egen advisory board som abonnement.</p>
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
      <SiteHeader />
      {variant === "app" ? (
        <main className="app-main bg-grey-bg py-space-5 sm:py-space-6">
          <div className="container-abu">{children}</div>
        </main>
      ) : (
        <main>{children}</main>
      )}
      <SiteFooter />
    </>
  );
}
