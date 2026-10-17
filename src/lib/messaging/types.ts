export interface OutgoingEmail {
  to: string;
  toName?: string;
  subject: string;
  text: string;
  html?: string;
  /** Vores eget id (NotificationLog.id), sendes med så statuswebhooks kan matches */
  messageId?: string;
}

export interface OutgoingSms {
  /** E.164, fx +4520304050 */
  to: string;
  text: string;
  /** Afsendernavn (3-11 tegn) eller nummer */
  from: string;
  messageId: string;
}

export interface SendResult {
  /** Udbyderens id for beskeden, bruges til at matche statuswebhooks */
  providerMessageId: string;
}

export interface EmailProvider {
  readonly name: "console" | "smtp" | "inmobile";
  send(message: OutgoingEmail): Promise<SendResult>;
}

export interface SmsProvider {
  readonly name: "console" | "inmobile";
  send(message: OutgoingSms): Promise<SendResult>;
}
