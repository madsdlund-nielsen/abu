import type { NotificationChannel, NotificationStatus } from "@prisma/client";

export const STATUS_LABEL: Record<NotificationStatus, string> = {
  QUEUED: "Planlagt",
  SENT: "Sendt",
  DELIVERED: "Leveret",
  FAILED: "Fejlet",
  SKIPPED: "Sprunget over",
};

const STATUS_CLASS: Record<NotificationStatus, string> = {
  QUEUED: "badge-outline",
  SENT: "badge-navy",
  DELIVERED: "badge-navy",
  FAILED: "badge-danger",
  SKIPPED: "badge-muted",
};

export function StatusBadge({ status }: { status: NotificationStatus }) {
  return (
    <span className={`badge ${STATUS_CLASS[status]}`}>
      {status === "DELIVERED" && <span aria-hidden="true" className="mr-1">✓</span>}
      {STATUS_LABEL[status]}
    </span>
  );
}

export function ChannelBadge({ channel }: { channel: NotificationChannel }) {
  return <span className={`badge ${channel === "SMS" ? "badge-gold" : "badge-outline"}`}>{channel === "SMS" ? "SMS" : "E-mail"}</span>;
}

export type Tab = "regler" | "skabeloner" | "log" | "indstillinger";

export const TABS: { id: Tab; label: string }[] = [
  { id: "regler", label: "Regler" },
  { id: "skabeloner", label: "Skabeloner" },
  { id: "log", label: "Log" },
  { id: "indstillinger", label: "Indstillinger" },
];
