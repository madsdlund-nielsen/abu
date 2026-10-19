import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileForm } from "@/components/advisor-forms";
import { AdvisorActivationControl } from "@/components/admin/advisor-activation";
import { ResendInviteButton } from "@/components/admin/advisor-invite";
import { AdvisorStatusBadge, ReadinessList } from "@/components/admin/readiness";
import { AdvisorForm } from "@/components/cms/advisor-form";
import { getPriceBounds } from "@/lib/advisor-price";
import { boardsWithAdvisor, loadReadiness, missingReadiness } from "@/lib/advisor-readiness";
import { avatarVersion } from "@/lib/avatar-url";
import { prisma } from "@/lib/db";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Rediger rådgiver" };

export default async function AdminAdvisor({ params }: { params: Promise<{ id: string }> }) {
  // Hver admin-side kræver selv ADMIN (N-1): layout og side renderes parallelt, så layoutets tjek alene beskytter ikke sidens forespørgsler
  await requireRole("ADMIN");
  const { id } = await params;
  const [profile, tags, activeSubscriptions] = await Promise.all([
    prisma.advisorProfile.findUnique({ where: { userId: id }, include: { user: true, tags: true } }),
    prisma.tag.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, active: true, kind: true, systemKey: true } }),
    prisma.subscriptionAdvisor.count({ where: { advisorId: id, subscription: { status: { in: ["ACTIVE", "PAST_DUE"] } } } }),
  ]);
  if (!profile) notFound();
  const bounds = await getPriceBounds();
  const [readinessMap, boardRows] = await Promise.all([loadReadiness([id], bounds), boardsWithAdvisor(id)]);
  const readiness = readinessMap.get(id) ?? [];
  const missing = missingReadiness(readiness);
  const boards = [...new Set(boardRows.map((b) => b.companyName))];
  const name = profile.user.name;
  return (
    <div>
      <span className="eyebrow">Admin · Rådgiver</span>
      <div className="flex flex-wrap items-center gap-3">
        <h1>{name}</h1>
        <AdvisorStatusBadge active={profile.active} missing={missing} />
      </div>
      <p className="mb-space-4 mt-space-3 text-muted">{profile.title || profile.user.email}</p>

      <section className="mb-space-4 border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-labelledby="status-h" data-testid="status-panel">
        <h2 id="status-h" className="text-xl font-light">Status</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <div className="mt-space-3 grid gap-space-4 md:grid-cols-2">
          <div>
            <p className="text-sm">
              <span className="font-semibold text-navy">{profile.active ? "Aktiv" : "Inaktiv"}</span>{" "}
              <span className="text-muted">{profile.active ? "– kan vælges af kunder (katalog, forslag, booking)." : "– kan ikke vælges af kunder (katalog, forslag, booking)."}</span>
            </p>
            {profile.active && missing.length > 0 && (
              <p role="alert" className="callout callout-error mt-space-3 text-sm" data-testid="active-not-ready">
                {name} er aktiv, men opfylder ikke længere tjeklisten (mangler {missing.join(", ")}). Rådgiveren deaktiveres ikke automatisk og kan stadig vælges af kunder. Ret det, der mangler, eller deaktivér.
              </p>
            )}
            {profile.active && boards.length > 0 && <p className="mt-space-3 text-sm text-muted">Sidder i aktive boards hos {boards.join(", ")}.</p>}
            <div className="mt-space-4">
              <AdvisorActivationControl userId={id} name={name} active={profile.active} missing={missing} boards={boards} />
            </div>
          </div>
          <div>
            <p className="label !mb-0">Klar til aktivering</p>
            <ReadinessList items={readiness} />
            <p className="mt-space-3 text-xs text-muted">Tjeklisten viser den gemte tilstand. Gem ændringer i profil, pris og tags, før du aktiverer.</p>
            {!profile.user.passwordHash && (
              <div className="mt-space-3">
                <ResendInviteButton userId={id} />
              </div>
            )}
          </div>
        </div>
      </section>

      <AdvisorForm
        userId={id}
        initial={{ priceDkk: profile.pricePerMeetingDkk, tagIds: profile.tags.map((t) => t.tagId) }}
        tags={tags}
        activeSubscriptions={activeSubscriptions}
        priceBounds={bounds}
      />

      <section className="mt-space-4 border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-labelledby="profile-h" data-testid="admin-profile">
        <h2 id="profile-h" className="text-xl font-light">Profil</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <p className="callout mt-space-3 text-sm">
          {name} kan også selv redigere disse felter under <strong>Min profil</strong>. Det, du gemmer her, ser rådgiveren næste gang, og rådgiveren kan rette det igen. Ændringer skrives til audit-loggen.
        </p>
        <div className="mt-space-4 max-w-2xl">
          <ProfileForm
            mode="admin"
            advisorId={id}
            photoVersion={profile.photoKey ? avatarVersion(profile.photoUpdatedAt) : null}
            initial={{ name, phone: profile.user.phone ?? "", title: profile.title, bio: profile.bio }}
          />
        </div>
      </section>
    </div>
  );
}
