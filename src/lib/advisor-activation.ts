import { audit } from "./audit";
import { getPriceBounds } from "./advisor-price";
import { activationBlockedMessage, boardsWithAdvisor, canActivate, loadReadiness, missingReadiness } from "./advisor-readiness";
import { prisma } from "./db";
import { fillMissingLeads, reassignLeadsFrom } from "./lead";

export type ActivationResult =
  | { ok: true; message: string; active: boolean; boards: string[] }
  | { ok: false; error: string; missing?: string[] };

/**
 * Aktivér eller deaktivér en rådgiver (QA #13, ejerens beslutning 18.10.2026). Aktivering afvises, medmindre hele
 * tjeklisten er opfyldt i den gemte tilstand – også for en forfalsket request, der springer UI'et over. Deaktivering er
 * altid tilladt; svaret nævner de kunder, hvis aktive boards rådgiveren sidder i. Begge dele skrives til audit-loggen.
 * `active` er den ønskede tilstand (ikke en vippekontakt), så et dobbeltklik ikke slår tilbage.
 */
export async function setAdvisorActive(adminId: string, advisorId: string, active: boolean): Promise<ActivationResult> {
  const profile = await prisma.advisorProfile.findUnique({ where: { userId: advisorId }, select: { active: true, user: { select: { name: true, role: true } } } });
  if (!profile || profile.user.role !== "ADVISOR") return { ok: false, error: "Rådgiveren findes ikke." };
  const name = profile.user.name;

  if (active) {
    const items = (await loadReadiness([advisorId], await getPriceBounds())).get(advisorId) ?? [];
    if (!canActivate(items)) {
      const missing = missingReadiness(items);
      await audit(adminId, "advisor.activate.blocked", "User", advisorId, `Mangler: ${items.filter((i) => !i.ok).map((i) => i.key).join(",")}`);
      return { ok: false, error: activationBlockedMessage(name, missing), missing };
    }
    if (!profile.active) {
      await prisma.advisorProfile.update({ where: { userId: advisorId }, data: { active: true } });
      await audit(adminId, "advisor.activate", "User", advisorId);
      // Boards uden ansvarlig, som rådgiveren sidder i, kan nu få én
      await fillMissingLeads(advisorId, adminId);
    }
    return { ok: true, active: true, boards: [], message: `${name} er aktiveret og kan nu vælges af kunder.` };
  }

  const boards = [...new Set((await boardsWithAdvisor(advisorId)).map((b) => b.companyName))];
  if (profile.active) {
    await prisma.advisorProfile.update({ where: { userId: advisorId }, data: { active: false } });
    await audit(adminId, "advisor.deactivate", "User", advisorId, boards.length ? `Berørte boards: ${boards.length}` : undefined);
    // En deaktiveret rådgiver kan ikke være ansvarlig: ny ansvarlig tildeles automatisk
    await reassignLeadsFrom(advisorId, "deactivated", adminId);
  }
  return {
    ok: true,
    active: false,
    boards,
    message: `${name} er deaktiveret.${boards.length ? ` Berørte kunder (vælg en ny rådgiver under Abonnementer): ${boards.join(", ")}.` : ""}`,
  };
}
