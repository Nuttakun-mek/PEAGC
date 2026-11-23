import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { formatBaht } from "@/lib/display";

/**
 * One in-app notification (member_notifications, channel 'system', type 'payment_update') when a
 * payment is approved, rejected or refunded (in-app only).
 * Use the service-role client: finance officers have no insert policy on notifications.
 * Never throws; a failed notification must not undo the decision.
 */
export async function notifyPaymentDecision(
  admin: SupabaseClient,
  {
    actorUserId,
    amount,
    clubId,
    itemTitle,
    memberId,
    paymentId,
    purpose,
    receiptNo,
    status,
  }: {
    actorUserId: string | null;
    amount: number;
    clubId: string;
    itemTitle: string;
    memberId: string | null;
    paymentId: string;
    purpose: string;
    receiptNo?: string | null;
    status: "approved" | "rejected" | "refunded";
  },
) {
  if (!memberId) return;
  const money = formatBaht(amount);
  const content = {
    approved: {
      body: `${itemTitle} ยอด ${money} ได้รับเงินแล้ว${receiptNo ? ` ใบเสร็จเลขที่ ${receiptNo}` : ""}`,
      subject: "ชำระเงินเรียบร้อย",
    },
    refunded: { body: `${itemTitle} ยอด ${money} คืนเงินแล้ว`, subject: "คืนเงินแล้ว" },
    rejected: { body: `${itemTitle} สลิปไม่ผ่านการตรวจ ส่งสลิปใหม่ในหน้าสมาชิก หรือติดต่อเหรัญญิก`, subject: "สลิปไม่ผ่านการตรวจ" },
  }[status];

  try {
    const { error } = await admin.from("member_notifications").insert({
      body: content.body,
      channel: "system",
      club_id: clubId,
      created_by: actorUserId,
      member_id: memberId,
      metadata: {
        link: status === "approved" ? `/receipts/${paymentId}` : "/member#todo",
        payment_id: paymentId,
        purpose,
        receipt_no: receiptNo ?? null,
        trigger: `payment.${status}`,
      },
      notification_type: "payment_update",
      status: "queued",
      subject: content.subject,
    });
    if (error) console.error("[payments] notification:", error.code ?? "-", error.message ?? "");
  } catch (error) {
    console.error("[payments] notification:", error instanceof Error ? error.message : String(error));
  }
}
