import { NextResponse } from "next/server";

import { isAuthorizedCronRequest, runLessonCron } from "@/lib/lessons/cron";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

export const maxDuration = 60;

/**
 * Daily lesson jobs (Vercel Cron, see vercel.json): expire waitlist offers, mark no-shows, expire
 * credits + warn before expiry, queue tomorrow's reminders. Every step is idempotent and runs as
 * the service role (the RPCs treat a call without a user as the system).
 */
export async function GET(request: Request) {
  if (!isAuthorizedCronRequest(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const result = await runLessonCron((step) => admin.rpc(step));

  for (const step of result.steps) {
    if (!step.ok) {
      logDbError(`cron.lessons ${step.step}`, { code: step.code, message: step.error ?? "failed" });
    }
  }

  // Before the lessons v2 migration is applied every step fails with "function does not exist".
  const schemaOutdated = result.steps.every(
    (step) => !step.ok && classifyDbError({ code: step.code, message: step.error }) === "schema-outdated",
  );

  return NextResponse.json(
    { ...result, ...(schemaOutdated ? { error: "schema-outdated" } : {}) },
    { status: result.ok ? 200 : 500 },
  );
}
