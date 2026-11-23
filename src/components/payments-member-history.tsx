import Link from "next/link";

import { MemberSection } from "@/components/member-section";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { formatBaht, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { paymentRecordStatusLabels } from "@/lib/payments";
import { paymentItemTitle } from "@/lib/payments/labels";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/errors";

type HistoryRow = {
  amount: number;
  created_at: string;
  description: string | null;
  event_registrations: { events: { name: string } | null } | null;
  id: string;
  purpose: string;
  receipt_no: string | null;
  reviewed_at: string | null;
  status: string;
};

const sampleRows: HistoryRow[] = [
  {
    amount: 2200,
    created_at: "2026-11-02T03:10:00.000Z",
    description: null,
    event_registrations: { events: { name: "ออกรอบประจำเดือน พ.ย." } },
    id: "sample",
    purpose: "event",
    receipt_no: "RC2569-000123",
    reviewed_at: "2026-11-02T05:00:00.000Z",
    status: "approved",
  },
  {
    amount: 3000,
    created_at: "2026-11-20T02:00:00.000Z",
    description: "แพ็กเกจเรียน 10 ครั้ง",
    event_registrations: null,
    id: "sample-2",
    purpose: "lesson_package",
    receipt_no: null,
    reviewed_at: null,
    status: "review",
  },
];

const PaymentsIcon = appIcons.payments;

async function loadRows(memberId: string): Promise<HistoryRow[] | null> {
  const admin = createAdminClient();
  const columns = "id, purpose, description, amount, status, created_at, reviewed_at, event_registrations(events(name))";
  const query = (select: string) =>
    admin
      .from("payment_records")
      .select(select)
      .eq("member_id", memberId)
      .or("slip_file_id.not.is.null,status.in.(approved,refunded)")
      .order("created_at", { ascending: false })
      .limit(6);
  let result = await query(`${columns}, receipt_no`);
  // receipt_no arrives with the payments migration; without it the list still shows.
  if (result.error) result = await query(columns);
  if (result.error) {
    logDbError("member.payments history", result.error);
    return null;
  }
  return (result.data ?? []).map((row) => ({ receipt_no: null, ...(row as object) })) as HistoryRow[];
}

/**
 * "การชำระเงิน" on the member page: the member's recent payments (all purposes) with their status
 * and a receipt link once approved. Hidden when there is nothing to show or the data cannot load.
 */
export async function MemberPaymentHistory({ isBypass, memberId }: { isBypass: boolean; memberId: string | null | undefined }) {
  const rows = isBypass ? sampleRows : memberId ? await loadRows(memberId) : null;
  if (!rows?.length) return null;

  return (
    <MemberSection icon={PaymentsIcon} id="payments" title="การชำระเงิน">
      <ul className="divide-y divide-line">
        {rows.map((row) => {
          const title = paymentItemTitle(row.purpose, { description: row.description, eventName: row.event_registrations?.events?.name });
          return (
            <li className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 py-3 first:pt-0 last:pb-0" key={row.id}>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{title}</p>
                <p className="mt-0.5 text-sm text-ink-muted">
                  <span className="font-semibold tabular-nums text-ink">{formatBaht(row.amount)}</span> · {formatThaiDateShort(row.reviewed_at ?? row.created_at)}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <StatusBadge kind="payment" status={row.status}>
                  {paymentRecordStatusLabels[row.status] ?? row.status}
                </StatusBadge>
                {row.status === "approved" && row.receipt_no ? (
                  <Link className={buttonClass("ghost", "sm")} href={isBypass ? "/receipts/sample?bypass=member" : `/receipts/${row.id}`}>
                    ใบเสร็จ
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </MemberSection>
  );
}
