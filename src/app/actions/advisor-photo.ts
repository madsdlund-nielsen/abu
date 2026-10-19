"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { removeAdvisorPhoto } from "@/lib/avatar";

export interface PhotoState {
  ok?: string;
  error?: string;
  /** Ny version (null = billedet er fjernet) */
  version?: string | null;
  at?: number;
}

/** Rådgiveren selv (uden advisorId) eller admin (med advisorId). Rettighederne tjekkes igen i lib-funktionen. */
async function target(formData: FormData) {
  const user = await requireRole("ADVISOR", "ADMIN");
  const advisorId = user.role === "ADMIN" ? String(formData.get("advisorId") ?? "") : user.id;
  return { actor: { id: user.id, role: user.role }, advisorId };
}

function revalidate(advisorId: string) {
  revalidatePath("/profile");
  revalidatePath("/admin/advisors");
  revalidatePath(`/admin/advisors/${advisorId}`);
}

// Upload går IKKE gennem en server action (D-2): en server action har allerede læst hele filen ind, før koden kører.
// Brug `PUT /api/avatar/<rådgiver-id>` (src/app/api/avatar/[advisorId]/route.ts), som tjekker pladser før body'en læses.

export async function removeAdvisorPhotoAction(formData: FormData): Promise<PhotoState> {
  const { actor, advisorId } = await target(formData);
  const r = await removeAdvisorPhoto(actor, advisorId);
  if (!r.ok) return { error: r.error, at: Date.now() };
  revalidate(advisorId);
  return { ok: r.message, version: null, at: Date.now() };
}
