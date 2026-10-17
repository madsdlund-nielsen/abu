import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/** GDPR-dataeksport (JSON) for den indloggede bruger. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });

  const [full, meetings, auditLog] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      include: {
        customerProfile: { include: { subscriptions: { include: { advisors: true } } } },
        advisorProfile: { include: { availabilityRules: true, availabilityBlocks: true } },
      },
    }),
    prisma.meeting.findMany({
      where: { participants: { some: { userId: user.id } } },
      include: { transcript: true, participants: { select: { userId: true } } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.auditLog.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } }),
  ]);
  // passwordHash udelades bevidst
  const { passwordHash, ...profile } = full;
  void passwordHash;
  await audit(user.id, "user.export", "User", user.id);
  return new NextResponse(JSON.stringify({ exportedAt: new Date().toISOString(), user: profile, meetings, auditLog }, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="abu-mine-data.json"',
      "Cache-Control": "no-store",
    },
  });
}
