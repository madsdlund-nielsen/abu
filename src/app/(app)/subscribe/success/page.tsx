import Link from "next/link";
import { redirect } from "next/navigation";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { SubStatusBadge } from "@/components/ui";

/**
 * Landingsside efter betaling. Siden ændrer intet (ingen sideeffekter på GET): abonnementet aktiveres af den signerede
 * webhook fra betalingsudbyderen (eller af testbetalingen i mock-tilstand).
 */
export default async function SubscribeSuccess({ searchParams }: { searchParams: SP }) {
  const user = await requireRole("CUSTOMER");
  const { one, params } = await flashFrom(searchParams);
  const id = one(params.sub) ?? "";
  const sub = await prisma.subscription.findFirst({ where: { id, customerId: user.id } });

  if (sub?.status === "ACTIVE") {
    redirect("/dashboard?ok=" + encodeURIComponent("Velkommen! Dit abonnement er aktivt. Du kan nu booke dit første møde."));
  }

  return (
    <div className="mx-auto max-w-xl text-center">
      <Flash />
      {!sub ? (
        <p>Abonnementet blev ikke fundet.</p>
      ) : (
        <>
          <h1>Vi afventer betalingsbekræftelse</h1>
          <p className="mt-3 text-muted">
            Status: <SubStatusBadge status={sub.status} />. Det kan tage et øjeblik, før betalingen er bekræftet. Opdater siden om lidt.
          </p>
          <Link href={`/subscribe/success?sub=${sub.id}`} className="btn-secondary mt-6">Opdater</Link>
        </>
      )}
    </div>
  );
}
