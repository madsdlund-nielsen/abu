import { getEnv } from "../env";
import { inmobileSendSms } from "./inmobile";
import { maskPhone, redactText } from "./redact";
import type { OutgoingSms, SendResult, SmsProvider } from "./types";

/** Kun til udvikling (forbudt i produktion). Logger en redigeret udgave; følsomme beskeder logges ikke. */
export class ConsoleSms implements SmsProvider {
  readonly name = "console" as const;
  constructor(private log: (line: string) => void = console.log) {}
  async send(m: OutgoingSms): Promise<SendResult> {
    const head = `[sms:console] Fra: ${m.from} · Til: ${maskPhone(m.to)}`;
    this.log(m.sensitive ? `${head} · (følsom besked – indholdet logges ikke)` : `\n${head}\n[sms:console] ${redactText(m.text)}\n[sms:console] ---\n`);
    return { providerMessageId: `console-${m.messageId}` };
  }
}

class InmobileSms implements SmsProvider {
  readonly name = "inmobile" as const;
  send(m: OutgoingSms) {
    return inmobileSendSms(m);
  }
}

let provider: SmsProvider | null = null;

export function getSms(): SmsProvider {
  if (!provider) provider = getEnv().SMS_PROVIDER === "inmobile" ? new InmobileSms() : new ConsoleSms();
  return provider;
}

/** 3-11 tegn: bogstaver og tal uden æøå/mellemrum (GSM-afsender), eller et internationalt nummer. */
export function validateSmsSender(value: string): string | null {
  const v = value.trim();
  if (/^\+?\d{6,15}$/.test(v)) return null;
  if (v.length < 3) return "Afsendernavnet skal være mindst 3 tegn.";
  if (v.length > 11) return "Afsendernavnet må højst være 11 tegn.";
  if (!/^[A-Za-z0-9]+$/.test(v)) return "Brug kun bogstaver (a-z) og tal, uden mellemrum, æ, ø og å.";
  return null;
}
