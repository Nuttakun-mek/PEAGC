import { NextResponse } from "next/server";

import { getStaffClub } from "@/lib/auth/staff";
import { csvResponseInit, toCsv } from "@/lib/csv";
import { financeByEvent } from "@/lib/reports/aggregate";
import { financeRoles, loadReportData, reportPeriod } from "@/lib/reports/load";
import { formatThaiMonthLong, monthlyRevenue, revenuePurposeLabels, revenuePurposes } from "@/lib/reports/revenue";

/**
 * Finance CSV for the selected period (accounting hand-off): per event by default, or approved
 * revenue per month split by purpose with `?kind=monthly`.
 */
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

  if (url.searchParams.get("kind") === "monthly") {
    const revenue = monthlyRevenue(data.revenue, period);
    const body = toCsv(
      ["เดือน", "เดือน (YYYY-MM)", ...revenuePurposes.map((purpose) => `${revenuePurposeLabels[purpose]} (บาท)`), "รวม (บาท)", "จำนวนรายการ"],
      [
        ...revenue.months.map((month) => [
          formatThaiMonthLong(month.month),
          month.month,
          ...revenuePurposes.map((purpose) => month.byPurpose[purpose]),
          month.total,
          month.count,
        ]),
        ["รวม", "", ...revenuePurposes.map((purpose) => revenue.purposeTotals[purpose]), revenue.total, ""],
      ],
    );
    return new NextResponse(body, csvResponseInit(`revenue-monthly-${period.from}_${period.to}.csv`));
  }

  const { lines, totals } = financeByEvent(data.payments);

  const body = toCsv(
    ["กิจกรรม", "อนุมัติแล้ว (บาท)", "จำนวนรายการอนุมัติ", "สลิปรอตรวจ (บาท)", "จำนวนสลิปรอตรวจ", "คืนเงิน (บาท)", "สุทธิ (บาท)"],
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
