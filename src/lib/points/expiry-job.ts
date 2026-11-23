import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatThaiDate } from "@/lib/display";
import { EXPIRY_SOURCE_TYPE, type PointTxn, computePointLedger } from "@/lib/points/ledger";
import { logDbError } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

type Txn = PointTxn & { club_id: string; member_id: string };

const MEMBER_CHUNK = 100;

/**
 * Daily แต้มสะสม expiry (service role). For every member with a lot past its 12 months, replay the
 * ledger first-in-first-out and write one 'expiry' row per lot for what is left of it. The unique
 * key (source_type 'point_txn', source_id = lot, reason 'expiry') makes re-runs harmless.
 */
export async function expireMemberPoints(admin: SupabaseClient, now: Date = new Date()) {
  const nowIso = now.toISOString();
  const due = await fetchAllRows<{ member_id: string }>((from, to) =>
    admin.from("point_txns").select("member_id").gt("delta", 0).lte("expires_at", nowIso).order("id").range(from, to),
  );
  if (due.error) {
    logDbError("cron.points due lots", due.error);
    return { error: "due-lookup-failed" as const, expiredPoints: 0, expiredRows: 0, members: 0 };
  }
  const memberIds = [...new Set((due.data ?? []).map((row) => row.member_id))];

  let expiredRows = 0;
  let expiredPoints = 0;
  const notified = new Map<string, { clubId: string; points: number }>();

  for (let start = 0; start < memberIds.length; start += MEMBER_CHUNK) {
    const chunk = memberIds.slice(start, start + MEMBER_CHUNK);
    const txns = await fetchAllRows<Txn>((from, to) =>
      admin
        .from("point_txns")
        .select("id, club_id, member_id, delta, reason, source_type, source_id, created_at, expires_at")
        .in("member_id", chunk)
        .order("created_at")
        .order("id")
        .range(from, to),
    );
    if (txns.error) {
      logDbError("cron.points ledger", txns.error);
      continue;
    }
    const byMember = new Map<string, Txn[]>();
    for (const txn of txns.data ?? []) byMember.set(txn.member_id, [...(byMember.get(txn.member_id) ?? []), txn]);

    const rows: Record<string, unknown>[] = [];
    for (const [memberId, memberTxns] of byMember) {
      const ledger = computePointLedger(memberTxns, now);
      const lotsById = new Map(ledger.lots.map((lot) => [lot.id, lot]));
      for (const item of ledger.dueExpiries) {
        const lot = lotsById.get(item.lotId);
        rows.push({
          club_id: memberTxns[0].club_id,
          delta: -item.amount,
          member_id: memberId,
          note: lot ? `ได้รับเมื่อ ${formatThaiDate(lot.createdAt)}` : null,
          reason: "expiry",
          source_id: item.lotId,
          source_type: EXPIRY_SOURCE_TYPE,
        });
      }
    }
    if (!rows.length) continue;

    const { data: inserted, error } = await admin
      .from("point_txns")
      .upsert(rows, { ignoreDuplicates: true, onConflict: "source_type,source_id,reason" })
      .select("member_id, club_id, delta");
    if (error) {
      logDbError("cron.points expiry insert", error);
      continue;
    }
    for (const row of (inserted ?? []) as Array<{ club_id: string; delta: number; member_id: string }>) {
      expiredRows += 1;
      expiredPoints += -row.delta;
      const current = notified.get(row.member_id) ?? { clubId: row.club_id, points: 0 };
      current.points += -row.delta;
      notified.set(row.member_id, current);
    }
  }

  if (notified.size) {
    const { error } = await admin.from("member_notifications").insert(
      [...notified].map(([memberId, info]) => ({
        body: `แต้มสะสม ${info.points.toLocaleString("th-TH")} แต้มสะสมครบ 12 เดือนและหมดอายุแล้ว`,
        channel: "system",
        club_id: info.clubId,
        member_id: memberId,
        metadata: { link: "/member#points", points: info.points, source: "cron.membership" },
        notification_type: "points_update",
        status: "queued",
        subject: "แต้มสะสมหมดอายุ",
      })),
    );
    if (error) logDbError("cron.points notify", error);
  }

  return { error: null, expiredPoints, expiredRows, members: memberIds.length };
}
