import nodemailer from "nodemailer";
import { getEnv } from "../env";
import type { EmailMessage, EmailProvider } from "./types";

class ConsoleEmail implements EmailProvider {
  async send(m: EmailMessage) {
    console.log(
      `\n[email:console] Til: ${m.to}\n[email:console] Emne: ${m.subject}\n${m.text}\n[email:console] ---\n`,
    );
  }
}

class SmtpEmail implements EmailProvider {
  private transport = (() => {
    const env = getEnv();
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
    });
  })();

  async send(m: EmailMessage) {
    await this.transport.sendMail({
      from: getEnv().EMAIL_FROM,
      to: m.to,
      subject: m.subject,
      text: m.text,
      html: m.html,
    });
  }
}

let provider: EmailProvider | null = null;

export function getEmail(): EmailProvider {
  if (!provider) provider = getEnv().EMAIL_PROVIDER === "smtp" ? new SmtpEmail() : new ConsoleEmail();
  return provider;
}

/** Sender mail uden at lade fejl vælte kaldeaftalen; logger fejl. */
export async function sendEmailSafe(m: EmailMessage): Promise<boolean> {
  try {
    await getEmail().send(m);
    return true;
  } catch (e) {
    console.error("[email] kunne ikke sende mail", e);
    return false;
  }
}
