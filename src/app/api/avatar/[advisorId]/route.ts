import { getCurrentUser } from "@/lib/auth";
import { serveAvatar } from "@/lib/avatar-serve";

export const dynamic = "force-dynamic";

/** Rådgiverfoto fra det private lager (se `serveAvatar` for adgang og cache). */
export async function GET(req: Request, { params }: { params: Promise<{ advisorId: string }> }) {
  const { advisorId } = await params;
  return serveAvatar(advisorId, new URL(req.url).searchParams, getCurrentUser, undefined, req.headers.get("if-none-match"));
}
