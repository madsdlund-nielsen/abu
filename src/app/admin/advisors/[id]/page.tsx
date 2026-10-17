import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AdvisorForm } from "@/components/cms/advisor-form";
import { getPriceBounds } from "@/lib/advisor-price";
import { boardsWithAdvisor, loadReadiness } from "@/lib/advisor-readiness";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Rediger rådgiver" };

export default async function AdminAdvisor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [profile, tags, activeSubscriptions] = await Promise.all([
    prisma.advisorProfile.findUnique({ where: { userId: id }, include: { user: true, tags: true } }),
    prisma.tag.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true } }),
    prisma.subscriptionAdvisor.count({ where: { advisorId: id, subscription: { status: { in: ["ACTIVE", "PAST_DUE"] } } } }),
  ]);
  if (!profile) notFound();
  const bounds = await getPriceBounds();
  const [readiness, boards] = await Promise.all([loadReadiness([id], bounds), boardsWithAdvisor(id)]);
  return (
    <div>
      <span className="eyebrow">Admin · Rådgiver</span>
      <h1>{profile.user.name}</h1>
      <p className="mb-space-4 mt-space-3 text-muted">{profile.title || profile.user.email}</p>
      <AdvisorForm
        userId={id}
        initial={{ priceDkk: profile.pricePerMeetingDkk, active: profile.active, tagIds: profile.tags.map((t) => t.tagId) }}
        tags={tags}
        activeSubscriptions={activeSubscriptions}
        readiness={readiness.get(id) ?? []}
        boards={[...new Set(boards.map((b) => b.companyName))]}
        priceBounds={bounds}
      />
    </div>
  );
}
