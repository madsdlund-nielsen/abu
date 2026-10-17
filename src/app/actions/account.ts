"use server";

import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { redirectWith } from "@/lib/redirect";

export async function requestDeletionAction() {
  const user = await requireUser();
  if (user.role === "ADMIN") redirectWith("/account", "err", "Administratorkonti kan ikke slettes her.");
  await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: new Date() } });
  await audit(user.id, "user.deletion_request", "User", user.id);
  redirectWith("/account", "ok", "Din anmodning om sletning er registreret. Vi behandler den hurtigst muligt og senest inden for 30 dage.");
}

export async function cancelDeletionRequestAction() {
  const user = await requireUser();
  await prisma.user.update({ where: { id: user.id }, data: { deletionRequestedAt: null } });
  await audit(user.id, "user.deletion_request_withdrawn", "User", user.id);
  redirectWith("/account", "ok", "Anmodningen om sletning er trukket tilbage.");
}
