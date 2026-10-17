import type { Metadata } from "next";
import { updateProfileAction } from "@/app/actions/advisor";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Profil" };

export default async function ProfilePage({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("ADVISOR");
  const { ok, err } = await flashFrom(searchParams);
  const profile = await prisma.advisorProfile.findUniqueOrThrow({ where: { userId: user.id }, include: { tags: { include: { tag: true } } } });
  return (
    <div>
      <h1>Min profil</h1>
      <p className="mt-2 text-sm text-muted">Profilen vises for kunder, når de sammensætter deres board.</p>
      <div className="card mt-6 max-w-2xl">
        <Flash ok={ok} err={err} />
        <form action={updateProfileAction} className="grid gap-4">
          <div>
            <label className="label" htmlFor="name">Navn</label>
            <input className="input" id="name" name="name" defaultValue={user.name} required />
          </div>
          <div>
            <label className="label" htmlFor="phone">Mobilnummer (til SMS-påmindelser)</label>
            <input className="input" id="phone" name="phone" type="tel" autoComplete="tel" defaultValue={user.phone ?? ""} placeholder="20 30 40 50" />
            <p className="mt-1 text-xs text-muted">Valgfrit. Bruges kun til påmindelser om dine møder. Du kan slå SMS fra under Konto.</p>
          </div>
          <div>
            <label className="label" htmlFor="title">Titel</label>
            <input className="input" id="title" name="title" defaultValue={profile.title} maxLength={120} />
          </div>
          <div>
            <label className="label" htmlFor="bio">Præsentation</label>
            <textarea className="input min-h-32" id="bio" name="bio" defaultValue={profile.bio} maxLength={4000} />
          </div>
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
          <div>
            <label className="label" htmlFor="photoUrl">Foto-URL (https)</label>
            <input className="input" id="photoUrl" name="photoUrl" type="url" defaultValue={profile.photoUrl} />
          </div>
          <div><button className="btn" type="submit">Gem profil</button></div>
        </form>
      </div>
    </div>
  );
}
