import type { Metadata } from "next";
import Link from "next/link";
import { TagsTable } from "@/components/cms/tags-table";
import { loadCmsData } from "@/lib/onboarding/cms-data";

export const metadata: Metadata = { title: "Tags" };

export default async function AdminTags() {
  const { tags } = await loadCmsData();
  return (
    <div>
      <span className="eyebrow">Admin · Indhold</span>
      <h1>Kompetence-tags</h1>
      <p className="mb-space-4 mt-space-3 max-w-3xl text-muted">
        Tags beskriver rådgivernes kompetencer og kobles til svarene i <Link href="/admin/onboarding">onboarding-testen</Link>. Omdøb direkte i tabellen;
        ændringen gemmes, når du forlader feltet.
      </p>
      <TagsTable initialTags={tags} />
    </div>
  );
}
