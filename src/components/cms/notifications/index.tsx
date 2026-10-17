"use client";

import { useEffect, useRef, useState } from "react";
import type { CmsProviders, CmsRule, CmsSettings, CmsTemplate } from "@/lib/notifications/cms-types";
import { SaveIndicator, useSaver } from "../primitives";
import { LogTab } from "./log-tab";
import { RulesTab } from "./rules-tab";
import { SettingsTab } from "./settings-tab";
import { TABS, type Tab } from "./shared";
import { TemplatesTab } from "./templates-tab";

export interface NotificationsCmsProps {
  initialTemplates: CmsTemplate[];
  initialRules: CmsRule[];
  settings: CmsSettings;
  providers: CmsProviders;
  initialTab: Tab;
}

export function NotificationsCms(props: NotificationsCmsProps) {
  const [tab, setTab] = useState<Tab>(props.initialTab);
  const [templates, setTemplates] = useState(props.initialTemplates);
  const [rules, setRules] = useState(props.initialRules);
  const [templateId, setTemplateId] = useState<string | null>(props.initialTemplates[0]?.id ?? null);
  const saver = useSaver();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  function go(next: Tab) {
    setTab(next);
    const url = new URL(window.location.href);
    url.searchParams.set("fane", next);
    window.history.replaceState(null, "", url);
  }

  useEffect(() => {
    // Genskab fanen ved tilbage-navigation
    const onPop = () => {
      const f = new URL(window.location.href).searchParams.get("fane") as Tab | null;
      if (f && TABS.some((t) => t.id === f)) setTab(f);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  function onKey(e: React.KeyboardEvent, i: number) {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const t = TABS[e.key === "Home" ? 0 : TABS.length - 1];
      go(t.id);
      tabRefs.current[t.id]?.focus();
    } else if (dir) {
      e.preventDefault();
      const t = TABS[(i + dir + TABS.length) % TABS.length];
      go(t.id);
      tabRefs.current[t.id]?.focus();
    }
  }

  return (
    <div>
      <div className="mb-space-3 flex flex-wrap items-end justify-between gap-3">
        <div role="tablist" aria-label="Notifikationer" className="flex flex-wrap border-b border-slate/40">
          {TABS.map((t, i) => {
            const on = tab === t.id;
            return (
              <button
                key={t.id}
                ref={(el) => { tabRefs.current[t.id] = el; }}
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={on}
                aria-controls={`panel-${t.id}`}
                tabIndex={on ? 0 : -1}
                onClick={() => go(t.id)}
                onKeyDown={(e) => onKey(e, i)}
                data-testid={`tab-${t.id}`}
                className={`-mb-px border-b-4 px-4 py-2 text-xs font-bold uppercase tracking-wide ${on ? "border-gold text-navy" : "border-transparent text-muted hover:text-navy"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <SaveIndicator saver={saver} />
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={-1}>
        {tab === "regler" && (
          <RulesTab
            rules={rules}
            setRules={setRules}
            templates={templates}
            setTemplates={setTemplates}
            saver={saver}
            quietEnabled={props.settings.quietEnabled}
            onOpenTemplate={(id) => { setTemplateId(id); go("skabeloner"); }}
          />
        )}
        {tab === "skabeloner" && (
          <TemplatesTab
            templates={templates}
            setTemplates={setTemplates}
            rules={rules}
            selectedId={templateId}
            setSelectedId={setTemplateId}
            saver={saver}
            providers={props.providers}
            onOpenLog={() => go("log")}
          />
        )}
        {tab === "log" && <LogTab />}
        {tab === "indstillinger" && <SettingsTab initial={props.settings} providers={props.providers} saver={saver} />}
      </div>
    </div>
  );
}
