import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cancelMeetingAction, retryRecordingAction } from "@/app/actions/meetings";
import { Flash, flashFrom, type SP } from "@/components/flash";
import { AutoRefresh, JoinCountdown } from "@/components/join-countdown";
import { RecordingUpload } from "@/components/recording-upload";
import { UPLOAD_TTL_SECONDS } from "@/lib/recording-upload";
import { RoomEmbed } from "@/components/room-embed";
import { LeadLabel, MeetingStatusBadge } from "@/components/ui";
import Link from "next/link";
import { canAccessMeeting } from "@/lib/access";
import { hasRecordingConsent } from "@/lib/consent";
import { joinEarlyMinutes, joinOpensAt, meetingJoinState } from "@/lib/meeting-join";
import { recordingUploadDecision } from "@/lib/meeting-status";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { LATE_CANCEL_HOURS } from "@/lib/quota";
import { formatDateTime, formatTime } from "@/lib/time";
import { MOCK_ROOM_PREFIX } from "@/lib/video/mock";
import type { TranscriptSegment } from "@/lib/transcription/types";

export const metadata: Metadata = { title: "Møde" };

const REC_LABEL = { UPLOADING: "Uploades …", RECEIVED: "Modtaget", TRANSCRIBING: "Transskriberer …", DONE: "Færdig", FAILED: "Fejlet" } as const;

