import type { NotificationAudience, NotificationChannel, NotificationStatus } from "@prisma/client";

export interface CmsTemplate {
  id: string;
  key: string | null;
  channel: NotificationChannel;
  name: string;
  subject: string;
  body: string;
  active: boolean;
  /** Antal regler der bruger skabelonen */
  usedBy: number;
  /** Bruges af en låst (transaktionel) udløser – kan ikke slås fra eller slettes */
  locked: boolean;
  hasDefault: boolean;
}

export interface CmsRule {
  id: string;
  trigger: string;
  offsetMinutes: number;
  channel: NotificationChannel;
  templateId: string;
  audience: NotificationAudience;
  active: boolean;
  quietHours: boolean;
}

export interface CmsSettings {
  quietEnabled: boolean;
  quietStart: number;
  quietEnd: number;
  smsSender: string;
  logRetentionMonths: number;
  leadRetentionMonths: number;
}

export interface CmsProviders {
  email: string;
  sms: string;
  inmobileKey: boolean;
  appUrl: string;
}

export interface CmsLogRow {
  id: string;
  createdAt: string;
  scheduledFor: string;
  sentAt: string | null;
  status: NotificationStatus;
  channel: NotificationChannel;
  trigger: string;
  triggerLabel: string;
  templateKey: string;
  recipient: string;
  subject: string | null;
  preview: string | null;
  error: string | null;
  canResend: boolean;
}

export interface CmsLogFilter {
  status?: NotificationStatus | "";
  channel?: NotificationChannel | "";
  trigger?: string;
  q?: string;
}

export interface CmsLogPage {
  rows: CmsLogRow[];
  nextCursor: string | null;
}
