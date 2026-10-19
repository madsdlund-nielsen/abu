import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MeetingAdminPanel } from "@/components/admin/meeting-admin-panel";
import { LeadLabel, MeetingStatusBadge } from "@/components/ui";
import { avatarVersion } from "@/lib/avatar-url";
import { prisma } from "@/lib/db";
import { listSubstituteCandidates } from "@/lib/meeting-admin";
import { formatDanishDateInput, formatDateTime, formatTime } from "@/lib/time";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Administrer møde" };
export const dynamic = "force-dynamic";

export default async function AdminMeeting({ params }: { params: Promise<{ id: string }> }) {
  // Hver admin-side kræver selv ADMIN (N-1): layout og side renderes parallelt, så layoutets tjek alene beskytter ikke sidens forespørgsler
  await requireRole("ADMIN");
  const { id } = await params;
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: { participants: { include: { user: { include: { advisorProfile: true } } } }, subscription: { include: { customer: { include: { user: true } }, advisors: { where: { isLead: true }, include: { advisor: { include: { user: { select: { name: true } } } } } } } } },
  });
  if (!meeting) notFound();
  const now = new Date();
  const editable = meeting.status === "BOOKED" && meeting.endsAt > now;
  const [candidates, tags, history] = await Promise.all([
    editable ? listSubstituteCandidates(id) : Promise.resolve([]),
    prisma.tag.findMany({ where: { kind: "COMPETENCE" }, select: { id: true, name: true } }),
    prisma.auditLog.findMany({ where: { entity: "Meeting", entityId: id }, orderBy: { createdAt: "desc" }, include: { user: { select: { name: true } } }, take: 30 }),
  ]);
  const advisors = meeting.participants
    .filter((p) => p.user.role === "ADVISOR")
    .map((p) => ({
      id: p.userId,
      name: p.user.name,
      title: p.user.advisorProfile?.title ?? "",
      priceDkk: p.pricePerMeetingDkk,
      photo: p.user.advisorProfile?.photoKey ? avatarVersion(p.user.advisorProfile.photoUpdatedAt) : null,
    }));

  return (
    <div className="space-y-space-4">
      <div>
        <span className="eyebrow">Admin · Møde</span>
        <h1 className="first-letter:uppercase">{formatDateTime(meeting.startsAt)}</h1>
        <p className="mt-space-3 flex flex-wrap items-center gap-3 text-sm text-muted">
          <MeetingStatusBadge status={meeting.status} />
          <span>{formatTime(meeting.startsAt)}–{formatTime(meeting.endsAt)} · {meeting.subscription.customer.companyName}</span>
          <Link href="/admin/meetings">← Alle møder</Link>
          <Link href={`/meetings/${meeting.id}`}>Se mødesiden</Link>
          <Link href={`/admin/subscriptions/${meeting.subscriptionId}`}>Kundens faste board</Link>
        </p>
        <p className="mt-2"><LeadLabel prefix name={meeting.subscription.advisors[0]?.advisor.user.name ?? "Ingen"} /></p>
      </div>

      {!editable && <p className="callout text-sm">Mødet er {meeting.status === "CANCELLED" ? "aflyst" : "afholdt"} og kan ikke ændres.</p>}

      <MeetingAdminPanel
        meetingId={meeting.id}
        editable={editable}
        advisors={advisors}
        boardSize={meeting.subscription.advisorCount}
        candidates={candidates}
        tagNames={Object.fromEntries(tags.map((t) => [t.id, t.name]))}
        startsLabel={formatDateTime(meeting.startsAt)}
        defaultDate={formatDanishDateInput(meeting.startsAt)}
        defaultTime={formatTime(meeting.startsAt)}
        canCancel={meeting.startsAt > now}
      />

      <section className="card" aria-labelledby="hist-h">
        <h2 id="hist-h" className="text-xl font-light">Historik</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Ingen ændringer endnu.</p>
        ) : (
          <ul className="mt-3 divide-y divide-grey-bg text-sm" data-testid="history">
            {history.map((h) => (
              <li key={h.id} className="py-2">
                <p><span className="font-semibold text-navy">{h.detail ?? h.action}</span></p>
                <p className="text-xs text-muted">{formatDateTime(h.createdAt)} · {h.user?.name ?? "System"} · {h.action}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
