import Link from "next/link";
import type { MeetingStatus } from "@prisma/client";
import { MeetingStatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/time";

export interface MeetingRow {
  id: string;
  startsAt: Date;
  status: MeetingStatus;
  who: string;
}

export function MeetingTable({ rows, whoLabel, hrefBase = "/meetings" }: { rows: MeetingRow[]; whoLabel: string; hrefBase?: string }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Tidspunkt</th>
            <th>{whoLabel}</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((m) => (
            <tr key={m.id}>
              <td className="whitespace-nowrap first-letter:uppercase">{formatDateTime(m.startsAt)}</td>
              <td>{m.who}</td>
              <td><MeetingStatusBadge status={m.status} /></td>
              <td className="text-right"><Link href={`${hrefBase}/${m.id}`}>Åbn</Link></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
