"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import type { ActionResult } from "@/lib/onboarding/cms-types";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Samler gemme-status for en gruppe handlinger: "Gemmer…", "Gemt" (forsvinder igen) eller en fejl. */
export function useSaver() {
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState("");
  const [, startTransition] = useTransition();
  const inflight = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = useCallback(
    <T extends { ok: boolean }>(call: () => Promise<T>): Promise<T | null> => {
      if (timer.current) clearTimeout(timer.current);
      inflight.current += 1;
      setStatus("saving");
      setError("");
      return new Promise((resolve) => {
        startTransition(async () => {
          let result: T | null = null;
          try {
            result = await call();
          } catch {
            result = null;
          }
          inflight.current -= 1;
          if (!result || !result.ok) {
            setStatus("error");
            setError(result && "error" in result ? String((result as unknown as { error: string }).error) : "Ændringen kunne ikke gemmes.");
          } else if (inflight.current === 0) {
            setStatus("saved");
            timer.current = setTimeout(() => setStatus("idle"), 2500);
          }
          resolve(result);
        });
      });
    },
    [],
  );
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return { status, error, run, dismiss: () => setStatus("idle") };
}

export type Saver = ReturnType<typeof useSaver>;

export function SaveIndicator({ saver }: { saver: Pick<Saver, "status" | "error" | "dismiss"> }) {
  const { status, error } = saver;
  return (
    <div className="min-h-6 text-sm" aria-live="polite" role="status">
      {status === "saving" && <span className="text-muted">Gemmer…</span>}
      {status === "saved" && (
        <span className="font-semibold text-navy" data-testid="saved">
          <span aria-hidden="true" className="mr-1 text-gold-dark">✓</span>Gemt
        </span>
      )}
      {status === "error" && (
        <span className="font-semibold text-danger" role="alert">
          {error}{" "}
          <button type="button" className="underline" onClick={saver.dismiss}>Luk</button>
        </span>
      )}
    </div>
  );
}

/** Kontakt: firkantet til/fra-knap (role=switch). */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 shrink-0 border transition-colors disabled:opacity-50 ${checked ? "border-navy bg-navy" : "border-slate bg-white"}`}
    >
      <span className={`absolute top-0.5 h-4 w-4 transition-all ${checked ? "left-[22px] bg-white" : "left-0.5 bg-slate"}`} aria-hidden="true" />
    </button>
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  danger = true,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onCancel={(e) => { e.preventDefault(); onCancel(); }}
      onClose={onCancel}
      aria-labelledby="confirm-title"
      className="w-[min(92vw,28rem)] border border-grey-bg bg-white p-space-4 text-ink shadow-panel backdrop:bg-overlay-navy"
    >
      <h2 id="confirm-title" className="text-xl">{title}</h2>
      <span className="rule-gold mt-3" aria-hidden="true" />
      <div className="mt-space-3 text-sm text-muted">{children}</div>
      <div className="mt-space-4 flex justify-end gap-2">
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel} autoFocus>Annullér</button>
        <button type="button" className={`${danger ? "btn-danger" : "btn"} btn-sm`} onClick={onConfirm}>{confirmLabel}</button>
      </div>
    </dialog>
  );
}

/** Seks prikker i to kolonner (⋮⋮). */
export function GripIcon() {
  return (
    <svg width="14" height="20" viewBox="0 0 14 20" fill="currentColor" aria-hidden="true">
      {[3, 10, 17].flatMap((y) => [3, 11].map((x) => <rect key={`${x}-${y}`} x={x - 1.5} y={y - 1.5} width="3" height="3" />))}
    </svg>
  );
}

export function WarnBadge({ count, title }: { count: number; title?: string }) {
  if (count === 0) return null;
  return (
    <span className="badge badge-gold" title={title}>
      {count} {count === 1 ? "advarsel" : "advarsler"}
    </span>
  );
}

export type Result = ActionResult;
