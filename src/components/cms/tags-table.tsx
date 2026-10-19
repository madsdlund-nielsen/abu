"use client";

import { useState } from "react";
import { createTagAction, updateTagAction } from "@/app/actions/cms";
import type { CmsTag } from "@/lib/onboarding/cms-types";
import { ConfirmDialog, SaveIndicator, Switch, useSaver } from "./primitives";

export function TagsTable({ initialTags }: { initialTags: CmsTag[] }) {
  const [tags, setTags] = useState(initialTags);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [kind, setKind] = useState<CmsTag["kind"]>("COMPETENCE");
  const [show, setShow] = useState<"all" | CmsTag["kind"]>("all");
  const [confirm, setConfirm] = useState<CmsTag | null>(null);
  const saver = useSaver();

  const patch = async (id: string, p: Partial<Pick<CmsTag, "name" | "description" | "active">>) => {
    const prev = tags;
    setTags((ts) => ts.map((t) => (t.id === id ? { ...t, ...p } : t)));
    const r = await saver.run(() => updateTagAction(id, p));
    if (!r || !r.ok) setTags(prev);
  };

  const create = async () => {
    const n = name.trim();
    if (n.length < 2) return;
    const r = await saver.run(() => createTagAction({ name: n, description: desc.trim(), kind }));
    if (r && r.ok && "id" in r) {
      setTags((ts) => [...ts, { id: (r as { id: string }).id, slug: n.toLowerCase(), name: n, description: desc.trim(), active: true, kind, system: false, advisors: 0, answers: 0 }]);
      setName("");
      setDesc("");
    }
  };

  const toggle = (t: CmsTag, active: boolean) => {
    if (!active && (t.advisors > 0 || t.answers > 0)) setConfirm(t);
    else void patch(t.id, { active });
  };

  return (
    <div>
      <div className="mb-space-3 flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex flex-1 flex-wrap items-end gap-2"
          onSubmit={(e) => { e.preventDefault(); void create(); }}
          aria-label="Opret tag"
        >
          <div className="min-w-[12rem] flex-1">
            <label className="label" htmlFor="new-tag">Nyt tag</label>
            <input id="new-tag" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Navn, fx «Produktudvikling»" maxLength={60} />
          </div>
          <div className="min-w-[12rem] flex-[2]">
            <label className="label" htmlFor="new-tag-desc">Beskrivelse (valgfri)</label>
            <input id="new-tag-desc" className="input" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={200} />
          </div>
          <div>
            <label className="label" htmlFor="new-tag-kind">Type</label>
            <select id="new-tag-kind" className="input" value={kind} onChange={(e) => setKind(e.target.value as CmsTag["kind"])}>
              <option value="COMPETENCE">Kompetence (synlig for kunder)</option>
              <option value="ADMIN">Internt (kun admin)</option>
            </select>
          </div>
          <button className="btn" type="submit" disabled={name.trim().length < 2}>Opret tag</button>
        </form>
        <SaveIndicator saver={saver} />
      </div>

      <div className="mb-space-3 flex flex-wrap items-center gap-2" role="group" aria-label="Vis tags">
        {([["all", "Alle"], ["COMPETENCE", "Kompetence"], ["ADMIN", "Interne"]] as const).map(([v, l]) => (
          <button key={v} type="button" aria-pressed={show === v} onClick={() => setShow(v)} className={`badge cursor-pointer ${show === v ? "badge-navy" : "badge-outline"}`}>
            {l} ({v === "all" ? tags.length : tags.filter((t) => t.kind === v).length})
          </button>
        ))}
      </div>

      {tags.length === 0 ? (
        <p className="border border-dashed border-slate bg-white p-space-5 text-center text-muted">Der er ingen tags endnu. Opret det første ovenfor.</p>
      ) : (
        <div className="table-wrap">
          <table className="table [&_td]:align-middle" data-testid="tags-table">
            <thead>
              <tr>
                <th>Navn</th>
                <th>Beskrivelse</th>
                <th>Type</th>
                <th className="!text-right">Rådgivere</th>
                <th className="!text-right">Svar</th>
                <th>Aktiv</th>
              </tr>
            </thead>
            <tbody>
              {tags.filter((t) => show === "all" || t.kind === show).map((t) => (
                <TagRow key={t.id} tag={t} onPatch={(p) => patch(t.id, p)} onToggle={(v) => toggle(t, v)} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title="Deaktivér tagget?"
        confirmLabel="Deaktivér"
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          const t = confirm;
          setConfirm(null);
          if (t) void patch(t.id, { active: false });
        }}
      >
        <p>
          «{confirm?.name}» bruges af {confirm?.advisors} {confirm?.advisors === 1 ? "rådgiver" : "rådgivere"} og i {confirm?.answers}{" "}
          {confirm?.answers === 1 ? "svar" : "svar"}. Et deaktiveret tag ignoreres i matchingen og vises ikke i rådgiverkataloget. Du kan aktivere det igen senere.
        </p>
      </ConfirmDialog>
    </div>
  );
}

function TagRow({ tag, onPatch, onToggle }: { tag: CmsTag; onPatch: (p: { name?: string; description?: string }) => void; onToggle: (v: boolean) => void }) {
  const [name, setName] = useState(tag.name);
  const [desc, setDesc] = useState(tag.description);
  const unused = tag.advisors === 0;
  return (
    <tr className={tag.active ? "" : "bg-grey-bg/60"} data-testid="tag-row" data-kind={tag.kind}>
      <td className="min-w-[11rem]">
        <input
          className="input !py-1.5 text-sm font-semibold"
          aria-label={`Navn på tag ${tag.name}`}
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim().length >= 2 && name.trim() !== tag.name ? onPatch({ name: name.trim() }) : setName(tag.name)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td className="min-w-[14rem]">
        <input
          className="input !py-1.5 text-sm"
          aria-label={`Beskrivelse af ${tag.name}`}
          value={desc}
          maxLength={200}
          onChange={(e) => setDesc(e.target.value)}
          onBlur={() => desc.trim() !== tag.description && onPatch({ description: desc.trim() })}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </td>
      <td>
        <span className={`badge ${tag.kind === "ADMIN" ? "badge-gold" : "badge-outline"}`}>{tag.kind === "ADMIN" ? "Internt" : "Kompetence"}</span>
        {tag.system && <span className="mt-1 block text-xs text-muted">Systemtag</span>}
      </td>
      <td className="text-right tabular-nums">
        {tag.advisors}
        {tag.kind === "COMPETENCE" && tag.active && unused && tag.answers > 0 && <span className="badge badge-gold ml-2" title="Behov med dette tag kan aldrig dækkes">Ingen dækning</span>}
      </td>
      <td className="text-right tabular-nums">{tag.kind === "ADMIN" ? "–" : tag.answers}</td>
      <td>
        <div className="flex items-center gap-2">
          <Switch checked={tag.active} onChange={onToggle} label={`${tag.name} er aktivt`} disabled={tag.system} />
          <span className="text-xs text-muted">{tag.system ? "Altid aktiv" : tag.active ? "Aktiv" : "Inaktiv"}</span>
        </div>
      </td>
    </tr>
  );
}
