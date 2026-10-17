"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const d = Math.floor(total / 86400);
  const h = Math.floor((total % 86400) / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} ${d === 1 ? "dag" : "dage"} og ${h} ${h === 1 ? "time" : "timer"}`;
  if (h > 0) return `${h} ${h === 1 ? "time" : "timer"} og ${m} min.`;
  if (m > 0) return `${m} min. og ${String(s).padStart(2, "0")} sek.`;
  return `${s} sek.`;
}

/** Nedtælling til mødelokalet åbner. Opdaterer siden, når tiden er gået. */
export function JoinCountdown({ opensAtIso, opensAtLabel }: { opensAtIso: string; opensAtLabel: string }) {
  const router = useRouter();
  const target = new Date(opensAtIso).getTime();
  const [left, setLeft] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      const ms = target - Date.now();
      setLeft(ms);
      if (ms <= 0) router.refresh();
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [target, router]);

  return (
    <div>
      <p className="text-2xl font-light text-navy" data-testid="opens-at">Åbner kl. {opensAtLabel}</p>
      <p className="mt-1 text-sm text-muted" aria-live="off" data-testid="countdown">
        {left === null ? " " : left > 0 ? `Om ${format(left)}` : "Åbner nu …"}
      </p>
    </div>
  );
}

/** Genindlæser siden med jævne mellemrum (fx mens en transskription behandles). */
export function AutoRefresh({ seconds = 15 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const id = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(id);
  }, [router, seconds]);
  return null;
}
