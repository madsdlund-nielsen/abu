import { PageShell } from "@/components/site-header";
import { requireRole } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole("ADMIN");
  return <PageShell wide>{children}</PageShell>;
}
