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

export { validateSmsSender } from "./sender";
