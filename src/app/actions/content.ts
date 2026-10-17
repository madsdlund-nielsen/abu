"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TEXT_BY_KEY, validateText } from "@/lib/content/onboarding-texts";
import type { ActionResult } from "@/lib/onboarding/cms-types";

type SaveResult = ActionResult<{ value: string; version: number }>;

/**
 * Gemmer en redigerbar onboarding-tekst. En tom tekst eller standardteksten gendanner standarden. Versionen hæves ved hver ændring,
 * så en samtykketekst altid kan knyttes til den præcise tekst, personen så.
 */
export async function saveTextAction(key: string, input: string): Promise<SaveResult> {
  const admin = await requireRole("ADMIN");
  const def = TEXT_BY_KEY[key];
  if (!def) return { ok: false, error: "Ukendt tekst." };
  const value = input.replace(/\r\n/g, "\n").trim();
  const problem = validateText(def, value);
  if (problem) return { ok: false, error: problem };
  const next = value === "" ? def.default : value;
  try {
    const existing = await prisma.contentBlock.findUnique({ where: { key } });
    const current = existing?.value ?? def.default;
    if (current === next) return { ok: true, value: next, version: existing?.version ?? 0 };
    const row = await prisma.contentBlock.upsert({
      where: { key },
      update: { value: next, version: { increment: 1 }, updatedById: admin.id },
      create: { key, value: next, version: 1, updatedById: admin.id },
    });
    await audit(admin.id, next === def.default ? "content.reset" : "content.update", "ContentBlock", key);
    revalidatePath("/kom-i-gang");
    revalidatePath("/admin/onboarding/tekster");
    return { ok: true, value: next, version: row.version };
  } catch (e) {
    console.error("[content] fejl", e);
    return { ok: false, error: "Ændringen kunne ikke gemmes. Prøv igen." };
  }
}

export async function resetTextAction(key: string): Promise<SaveResult> {
  return saveTextAction(key, "");
}
