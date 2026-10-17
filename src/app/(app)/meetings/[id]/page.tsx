import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cancelMeetingAction, retryRecordingAction, uploadRecordingAction } from "@/app/actions/meetings";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { RoomEmbed } from "@/components/room-embed";
import { MeetingStatusBadge } from "@/components/ui";
import { canAccessMeeting } from "@/lib/access";
import { recordingUploadDecision } from "@/lib/meeting-status";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LATE_CANCEL_HOURS } from "@/lib/quota";
import { formatDateTime, formatTime } from "@/lib/time";
import { MOCK_ROOM_PREFIX } from "@/lib/video/mock";
import type { TranscriptSegment } from "@/lib/transcription/types";

export const metadata: Metadata = { title: "Møde" };

const REC_LABEL = { RECEIVED: "Modtaget", TRANSCRIBING: "Transskriberer …", DONE: "Færdig", FAILED: "Fejlet" } as const;

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const user = await requireUser();
  const { id } = await params;
  const { ok, err } = await flashFrom(searchParams);
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      participants: { include: { user: true } },
      subscription: { include: { customer: { include: { user: true } } } },
      recordings: { orderBy: { createdAt: "desc" } },
      transcript: true,
    },
  });
  if (!meeting || !canAccessMeeting(user, meeting.participants.map((p) => p.userId))) notFound();

  const uploadDecision = recordingUploadDecision(meeting, new Date());
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";
  const canCancel =
    meeting.status === "BOOKED" &&
    meeting.startsAt > new Date() &&
    (user.role === "ADMIN" || meeting.subscription.customerId === user.id);
  const roomUrl = isStaff ? (meeting.hostRoomUrl ?? meeting.roomUrl) : meeting.roomUrl;
  const advisors = meeting.participants.filter((p) => p.user.role === "ADVISOR");

  if (meeting.transcript) await audit(user.id, "transcript.view", "Transcript", meeting.transcript.id);
  const segments = (meeting.transcript?.segments as TranscriptSegment[] | null) ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="first-letter:uppercase">{formatDateTime(meeting.startsAt)}</h1>
          <p className="mt-1 text-sm text-muted">
            Varighed: {formatTime(meeting.startsAt)}–{formatTime(meeting.endsAt)} · {meeting.subscription.customer.companyName}
          </p>
        </div>
        <MeetingStatusBadge status={meeting.status} />
      </div>
      <Flash ok={ok} err={err} />

      <section className="card">
        <h2>Deltagere</h2>
        <ul className="mt-3 space-y-1 text-sm">
          <li><span className="text-muted">Kunde:</span> {meeting.subscription.customer.user.name}, {meeting.subscription.customer.companyName}</li>
          <li><span className="text-muted">Rådgivere:</span> {advisors.map((a) => a.user.name).join(", ")}</li>
        </ul>
      </section>

      {meeting.status !== "CANCELLED" && roomUrl && (
        <section className="card">
          <h2>Videomøde</h2>
          <div className="mt-4">
            <RoomEmbed url={roomUrl} mock={roomUrl.startsWith(MOCK_ROOM_PREFIX)} />
          </div>
        </section>
      )}

      {canCancel && (
        <section className="card">
          <h2>Aflys møde</h2>
          <p className="mt-2 text-sm text-muted">
            Aflysning mindst {LATE_CANCEL_HOURS} timer før start frigiver mødet, så du kan booke et nyt. Senere aflysning tæller som afholdt.
          </p>
          <form action={cancelMeetingAction} className="mt-3">
            <input type="hidden" name="meetingId" value={meeting.id} />
            <button className="btn-danger" type="submit">Aflys mødet</button>
          </form>
        </section>
      )}

      <section className="card">
        <h2>Resumé</h2>
        {meeting.transcript?.summary ? (
          <div className="mt-3 whitespace-pre-wrap text-sm leading-6">{meeting.transcript.summary}</div>
        ) : (
          <p className="mt-2 text-sm text-muted">Resumé foreligger, når mødet er afholdt og optagelsen er transskriberet.</p>
        )}
      </section>

      {meeting.transcript && (
        <section className="card">
          <h2>Transskription</h2>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-navy">Vis hele transskriptionen</summary>
            {segments.length > 0 ? (
              <ol className="mt-3 space-y-2 text-sm">
                {segments.map((s, i) => (
                  <li key={i} className="flex gap-3">
                    <span className="w-12 shrink-0 tabular-nums text-muted">
                      {String(Math.floor(s.start / 60)).padStart(2, "0")}:{String(Math.floor(s.start % 60)).padStart(2, "0")}
                    </span>
                    <span>{s.text}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="mt-3 whitespace-pre-wrap text-sm">{meeting.transcript.text}</p>
            )}
          </details>
        </section>
      )}

      {isStaff && (
        <section className="card">
          <h2>Optagelser</h2>
          {meeting.recordings.length > 0 && (
            <ul className="mt-3 space-y-2 text-sm">
              {meeting.recordings.map((r) => (
                <li key={r.id} className="flex flex-wrap items-center gap-2">
                  <span className="badge badge-muted">{r.source === "UPLOAD" ? "Uploadet" : "Fra videoudbyder"}</span>
                  <span>{REC_LABEL[r.status]}</span>
                  {r.error && <span className="text-danger">{r.error}</span>}
                  {r.status === "FAILED" && user.role === "ADMIN" && r.storageKey && (
                    <form action={retryRecordingAction}>
                      <input type="hidden" name="recordingId" value={r.id} />
                      <button className="btn-secondary btn-sm" type="submit">Prøv igen</button>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          {uploadDecision.allowed ? (
            <>
              <p className="mt-4 text-sm text-muted">
                Mangler den automatiske optagelse? Upload en lyd- eller videofil, så transskriberes den på samme måde.
              </p>
              <form action={uploadRecordingAction} className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
                <input type="hidden" name="meetingId" value={meeting.id} />
                <input type="file" name="file" accept="audio/*,video/*" required className="text-sm" />
                <button className="btn" type="submit">Upload og transskriber</button>
              </form>
            </>
          ) : (
            <p className="callout mt-4 text-sm" data-testid="upload-disabled">
              {meeting.status !== "CANCELLED" && meeting.startsAt > new Date()
                ? `Upload af optagelse er først muligt, når mødet er startet (${formatDateTime(meeting.startsAt)}). Før da findes der ingen optagelse at transskribere.`
                : uploadDecision.reason}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
