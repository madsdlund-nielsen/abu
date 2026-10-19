import type { Metadata } from "next";
import Link from "next/link";
import { LoginForm } from "@/components/auth-forms";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";
import { redirect } from "next/navigation";
import { getSessionContext, mfaPathFor } from "@/lib/auth";
import { safeNextPath } from "@/lib/consent";

export const metadata: Metadata = { title: "Log ind" };

export default async function LoginPage({ searchParams }: { searchParams: SP }) {
  const { ok, err, one, params } = await flashFrom(searchParams);
  const next = safeNextPath(one(params.next));
  const ctx = await getSessionContext();
  if (ctx?.stage === "full") redirect(next ?? (ctx.user.role === "ADMIN" ? "/admin" : "/dashboard"));
  // Adgangskoden er godkendt, men koden mangler: fortsæt dér (eller log ud fra MFA-siden)
  if (ctx) redirect(mfaPathFor(ctx.stage as "mfa_verify" | "mfa_setup", next));
  return (
    <PageShell variant="bare">
      <Band tone="grey">
      <div className="mx-auto max-w-md">
        <h1>Log ind</h1>
        <div className="panel mt-space-5">
          <Flash ok={ok} err={err} />
          {next && <p className="callout mb-space-4 text-sm">Log ind for at fortsætte til siden, du åbnede.</p>}
          <LoginForm next={next} initialEmail={one(params.e)} />
          <p className="mt-4 text-sm text-muted">
            <Link href="/reset-password">Glemt adgangskode?</Link> · <Link href="/kom-i-gang">Opret konto</Link>
          </p>
        </div>
      </div>
      </Band>
    </PageShell>
  );
}
