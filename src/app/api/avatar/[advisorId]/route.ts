import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { readBodyLimited, uploadAdvisorPhoto } from "@/lib/avatar";
import { serveAvatar } from "@/lib/avatar-serve";
import { getEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/** Rådgiverfoto fra det private lager (se `serveAvatar` for adgang og cache). */
export async function GET(req: Request, { params }: { params: Promise<{ advisorId: string }> }) {
  const { advisorId } = await params;
  return serveAvatar(advisorId, new URL(req.url).searchParams, getCurrentUser, undefined, req.headers.get("if-none-match"));
}

/**
 * Upload eller skift af profilbillede (D-2): body'en er selve filen (JPEG/PNG/WebP). Rådgiveren selv eller admin.
 * Rettigheder, Content-Length og upload-pladser tjekkes, før body'en læses (se `uploadAdvisorPhoto`).
 */
export async function PUT(req: Request, { params }: { params: Promise<{ advisorId: string }> }) {
  const noStore = { "Cache-Control": "no-store" };
  const user = await getCurrentUser();
  if (!user || (user.role !== "ADVISOR" && user.role !== "ADMIN")) return NextResponse.json({ ok: false, error: "Ikke logget ind" }, { status: 401, headers: noStore });
  // Kun fra vores egen side (cookien er SameSite=lax, og PUT kan ikke sendes af en formular, men tjek Origin alligevel)
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(getEnv().APP_URL).origin && origin !== new URL(req.url).origin) {
    return NextResponse.json({ ok: false, error: "Forkert oprindelse" }, { status: 403, headers: noStore });
  }
  const { advisorId } = await params;
  const declared = req.headers.get("content-length");
  const contentLength = declared !== null && /^\d+$/.test(declared) ? Number(declared) : null;
  const { status, result } = await uploadAdvisorPhoto({ id: user.id, role: user.role }, advisorId, {
    contentLength,
    read: (maxBytes) => readBodyLimited(req.body, maxBytes),
  });
  if (result.ok) {
    revalidatePath("/profile");
    revalidatePath("/admin/advisors");
    revalidatePath(`/admin/advisors/${advisorId}`);
  }
  return NextResponse.json(result, { status, headers: noStore });
}