export default async function MeetingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: SP }) {
  const user = await requireUser();
  const { id } = await params;
  const { ok, err } = await flashFrom(searchParams);
  const meeting = await prisma.meeting.findUnique({
    where: { id },
    include: {
      participants: { include: { user: true } },
      subscription: { include: { customer: { include: { user: true } }, advisors: { where: { isLead: true }, include: { advisor: { include: { user: { select: { name: true } } } } } } } },
      recordings: { orderBy: { createdAt: "desc" } },
      transcript: true,
    },
  });
  if (!meeting || !canAccessMeeting(user, meeting.participants.map((p) => p.userId))) notFound();

  const uploadDecision = recordingUploadDecision(meeting, new Date());
  const isStaff = user.role === "ADMIN" || user.role === "ADVISOR";
  const leadRow = meeting.subscription.advisors[0];
  const leadId = leadRow?.advisorId ?? null;
  const leadName = leadRow?.advisor.user.name ?? null;
  const canCancel =
    meeting.status === "BOOKED" &&
    meeting.startsAt > new Date() &&
    (user.role === "ADMIN" || meeting.subscription.customerId === user.id);
  const now = new Date();
  const join = meetingJoinState(meeting, now);
  const opensAt = joinOpensAt(meeting, joinEarlyMinutes());
  const roomUrl = isStaff ? (meeting.hostRoomUrl ?? meeting.roomUrl) : meeting.roomUrl;
  const processing = meeting.recordings.some((r) => r.status === "RECEIVED" || r.status === "TRANSCRIBING");
  // Kun uploads fra den sidste time tæller (en afbrudt upload må ikke skjule formularen, til oprydningen kører)
  const uploading = meeting.recordings.some((r) => r.status === "UPLOADING" && r.createdAt.getTime() > now.getTime() - UPLOAD_TTL_SECONDS * 1000);
  // Upload-formularen skjules, når der allerede er en transskription eller en optagelse undervejs (plan #23)
  const showUpload = uploadDecision.allowed && !meeting.transcript && !processing && !uploading;
  const consented = hasRecordingConsent(user);
  // Et møde, hvis tid er gået, vises som afholdt, også før jobkøen har opdateret statussen
  const shownStatus = join === "ended" && meeting.status === "BOOKED" ? "COMPLETED" : meeting.status;
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
        <MeetingStatusBadge status={shownStatus} />
      </div>
      <Flash ok={ok} err={err} />

      <section className="card">
        <h2>Deltagere</h2>
        <ul className="mt-3 space-y-1 text-sm">
          <li><span className="text-muted">Kunde:</span> {meeting.subscription.customer.user.name}, {meeting.subscription.customer.companyName}</li>
          <li><span className="text-muted">Rådgivere (hele boardet):</span> {advisors.map((a) => a.user.name).join(", ")}</li>
          <li data-testid="meeting-lead">
            {leadId === user.id ? (
              <span className="font-semibold text-navy">Du er ansvarlig rådgiver for dette board.</span>
            ) : (
              <LeadLabel prefix name={leadName} />
            )}
          </li>
        </ul>
        <p className="mt-2 text-xs text-muted">Møderne holdes altid med hele boardet. Kan en rådgiver ikke deltage, finder vi en afløser.</p>
      </section>

      {user.role === "ADMIN" && (
        <p className="text-sm"><Link href={`/admin/meetings/${meeting.id}`}>Administrer mødet (udskift rådgiver, flyt, aflys på kundens vegne)</Link></p>
      )}

      {join === "not_open_yet" && (
        <section className="card" data-testid="join-not-open" data-state="not_open_yet">
          <span className="eyebrow">Videomøde</span>
          <h2 className="text-xl font-light">Mødet er ikke åbnet endnu</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <div className="mt-space-3">
            <JoinCountdown opensAtIso={opensAt.toISOString()} opensAtLabel={formatTime(opensAt)} />
          </div>
          <p className="mt-space-3 text-sm text-muted">Mødet optages og transskriberes automatisk.</p>
        </section>
      )}

      {join === "open" && (
        <section className="card" data-testid="join-open" data-state="open">
          <span className="eyebrow">Videomøde</span>
          <h2 className="text-xl font-light">Mødet er åbent</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <p className="mt-space-3 text-sm text-muted" data-testid="recording-info">Mødet optages og transskriberes automatisk.</p>
          <div className="mt-space-3">
            {!consented ? (
              <div className="callout callout-error text-sm" role="alert" data-testid="consent-missing">
                <p className="font-semibold">Du skal give samtykke til optagelse, før du kan deltage.</p>
                <p className="mt-1 text-ink">Vi har ikke registreret dit samtykke til, at møder optages og transskriberes. Det tager et øjeblik.</p>
                <Link className="btn mt-3" href={`/samtykke?next=${encodeURIComponent(`/meetings/${meeting.id}`)}`}>Giv samtykke</Link>
              </div>
            ) : roomUrl ? (
              <RoomEmbed url={roomUrl} mock={roomUrl.startsWith(MOCK_ROOM_PREFIX)} staff={isStaff} />
            ) : (
              <p className="text-sm text-muted">Videorummet er ikke klar. Prøv igen om lidt.</p>
            )}
          </div>
        </section>
      )}

      {join === "ended" && (
        <section className="card" data-testid="join-ended" data-state="ended">
          <span className="eyebrow">Afholdt</span>
          <h2 className="text-xl font-light">Mødet er afholdt</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <p className="mt-space-3 text-sm text-muted" data-testid="ended-note">
            {meeting.transcript
              ? "Resumé og transskription finder du herunder."
              : processing
                ? "Transskription behandles. Siden opdateres automatisk, når den er klar."
                : "Resumé og transskription foreligger, når optagelsen er modtaget og behandlet."}
          </p>
          {processing && !meeting.transcript && (
            <>
              <p className="mt-2 text-sm font-semibold text-navy" data-testid="processing">Transskription behandles …</p>
              <AutoRefresh seconds={10} />
            </>
          )}
        </section>
      )}

      {join === "cancelled" && (
        <section className="card" data-testid="join-cancelled" data-state="cancelled">
          <span className="eyebrow">Aflyst</span>
          <h2 className="text-xl font-light">Mødet er aflyst</h2>
          <span className="rule-gold mt-3" aria-hidden="true" />
          <p className="mt-space-3 text-sm text-muted">
            {meeting.cancelledAt ? `Aflyst ${formatDateTime(meeting.cancelledAt)}. ` : ""}Der er ikke noget videomøde til dette tidspunkt.
          </p>
        </section>
      )}

      {canCancel && (
        <section className="card">
          <h2>Aflys møde</h2>
          <p className="mt-2 text-sm text-muted">
            Aflysning mindst {LATE_CANCEL_HOURS} timer før start frigiver mødet, så du kan booke et nyt. Senere aflysning tæller som afholdt.
          </p>
          <form action={cancelMeetingAction} className="mt-3" data-confirm="Vil du aflyse mødet?">
            <input type="hidden" name="meetingId" value={meeting.id} />
            <button className="btn-danger" type="submit">Aflys mødet</button>
          </form>
        </section>
      )}

      {(join === "ended" || meeting.transcript) && (
      <section className="card">
        <h2>Resumé</h2>
        {meeting.transcript?.summary ? (
          <div className="mt-3 whitespace-pre-wrap text-sm leading-6">{meeting.transcript.summary}</div>
        ) : (
          <p className="mt-2 text-sm text-muted">Resumé foreligger, når mødet er afholdt og optagelsen er transskriberet.</p>
        )}
      </section>
      )}

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
          {showUpload ? (
            <>
              <p className="mt-4 text-sm text-muted">
                Mangler den automatiske optagelse? Upload en lyd- eller videofil, så transskriberes den på samme måde.
              </p>
              <RecordingUpload meetingId={meeting.id} />
            </>
          ) : meeting.transcript ? (
            <>
              <p className="mt-4 text-sm text-muted" data-testid="upload-hidden">Transskriptionen er færdig, så der skal ikke uploades en optagelse.</p>
              {user.role === "ADMIN" && uploadDecision.allowed && (
                <details className="mt-3">
                  <summary className="text-sm text-navy">Erstat transskriptionen med en ny optagelse</summary>
                  <RecordingUpload meetingId={meeting.id} />
                </details>
              )}
            </>
          ) : processing || uploading ? (
            <p className="mt-4 text-sm text-muted" data-testid="upload-hidden">Optagelsen behandles. Siden opdateres, når transskriptionen er klar.</p>
          ) : (
            <p className="callout mt-4 text-sm" data-testid="upload-disabled">
              {meeting.status !== "CANCELLED" && meeting.startsAt > new Date()
                ? `Upload af optagelse er først muligt, når mødet er startet (${formatDateTime(meeting.startsAt)}). Før da findes der ingen optagelse at transskribere.`
                : !uploadDecision.allowed
                  ? uploadDecision.reason
                  : ""}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
