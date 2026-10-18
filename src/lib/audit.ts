import { raiseAlert } from "./alerts";
import { prisma } from "./db";

/**
 * Audit-log over admin-handlinger og adgang til følsomme data. En fejlet skrivning må ikke vælte handlingen, men den
 * må heller ikke forsvinde i stilhed (L-3): der rejses en driftsalarm ("[ALERT] audit_write_failed" i loggen og på
 * admin-forsiden) med handlingen, men uden persondata.
 */
export async function audit(userId: string | null, action: string, entity: string, entityId: string, detail?: string) {
  try {
    // createMany (ingen RETURNING): audit-loggen er append-only og kun læsbar for admin/system (RLS), så en kunde eller
    // rådgiver må tilføje en række, men ikke få den returneret
    await prisma.auditLog.createMany({ data: [{ userId, action, entity, entityId, detail: detail?.slice(0, 1000) }] });
  } catch (e) {
    await raiseAlert("audit_write_failed", `Audit-loggen kunne ikke skrive «${action}» (${entity}): ${e instanceof Error ? e.message.slice(0, 200) : "ukendt fejl"}`);
  }
}
