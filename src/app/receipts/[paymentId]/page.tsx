import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { ReceiptPrintButton } from "@/components/payments-receipt-print-button";
import { StatusBanner } from "@/components/status-banner";
import { buttonClass } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { formatBaht, formatThaiDateLong, formatThaiDateTime, orUnset } from "@/lib/display";
import { paymentItemTitle } from "@/lib/payments/labels";
import { bahtText } from "@/lib/payments/receipt";
import { readVerification } from "@/lib/payments/verification";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "ใบเสร็จรับเงิน",
};

type PageProps = {
  params: Promise<{ paymentId: string }>;
  searchParams: Promise<{ bypass?: string }>;
};

type ReceiptData = {
  amount: number;
  approvedBy: string;
  backHref: string;
  clubName: string;
  issuedAt: string | null;
  item: string;
  paidAt: string | null;
  payerCode: string | null;
  payerName: string;
  paidBy: string;
  receiptNo: string | null;
  refundedAt: string | null;
  status: string;
};

type PaymentRow = {
  amount: number;
  club_id: string;
  description?: string | null;
  event_registration_id: string | null;
  id: string;
  member_id?: string | null;
  purpose?: string | null;
  receipt_issued_at?: string | null;
  receipt_no?: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  slip_file_id: string | null;
  status: string;
  transferred_at: string | null;
  updated_at: string | null;
  verification?: unknown;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sampleReceipt = (bypass: string): ReceiptData => ({
  amount: 2200,
  approvedBy: "ตรวจอัตโนมัติ (SlipOK)",
  backHref: bypass === "admin" ? "/admin/payments?bypass=admin" : "/member?bypass=member#payments",
  clubName: CLUB_NAME,
  issuedAt: "2026-11-02T05:00:00.000Z",
  item: "ค่าสมัครกิจกรรม ออกรอบประจำเดือน พ.ย.",
  paidAt: "2026-11-02T03:10:00.000Z",
  paidBy: "โอนเงิน",
  payerCode: "PEA001",
  payerName: "สมชาย ใจดี",
  receiptNo: "RC2569-000123",
  refundedAt: null,
  status: "approved",
});

function first<T>(value: T | T[] | null | undefined): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

async function loadReceipt(paymentId: string, viewerId: string | null): Promise<ReceiptData | null> {
  if (!UUID.test(paymentId)) return null;
  // The user's own client decides who may see it: the member who paid (own payments policy) or
  // finance staff / auditors of the club. Everyone else gets "not found".
  const supabase = await createClient();
  const { data, error } = await supabase.from("payment_records").select("*").eq("id", paymentId).maybeSingle();
  if (error) logDbError("receipts.payment", error);
  const payment = data as PaymentRow | null;
  if (!payment) return null;

  const admin = createAdminClient();
  const [{ data: registration }, { data: club }, { data: approver }] = await Promise.all([
    payment.event_registration_id
      ? admin.from("event_registrations").select("member_id, events(name)").eq("id", payment.event_registration_id).maybeSingle()
      : Promise.resolve({ data: null }),
    admin.from("clubs").select("name").eq("id", payment.club_id).maybeSingle(),
    payment.reviewed_by ? admin.from("profiles").select("display_name").eq("id", payment.reviewed_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const registrationRow = registration as { events?: { name?: string } | Array<{ name?: string }> | null; member_id?: string | null } | null;
  const memberId = payment.member_id ?? registrationRow?.member_id ?? null;
  const { data: member } = memberId
    ? await admin.from("members").select("full_name, member_code, user_id").eq("id", memberId).maybeSingle()
    : { data: null };
  const isPayer = Boolean(viewerId && member?.user_id === viewerId);
  const verifiedBy = readVerification(payment.verification).verified_by;

  return {
    amount: Number(payment.amount ?? 0),
    approvedBy:
      verifiedBy === "slipok" && !payment.reviewed_by
        ? "ตรวจอัตโนมัติ (SlipOK)"
        : orUnset((approver as { display_name?: string } | null)?.display_name, "เหรัญญิกชมรม"),
    backHref: isPayer ? "/member#payments" : "/admin/payments",
    clubName: (club as { name?: string } | null)?.name || CLUB_NAME,
    issuedAt: payment.receipt_issued_at ?? payment.reviewed_at,
    item: paymentItemTitle(payment.purpose ?? "event", { description: payment.description, eventName: first(registrationRow?.events)?.name }),
    paidAt: payment.transferred_at ?? payment.reviewed_at,
    paidBy: payment.slip_file_id ? "โอนเงิน" : "เงินสดหรือช่องทางอื่น",
    payerCode: member?.member_code ?? null,
    payerName: member?.full_name ?? "สมาชิก",
    receiptNo: payment.receipt_no ?? null,
    refundedAt: payment.status === "refunded" ? payment.updated_at : null,
    status: payment.status,
  };
}

export default async function ReceiptPage({ params, searchParams }: PageProps) {
  const [{ paymentId }, search] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({
    allowBypassRole: search.bypass === "admin" ? "admin" : "member",
    nextPath: `/receipts/${paymentId}`,
    searchParams: search,
  });

  const receipt = access.isBypass ? sampleReceipt(search.bypass ?? "member") : await loadReceipt(paymentId, access.userId);
  if (!receipt) notFound();

  const issued = (receipt.status === "approved" || receipt.status === "refunded") && receipt.receiptNo;

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink print:bg-white print:p-0">
      <style>{"@page { size: A5 portrait; margin: 10mm; } @media print { html, body { background: #fff; } }"}</style>

      <div className="mx-auto mb-4 flex w-full max-w-[148mm] flex-wrap items-center justify-between gap-2 print:hidden">
        <Link className={buttonClass("secondary", "md")} href={receipt.backHref}>
          กลับ
        </Link>
        {issued ? <ReceiptPrintButton /> : null}
      </div>

      {!issued ? (
        <div className="mx-auto w-full max-w-[148mm]">
          <StatusBanner title="ยังไม่มีใบเสร็จ" tone="info">
            ใบเสร็จออกให้หลังเหรัญญิกอนุมัติการชำระเงินแล้ว
          </StatusBanner>
        </div>
      ) : (
        <article
          aria-labelledby="receipt-title"
          className="relative mx-auto w-full max-w-[148mm] overflow-hidden rounded-xl border border-line bg-white p-6 shadow-card sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:shadow-none"
        >
          <header className="flex items-start gap-4 border-b border-line pb-4">
            <ClubCrest priority size={64} />
            <div className="min-w-0 flex-1">
              <p className="text-base font-semibold text-brand-600">{receipt.clubName}</p>
              <h1 className="mt-1 text-h2 font-semibold text-ink" id="receipt-title">
                ใบเสร็จรับเงิน
              </h1>
            </div>
            <dl className="shrink-0 text-right text-sm">
              <dt className="text-xs text-ink-muted">เลขที่</dt>
              <dd className="font-semibold tabular-nums text-ink">{receipt.receiptNo}</dd>
              <dt className="mt-1 text-xs text-ink-muted">วันที่ออก</dt>
              <dd className="text-ink">{formatThaiDateLong(receipt.issuedAt)}</dd>
            </dl>
          </header>

          {receipt.refundedAt ? (
            <p className="mt-4 rounded-lg border border-danger/30 bg-danger-bg px-3 py-2 text-sm font-semibold text-danger">
              คืนเงินแล้วเมื่อ {formatThaiDateTime(receipt.refundedAt)} ใบเสร็จนี้ใช้อ้างอิงเท่านั้น
            </p>
          ) : null}

          <dl className="mt-4 grid gap-1 text-sm">
            <div className="flex flex-wrap gap-x-2">
              <dt className="text-ink-muted">ได้รับเงินจาก</dt>
              <dd className="font-semibold text-ink">
                {receipt.payerName}
                {receipt.payerCode ? <span className="font-normal text-ink-muted"> · เลขสมาชิก {receipt.payerCode}</span> : null}
              </dd>
            </div>
          </dl>

          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-y border-line text-left text-xs text-ink-muted">
                <th className="py-2 pr-3 font-medium" scope="col">
                  รายการ
                </th>
                <th className="py-2 text-right font-medium" scope="col">
                  จำนวนเงิน
                </th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-line align-top">
                <td className="py-3 pr-3 text-ink">{receipt.item}</td>
                <td className="py-3 text-right tabular-nums text-ink">{formatBaht(receipt.amount)}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr>
                <th className="pt-3 pr-3 text-left font-semibold text-ink" scope="row">
                  รวมทั้งสิ้น
                </th>
                <td className="pt-3 text-right text-h3 font-semibold tabular-nums text-ink">{formatBaht(receipt.amount)}</td>
              </tr>
            </tfoot>
          </table>
          <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm font-medium text-ink print:border print:border-line print:bg-white">
            ({bahtText(receipt.amount)})
          </p>

          <dl className="mt-5 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 print:grid-cols-2">
            <div>
              <dt className="text-xs text-ink-muted">วันที่ชำระ</dt>
              <dd className="text-ink">{formatThaiDateLong(receipt.paidAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">ชำระโดย</dt>
              <dd className="text-ink">{receipt.paidBy}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-muted">ตรวจรับเงินโดย</dt>
              <dd className="text-ink">{receipt.approvedBy}</dd>
            </div>
          </dl>
        </article>
      )}
    </main>
  );
}
