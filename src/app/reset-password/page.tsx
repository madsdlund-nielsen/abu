import type { Metadata } from "next";
import Link from "next/link";
import { requestResetAction } from "@/app/actions/auth";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { PageShell } from "@/components/site-header";

export const metadata: Metadata = { title: "Nulstil adgangskode" };

export default async function ResetPage({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  return (
    <PageShell>
      <div className="mx-auto max-w-md">
        <h1>Nulstil adgangskode</h1>
        <div className="card mt-6">
          <Flash ok={ok} err={err} />
          <form action={requestResetAction} className="space-y-4">
            <div>
              <label className="label" htmlFor="email">E-mail</label>
              <input className="input" id="email" name="email" type="email" required autoComplete="email" />
            </div>
            <button className="btn w-full" type="submit">Send nulstillingslink</button>
          </form>
          <p className="mt-4 text-sm"><Link href="/login">Tilbage til login</Link></p>
        </div>
      </div>
    </PageShell>
  );
}
