import { timingSafeEqual } from "node:crypto";

import { NextResponse } from "next/server";

import { expireMemberPoints } from "@/lib/points/expiry-job";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";

export const maxDuration = 60;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Daily membership job (Vercel cron, 01:00 Bangkok). Idempotent; safe to run again the same day.
 *   1. run_membership_daily(): expire memberships past their end date, queue one renewal reminder
 *      per end date (membership_expiring), suspend members out of the association directory longer
 *      than the grace period, and restore those who came back.
 *   2. แต้มสะสม older than 12 months expire first-in-first-out (src/lib/points).
 */
export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: lifecycle, error } = await admin.rpc("run_membership_daily", { p_today: null });
  if (error) {
    logDbError("cron.membership daily", error);
    if (classifyDbError(error) === "schema-outdated") {
      return NextResponse.json({ error: "migration-not-applied", skipped: true });
    }
    return NextResponse.json({ error: "membership-daily-failed" }, { status: 500 });
  }

  const points = await expireMemberPoints(admin);
  console.info("[cron.membership]", JSON.stringify({ lifecycle, points }));
  return NextResponse.json({ lifecycle, points }, { status: points.error ? 500 : 200 });
}
