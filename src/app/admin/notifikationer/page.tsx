import type { Metadata } from "next";
import { NotificationsCms } from "@/components/cms/notifications";
import type { Tab } from "@/components/cms/notifications/shared";
import { TABS } from "@/components/cms/notifications/shared";
import type { SP } from "@/components/flash";
import { loadNotificationsCms } from "@/lib/notifications/cms-data";
import { requireRole } from "@/lib/auth";

export const metadata: Metadata = { title: "Notifikationer" };
export const dynamic = "force-dynamic";

export default async function AdminNotifications({ searchParams }: { searchParams: SP }) {
  // Hver admin-side kræver selv ADMIN (N-1): layout og side renderes parallelt, så layoutets tjek alene beskytter ikke sidens forespørgsler
  await requireRole("ADMIN");
  const p = await searchParams;
  const fane = Array.isArray(p.fane) ? p.fane[0] : p.fane;
  const initialTab: Tab = TABS.some((t) => t.id === fane) ? (fane as Tab) : "regler";
  const data = await loadNotificationsCms();
  return (
    <div>
      <span className="eyebrow">Admin · Indhold</span>
      <h1>Notifikationer</h1>
      <p className="mb-space-4 mt-space-3 max-w-3xl text-muted">
        E-mails og SMS&apos;er, der sendes til kunder og rådgivere: hvornår, til hvem og med hvilken tekst. Ændringer gælder straks for nye beskeder.
      </p>
      <NotificationsCms initialTemplates={data.templates} initialRules={data.rules} settings={data.settings} providers={data.providers} initialTab={initialTab} />
    </div>
  );
}
