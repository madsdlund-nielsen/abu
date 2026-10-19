import type { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { withSystemContext } from "./db-context";
import { completePastMeetings } from "./meeting-status";
import { cleanupExpiredOnboarding } from "./onboarding/session";
import { cleanupTrustedDevices } from "./mfa/service";

async function cleanupAuth(now = new Date()) {
  await cleanupTrustedDevices(now);
  await prisma.session.deleteMany({ where: { expiresAt: { lt: now } } });
}

type Handler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, Handler>();

export function registerJobHandler(type: string, handler: Handler) {
  handlers.set(type, handler);
}

const MAX_ATTEMPTS = 3;
const STALE_LOCK_MS = 15 * 60_000;

/**
 * Lægger et job i køen. RLS: Job er en systemtabel – kaldes fra requests (fx optagelse uploadet) og webhooks, så
 * rækken skrives altid i systemkontekst. Selve jobbet kører senere i processJobs (også systemkontekst).
 */
export async function enqueueJob(type: string, payload: Record<string, unknown>) {
  const job = await withSystemContext("jobs.enqueue", () => prisma.job.create({ data: { type, payload: payload as Prisma.InputJsonValue } }));
  // Kør i baggrunden i samme proces; cron-ruten samler op hvis processen dør.
  setTimeout(() => {
    processJobs(1).catch((e) => console.error("[jobs] fejl", e));
  }, 50);
  return job;
}

/** Henter næste ventende job atomisk (FOR UPDATE SKIP LOCKED). */
async function claimNext() {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM "Job"
      WHERE (status = 'PENDING' AND "runAt" <= now())
         OR (status = 'RUNNING' AND "lockedAt" < ${new Date(Date.now() - STALE_LOCK_MS)})
      ORDER BY "runAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id`;
  if (rows.length === 0) return null;
  return prisma.job.findUnique({ where: { id: rows[0].id } });
}

/**
 * Jobprocessoren (scheduler hvert minut, cron-ruten og admins «Kør baggrundsjob»). RLS: altid systemkontekst – jobbene
 * går på tværs af kunder (påmindelser, oprydning, transskription).
 */
export async function processJobs(limit = 5): Promise<number> {
  return withSystemContext("jobs.process", () => processJobsAsSystem(limit));
}

async function processJobsAsSystem(limit: number): Promise<number> {
  await import("./pipeline"); // registrerer handlers
  const { runNotificationTick } = await import("./notifications/jobs"); // registrerer handlers
  // Idempotent oprydning: BOOKED møder, der er slut, bliver COMPLETED.
  await completePastMeetings().catch((e) => console.error("[jobs] completePastMeetings fejlede", e));
  // GDPR: udløbne onboarding-sessioner slettes.
  await cleanupExpiredOnboarding().catch((e) => console.error("[jobs] oprydning af onboarding fejlede", e));
  // Udløbne betroede enheder og sessioner slettes.
  await cleanupAuth().catch((e) => console.error("[jobs] oprydning af sessioner/enheder fejlede", e));
  // Notifikationer: ufærdige tilmeldinger, forfaldne beskeder og daglig oprydning af loggen.
  await runNotificationTick().catch((e) => console.error("[jobs] notifikationer fejlede", e));
  let done = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claimNext();
    if (!job) break;
    const handler = handlers.get(job.type);
    try {
      if (!handler) throw new Error(`Ukendt job-type ${job.type}`);
      await handler(job.payload as Record<string, unknown>);
      await prisma.job.update({ where: { id: job.id }, data: { status: "DONE", error: null } });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const final = job.attempts >= MAX_ATTEMPTS;
      await prisma.job.update({
        where: { id: job.id },
        data: {
          status: final ? "FAILED" : "PENDING",
          error: message.slice(0, 2000),
          runAt: new Date(Date.now() + 60_000 * job.attempts),
        },
      });
      console.error(`[jobs] ${job.type} fejlede (forsøg ${job.attempts})`, message);
    }
    done++;
  }
  return done;
}
