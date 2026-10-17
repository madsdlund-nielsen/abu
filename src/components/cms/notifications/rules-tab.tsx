"use client";

import { useEffect, useRef, useState } from "react";
import { createRuleAction, createTemplateAction, deleteRuleAction, updateRuleAction } from "@/app/actions/notifications";
import type { CmsRule, CmsTemplate } from "@/lib/notifications/cms-types";
import { validateTemplate } from "@/lib/notifications/template";
import { allowedDirections, anchorLabel, describeTiming, offsetToParts, partsToOffset, unitLabel, validateOffset, type TimingDirection, type TimingUnit } from "@/lib/notifications/timing";
import { AUDIENCE_LABEL, CHANNEL_LABEL, TRIGGERS, TRIGGER_GROUPS, type TriggerDef, type TriggerKey } from "@/lib/notifications/triggers";
import { ConfirmDialog, Switch, type Saver } from "../primitives";
import { ChannelBadge } from "./shared";

export function RulesTab({
  rules,
  setRules,
  templates,
  setTemplates,
  saver,
  quietEnabled,
  onOpenTemplate,
}: {
  rules: CmsRule[];
  setRules: React.Dispatch<React.SetStateAction<CmsRule[]>>;
  templates: CmsTemplate[];
  setTemplates: React.Dispatch<React.SetStateAction<CmsTemplate[]>>;
  saver: Saver;
  quietEnabled: boolean;
  onOpenTemplate: (id: string) => void;
}) {
  const [editing, setEditing] = useState<{ trigger: TriggerKey; rule: CmsRule | null } | null>(null);
  const [deleting, setDeleting] = useState<CmsRule | null>(null);
  const tpl = new Map(templates.map((t) => [t.id, t]));

  async function toggle(rule: CmsRule, active: boolean) {
    const prev = rules;
    setRules((rs) => rs.map((r) => (r.id === rule.id ? { ...r, active } : r)));
    const r = await saver.run(() => updateRuleAction(rule.id, { active }));
    if (!r || !r.ok) setRules(prev);
  }

  return (
    <div className="space-y-space-5">
      <p className="max-w-3xl text-muted">
        Her bestemmer du, hvornår en besked sendes, til hvem og med hvilken tekst. Tekster og kanaler redigeres under{" "}
        <span className="font-semibold text-navy">Skabeloner</span>. Transaktionelle beskeder (invitation og nulstilling af adgangskode) kan ikke slås fra.
      </p>
      {TRIGGER_GROUPS.map((group) => (
        <section key={group} aria-labelledby={`g-${group}`}>
          <h2 id={`g-${group}`} className="mb-space-3 text-xl font-light">{group}</h2>
          <div className="grid gap-space-3">
            {Object.values(TRIGGERS)
              .filter((t) => t.group === group)
              .map((def) => {
                const list = rules.filter((r) => r.trigger === def.key).sort((a, b) => a.offsetMinutes - b.offsetMinutes);
                return (
                  <article key={def.key} className="border border-grey-bg bg-white" data-testid="trigger-card" data-trigger={def.key}>
                    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-grey-bg px-4 py-3">
                      <div className="min-w-0 max-w-2xl">
                        <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold text-navy">
                          {def.label}
                          {def.locked && <span className="badge badge-outline">Kan ikke slås fra</span>}
                          {def.optIn && <span className="badge badge-gold">Kræver samtykke</span>}
                        </h3>
                        <p className="mt-1 text-sm text-muted">{def.description}</p>
                      </div>
                      <button type="button" className="btn-secondary btn-sm shrink-0" onClick={() => setEditing({ trigger: def.key, rule: null })} aria-label={`Ny regel for ${def.label}`}>
                        + Ny regel
                      </button>
                    </header>
                    {list.length === 0 ? (
                      <p className="px-4 py-3 text-sm text-muted">Ingen regler. Der sendes ingenting ved denne udløser.</p>
                    ) : (
                      <ul className="divide-y divide-grey-bg">
                        {list.map((r) => (
                          <li key={r.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${r.active ? "" : "bg-grey-bg/50"}`} data-testid="rule-row" data-rule={r.id}>
                            <Switch checked={r.active} onChange={(v) => toggle(r, v)} label={`${def.label}: ${describeTiming(def.timing, r.offsetMinutes)} (${CHANNEL_LABEL[r.channel]})`} disabled={def.locked} />
                            <ChannelBadge channel={r.channel} />
                            <span className="min-w-[10rem] flex-1 text-sm">
                              <span className="font-semibold text-navy">{describeTiming(def.timing, r.offsetMinutes)}</span>
                              <span className="text-muted"> · til {AUDIENCE_LABEL[r.audience].toLowerCase()}</span>
                              {r.quietHours && quietEnabled && <span className="ml-2 badge badge-muted">Stille timer</span>}
                            </span>
                            <button type="button" className="max-w-[16rem] truncate text-sm underline underline-offset-2 hover:text-gold-dark" onClick={() => onOpenTemplate(r.templateId)} title="Åbn skabelonen">
                              {tpl.get(r.templateId)?.name ?? "Skabelon"}
                              {tpl.get(r.templateId)?.active === false && " (slået fra)"}
                            </button>
                            <span className="flex gap-1">
                              <button type="button" className="px-2 py-1 text-sm text-muted hover:text-navy" onClick={() => setEditing({ trigger: def.key, rule: r })} aria-label={`Redigér regel: ${def.label}, ${describeTiming(def.timing, r.offsetMinutes)}`}>Redigér</button>
                              <button type="button" className="px-2 py-1 text-sm text-muted hover:text-danger focus-visible:text-danger" onClick={() => setDeleting(r)} aria-label={`Slet regel: ${def.label}, ${describeTiming(def.timing, r.offsetMinutes)}`}>Slet</button>
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
          </div>
        </section>
      ))}

      {editing && (
        <RuleDialog
          def={TRIGGERS[editing.trigger]}
          rule={editing.rule}
          templates={templates}
          allRules={rules}
          onClose={() => setEditing(null)}
          onCreateTemplate={async (channel, name) => {
            const r = await saver.run(() => createTemplateAction({ channel, name }));
            if (r && r.ok) {
              setTemplates((t) => [...t, r.template]);
              return r.template;
            }
            return null;
          }}
          onSave={async (value) => {
            const r = await saver.run(() => (editing.rule ? updateRuleAction(editing.rule.id, value) : createRuleAction({ ...value, trigger: editing.trigger })));
            if (r && r.ok) {
              setRules((rs) => (editing.rule ? rs.map((x) => (x.id === r.rule.id ? r.rule : x)) : [...rs, r.rule]));
              setEditing(null);
              return null;
            }
            return r && !r.ok ? r.error : "Reglen kunne ikke gemmes.";
          }}
        />
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="Slet reglen?"
        confirmLabel="Slet regel"
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          const r = deleting;
          setDeleting(null);
          if (!r) return;
          const prev = rules;
          setRules((rs) => rs.filter((x) => x.id !== r.id));
          const res = await saver.run(() => deleteRuleAction(r.id));
          if (!res || !res.ok) setRules(prev);
        }}
      >
        <p>
          «{deleting && TRIGGERS[deleting.trigger as TriggerKey]?.label}: {deleting && describeTiming(TRIGGERS[deleting.trigger as TriggerKey].timing, deleting.offsetMinutes)}» slettes, og ventende beskeder fra reglen
          annulleres. Skabelonen bevares. Vil du blot pause reglen, så slå den fra i stedet.
        </p>
      </ConfirmDialog>
    </div>
  );
}

const UNITS: TimingUnit[] = ["minutes", "hours", "days"];

function RuleDialog({
  def,
  rule,
  templates,
  allRules,
  onClose,
  onSave,
  onCreateTemplate,
}: {
  def: TriggerDef;
  rule: CmsRule | null;
  templates: CmsTemplate[];
  allRules: CmsRule[];
  onClose: () => void;
  onSave: (v: Omit<CmsRule, "id" | "trigger">) => Promise<string | null>;
  onCreateTemplate: (channel: "EMAIL" | "SMS", name: string) => Promise<CmsTemplate | null>;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const initial = offsetToParts(rule?.offsetMinutes ?? (def.timing === "before_start" ? -1440 : 0));
  const directions = allowedDirections(def.timing);
  const [channel, setChannel] = useState<"EMAIL" | "SMS">(rule?.channel ?? "EMAIL");
  const [amount, setAmount] = useState(rule ? initial.amount : def.timing === "before_start" ? 24 : 0);
  const [unit, setUnit] = useState<TimingUnit>(rule ? initial.unit : def.timing === "before_start" ? "hours" : "minutes");
  const [direction, setDirection] = useState<TimingDirection>(directions[0]);
  const [audience, setAudience] = useState(rule?.audience ?? def.audiences[0]);
  const [templateId, setTemplateId] = useState(rule?.templateId ?? "");
  const [quiet, setQuiet] = useState(rule?.quietHours ?? false);
  const [active, setActive] = useState(rule?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newName, setNewName] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);

  // Kun skabeloner, hvis variabler findes for udløseren, kan vælges; de bedst egnede (allerede brugt af udløseren) står først
  const compatible = (t: CmsTemplate) => validateTemplate({ channel: t.channel, subject: t.subject, body: t.body }, def.variables).length === 0;
  const usedHere = new Set(allRules.filter((r) => r.trigger === def.key).map((r) => r.templateId));
  const candidates = templates
    .filter((t) => t.channel === channel && (t.active || t.id === templateId || def.locked))
    .sort((a, b) => Number(compatible(b)) - Number(compatible(a)) || Number(usedHere.has(b.id)) - Number(usedHere.has(a.id)) || a.name.localeCompare(b.name, "da"));
  useEffect(() => {
    if (!candidates.some((t) => t.id === templateId)) setTemplateId(candidates.find(compatible)?.id ?? candidates[0]?.id ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel]);

  const offset = partsToOffset({ amount: Number.isFinite(amount) ? amount : 0, unit, direction });
  const offsetProblem = validateOffset(def.timing, def.timing === "before_start" && offset === 0 ? -0 : offset);
  const sentence = `Sendes ${describeTiming(def.timing, offset).toLowerCase()} til ${AUDIENCE_LABEL[audience].toLowerCase()} som ${channel === "SMS" ? "SMS" : "e-mail"}.`;

  async function submit() {
    setBusy(true);
    setError(null);
    const e = await onSave({ channel, offsetMinutes: offset, audience, templateId, active, quietHours: channel === "SMS" && quiet });
    setBusy(false);
    if (e) setError(e);
  }

  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClose={onClose}
      aria-labelledby="rule-title"
      className="m-0 ml-auto h-full max-h-none w-full max-w-lg border-0 bg-white p-0 text-ink backdrop:bg-overlay-navy sm:m-auto sm:h-auto sm:max-h-[92vh] sm:border sm:border-grey-bg"
    >
      <form
        onSubmit={(e) => { e.preventDefault(); void submit(); }}
        className="flex h-full flex-col"
      >
        <div className="flex items-start justify-between gap-3 border-b border-grey-bg p-space-3 sm:p-space-4">
          <div>
            <span className="eyebrow !mb-2">{def.label}</span>
            <h2 id="rule-title" className="text-xl font-light">{rule ? "Redigér regel" : "Ny regel"}</h2>
            <span className="rule-gold mt-3" aria-hidden="true" />
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Luk</button>
        </div>
        <div className="flex-1 space-y-space-3 overflow-y-auto p-space-3 sm:p-space-4">
          <fieldset>
            <legend className="label">Kanal</legend>
            <div className="inline-flex" role="radiogroup" aria-label="Kanal">
              {(["EMAIL", "SMS"] as const).map((c) => (
                <button
                  key={c}
                  type="button"
                  role="radio"
                  aria-checked={channel === c}
                  onClick={() => setChannel(c)}
                  className={`border px-4 py-2 text-xs font-bold uppercase tracking-wide first:border-r-0 ${channel === c ? "border-navy bg-navy text-white" : "border-slate bg-white text-navy hover:border-navy"}`}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend className="label">Tidspunkt</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input !w-24"
                type="number"
                min={0}
                value={Number.isFinite(amount) ? amount : ""}
                onChange={(e) => setAmount(e.target.value === "" ? NaN : Number(e.target.value))}
                aria-label="Antal"
              />
              <select className="input !w-auto" value={unit} onChange={(e) => setUnit(e.target.value as TimingUnit)} aria-label="Enhed">
                {UNITS.map((u) => <option key={u} value={u}>{unitLabel(u, amount === 1 ? 1 : 2)}</option>)}
              </select>
              <select className="input !w-auto" value={direction} onChange={(e) => setDirection(e.target.value as TimingDirection)} aria-label="Før eller efter" disabled={directions.length === 1}>
                {directions.map((d) => <option key={d} value={d}>{anchorLabel(def.timing, d)}</option>)}
              </select>
            </div>
            <p className="mt-1 text-xs text-muted">{def.timing === "before_start" ? "Fx 24 timer eller 60 minutter før mødets start." : def.timing === "after_activity" ? "Regnes fra sidste aktivitet i tilmeldingen." : "0 betyder straks."}</p>
          </fieldset>

          <div>
            <label className="label" htmlFor="rule-audience">Modtager</label>
            <select id="rule-audience" className="input" value={audience} onChange={(e) => setAudience(e.target.value as typeof audience)}>
              {def.audiences.map((a) => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </select>
            {def.audienceNote && <p className="mt-1 text-xs text-muted">{def.audienceNote}</p>}
          </div>

          <div>
            <label className="label" htmlFor="rule-template">Skabelon</label>
            <select id="rule-template" className="input" value={templateId} onChange={(e) => setTemplateId(e.target.value)} required>
              {candidates.length === 0 && <option value="">Ingen skabeloner til {CHANNEL_LABEL[channel]}</option>}
              {candidates.map((t) => <option key={t.id} value={t.id} disabled={!compatible(t)}>{t.name}{t.active ? "" : " (slået fra)"}{compatible(t) ? "" : " – bruger variabler, som ikke findes her"}</option>)}
            </select>
            <div className="mt-2 flex gap-2">
              <input className="input !py-1.5 text-sm" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Navn på en ny skabelon" aria-label="Navn på ny skabelon" />
              <button
                type="button"
                className="btn-secondary btn-sm shrink-0"
                disabled={newName.trim().length < 2}
                onClick={async () => {
                  const t = await onCreateTemplate(channel, newName.trim());
                  if (t) { setTemplateId(t.id); setNewName(""); }
                }}
              >
                Opret
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">En ny skabelon er slået fra, til du har skrevet teksten under Skabeloner.</p>
          </div>

          {channel === "SMS" && (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-4 w-4" checked={quiet} onChange={(e) => setQuiet(e.target.checked)} />
              <span>Respektér stille timer<span className="block text-xs text-muted">SMS udsættes til efter de stille timer (se Indstillinger). Påmindelser under 2 timer før mødet sendes altid.</span></span>
            </label>
          )}

          <div className="flex items-center gap-3">
            <Switch checked={active} onChange={setActive} label="Reglen er aktiv" disabled={def.locked} />
            <span className="text-sm">{active ? "Aktiv" : "Slået fra"}</span>
          </div>

          <p className="callout text-sm" aria-live="polite" data-testid="rule-sentence">{sentence}</p>
          {offsetProblem && <p className="text-sm font-semibold text-danger" role="alert">{offsetProblem}</p>}
          {error && <p className="callout callout-error text-sm" role="alert" data-testid="rule-error">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 border-t border-grey-bg p-space-3 sm:px-space-4">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>Annullér</button>
          <button type="submit" className="btn btn-sm" disabled={busy || !!offsetProblem || !templateId || Number.isNaN(amount)} data-testid="rule-save">Gem regel</button>
        </div>
      </form>
    </dialog>
  );
}
