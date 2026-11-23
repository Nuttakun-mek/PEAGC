import "server-only";

import { cache } from "react";

import { type PointLedger, type PointTxn, computePointLedger } from "@/lib/points/ledger";
import { classifyDbError, logDbError } from "@/lib/supabase/errors";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { createClient } from "@/lib/supabase/server";

export type MemberPointTxn = PointTxn & { note: string | null };

export type MemberPoints = {
  available: boolean;
  ledger: PointLedger;
  txns: MemberPointTxn[];
};

const EMPTY: MemberPoints = { available: false, ledger: computePointLedger([]), txns: [] };

/** The signed-in member's own ledger (RLS: own rows), once per request. Never throws. */
export const loadMemberPoints = cache(async (memberId: string | null): Promise<MemberPoints> => {
  if (!memberId) return EMPTY;
  try {
    const supabase = await createClient();
    const { data, error } = await fetchAllRows<MemberPointTxn>((from, to) =>
      supabase
        .from("point_txns")
        .select("id, delta, reason, source_type, source_id, note, created_at, expires_at")
        .eq("member_id", memberId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    );
    if (error) {
      if (classifyDbError(error) !== "schema-outdated") logDbError("points.load_member", error);
      return EMPTY;
    }
    const txns = data ?? [];
    return { available: true, ledger: computePointLedger(txns), txns };
  } catch (error) {
    console.error("[points] load_member failed:", error instanceof Error ? error.message : String(error));
    return EMPTY;
  }
});
