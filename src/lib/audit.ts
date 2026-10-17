import { prisma } from "./db";

export async function audit(userId: string | null, action: string, entity: string, entityId: string, detail?: string) {
  try {
    await prisma.auditLog.create({ data: { userId, action, entity, entityId, detail: detail?.slice(0, 1000) } });
  } catch (e) {
    console.error("[audit] kunne ikke skrive audit-log", e);
  }
}
