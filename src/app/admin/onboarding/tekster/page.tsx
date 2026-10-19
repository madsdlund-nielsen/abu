import type { Metadata } from "next";
import Link from "next/link";
import { OnboardingTextsCms } from "@/components/cms/onboarding-texts-cms";
import { prisma } from "@/lib/db";
import { resolveTexts } from "@/lib/content/onboarding-texts";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Onboarding-tekster" };
export const dynamic = "force-dynamic";

export default async function AdminOnboardingTexts() {
  // Hver admin-side kræver selv ADMIN (N-1): layout og side renderes parallelt, så layoutets tjek alene beskytter ikke sidens forespørgsler
  await requireRole("ADMIN");
  const rows = await prisma.contentBlock.findMany();
  const values = resolveTexts(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  const versions = Object.fromEntries(rows.map((r) => [r.key, r.version]));
  return (
    <div>
      <span className="eyebrow">Admin · Indhold</span>
      <h1>Onboarding-tekster</h1>
      <nav aria-label="Onboarding-indhold" className="mt-space-3 flex gap-2">
        <Link href="/admin/onboarding" className="badge badge-muted no-underline hover:border-navy">Test</Link>
        <Link href="/admin/onboarding/tekster" aria-current="page" className="badge badge-navy no-underline">Tekster</Link>
      </nav>
      <p className="mb-space-3 mt-space-3 max-w-3xl text-muted">
        Alle tekster, nye kunder møder i tilmeldingen: overskrifter, introduktioner, feltnavne, knapper, fejlbeskeder og samtykketekster. Ændringer gælder
        straks.
      </p>
      <OnboardingTextsCms initialValues={values} initialVersions={versions} />
    </div>
  );
}
