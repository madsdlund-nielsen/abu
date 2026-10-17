import { processJobs } from "@/lib/jobs";

/**
 * Kører jobkøen og notifikationerne hvert minut i selve app-processen (slås fra med IN_PROCESS_SCHEDULER=false, hvis en
 * ekstern cron kalder /api/cron/process-jobs). Flere instanser er sikre: opgaver hentes med FOR UPDATE SKIP LOCKED.
 */
export function startScheduler() {
  if (process.env.IN_PROCESS_SCHEDULER === "false" || process.env.NODE_ENV === "test") return;
  const g = globalThis as unknown as { __abuScheduler?: boolean };
  if (g.__abuScheduler) return;
  g.__abuScheduler = true;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await processJobs(10);
    } catch (e) {
      console.error("[scheduler] fejl", e);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 60_000);
  timer.unref?.();
}
