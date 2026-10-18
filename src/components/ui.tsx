import type { MeetingStatus, SubscriptionStatus } from "@prisma/client";

const SUB: Record<SubscriptionStatus, [string, string]> = {
  PENDING: ["Afventer betaling", "badge-gold"],
  ACTIVE: ["Aktivt", "badge-navy"],
  PAST_DUE: ["Betaling mangler", "badge-danger"],
  CANCELLED: ["Opsagt", "badge-muted"],
};

const MEET: Record<MeetingStatus, [string, string]> = {
  BOOKED: ["Booket", "badge-outline"],
  COMPLETED: ["Afholdt", "badge-navy"],
  CANCELLED: ["Aflyst", "badge-muted"],
};

export function SubStatusBadge({ status }: { status: SubscriptionStatus }) {
  const [label, cls] = SUB[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const [label, cls] = MEET[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

/** Tom tilstand: firkantet panel med stiplet kant, rolig tekst. */
export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border border-dashed border-slate bg-white p-space-5 text-center text-muted">{children}</p>;
}

/** «Ansvarlig rådgiver: navn» med guldstreg (kunde-, rådgiver- og admin-sider). */
export function LeadLabel({ name, prefix = false }: { name?: string | null; prefix?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm" data-testid="lead-label">
      <span aria-hidden="true" className="inline-block h-0.5 w-4 bg-gold" />
      {prefix && <span className="text-muted">Ansvarlig rådgiver:</span>}
      <span className="font-semibold text-navy">{name ?? "Tildeles snarest"}</span>
    </span>
  );
}
