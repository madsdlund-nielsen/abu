"use client";

import { useMemo, useRef, useState } from "react";
import { createTemplateAction, deleteTemplateAction, restoreTemplateAction, sendTestAction, updateTemplateAction } from "@/app/actions/notifications";
import type { CmsProviders, CmsRule, CmsTemplate } from "@/lib/notifications/cms-types";
import { buildEmail } from "@/lib/notifications/email-layout";
import { renderTemplate, smsSegments, validateTemplate } from "@/lib/notifications/template";
import { KNOWN_VARIABLES, TRIGGERS, VARIABLES, isTriggerKey } from "@/lib/notifications/triggers";
import { ConfirmDialog, Switch, type Saver } from "../primitives";
import { ChannelBadge } from "./shared";

export function TemplatesTab({
  templates,
  setTemplates,
  rules,
  selectedId,
  setSelectedId,
  saver,
  providers,
  onOpenLog,
}: {
  templates: CmsTemplate[];
  setTemplates: React.Dispatch<React.SetStateAction<CmsTemplate[]>>;
  rules: CmsRule[];
  selectedId: string | null;
  setSelectedId: (id: string | null) => void;
  saver: Saver;
  providers: CmsProviders;
  onOpenLog: () => void;
}) {
  const [filter, setFilter] = useState<"ALL" | "EMAIL" | "SMS">("ALL");
  const [creating, setCreating] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<CmsTemplate | null>(null);
  const visible = templates.filter((t) => filter === "ALL" || t.channel === filter);
  const selected = templates.find((t) => t.id === selectedId) ?? null;

  const patch = (id: string, p: Partial<CmsTemplate>) => setTemplates((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));

  async function save(t: CmsTemplate, p: Partial<Pick<CmsTemplate, "name" | "subject" | "body" | "active">>) {
    const prev = t;
    patch(t.id, p);
    const r = await saver.run(() => updateTemplateAction(t.id, p));
    if (!r || !r.ok) patch(t.id, prev);
    return r;
  }

  return (
    <div className="grid items-start gap-space-4 lg:grid-cols-[260px_minmax(0,1fr)]">
      <section aria-labelledby="tlist" className="border border-grey-bg bg-white">
        <div className="border-b border-grey-bg px-4 py-3">
          <h2 id="tlist" className="!text-base !font-semibold">Skabeloner</h2>
          <div className="mt-2 inline-flex" role="radiogroup" aria-label="Filtrér efter kanal">
            {([["ALL", "Alle"], ["EMAIL", "E-mail"], ["SMS", "SMS"]] as const).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={filter === v} onClick={() => setFilter(v)}
                className={`border px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide first:border-r-0 last:border-l-0 ${filter === v ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"}`}>
                {l}
              </button>
            ))}
          </div>
        </div>
        <ul className="max-h-[70vh] divide-y divide-grey-bg overflow-y-auto">
          {visible.map((t) => {
            const on = t.id === selectedId;
            return (
              <li key={t.id}>
                <button type="button" onClick={() => setSelectedId(t.id)} aria-current={on ? "true" : undefined} data-testid="template-row" data-template={t.name}
                  className={`flex w-full flex-col gap-1 border-l-4 px-3 py-3 text-left ${on ? "border-gold bg-grey-bg" : "border-transparent hover:border-slate"}`}>
                  <span className="text-sm font-semibold leading-snug text-navy">{t.name}</span>
                  <span className="flex flex-wrap items-center gap-1">
                    <ChannelBadge channel={t.channel} />
                    <span className={`badge ${t.active ? "badge-navy" : "badge-muted"}`}>{t.active ? "Aktiv" : "Slået fra"}</span>
                    <span className="text-xs text-muted">{t.usedBy} {t.usedBy === 1 ? "regel" : "regler"}</span>
                  </span>
                </button>
              </li>
            );
          })}
          {visible.length === 0 && <li className="p-space-3 text-sm text-muted">Ingen skabeloner.</li>}
        </ul>
        <div className="border-t border-grey-bg p-3">
          {creating ? (
            <NewTemplateForm
              onCancel={() => setCreating(false)}
              onCreate={async (channel, name) => {
                const r = await saver.run(() => createTemplateAction({ channel, name }));
                if (r && r.ok) {
                  setTemplates((ts) => [...ts, r.template]);
                  setSelectedId(r.template.id);
                  setCreating(false);
                }
              }}
            />
          ) : (
            <button type="button" className="btn-secondary btn-sm w-full" onClick={() => setCreating(true)}>+ Ny skabelon</button>
          )}
        </div>
      </section>

      <section className="min-w-0">
        {selected ? (
          <TemplateEditor
            key={selected.id}
            template={selected}
            rules={rules}
            providers={providers}
            onSave={(p) => save(selected, p)}
            onAskDelete={() => setConfirmDelete(selected)}
            onRestore={async () => {
              const r = await saver.run(() => restoreTemplateAction(selected.id));
              if (r && r.ok) patch(selected.id, { subject: r.subject, body: r.body });
              return r && r.ok ? { subject: r.subject, body: r.body } : null;
            }}
            onOpenLog={onOpenLog}
          />
        ) : (
          <div className="border border-dashed border-slate bg-white p-space-5 text-center text-muted">Vælg en skabelon til venstre for at redigere den.</div>
        )}
      </section>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Slet skabelonen?"
        confirmLabel="Slet skabelon"
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const t = confirmDelete;
          setConfirmDelete(null);
          if (!t) return;
          const r = await saver.run(() => deleteTemplateAction(t.id));
          if (r && r.ok) {
            setTemplates((ts) => ts.filter((x) => x.id !== t.id));
            setSelectedId(templates.find((x) => x.id !== t.id)?.id ?? null);
          }
        }}
      >
        <p>«{confirmDelete?.name}» slettes permanent. Vil du blot undgå at bruge den, så slå den fra i stedet.</p>
      </ConfirmDialog>
    </div>
  );
}

