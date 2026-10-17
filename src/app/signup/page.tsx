import type { Metadata } from "next";
import Link from "next/link";
import { signupAction } from "@/app/actions/auth";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { PageShell } from "@/components/site-header";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth";

export const metadata: Metadata = { title: "Opret konto" };

export default async function SignupPage({ searchParams }: { searchParams: SP }) {
  const { err } = await flashFrom(searchParams);
  return (
    <PageShell>
      <div className="mx-auto max-w-xl">
        <h1>Opret konto</h1>
        <p className="mt-2 text-sm text-slate-600">Opret din virksomhed og vælg derefter dit abonnement.</p>
        <div className="card mt-6">
          <Flash err={err} />
          <form action={signupAction} className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="label" htmlFor="companyName">Firmanavn</label>
              <input className="input" id="companyName" name="companyName" required autoComplete="organization" />
            </div>
            <div>
              <label className="label" htmlFor="cvr">CVR-nummer</label>
              <input className="input" id="cvr" name="cvr" required inputMode="numeric" pattern="[0-9 ]{8,10}" placeholder="12345678" />
            </div>
            <div>
              <label className="label" htmlFor="address">Adresse (valgfri)</label>
              <input className="input" id="address" name="address" autoComplete="street-address" />
            </div>
            <div>
              <label className="label" htmlFor="name">Dit navn</label>
              <input className="input" id="name" name="name" required autoComplete="name" />
            </div>
            <div>
              <label className="label" htmlFor="phone">Telefon</label>
              <input className="input" id="phone" name="phone" type="tel" required autoComplete="tel" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="email">E-mail</label>
              <input className="input" id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <div className="sm:col-span-2">
              <label className="label" htmlFor="password">Adgangskode (mindst {MIN_PASSWORD_LENGTH} tegn)</label>
              <input className="input" id="password" name="password" type="password" required minLength={MIN_PASSWORD_LENGTH} autoComplete="new-password" />
            </div>
            <label className="flex items-start gap-3 text-sm text-slate-700 sm:col-span-2">
              <input type="checkbox" name="consent" className="mt-1 h-4 w-4" required />
              <span>
                Jeg accepterer <Link href="/vilkaar" target="_blank">vilkårene</Link> og har læst{" "}
                <Link href="/privatliv" target="_blank">privatlivspolitikken</Link>, herunder at møder optages og
                transskriberes automatisk.
              </span>
            </label>
            <div className="sm:col-span-2">
              <button className="btn w-full" type="submit">Opret konto</button>
            </div>
          </form>
          <p className="mt-4 text-sm text-slate-600">
            Har du allerede en konto? <Link href="/login">Log ind</Link>
          </p>
        </div>
      </div>
    </PageShell>
  );
}
