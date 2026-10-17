import nodemailer from "nodemailer";
import { getEnv } from "../env";
import { inmobileSendEmail } from "./inmobile";
import type { EmailProvider, OutgoingEmail, SendResult } from "./types";

class ConsoleEmail implements EmailProvider {
  readonly name = "console" as const;
  async send(m: OutgoingEmail): Promise<SendResult> {
    console.log(`\n[email:console] Til: ${m.to}\n[email:console] Emne: ${m.subject}\n${m.text}\n[email:console] ---\n`);
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
