export interface CreateRoomInput {
  startsAt: Date;
  endsAt: Date;
  /** Vises i evt. udbyder-UI */
  title: string;
}

export interface CreatedRoom {
  roomUrl: string;
  hostRoomUrl: string;
  providerMeetingId: string;
}

export interface RecordingEvent {
  providerMeetingId: string;
  /** Nøgle i den S3-bucket udbyderen skriver optagelsen til */
  storageKey: string;
  mime: string;
}

export interface VideoProvider {
  readonly name: "mock" | "whereby";
  createMeeting(input: CreateRoomInput): Promise<CreatedRoom>;
  deleteMeeting(providerMeetingId: string): Promise<void>;
  /** Verificerer og fortolker en webhook. Returnerer null hvis begivenheden ikke er en færdig optagelse. */
  parseWebhook(rawBody: string, headers: Headers): RecordingEvent | null;
}
