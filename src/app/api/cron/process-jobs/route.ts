import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { processJobs } from "@/lib/jobs";
import { withSystemContext } from "@/lib/db-context";
import { completePastMeetings } from "@/lib/meeting-status";

export const dynamic = "force-dynamic";

function authorized(req: Request): boolean {
  const secret = getEnv().CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""));
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

async function handle(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // RLS: cron har ingen bruger; jobprocessoren kører selv i systemkontekst («jobs.process»)
  const completed = await withSystemContext("cron.complete_meetings", () => completePastMeetings());
  const processed = await processJobs(10);
  return NextResponse.json({ processed, completedMeetings: completed });
}

export const GET = handle;
export const POST = handle;
