import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SubStatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import type { CompanyInfo } from "@/lib/cvr/types";
import type { TestSnapshot } from "@/lib/onboarding/snapshot";
import { formatDkk, frequencyLabel } from "@/lib/pricing";
import { formatDate } from "@/lib/time";

export const metadata: Metadata = { title: "Kunde" };

export default async function AdminCustomer({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await prisma.customerProfile.findUnique({
    where: { userId: id },
    include: {
      user: true,
      subscriptions: { orderBy: { createdAt: "desc" }, include: { advisors: { include: { advisor: { include: { user: true } } } } } },
    },
  });
  if (!c) notFound();
  const cvr = c.cvrData as (Partial<CompanyInfo> & { manual?: boolean }) | null;
  const test = c.testAnswers as TestSnapshot | null;
  const rows: [string, string][] = cvr && !cvr.manual
    ? [
        ["Navn", cvr.name ?? ""],
        ["Adresse", [cvr.address, `${cvr.zip ?? ""} ${cvr.city ?? ""}`.trim()].filter(Boolean).join(", ")],
        ["Virksomhedsform", cvr.companyForm ?? ""],
        ["Branche", [cvr.industryCode, cvr.industryText].filter(Boolean).join(" · ")],
        ["Startdato", cvr.startDate ? formatDate(new Date(cvr.startDate)) : "Ukendt"],
        ["Antal ansatte", cvr.employees ?? "Ukendt"],
        ["Status", cvr.statusText ?? ""],
      ]
    : [["Navn", c.companyName], ["Adresse", c.address]];

  return (
    <div className="space-y-space-4">
      <div>
        <span className="eyebrow">Admin · Kunde</span>
        <h1>{c.companyName}</h1>
        <p className="mt-space-3 text-muted"><Link href="/admin/customers">← Alle kunder</Link></p>
      </div>

      <div className="grid gap-space-4 lg:grid-cols-2">
        <section className="card">
          <div className="flex items-center justify-between gap-3">
            <h2>Virksomhed (CVR {c.cvr})</h2>
            {c.cvrVerified ? <span className="badge badge-navy">Verificeret via CVR</span> : <span className="badge badge-gold">Ikke verificeret</span>}
          </div>
          <dl className="mt-3 divide-y divide-grey-bg text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>
            ))}
          </dl>
          {!c.cvrVerified && <p className="callout mt-3 text-sm">Navn og adresse er indtastet af kunden, fordi CVR-opslaget ikke kunne gennemføres.</p>}
        </section>

        <section className="card">
          <h2>Kontakt</h2>
          <dl className="mt-3 divide-y divide-grey-bg text-sm">
            <div className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]"><dt className="text-muted">Navn</dt><dd>{c.user.name}</dd></div>
            <div className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]"><dt className="text-muted">E-mail</dt><dd>{c.user.email}</dd></div>
            <div className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]"><dt className="text-muted">Telefon</dt><dd>{c.user.phone}</dd></div>
            <div className="grid gap-1 py-2 sm:grid-cols-[9rem_1fr]"><dt className="text-muted">Oprettet</dt><dd>{formatDate(c.user.createdAt)}</dd></div>
          </dl>
        </section>
      </div>

      <section className="card">
        <h2>Abonnementer</h2>
        {c.subscriptions.length === 0 ? <p className="mt-2 text-sm text-muted">Ingen abonnementer.</p> : (
          <ul className="mt-3 divide-y divide-grey-bg">
            {c.subscriptions.map((s) => (
              <li key={s.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-navy">{formatDkk(s.monthlyPriceDkk)} / md. ekskl. moms · {frequencyLabel(s.frequencyWeeks)}</p>
                  <SubStatusBadge status={s.status} />
                </div>
                <p className="text-muted">
                  {s.advisors.map((a) => `${a.advisor.user.name} (${formatDkk(a.pricePerMeetingDkk)})`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card" data-testid="test-answers">
        <h2>Testsvar fra onboarding</h2>
        {!test ? (
          <p className="mt-2 text-sm text-muted">Kunden har ikke taget onboarding-testen (oprettet før testen blev indført).</p>
        ) : (
          <div className="mt-3 grid gap-space-4 lg:grid-cols-[1.5fr_1fr]">
            <ol className="space-y-3 text-sm">
              {test.answers.map((q, i) => (
                <li key={q.questionId}>
                  <p className="font-semibold text-navy"><span className="text-muted">{i + 1}. </span>{q.question}</p>
                  <ul className="mt-1 list-disc pl-5 text-ink">
                    {q.answers.map((a) => <li key={a.answerId}>{a.text}</li>)}
                  </ul>
                </li>
              ))}
            </ol>
            <div className="text-sm">
              <p className="label">Beregnet behov</p>
              <ul className="space-y-1">
                {test.needs.map((n) => (
                  <li key={n.tagId} className="flex justify-between gap-3"><span>{n.tag}</span><span className="tabular-nums text-muted">{n.weight}</span></li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted">Taget {formatDate(new Date(test.takenAt))}. Forslaget bestod af {test.suggestionSize} rådgivere.</p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
