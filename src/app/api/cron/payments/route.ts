import { NextResponse } from "next/server";

import { recordAudit } from "@/lib/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/errors";

export const maxDuration = 60;

type DueFile = { bucket: string; club_id: string; file_id: string; object_path: string };

/** Storage removes at most this many objects per call. */
const REMOVE_BATCH = 100;
const MAX_ROUNDS = 5;

/**
 * Daily slip retention (PDPA): deletes slip images of payments that were settled (approved,
 * rejected or refunded) longer ago than the club's "เก็บรูปสลิปไว้" days, and marks their `files`
 * rows with `deleted_at`. Slips still pending or in review are never touched; payment records and
 * receipts stay. Idempotent: a file is listed only until it is marked.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const perClub = new Map<string, number>();
  let deleted = 0;
  let failed = 0;

  for (let round = 0; round < MAX_ROUNDS; round += 1) {
    const { data, error } = await admin.rpc("payment_slip_files_due_for_purge", { p_limit: 500 });
    if (error) {
      logDbError("cron.payments purge list", error);
      return NextResponse.json({ deleted, error: "purge-list-failed", failed }, { status: 500 });
    }
    const due = (data ?? []) as DueFile[];
    if (!due.length) break;

    for (let start = 0; start < due.length; start += REMOVE_BATCH) {
      const batch = due.slice(start, start + REMOVE_BATCH);
      const byBucket = new Map<string, DueFile[]>();
      for (const file of batch) byBucket.set(file.bucket, [...(byBucket.get(file.bucket) ?? []), file]);

      for (const [bucket, files] of byBucket) {
        // A missing object counts as removed (storage returns no error for it).
        const { error: removeError } = await admin.storage.from(bucket).remove(files.map((file) => file.object_path));
        if (removeError) {
          console.error("[cron.payments] storage remove:", removeError.message);
          failed += files.length;
          continue;
        }
        const { error: markError } = await admin
          .from("files")
          .update({ deleted_at: new Date().toISOString() })
          .in(
            "id",
            files.map((file) => file.file_id),
          );
        if (markError) {
          logDbError("cron.payments mark deleted", markError);
          failed += files.length;
          continue;
        }
        deleted += files.length;
        for (const file of files) perClub.set(file.club_id, (perClub.get(file.club_id) ?? 0) + 1);
      }
    }

    // Stop when this round could not remove anything (avoid looping on the same failures).
    if (failed && !deleted) break;
    if (due.length < 500) break;
  }

  for (const [clubId, count] of perClub) {
    await recordAudit(admin, {
      action: "payment.slips_purged",
      actorUserId: null,
      after: { files_deleted: count },
      clubId,
      entityType: "files",
      metadata: { reason: "slip_retention", source: "cron.payments" },
    });
  }

  return NextResponse.json({ deleted, failed });
}