function NewTemplateForm({ onCreate, onCancel }: { onCreate: (c: "EMAIL" | "SMS", name: string) => void | Promise<void>; onCancel: () => void }) {
  const [channel, setChannel] = useState<"EMAIL" | "SMS">("EMAIL");
  const [name, setName] = useState("");
  return (
    <form className="grid gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim().length >= 2) void onCreate(channel, name.trim()); }}>
      <select className="input !py-1.5 text-sm" value={channel} onChange={(e) => setChannel(e.target.value as "EMAIL" | "SMS")} aria-label="Kanal">
        <option value="EMAIL">E-mail</option>
        <option value="SMS">SMS</option>
      </select>
      <input className="input !py-1.5 text-sm" value={name} onChange={(e) => setName(e.target.value)} placeholder="Skabelonens navn" aria-label="Skabelonens navn" autoFocus onKeyDown={(e) => e.key === "Escape" && onCancel()} />
      <div className="flex gap-2">
        <button type="submit" className="btn btn-sm" disabled={name.trim().length < 2}>Opret</button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel}>Annullér</button>
      </div>
    </form>
  );
}

function TemplateEditor({
  template,
  rules,
  providers,
  onSave,
  onAskDelete,
  onRestore,
  onOpenLog,
}: {
  template: CmsTemplate;
  rules: CmsRule[];
  providers: CmsProviders;
  onSave: (p: Partial<Pick<CmsTemplate, "name" | "subject" | "body" | "active">>) => Promise<{ ok: boolean } | null>;
  onAskDelete: () => void;
  onRestore: () => Promise<{ subject: string; body: string } | null>;
  onOpenLog: () => void;
}) {
  const isSms = template.channel === "SMS";
  const [name, setName] = useState(template.name);
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const [serverError, setServerError] = useState<string | null>(null);
  const [lastField, setLastField] = useState<"subject" | "body">("body");
  const subjectRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [testTo, setTestTo] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Udløsere der bruger skabelonen → hvilke variabler er tilladt
  const usedTriggers = useMemo(() => [...new Set(rules.filter((r) => r.templateId === template.id).map((r) => r.trigger))].filter(isTriggerKey), [rules, template.id]);
  const allowed = useMemo(() => {
    if (usedTriggers.length === 0) return KNOWN_VARIABLES;
    return KNOWN_VARIABLES.filter((v) => usedTriggers.some((t) => TRIGGERS[t].variables.includes(v)));
  }, [usedTriggers]);

  const issues = validateTemplate({ channel: template.channel, name, subject, body }, undefined);
  const triggerIssues = usedTriggers.flatMap((t) => validateTemplate({ channel: template.channel, subject, body }, TRIGGERS[t].variables).map((i) => ({ ...i, trigger: TRIGGERS[t].label })));
  const bodyIssue = issues.find((i) => i.field === "body") ?? triggerIssues.find((i) => i.field === "body");
  const subjectIssue = issues.find((i) => i.field === "subject") ?? triggerIssues.find((i) => i.field === "subject");
  const nameIssue = issues.find((i) => i.field === "name");
  const blocking = issues.length > 0 || triggerIssues.length > 0;

  const sample = useMemo(() => {
    const base = providers.appUrl.replace(/\/$/, "");
    return Object.fromEntries(Object.entries(VARIABLES).map(([k, v]) => [k, v.sample.replace("{APP}", base)]));
  }, [providers.appUrl]);
  const renderedBody = renderTemplate(body, sample);
  const renderedSubject = renderTemplate(subject, sample);
  const smsRaw = smsSegments(body);
  const smsRendered = smsSegments(renderedBody);
  const html = useMemo(() => (isSms ? "" : buildEmail({ subject: renderedSubject || "Emne", bodyText: renderedBody, baseUrl: providers.appUrl }).html), [isSms, renderedSubject, renderedBody, providers.appUrl]);

  function insert(name: string) {
    const token = `{{${name}}}`;
    const field = isSms ? "body" : lastField;
    const el = field === "subject" ? subjectRef.current : bodyRef.current;
    const set = field === "subject" ? setSubject : setBody;
    const value = field === "subject" ? subject : body;
    const s = el?.selectionStart ?? value.length;
    const e = el?.selectionEnd ?? value.length;
    const next = value.slice(0, s) + token + value.slice(e);
    set(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(s + token.length, s + token.length);
    });
  }

  async function commit(p: Partial<Pick<CmsTemplate, "name" | "subject" | "body" | "active">>) {
    if (blocking && p.active !== false) return;
    setServerError(null);
    const r = await onSave(p);
    if (r && !r.ok && "error" in r) setServerError(String((r as { error: string }).error));
  }

  async function sendTest() {
    setTesting(true);
    setTestResult(null);
    const r = await sendTestAction({ channel: template.channel, subject, body, to: testTo, name: template.key ?? template.name });
    setTesting(false);
    setTestResult(r.ok ? { ok: true, text: `Testen er sendt til ${r.to} via ${r.adapter === "console" ? "konsol-adapteren (skrevet til serverloggen)" : r.adapter}. Se den i loggen.` } : { ok: false, text: r.error });
  }

  return (
    <div className="grid items-start gap-space-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,460px)]">
      <div className="border border-grey-bg bg-white p-space-3 sm:p-space-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <span className="eyebrow">Skabelon</span>
            <h2 className="text-xl font-light">Redigér tekst</h2>
          </div>
          <div className="flex items-center gap-3">
            <ChannelBadge channel={template.channel} />
            <Switch checked={template.active} onChange={(v) => commit({ active: v })} label="Skabelonen er aktiv" disabled={template.locked} />
            <span className="text-sm font-semibold text-navy">{template.active ? "Aktiv" : "Slået fra"}</span>
          </div>
        </div>
        <span className="rule-gold mt-3" aria-hidden="true" />
        <p className="mt-space-3 text-sm text-muted" data-testid="template-usage">
          {usedTriggers.length === 0
            ? "Bruges ikke af nogen regler endnu."
            : <>Bruges af: {usedTriggers.map((t) => TRIGGERS[t].label).join(", ")}{template.locked && " (transaktionel – kan ikke slås fra)"}.</>}
        </p>

        <div className="mt-space-4 grid gap-4">
          <div>
            <label className="label" htmlFor="t-name">Navn</label>
            <input id="t-name" className="input" value={name} maxLength={120} aria-invalid={nameIssue ? true : undefined}
              onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() !== template.name && !nameIssue && commit({ name: name.trim() })} />
            {nameIssue && <p className="mt-1 text-xs font-semibold text-danger" role="alert">{nameIssue.message}</p>}
          </div>
          {!isSms && (
            <div>
              <label className="label" htmlFor="t-subject">Emne</label>
              <input id="t-subject" ref={subjectRef} className={`input ${subjectIssue ? "!border-danger" : ""}`} value={subject} aria-invalid={subjectIssue ? true : undefined}
                onFocus={() => setLastField("subject")} onChange={(e) => setSubject(e.target.value)}
                onBlur={() => subject.trim() !== template.subject && commit({ subject })} />
              {subjectIssue && <p className="mt-1 text-xs font-semibold text-danger" role="alert" data-testid="subject-error">{subjectIssue.message}</p>}
            </div>
          )}
          <div>
            <label className="label" htmlFor="t-body">{isSms ? "SMS-tekst" : "Brødtekst"}</label>
            <textarea id="t-body" ref={bodyRef} className={`input ${isSms ? "min-h-28" : "min-h-72"} font-[inherit] ${bodyIssue ? "!border-danger" : ""}`} value={body}
              aria-invalid={bodyIssue ? true : undefined} aria-describedby="t-body-help"
              onFocus={() => setLastField("body")} onChange={(e) => setBody(e.target.value)}
              onBlur={() => body !== template.body && commit({ body })} />
            {bodyIssue && <p className="mt-1 text-xs font-semibold text-danger" role="alert" data-testid="body-error">{bodyIssue.message}</p>}
            <p id="t-body-help" className="mt-1 text-xs text-muted">Brug variabler som {"{{fornavn}}"}. Gemmes, når du forlader feltet.</p>
          </div>
          {isSms && (
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm" data-testid="sms-counter" aria-live="polite">
              <span><span className="font-semibold text-navy">{smsRaw.length}</span> tegn i skabelonen</span>
              <span>
                Eksempel udfyldt: <span className="font-semibold text-navy">{smsRendered.length}</span> tegn ·{" "}
                <span className={`font-semibold ${smsRendered.segments > 1 ? "text-gold-ink" : "text-navy"}`}>{smsRendered.segments} {smsRendered.segments === 1 ? "SMS" : "SMS-dele"}</span> ({smsRendered.encoding}, {smsRendered.remaining} tegn tilbage i sidste del)
              </span>
            </p>
          )}

          <div>
            <p className="label">Indsæt variabel</p>
            <ul className="flex flex-wrap gap-1" aria-label="Variabler">
              {allowed.map((v) => (
                <li key={v}>
                  <button type="button" onClick={() => insert(v)} className="badge badge-muted cursor-pointer normal-case tracking-normal hover:border-navy" title={VARIABLES[v].label} aria-label={`Indsæt ${VARIABLES[v].label} ({{${v}}})`}>
                    {`{{${v}}}`}
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">{usedTriggers.length ? "Viser de variabler, der findes for udløserne, skabelonen bruges af." : "Skabelonen bruges ikke endnu, så alle variabler vises."}</p>
          </div>

          {serverError && <p className="callout callout-error text-sm" role="alert">{serverError}</p>}
        </div>

        <div className="mt-space-4 flex flex-wrap items-center justify-between gap-3 border-t border-grey-bg pt-space-3">
          {template.hasDefault ? (
            <button type="button" className="btn-secondary btn-sm" onClick={async () => { const r = await onRestore(); if (r) { setSubject(r.subject); setBody(r.body); setServerError(null); } }}>Gendan standardtekst</button>
          ) : <span />}
          <button type="button" className="btn-danger btn-sm" onClick={onAskDelete} disabled={template.usedBy > 0} title={template.usedBy > 0 ? "Skabelonen bruges af regler" : undefined}>Slet skabelon</button>
        </div>
      </div>

      <div className="space-y-space-3 xl:sticky xl:top-6">
        <section className="border border-grey-bg bg-white" aria-label="Forhåndsvisning">
          <div className="border-b border-grey-bg px-4 py-3">
            <h3 className="!text-base !font-semibold">Forhåndsvisning</h3>
            <p className="text-xs text-muted">Med eksempeldata. {isSms ? "Sådan ser SMS'en ud." : "Sådan ser mailen ud."}</p>
          </div>
          <div className="bg-grey-bg p-3">
            {isSms ? (
              <div className="mx-auto max-w-[300px]" data-testid="sms-preview">
                <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">SMS</p>
                <div className="whitespace-pre-wrap break-words border border-slate bg-white p-3 text-sm text-ink">{renderedBody || <span className="text-muted">Tom tekst</span>}</div>
              </div>
            ) : (
              <>
                <p className="mb-2 text-xs"><span className="font-bold uppercase tracking-wide text-muted">Emne</span> <span className="font-semibold text-navy" data-testid="subject-preview">{renderedSubject}</span></p>
                <iframe title="Forhåndsvisning af e-mail" sandbox="" srcDoc={html} className="h-[620px] w-full border border-slate bg-white" data-testid="email-preview" />
              </>
            )}
          </div>
        </section>

        <section className="border border-grey-bg bg-white p-space-3" aria-label="Send test">
          <h3 className="!text-base !font-semibold">Send test til mig</h3>
          <p className="mt-1 text-xs text-muted">Sendes med eksempeldata via den rigtige afsender ({isSms ? providers.sms : providers.email}) og vises i loggen.</p>
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void sendTest(); }}>
            <input className="input !py-1.5 text-sm" type={isSms ? "tel" : "email"} value={testTo} onChange={(e) => setTestTo(e.target.value)}
              placeholder={isSms ? "Dit mobilnummer, fx 20 30 40 50" : "Din e-mailadresse"} aria-label={isSms ? "Mobilnummer til test" : "E-mailadresse til test"} required />
            <button type="submit" className="btn btn-sm shrink-0" disabled={testing || blocking} data-testid="send-test">{testing ? "Sender …" : "Send test"}</button>
          </form>
          {testResult && (
            <p className={`callout mt-2 text-sm ${testResult.ok ? "" : "callout-error"}`} role={testResult.ok ? "status" : "alert"} data-testid="test-result">
              {testResult.text} {testResult.ok && <button type="button" className="underline" onClick={onOpenLog}>Åbn loggen</button>}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
