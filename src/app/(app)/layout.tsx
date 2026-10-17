import { PageShell } from "@/components/site-header";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return <PageShell wide>{children}</PageShell>;
}
