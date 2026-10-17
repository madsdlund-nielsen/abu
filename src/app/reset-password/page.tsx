import type { Metadata } from "next";
import Link from "next/link";
import { ResetRequestForm } from "@/components/auth-forms";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { Band } from "@/components/band";
import { PageShell } from "@/components/site-header";

export const metadata: Metadata = { title: "Nulstil adgangskode" };

export default async function ResetPage({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  return (
    <PageShell variant="bare">
      <Band tone="grey">
      <div className="mx-auto max-w-md">
        <h1>Nulstil adgangskode</h1>
        <div className="panel mt-space-5">
          <Flash ok={ok} err={err} />
          <ResetRequestForm />
          <p className="mt-4 text-sm"><Link href="/login">Tilbage til login</Link></p>
        </div>
      </div>
      </Band>
    </PageShell>
  );
}
