import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth";
import { buildDataExport } from "@/lib/data-export";

export const dynamic = "force-dynamic";

/** GDPR-dataeksport (JSON) for den indloggede bruger. Kun udvalgte felter (se lib/data-export.ts). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Ikke logget ind" }, { status: 401 });
  const data = await buildDataExport(user);
  await audit(user.id, "user.export", "User", user.id);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="abu-mine-data.json"',
      "Cache-Control": "no-store",
    },
  });
}
