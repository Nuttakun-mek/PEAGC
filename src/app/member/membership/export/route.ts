import { NextResponse } from "next/server";

import { bangkokToday } from "@/lib/membership/lifecycle";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

/**
 * PDPA "ดาวน์โหลดข้อมูลของฉัน": the signed-in member's own rows as one JSON file. Every query goes
 * through the member's own session, so row-level security limits it to their data. Tables that do
 * not exist yet (migration not applied) are skipped.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  const { data: members, error: memberError } = await supabase.from("members").select("*").eq("user_id", user.id);
  if (memberError) {
    logDbError("member.export members", memberError);
    return NextResponse.json({ error: "load-failed" }, { status: 500 });
  }
  const memberIds = (members ?? []).map((row) => row.id as string);

  const byMember: Array<[string, string]> = [
    ["lesson_bookings", "*"],
    ["event_registrations", "*"],
    ["payment_records", "id, purpose, description, amount, status, transferred_at, reviewed_at, created_at, receipt_no"],
    ["member_notifications", "id, notification_type, subject, body, status, created_at"],
    ["golf_hole_scores", "*"],
    ["member_awards", "*"],
    ["membership_terms", "*"],
    ["point_txns", "*"],
    ["point_redemptions", "*"],
    ["member_data_requests", "*"],
  ];

  const tables: Record<string, unknown[]> = {};
  if (memberIds.length) {
    const results = await Promise.all(
      byMember.map(async ([table, columns]) => {
        let result = await supabase.from(table).select(columns).in("member_id", memberIds).limit(5000);
        // payment_records.receipt_no comes with a later migration; retry without it.
        if (result.error && table === "payment_records") {
          result = await supabase.from(table).select("*").in("member_id", memberIds).limit(5000);
        }
        return [table, result] as const;
      }),
    );
    for (const [table, result] of results) {
      if (result.error) continue;
      tables[table] = (result.data ?? []) as unknown[];
    }
  }

  const body = JSON.stringify(
    {
      exported_at: new Date().toISOString(),
      account: { created_at: user.created_at, email: user.email ?? null, id: user.id, phone: user.phone ?? null },
      profile: profile ?? null,
      members: members ?? [],
      ...tables,
    },
    null,
    2,
  );

  return new NextResponse(body, {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="peagc-my-data-${bangkokToday()}.json"`,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}
