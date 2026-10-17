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
  /**
   * En ny eller udskiftet rådgiver skal have værtsadgang til det eksisterende rum. Mock: rummet er det samme, så der er
   * intet at opdatere. Whereby: rummet genbruges, og `hostRoomUrl` deles med de rådgivere, der er deltagere (ingen API-kald).
   */
  grantHostAccess(providerMeetingId: string | null, hostRoomUrl: string | null): Promise<{ hostRoomUrl: string | null }>;
  createMeeting(input: CreateRoomInput): Promise<CreatedRoom>;
  deleteMeeting(providerMeetingId: string): Promise<void>;
  /** Verificerer og fortolker en webhook. Returnerer null hvis begivenheden ikke er en færdig optagelse. */
  parseWebhook(rawBody: string, headers: Headers): RecordingEvent | null;
}
