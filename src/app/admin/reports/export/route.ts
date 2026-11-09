import { NextResponse } from "next/server";

import { getStaffClub } from "@/lib/auth/staff";
import { csvResponseInit, toCsv } from "@/lib/csv";
import { financeByEvent } from "@/lib/reports/aggregate";
import { loadReportData, reportPeriod } from "@/lib/reports/load";

const financeRoles = ["platform_owner", "club_admin", "finance_officer", "auditor"];

/** Finance summary per event for the selected period (accounting hand-off). */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const staff = await getStaffClub(financeRoles);
  if (staff.status === "anonymous") {
    return NextResponse.redirect(new URL("/login?next=/admin/reports", request.url));
  }
  if (staff.status === "forbidden") {
    return new NextResponse("ไม่มีสิทธิ์เข้าถึง", { status: 403 });
  }

  const period = reportPeriod(url.searchParams.get("from") ?? undefined, url.searchParams.get("to") ?? undefined);
  const data = await loadReportData(staff.supabase, staff.clubId, period);
  const { lines, totals } = financeByEvent(data.payments);

  const body = toCsv(
    ["กิจกรรม", "อนุมัติแล้ว (บาท)", "จำนวนรายการอนุมัติ", "รอตรวจ (บาท)", "จำนวนรอตรวจ", "คืนเงิน (บาท)", "สุทธิ (บาท)"],
    [
      ...lines.map((line) => [
        line.eventName,
        line.approved,
        line.approvedCount,
        line.pending,
        line.pendingCount,
        line.refunded,
        line.approved - line.refunded,
      ]),
      ["รวม", totals.approved, "", totals.pending, "", totals.refunded, totals.net],
    ],
  );

  return new NextResponse(body, csvResponseInit(`finance-${period.from}_${period.to}.csv`));
}
