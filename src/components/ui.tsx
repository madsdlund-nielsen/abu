import type { MeetingStatus, SubscriptionStatus } from "@prisma/client";

const SUB: Record<SubscriptionStatus, [string, string]> = {
  PENDING: ["Afventer betaling", "bg-amber-100 text-amber-800"],
  ACTIVE: ["Aktivt", "bg-emerald-100 text-emerald-800"],
  PAST_DUE: ["Betaling mangler", "bg-red-100 text-red-800"],
  CANCELLED: ["Opsagt", "bg-slate-200 text-slate-700"],
};

const MEET: Record<MeetingStatus, [string, string]> = {
  BOOKED: ["Booket", "bg-sky-100 text-sky-800"],
  COMPLETED: ["Afholdt", "bg-emerald-100 text-emerald-800"],
  CANCELLED: ["Aflyst", "bg-slate-200 text-slate-700"],
};

export function SubStatusBadge({ status }: { status: SubscriptionStatus }) {
  const [label, cls] = SUB[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function MeetingStatusBadge({ status }: { status: MeetingStatus }) {
  const [label, cls] = MEET[status];
  return <span className={`badge ${cls}`}>{label}</span>;
}

export function Initials({ name, url }: { name: string; url?: string }) {
  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="h-12 w-12 rounded-full object-cover" referrerPolicy="no-referrer" />;
  }
  const initials = name
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("");
  return (
    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
      {initials}
    </span>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-sm text-slate-500">{children}</p>;
}
