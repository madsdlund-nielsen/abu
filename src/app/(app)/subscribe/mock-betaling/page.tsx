import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { completeMockPaymentAction } from "@/app/actions/subscription";
import { type SP } from "@/components/flash";
import { requireRole } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEnv, isProductionEnv } from "@/lib/env";
import { formatDkk, frequencyLabel, vatBreakdown } from "@/lib/pricing";

export const metadata: Metadata = { title: "Testbetaling" };

/** Erstatter betalingsudbyderens side, når PAYMENT_PROVIDER=mock (findes ikke i produktion). */
export default async function MockPayment({ searchParams }: { searchParams: SP }) {
  if (getEnv().PAYMENT_PROVIDER !== "mock" || isProductionEnv()) notFound();
  const user = await requireRole("CUSTOMER");
  const p = await searchParams;
  const id = String(Array.isArray(p.sub) ? p.sub[0] : (p.sub ?? ""));
  const sub = await prisma.subscription.findFirst({ where: { id, customerId: user.id, status: "PENDING", provider: "mock" } });
  if (!sub) notFound();
  const vat = vatBreakdown(sub.monthlyPriceDkk);
  return (
    <div className="mx-auto max-w-xl">
      <span className="eyebrow">Testbetaling</span>
      <h1>Betaling (testtilstand)</h1>
      <div className="panel mt-space-4">
        <p className="callout text-sm" role="note">
          Der er ikke koblet en rigtig betalingsudbyder på (PAYMENT_PROVIDER=mock). Her ville kunden betale hos udbyderen. Ingen penge trækkes.
        </p>
        <dl className="mt-space-4 text-sm">
          <div className="flex justify-between"><dt className="text-muted">Frekvens</dt><dd>{frequencyLabel(sub.frequencyWeeks)}</dd></div>
          <div className="flex justify-between"><dt className="text-muted">Pr. måned ekskl. moms</dt><dd>{formatDkk(vat.exVat)}</dd></div>
          <div className="flex justify-between font-semibold text-navy"><dt>I alt pr. måned</dt><dd>{formatDkk(vat.incVat)}</dd></div>
        </dl>
        <form action={completeMockPaymentAction} className="mt-space-4 flex flex-wrap items-center justify-between gap-3">
          <input type="hidden" name="sub" value={sub.id} />
          <Link href={`/subscribe?err=${encodeURIComponent("Betalingen blev afbrudt.")}`} className="btn-secondary">Afbryd</Link>
          <button className="btn" type="submit" data-testid="mock-pay">Gennemfør testbetaling</button>
        </form>
      </div>
    </div>
  );
}
