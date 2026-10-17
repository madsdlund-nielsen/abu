import type { Metadata } from "next";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MeetingTable } from "@/components/meeting-list";
import { Empty } from "@/components/ui";
import { prisma } from "@/lib/db";

export const metadata: Metadata = { title: "Alle møder" };

export default async function AdminMeetings({ searchParams }: { searchParams: SP }) {
  const { ok, err } = await flashFrom(searchParams);
  const meetings = await prisma.meeting.findMany({
    include: { subscription: { include: { customer: true } }, participants: { include: { user: true } } },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
  return (
    <div className="space-y-6">
      <span className="eyebrow">Admin · Møder</span>
      <h1>Alle møder</h1>
      <Flash ok={ok} err={err} />
      {meetings.length === 0 ? (
        <Empty>Ingen møder endnu.</Empty>
      ) : (
        <MeetingTable
          hrefBase="/admin/meetings"
          whoLabel="Kunde / rådgivere"
          rows={meetings.map((m) => ({
            id: m.id,
            startsAt: m.startsAt,
            status: m.status,
            who: `${m.subscription.customer.companyName} – ${m.participants.filter((p) => p.user.role === "ADVISOR").map((p) => p.user.name).join(", ")}`,
          }))}
        />
      )}
    </div>
  );
}
