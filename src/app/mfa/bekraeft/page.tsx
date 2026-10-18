import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Band } from "@/components/band";
import { flashFrom, type SP } from "@/components/flash";
import { ReverifyForm } from "@/components/mfa-forms";
import { PageShell } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { safeNextPath } from "@/lib/consent";

export const metadata: Metadata = { title: "Bekræft med kode" };
export const dynamic = "force-dynamic";

/** Følsomme handlinger kræver en kode, der højst er 15 minutter gammel. Bagefter sendes man tilbage til siden. */
export default async function ReverifyPage({ searchParams }: { searchParams: SP }) {
  const { user } = await requireSession();
  if (!user.mfaEnabledAt) redirect("/mfa/opsaet");
  const { one, params } = await flashFrom(searchParams);
  const next = safeNextPath(one(params.next));
  const back = next && !next.startsWith("/mfa") ? next : user.role === "ADMIN" ? "/admin" : "/account";
  return (
    <PageShell variant="bare">
      <Band tone="grey">
        <div className="mx-auto max-w-md">
          <span className="eyebrow">Følsom handling</span>
          <h1>Bekræft med kode</h1>
          <div className="panel mt-space-5">
            <p className="mb-space-4 text-sm text-muted">
              Af sikkerhedshensyn skal du bekræfte, at det er dig, før du fortsætter. Indtast koden fra din godkendelses-app. Bekræftelsen
              gælder i 15 minutter.
            </p>
            <ReverifyForm next={back} />
            <p className="mt-space-4 text-sm"><Link href={back}>Annullér og gå tilbage</Link></p>
          </div>
        </div>
      </Band>
    </PageShell>
  );
}
