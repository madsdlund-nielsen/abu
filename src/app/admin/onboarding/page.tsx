import type { Metadata } from "next";
import Link from "next/link";
import { OnboardingCms } from "@/components/cms/onboarding-cms";
import { loadCmsData } from "@/lib/onboarding/cms-data";

export const metadata: Metadata = { title: "Onboarding-test" };

export default async function AdminOnboarding() {
  const { questions, tags, advisors } = await loadCmsData();
  return (
    <div>
      <span className="eyebrow">Admin · Indhold</span>
      <h1>Onboarding-test</h1>
      <nav aria-label="Onboarding-indhold" className="mt-space-3 flex gap-2">
        <Link href="/admin/onboarding" aria-current="page" className="badge badge-navy no-underline">Test</Link>
        <Link href="/admin/onboarding/tekster" className="badge badge-muted no-underline hover:border-navy">Tekster</Link>
      </nav>
      <p className="mb-space-4 mt-space-3 max-w-3xl text-muted">
        Spørgsmålene og svarene, nye kunder møder før de sammensætter deres board. Hvert svar giver tags en vægt; vægtene afgør, hvilke rådgivere vi foreslår.
        Ændringer gælder straks for nye onboardinger.
      </p>
      <OnboardingCms initialQuestions={questions} tags={tags} advisors={advisors} />
    </div>
  );
}
