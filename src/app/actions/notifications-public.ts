"use server";

import { redirect } from "next/navigation";
import { rateLimit } from "@/lib/rate-limit";
import { prisma } from "@/lib/db";
import { audit } from "@/lib/audit";
import { applyUnsubscribe } from "@/lib/notifications/service";
import { verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";

/** Afmelding fra link i e-mail/SMS (kræver ingen login). */
export async function unsubscribeAction(formData: FormData) {
  const t = String(formData.get("t") ?? "");
  const claim = verifyUnsubscribeToken(t);
  if (!claim || !(await rateLimit(`unsub:${t.slice(0, 20)}`, 20))) redirect("/afmeld");
  await applyUnsubscribe(claim.channel, claim.address);
  const user = claim.channel === "EMAIL" ? await prisma.user.findFirst({ where: { email: { equals: claim.address, mode: "insensitive" } }, select: { id: true } }) : null;
  await audit(user?.id ?? null, "notification.unsubscribe", "Notification", claim.channel);
  redirect(`/afmeld?done=1&k=${claim.channel}`);
}
