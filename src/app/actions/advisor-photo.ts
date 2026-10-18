"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/auth";
import { AVATAR_ERRORS, MAX_AVATAR_BYTES, removeAdvisorPhoto, saveAdvisorPhoto } from "@/lib/avatar";

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

export async function uploadAdvisorPhotoAction(formData: FormData): Promise<PhotoState> {
  const { actor, advisorId } = await target(formData);
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { error: AVATAR_ERRORS.empty, at: Date.now() };
  if (file.size > MAX_AVATAR_BYTES) return { error: AVATAR_ERRORS.too_large, at: Date.now() };
  const r = await saveAdvisorPhoto(actor, advisorId, Buffer.from(await file.arrayBuffer()));
  if (!r.ok) return { error: r.error, at: Date.now() };
  revalidate(advisorId);
  return { ok: r.message, version: r.version, at: Date.now() };
}

export async function removeAdvisorPhotoAction(formData: FormData): Promise<PhotoState> {
  const { actor, advisorId } = await target(formData);
  const r = await removeAdvisorPhoto(actor, advisorId);
  if (!r.ok) return { error: r.error, at: Date.now() };
  revalidate(advisorId);
  return { ok: r.message, version: null, at: Date.now() };
}
