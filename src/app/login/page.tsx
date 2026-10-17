import type { Metadata } from "next";
import Link from "next/link";
import { loginAction } from "@/app/actions/auth";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";

export const metadata: Metadata = { title: "Log ind" };

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  return (
    <PageShell variant="bare">
      <Band tone="grey">
      <div className="mx-auto max-w-md">
        <h1>Log ind</h1>
        <div className="panel mt-space-5">
          <Flash ok={ok} err={err} />
          <form action={loginAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">E-mail</label>
              <input className="input" id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div>
              <label className="label" htmlFor="password">Adgangskode</label>
              <input className="input" id="password" name="password" type="password" autoComplete="current-password" required />
            </div>
            <button className="btn w-full" type="submit">Log ind</button>
          </form>
          <p className="mt-4 text-sm text-muted">
            <Link href="/reset-password">Glemt adgangskode?</Link> · <Link href="/kom-i-gang">Opret konto</Link>
          </p>
        </div>
      </div>
      </Band>
    </PageShell>
  );
}
