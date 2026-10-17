import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { getCurrentUser } from "@/lib/auth";

export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 text-slate-900 hover:text-slate-900">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">A</span>
      <span className="text-sm font-semibold sm:text-base">Advisory Board Unlimited</span>
    </Link>
  );
}

const NAV: Record<string, { href: string; label: string }[]> = {
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
    { href: "/admin", label: "Admin" },
    { href: "/admin/advisors", label: "Rådgivere" },
    { href: "/admin/customers", label: "Kunder" },
    { href: "/admin/subscriptions", label: "Abonnementer" },
    { href: "/admin/meetings", label: "Møder" },
    { href: "/account", label: "Konto" },
  ],
};

export async function SiteHeader() {
  const user = await getCurrentUser();
  const links = user ? NAV[user.role] : [{ href: "/priser", label: "Priser" }];
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
        <Logo />
        <nav className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          {links.map((l) => (
            <Link key={l.href} href={l.href} className="text-slate-600 hover:text-slate-900">
              {l.label}
            </Link>
          ))}
          {user ? (
            <form action={logoutAction}>
              <button className="btn-secondary btn-sm" type="submit">
                Log ud
              </button>
            </form>
          ) : (
            <>
              <Link href="/login" className="text-slate-600 hover:text-slate-900">
                Log ind
              </Link>
              <Link href="/signup" className="btn btn-sm">
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
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:justify-between">
        <span>© {new Date().getFullYear()} Advisory Board Unlimited</span>
        <span className="flex gap-4">
          <Link href="/privatliv" className="text-slate-500">Privatlivspolitik</Link>
          <Link href="/vilkaar" className="text-slate-500">Vilkår</Link>
          <Link href="/priser" className="text-slate-500">Priser</Link>
        </span>
      </div>
    </footer>
  );
}

export async function PageShell({ children, wide = false }: { children: React.ReactNode; wide?: boolean }) {
  return (
    <>
      <SiteHeader />
      <main className={`mx-auto px-4 py-8 ${wide ? "max-w-6xl" : "max-w-4xl"}`}>{children}</main>
      <SiteFooter />
    </>
  );
}
