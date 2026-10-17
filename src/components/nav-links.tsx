"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavItem {
  href: string;
  label: string;
  exact?: boolean;
}

export function NavLinks({ links }: { links: NavItem[] }) {
  const pathname = usePathname();
  return (
    <>
      {links.map((l) => {
        const active = l.exact ? pathname === l.href : pathname === l.href || pathname.startsWith(`${l.href}/`);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={`nav-link ${active ? "nav-link-active" : ""}`}
            aria-current={active ? "page" : undefined}
            // Luk mobilmenuen, når et punkt vælges
            onClick={(e) => e.currentTarget.closest("details")?.removeAttribute("open")}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
