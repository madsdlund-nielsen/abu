"use client";

import { useState } from "react";
import { loadDefaultsAction, saveSettingsAction } from "@/app/actions/notifications";
import type { CmsProviders, CmsSettings } from "@/lib/notifications/cms-types";
import { validateSmsSender } from "@/lib/messaging/sms";
import { Switch, type Saver } from "../primitives";

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const hh = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function SettingsTab({
  initial,
  providers,
  saver,
}: {
  initial: CmsSettings;
  providers: CmsProviders;
  saver: Saver;
}) {
  const [s, setS] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [defaultsMsg, setDefaultsMsg] = useState<string | null>(null);
  const senderProblem = validateSmsSender(s.smsSender);

  async function commit(next: CmsSettings) {
    setS(next);
    setError(null);
    if (validateSmsSender(next.smsSender)) return;
    if (JSON.stringify(next) === JSON.stringify(saved)) return;
    const r = await saver.run(() => saveSettingsAction(next));
    if (r && r.ok) setSaved(next);
    else {
      setError(r && !r.ok ? r.error : "Indstillingerne kunne ikke gemmes.");
      setS(saved);
    }
  }

  const dry = providers.email === "console" || providers.sms === "console";

  return (
    <div className="grid items-start gap-space-4 lg:grid-cols-2">
      <section className="border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-labelledby="quiet-h">
        <span className="eyebrow">SMS</span>
        <h2 id="quiet-h" className="text-xl font-light">Stille timer og afsender</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <div className="mt-space-4 flex items-center gap-3">
          <Switch checked={s.quietEnabled} onChange={(v) => commit({ ...s, quietEnabled: v })} label="Brug stille timer for SMS" />
          <span className="text-sm font-semibold text-navy">{s.quietEnabled ? "Stille timer er slået til" : "Ingen stille timer"}</span>
        </div>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <div>
            <label className="label" htmlFor="q-start">Fra</label>
            <select id="q-start" className="input !w-auto" value={s.quietStart} disabled={!s.quietEnabled} onChange={(e) => commit({ ...s, quietStart: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="q-end">Til</label>
            <select id="q-end" className="input !w-auto" value={s.quietEnd} disabled={!s.quietEnabled} onChange={(e) => commit({ ...s, quietEnd: Number(e.target.value) })}>
              {HOURS.map((h) => <option key={h} value={h}>{hh(h)}</option>)}
            </select>
          </div>
        </div>
        <p className="mt-2 text-xs text-muted">SMS i reglerne med «Respektér stille timer» udsættes til efter de stille timer (København-tid). Påmindelser under 2 timer før mødet sendes altid.</p>

        <div className="mt-space-4">
          <label className="label" htmlFor="sms-sender">Afsendernavn til SMS</label>
          <input id="sms-sender" className={`input ${senderProblem ? "!border-danger" : ""}`} value={s.smsSender} maxLength={15} aria-invalid={senderProblem ? true : undefined}
            onChange={(e) => setS({ ...s, smsSender: e.target.value })} onBlur={() => commit(s)} />
          {senderProblem ? <p className="mt-1 text-xs font-semibold text-danger" role="alert">{senderProblem}</p> : <p className="mt-1 text-xs text-muted">3-11 tegn, kun bogstaver (a-z) og tal, fx «ABUnlimited». Et alfanumerisk navn kan ikke modtage svar.</p>}
        </div>
      </section>

      <section className="border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-labelledby="ret-h">
        <span className="eyebrow">GDPR</span>
        <h2 id="ret-h" className="text-xl font-light">Opbevaring</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <div className="mt-space-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="ret-log">Notifikationslog (måneder)</label>
            <input id="ret-log" className="input" type="number" min={1} max={60} value={s.logRetentionMonths}
              onChange={(e) => setS({ ...s, logRetentionMonths: Number(e.target.value) })} onBlur={() => commit(s)} />
            <p className="mt-1 text-xs text-muted">Ældre beskeder i loggen slettes automatisk.</p>
          </div>
          <div>
            <label className="label" htmlFor="ret-lead">Leads med samtykke (måneder)</label>
            <input id="ret-lead" className="input" type="number" min={1} max={60} value={s.leadRetentionMonths}
              onChange={(e) => setS({ ...s, leadRetentionMonths: Number(e.target.value) })} onBlur={() => commit(s)} />
            <p className="mt-1 text-xs text-muted">Regnet fra seneste aktivitet. Leads uden samtykke slettes, når tilmeldingen udløber.</p>
          </div>
        </div>
        {error && <p className="callout callout-error mt-space-3 text-sm" role="alert">{error}</p>}
      </section>

      <section className="border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-labelledby="prov-h">
        <span className="eyebrow">Afsendelse</span>
        <h2 id="prov-h" className="text-xl font-light">Leverandører</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <dl className="mt-space-3 divide-y divide-grey-bg text-sm">
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">E-mail (EMAIL_PROVIDER)</dt><dd className="font-semibold text-navy" data-testid="prov-email">{providers.email}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">SMS (SMS_PROVIDER)</dt><dd className="font-semibold text-navy" data-testid="prov-sms">{providers.sms}</dd></div>
          <div className="flex justify-between gap-3 py-2"><dt className="text-muted">inMobile API-nøgle</dt><dd className="font-semibold text-navy">{providers.inmobileKey ? "Sat" : "Ikke sat"}</dd></div>
        </dl>
        {dry && <p className="callout mt-space-3 text-sm">Afsenderen er sat til «console»: beskeder skrives til serverloggen og sendes ikke. Sæt <code>EMAIL_PROVIDER</code>/<code>SMS_PROVIDER</code> til <code>inmobile</code> i produktion.</p>}
        <p className="mt-2 text-xs text-muted">Leverandørerne sættes med miljøvariabler (se README), ikke her.</p>
      </section>

      <section className="border border-grey-bg bg-white p-space-3 sm:p-space-4" aria-labelledby="def-h">
        <span className="eyebrow">Standardtekster</span>
        <h2 id="def-h" className="text-xl font-light">Indlæs standardtekster</h2>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <p className="mt-space-3 text-sm text-muted">Opretter manglende danske standardskabeloner og standardregler for udløsere uden regler. Redigerede tekster og dine egne regler overskrives aldrig.</p>
        <button type="button" className="btn-secondary mt-3" onClick={async () => {
          const r = await saver.run(() => loadDefaultsAction());
          if (r && r.ok) {
            setDefaultsMsg(`${r.templates} nye skabeloner og ${r.rules} nye regler oprettet.`);
            if (r.templates + r.rules > 0) window.location.reload();
          }
        }}>Indlæs manglende standardtekster</button>
        {defaultsMsg && <p className="mt-2 text-sm text-muted" role="status">{defaultsMsg}</p>}
      </section>
    </div>
  );
}
