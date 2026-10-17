import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "../env";
import type { CreateRoomInput, CreatedRoom, RecordingEvent, VideoProvider } from "./types";

/**
 * Whereby Embedded. Felter og webhook-format er skrevet efter dokumentationen som vi husker den
 * og SKAL verificeres mod en rigtig konto (se README/OPEN_ITEMS).
 */
export class WherebyVideo implements VideoProvider {
  readonly name = "whereby" as const;

  async createMeeting(input: CreateRoomInput): Promise<CreatedRoom> {
    const env = getEnv();
    const body: Record<string, unknown> = {
      isLocked: false,
      roomNamePrefix: "abu",
      roomMode: "group",
      startDate: input.startsAt.toISOString(),
      // Rummet er gyldigt til 1 time efter planlagt slut
      endDate: new Date(input.endsAt.getTime() + 3_600_000).toISOString(),
      fields: ["hostRoomUrl"],
    };
    if (env.WHEREBY_RECORDING_BUCKET) {
      body.recording = {
        type: "cloud",
        startTrigger: "automatic",
        destination: {
          provider: "s3",
          bucket: env.WHEREBY_RECORDING_BUCKET,
          accessKeyId: env.WHEREBY_RECORDING_ACCESS_KEY_ID,
          accessKeySecret: env.WHEREBY_RECORDING_SECRET_ACCESS_KEY,
          fileFormat: "mp4",
        },
      };
    }
    const res = await fetch(`${env.WHEREBY_API_URL}/meetings`, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.WHEREBY_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Whereby fejlede (${res.status}): ${(await res.text()).slice(0, 500)}`);
    const json = (await res.json()) as { meetingId: string; roomUrl: string; hostRoomUrl: string };
    return { roomUrl: json.roomUrl, hostRoomUrl: json.hostRoomUrl, providerMeetingId: String(json.meetingId) };
  }

  async deleteMeeting(providerMeetingId: string) {
    const env = getEnv();
    const res = await fetch(`${env.WHEREBY_API_URL}/meetings/${encodeURIComponent(providerMeetingId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${env.WHEREBY_API_KEY}` },
    });
    if (!res.ok && res.status !== 404) throw new Error(`Whereby sletning fejlede (${res.status})`);
  }

  /** Header: `Whereby-Signature: t=<ts>,v1=<hex hmac sha256 af "<ts>.<body>">` */
  parseWebhook(rawBody: string, headers: Headers): RecordingEvent | null {
    const secret = getEnv().WHEREBY_WEBHOOK_SECRET;
    if (!verifyWherebySignature(rawBody, headers.get("whereby-signature") ?? "", secret)) {
      throw new Error("Ugyldig webhook-signatur");
    }
    const evt = JSON.parse(rawBody) as {
      type?: string;
      data?: { meetingId?: string; s3Key?: string; key?: string; filename?: string };
    };
    if (evt.type !== "recording.finished" && evt.type !== "recording.ready") return null;
    const key = evt.data?.s3Key ?? evt.data?.key ?? evt.data?.filename;
    if (!evt.data?.meetingId || !key) return null;
    return { providerMeetingId: String(evt.data.meetingId), storageKey: key, mime: "video/mp4" };
  }
}

export function verifyWherebySignature(rawBody: string, header: string, secret: string): boolean {
  if (!secret || !header) return false;
  const parts = Object.fromEntries(header.split(",").map((p) => p.trim().split("=") as [string, string]));
  if (!parts.t || !parts.v1) return false;
  const expected = Buffer.from(createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex"));
  const given = Buffer.from(parts.v1);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
