import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { MeetingTable } from "@/components/meeting-list";
import { Empty } from "@/components/ui";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { userDirectory } from "@/lib/user-directory";

export const metadata: Metadata = { title: "Møder" };

export default async function MeetingsPage({ searchParams }: { searchParams: SP }) {
  const user = await requireUser();
  if (user.role === "ADMIN") redirect("/admin/meetings");
  const { ok, err } = await flashFrom(searchParams);
  const meetings = await prisma.meeting.findMany({
    where: { participants: { some: { userId: user.id } } },
    include: { participants: true, subscription: { include: { customer: true } } },
    orderBy: { startsAt: "desc" },
  });
  // RLS: deltagernes navn og rolle fra kataloget (ikke deres User-rækker)
  const people = await userDirectory(meetings.flatMap((m) => m.participants.map((p) => p.userId)));
  const rows = meetings.map((m) => ({
    id: m.id,
    startsAt: m.startsAt,
    status: m.status,
    who:
      user.role === "CUSTOMER"
        ? m.participants.map((p) => people.get(p.userId)).filter((p) => p?.role === "ADVISOR").map((p) => p!.name).join(", ")
        : m.subscription.customer.companyName,
  }));
  return (
    <div>
      <h1>Møder</h1>
      <div className="mt-6">
        <Flash ok={ok} err={err} />
        {rows.length === 0 ? (
          <Empty>Ingen møder endnu.</Empty>
        ) : (
          <MeetingTable rows={rows} whoLabel={user.role === "CUSTOMER" ? "Rådgivere" : "Kunde"} />
        )}
      </div>
    </div>
  );
}
