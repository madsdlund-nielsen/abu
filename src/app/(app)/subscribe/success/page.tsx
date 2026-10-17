import Link from "next/link";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { audit } from "@/lib/audit";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SubStatusBadge } from "@/components/ui";

export default async function SubscribeSuccess({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { one, params } = await flashFrom(searchParams);
  const id = one(params.sub) ?? "";
  let sub = await prisma.subscription.findFirst({ where: { id, customerId: user.id } });

  // Mock-betaling: kunden er "betalt" når de lander her. Med Frisbii sker aktivering via webhook.
  if (sub && sub.status === "PENDING" && sub.provider === "mock") {
    sub = await prisma.subscription.update({ where: { id: sub.id }, data: { status: "ACTIVE", startedAt: new Date() } });
    await audit(user.id, "subscription.activate_mock", "Subscription", sub.id);
  }

  return (
    <div className="mx-auto max-w-xl text-center">
      <Flash />
      {!sub ? (
        <p>Abonnementet blev ikke fundet.</p>
      ) : sub.status === "ACTIVE" ? (
        <>
          <h1>Tak – dit abonnement er aktivt</h1>
          <p className="mt-3 text-slate-600">Du kan nu booke dit første møde.</p>
          <Link href="/book" className="btn mt-6">Book møde</Link>
        </>
      ) : (
        <>
          <h1>Vi afventer betalingsbekræftelse</h1>
          <p className="mt-3 text-slate-600">
            Status: <SubStatusBadge status={sub.status} />. Det kan tage et øjeblik, før betalingen er bekræftet. Opdater siden om lidt.
          </p>
          <Link href={`/subscribe/success?sub=${sub.id}`} className="btn-secondary mt-6">Opdater</Link>
        </>
      )}
    </div>
  );
}
