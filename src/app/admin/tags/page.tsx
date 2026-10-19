import type { Metadata } from "next";
import Link from "next/link";
import { TagsTable } from "@/components/cms/tags-table";
import { loadCmsData } from "@/lib/onboarding/cms-data";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Tags" };

export default async function AdminTags() {
  // Hver admin-side kræver selv ADMIN (N-1): layout og side renderes parallelt, så layoutets tjek alene beskytter ikke sidens forespørgsler
  await requireRole("ADMIN");
  const { tags } = await loadCmsData({ includeAdmin: true });
  return (
    <div>
      <span className="eyebrow">Admin · Indhold</span>
      <h1>Tags</h1>
      <p className="mb-space-4 mt-space-3 max-w-3xl text-muted">
        <strong className="text-navy">Kompetence-tags</strong> beskriver rådgivernes kompetencer og kobles til svarene i <Link href="/admin/onboarding">onboarding-testen</Link>.{" "}
        <strong className="text-navy">Interne tags</strong> er mærkater kun for admin: de vises aldrig for kunder eller rådgivere og bruges ikke i matchingen.
        Systemtagget «Lead-kvalificeret» afgør, hvem der kan være <Link href="/admin/ansvarlige">ansvarlig rådgiver</Link>. Omdøb direkte i tabellen; ændringen gemmes, når du forlader feltet.
      </p>
      <TagsTable initialTags={tags} />
    </div>
  );
}
