"use client";

import { useEffect } from "react";

/**
 * Global beskyttelse af server-action-formularer:
 *  - dobbeltklik/dobbelt-Enter sender ikke formularen to gange (knapperne deaktiveres, mens den sendes),
 *  - `data-confirm="..."` på en formular beder om bekræftelse, før en destruktiv handling sendes.
 *  - `data-no-guard` slår dobbeltsubmit-spærringen fra for formularer, der selv viser «sender …» (useActionState).
 * Spærringen løftes igen efter 10 sekunder (hvis handlingen ikke navigerer væk) og når siden vises fra cache.
 */
export function FormGuard() {
  useEffect(() => {
    const release = (form: HTMLFormElement) => {
      delete form.dataset.submitting;
      form.removeAttribute("aria-busy");
      form.querySelectorAll<HTMLButtonElement>("button[data-guard-disabled]").forEach((b) => {
        b.disabled = false;
        b.removeAttribute("data-guard-disabled");
      });
    };
    const onSubmit = (e: Event) => {
      const form = e.target as HTMLFormElement | null;
      if (!form || form.tagName !== "FORM") return;
      const message = form.dataset.confirm;
      if (message && !window.confirm(message)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      // Formularer, der selv styrer «sender …» (useActionState/klientformularer), spærres ikke: de skal kunne sendes igen
      // straks efter en fejl. Bekræftelsen ovenfor gælder stadig.
      if (form.hasAttribute("data-no-guard")) return;
      if (form.dataset.submitting) {
        e.preventDefault();
        e.stopImmediatePropagation();
        return;
      }
      form.dataset.submitting = "1";
      form.setAttribute("aria-busy", "true");
      // Efter submit-hændelsen er læst (formdata er allerede samlet), så deaktiveres knapperne
      setTimeout(() => {
        form.querySelectorAll<HTMLButtonElement>("button[type=submit], button:not([type])").forEach((b) => {
          if (!b.disabled) {
            b.disabled = true;
            b.setAttribute("data-guard-disabled", "1");
          }
        });
      }, 0);
      setTimeout(() => release(form), 10_000);
    };
    const onPageShow = () => document.querySelectorAll<HTMLFormElement>("form[data-submitting]").forEach(release);
    document.addEventListener("submit", onSubmit, true);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("submit", onSubmit, true);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, []);
  return null;
}
