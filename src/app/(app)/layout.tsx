import { PageShell } from "@/components/site-header";
import { requireUser } from "@/lib/auth";
import { completePastMeetings } from "@/lib/meeting-status";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  // Idempotent: markerer afsluttede møder som afholdt, også uden cron.
  await completePastMeetings().catch(() => undefined);
  return <PageShell wide>{children}</PageShell>;
}
