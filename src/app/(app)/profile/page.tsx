import type { Metadata } from "next";
import { ProfileForm } from "@/components/advisor-forms";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("ADVISOR");
  const { ok, err } = await flashFrom(searchParams);
  const profile = await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: user.id }, include: { tags: { where: { tag: { kind: "COMPETENCE" } }, include: { tag: true } } } });
  return (
    <div>
      <h1>Min profil</h1>
      <p className="mt-2 text-sm text-muted">Profilen vises for kunder, når de sammensætter deres board.</p>
      <div className="card mt-6 max-w-2xl">
        <Flash ok={ok} err={err} />
        <ProfileForm initial={{ name: user.name, phone: user.phone ?? "", title: profile.title, bio: profile.bio, photoUrl: profile.photoUrl }} />
        <div className="mt-space-4 border-t border-grey-bg pt-space-3">
          <div>
            <p className="label">Kompetence-tags</p>
            {profile.tags.length ? (
              <ul className="flex flex-wrap gap-1">
                {profile.tags.map((t) => (
                  <li key={t.tagId} className="badge badge-muted">{t.tag.name}</li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">Ingen tags endnu.</p>
            )}
            <p className="mt-1 text-xs text-muted">Tags bruges til at matche dig med kunder og tildeles af administratoren.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
