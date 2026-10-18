import { prisma } from "./db";
import { withSystemContext } from "./db-context";

/**
 * Driftsalarmer (M-5, L-3). Skrives altid til loggen med præfikset "[ALERT]" (til log-overvågning, fx GlitchTip/Better
 * Stack) og gemmes som AppSetting `alert:<type>`, så de vises på admin-forsiden. Må aldrig kaste.
 */
export type AlertKind = "sms_cap_number" | "sms_cap_daily" | "sms_country_blocked" | "audit_write_failed" | "advisor_erased" | "mfa_decrypt_failed";

export const ALERT_LABEL: Record<AlertKind, string> = {
  sms_cap_number: "SMS-loft pr. nummer nået",
  sms_cap_daily: "Dagligt SMS-loft nået",
  sms_country_blocked: "SMS til land uden for tilladt-listen blokeret",
  audit_write_failed: "Audit-loggen kunne ikke skrives",
  advisor_erased: "Rådgiver slettet – møder og boards mangler en rådgiver",
  mfa_decrypt_failed: "Totrinsbekræftelse kunne ikke dekrypteres (tjek MFA_ENCRYPTION_KEY)",
};

export interface StoredAlert {
  kind: AlertKind;
  lastAt: string;
  count: number;
  message: string;
}

/** RLS: alarmer kan opstå i enhver kontekst (også en kundes request), men gemmes altid i systemkontekst. */
export async function raiseAlert(kind: AlertKind, message: string): Promise<void> {
  console.error(`[ALERT] ${kind}: ${message}`);
  try {
    const key = `alert:${kind}`;
    await withSystemContext("alerts.raise", async () => {
      const prev = await prisma.appSetting.findUnique({ where: { key } });
      const old = prev ? (JSON.parse(prev.value) as StoredAlert) : null;
      const value = JSON.stringify({ kind, lastAt: new Date().toISOString(), count: (old?.count ?? 0) + 1, message } satisfies StoredAlert);
      await prisma.appSetting.upsert({ where: { key }, update: { value }, create: { key, value } });
    });
  } catch (e) {
    console.error("[ALERT] alarmen kunne ikke gemmes", e instanceof Error ? e.message : e);
  }
}

/** Alarmer fra de seneste `days` dage, nyeste først. */
export async function recentAlerts(days = 7, now = new Date()): Promise<StoredAlert[]> {
  const rows = await prisma.appSetting.findMany({ where: { key: { startsWith: "alert:" } } });
  const since = now.getTime() - days * 86_400_000;
  return rows
    .map((r) => {
      try {
        return JSON.parse(r.value) as StoredAlert;
      } catch {
        return null;
      }
    })
    .filter((a): a is StoredAlert => Boolean(a) && new Date(a!.lastAt).getTime() >= since)
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt));
}

export async function clearAlert(kind: AlertKind): Promise<void> {
  await prisma.appSetting.deleteMany({ where: { key: `alert:${kind}` } });
}
