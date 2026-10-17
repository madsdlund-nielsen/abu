import nodemailer from "nodemailer";
import { getEnv } from "../env";
import { inmobileSendEmail } from "./inmobile";
import { maskEmail, redactText } from "./redact";
import type { EmailProvider, OutgoingEmail, SendResult } from "./types";

/**
 * Kun til udvikling (forbudt i produktion af opstarts-guarden). Skriver en redigeret udgave til loggen: links uden
 * forespørgsel/tokens, maskerede adresser og numre. Følsomme beskeder (engangslinks) logges slet ikke.
 */
export class ConsoleEmail implements EmailProvider {
  readonly name = "console" as const;
  constructor(private log: (line: string) => void = console.log) {}
  async send(m: OutgoingEmail): Promise<SendResult> {
    const head = `[email:console] Til: ${maskEmail(m.to)} · Emne: ${redactText(m.subject)}`;
    this.log(m.sensitive ? `${head} · (følsom besked med engangslink – indholdet logges ikke)` : `\n${head}\n${redactText(m.text)}\n[email:console] ---\n`);
    return { providerMessageId: `console-${m.messageId ?? Date.now()}` };
  }
}

class SmtpEmail implements EmailProvider {
  readonly name = "smtp" as const;
  private transport = (() => {
    const env = getEnv();
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  })();

  async send(m: OutgoingEmail): Promise<SendResult> {
    const info = await this.transport.sendMail({
      from: getEnv().EMAIL_FROM,
      to: m.toName ? { name: m.toName, address: m.to } : m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
    return { providerMessageId: String(info.messageId ?? "") };
  }
}

class InmobileEmail implements EmailProvider {
  readonly name = "inmobile" as const;
  send(m: OutgoingEmail) {
    return inmobileSendEmail(m);
  }
}

let provider: EmailProvider | null = null;

export function getEmail(): EmailProvider {
  if (!provider) {
    const p = getEnv().EMAIL_PROVIDER;
    provider = p === "smtp" ? new SmtpEmail() : p === "inmobile" ? new InmobileEmail() : new ConsoleEmail();
  }
  return provider;
}
