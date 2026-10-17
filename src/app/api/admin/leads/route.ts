import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { loadLeads, leadsToCsv, parseLeadFilter } from "@/lib/leads-admin";

export const dynamic = "force-dynamic";

/** CSV-eksport af leads (admin). Respekterer de samme filtre som listen. */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user || user.role !== "ADMIN") return NextResponse.json({ error: "Ikke tilladt" }, { status: 403 });
  const params = Object.fromEntries(new URL(req.url).searchParams);
  const rows = await loadLeads(parseLeadFilter(params));
  await audit(user.id, "leads.export", "Lead", `${rows.length}`);
  return new NextResponse(leadsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
