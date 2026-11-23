import Link from "next/link";
import { AlertTriangle, BadgeCheck, Check, ChevronDown, Clock, Landmark, Search } from "lucide-react";

import { PaymentDecisionFields } from "@/components/payment-decision-fields";
import { PaymentsSlipPreview } from "@/components/payments-slip-preview";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, buttonPrimary, buttonSecondary, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { formatBaht, formatPhone, formatThaiDateShort, formatThaiDateTime, orUnset, phoneHref } from "@/lib/display";
import { pickFilter } from "@/lib/filters";
import { toBangkokInputValue } from "@/lib/lessons/booking";
import {
  NO_SLIP_REASON_MIN,
  type PaymentStage,
  paymentRecordStage,
  paymentRecordStatusLabels,
  paymentStage,
  paymentStageLabels,
  paymentStageOrder,
} from "@/lib/payments";
import { type PaymentPurpose, isPaymentPurpose, paymentItemTitle, paymentPurposeLabels } from "@/lib/payments/labels";
import { readVerification, summarizeVerification } from "@/lib/payments/verification";
import { type StatusKind, type StatusTone, statusTone } from "@/lib/status";
import { classifyDbError, collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

import { updatePaymentReview } from "./actions";

type AdminPaymentsPageProps = {
  searchParams: Promise<{
    bypass?: string;
    event?: string;
    payment?: string;
    purpose?: string;
    q?: string;
    registration?: string;
    stage?: string;
    status?: string;
  }>;
};

type SlipFile = { deleted_at?: string | null; mime_type: string | null; object_path: string | null };

type PaymentRecord = {
  amount: number;
  created_at?: string;
  description?: string | null;
  files?: SlipFile | null;
  id: string;
  note: string | null;
  purpose?: string | null;
  receipt_no?: string | null;
  reviewed_at?: string | null;
  slip_file_id: string | null;
  status: string;
  transferred_at: string | null;
  verification?: unknown;
};

type MemberInfo = {
  email: string | null;
  full_name: string;
  member_code: string | null;
  phone: string | null;
};

type RegistrationRow = {
  created_at: string;
  event_id: string;
  events: {
    event_date: string;
    member_price: number;
    name: string;
    tee_off_time: string | null;
    venue: string | null;
  } | null;
  guest_name: string | null;
  id: string;
  members: MemberInfo | null;
  payment_records: PaymentRecord[] | null;
  registration_type: string;
  status: string;
};

type ItemPaymentRow = PaymentRecord & { created_at: string; members: MemberInfo | null; purpose: string };

type EventOption = {
  id: string;
  name: string;
};

/** One line of the review list, whatever the money is for. */
type ReviewRow = {
  anchor: string;
  createdAt: string;
  eventId: string | null;
  expected: number;
  guest: boolean;
  member: MemberInfo | null;
  name: string;
  payment: PaymentRecord | null;
  purpose: PaymentPurpose;
  registration: { id: string; status: string } | null;
  searchText: string;
  stage: PaymentStage;
  subtitle: string;
  title: string;
};

const purposeTabs = ["all", "event", "lesson_package", "membership_fee"] as const;
type PurposeTab = (typeof purposeTabs)[number];
const purposeTabLabels: Record<PurposeTab, string> = {
  all: "ทั้งหมด",
  event: paymentPurposeLabels.event,
  lesson_package: paymentPurposeLabels.lesson_package,
  membership_fee: paymentPurposeLabels.membership_fee,
};

const sampleRegistrations: RegistrationRow[] = [
  {
    created_at: "2026-11-09T09:00:00.000Z",
    event_id: "sample-event-1",
    events: {
      event_date: "2026-12-12",
      member_price: 2200,
      name: "ออกรอบประจำเดือน ธ.ค.",
      tee_off_time: "11:30",
      venue: "สนามกอล์ฟรอยัล",
    },
    guest_name: null,
    id: "sample-registration-1",
    members: {
      email: "member@example.com",
      full_name: "สมชาย ใจดี",
      member_code: "PEA001",
      phone: "0812345678",
    },
    payment_records: [
      {
        amount: 2200,
        files: { mime_type: "image/jpeg", object_path: "event/2026/11/sample.jpg" },
        id: "sample-payment-1",
        note: null,
        purpose: "event",
        slip_file_id: "sample-file-1",
        status: "review",
        transferred_at: "2026-11-09T08:45:00.000Z",
        verification: {
          auto: {
            amount: 2000,
            checked_at: "2026-11-09T08:46:00.000Z",
            provider: "slipok",
            reasons: ["ยอดในสลิป 2,000 บาท ไม่ตรงกับยอดที่ต้องชำระ 2,200 บาท"],
            receiver: { account: "xxx-x-x3109-x", bank: "006", name: "ชมรมกอล์ฟการไฟฟ้าส" },
            state: "failed",
            trans_ref: "016313105447ATF07867",
            transferred_at: "2026-11-09T08:44:00.000Z",
          },
          duplicates: [{ payment_id: "sample-payment-9", reason: "same-file", status: "review" }],
          expected_amount: 2200,
        },
      },
    ],
    registration_type: "single",
    status: "payment_review",
  },
  {
    created_at: "2026-11-10T10:30:00.000Z",
    event_id: "sample-event-1",
    events: {
      event_date: "2026-12-12",
      member_price: 2200,
      name: "ออกรอบประจำเดือน ธ.ค.",
      tee_off_time: "11:30",
      venue: "สนามกอล์ฟรอยัล",
    },
    guest_name: null,
    id: "sample-registration-2",
    members: {
      email: "new.member@example.com",
      full_name: "วิภา รักกอล์ฟ",
      member_code: "PEA002",
      phone: "0898765432",
    },
    payment_records: null,
    registration_type: "single",
    status: "pending_payment",
  },
];

const sampleItemPayments: ItemPaymentRow[] = [
  {
    amount: 3500,
    created_at: "2026-11-20T02:00:00.000Z",
    description: "แพ็กเกจเรียน 10 ครั้ง (โค้ชเอ)",
    files: { mime_type: "image/jpeg", object_path: "lesson_package/2026/11/sample.jpg" },
    id: "sample-payment-2",
    members: { email: null, full_name: "ประเสริฐ ตีไกล", member_code: "PEA014", phone: "0861112222" },
    note: null,
    purpose: "lesson_package",
    receipt_no: "RC2569-000124",
    reviewed_at: "2026-11-20T02:01:00.000Z",
    slip_file_id: "sample-file-2",
    status: "approved",
    transferred_at: "2026-11-20T01:58:00.000Z",
    verification: {
      auto: {
        amount: 3500,
        checked_at: "2026-11-20T02:01:00.000Z",
        provider: "slipok",
        reasons: [],
        receiver: { account: "xxx-x-x3109-x", bank: "006", name: "ชมรมกอล์ฟการไฟฟ้าส" },
        state: "passed",
        trans_ref: "016324105447BTF01234",
        transferred_at: "2026-11-20T01:58:00.000Z",
      },
      expected_amount: 3500,
      verified_by: "slipok",
    },
  },
  {
    amount: 1200,
    created_at: "2026-11-21T04:00:00.000Z",
    description: "ค่าบำรุงสมาชิก ปี 2570",
    files: { mime_type: "application/pdf", object_path: "membership_fee/2026/11/sample.pdf" },
    id: "sample-payment-3",
    members: { email: "nok@example.com", full_name: "นกน้อย บินสูง", member_code: "PEA027", phone: null },
    note: null,
    purpose: "membership_fee",
    slip_file_id: "sample-file-3",
    status: "review",
    transferred_at: "2026-11-21T03:50:00.000Z",
    verification: {
      auto: { checked_at: "2026-11-21T04:00:00.000Z", provider: "slipok", reasons: ["สลิปเป็นไฟล์ PDF ตรวจอัตโนมัติไม่ได้"], state: "skipped" },
      expected_amount: 1200,
    },
  },
];

const registrationNotes: Record<string, string> = {
  checked_in: "เช็กอินแล้ว",
  waitlist: "คิวสำรอง",
};

/** Stage → the record/registration status whose colour it shares (lib/status.ts decides the tone). */
const stageBadge: Record<PaymentStage, { kind: StatusKind; status: string }> = {
  approved: { kind: "payment", status: "approved" },
  awaiting_payment: { kind: "payment", status: "pending" },
  awaiting_review: { kind: "payment", status: "review" },
  not_required: { kind: "payment", status: "not_required" },
  refunded: { kind: "payment", status: "refunded" },
  rejected: { kind: "payment", status: "rejected" },
  waitlist: { kind: "registration", status: "waitlist" },
};

const toneDot: Record<StatusTone, string> = {
  danger: "bg-danger",
  info: "bg-info",
  neutral: "bg-neutral/60",
  success: "bg-success",
  warning: "bg-warning",
};

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "amount-invalid": "จำนวนเงินต้องไม่ติดลบ",
  "approve-needs-reason": `ยังไม่มีสลิป ถ้าจะอนุมัติต้องเขียนเหตุผลอย่างน้อย ${NO_SLIP_REASON_MIN} ตัวอักษร เช่น รับเงินสดหน้างาน`,
  "invalid-status": "สถานะการชำระเงินไม่ถูกต้อง",
  "missing-payment": "ไม่พบรายการชำระเงิน",
  "missing-registration": "ไม่พบรายการสมัครกิจกรรม",
  "payment-approved": "อนุมัติแล้ว ผู้สมัครเปลี่ยนเป็น “ชำระแล้ว” และออกใบเสร็จแล้ว",
  "payment-approved-item": "อนุมัติแล้ว ออกใบเสร็จแล้ว",
  "payment-update-failed": "บันทึกผลตรวจไม่สำเร็จ ลองอีกครั้ง",
  "payment-updated": "บันทึกผลตรวจแล้ว",
  "registration-update-failed": "บันทึกการชำระเงินแล้ว แต่ปรับสถานะผู้สมัครไม่สำเร็จ",
  "slip-duplicate-approved": "อนุมัติไม่ได้ สลิปไฟล์นี้ใช้อนุมัติรายการอื่นไปแล้ว",
};

/** Desktop columns, shared by the header row and every list row. */
const columns = "lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_8.5rem]";

function latestPayment(payments: PaymentRecord[] | null | undefined) {
  // PostgREST does not order embedded rows, so pick the newest explicitly.
  return [...(payments ?? [])].sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))[0] ?? null;
}

function eventRow(registration: RegistrationRow): ReviewRow {
  const payment = latestPayment(registration.payment_records);
  const event = registration.events;
  return {
    anchor: `registration-${registration.id}`,
    createdAt: registration.created_at,
    eventId: registration.event_id,
    expected: Number(event?.member_price ?? 0),
    guest: !registration.members,
    member: registration.members,
    name: registration.members?.full_name ?? registration.guest_name ?? "ผู้สมัคร",
    payment,
    purpose: "event",
    registration: { id: registration.id, status: registration.status },
    searchText: [event?.name, event?.venue, registration.members?.full_name, registration.members?.member_code, registration.members?.phone, registration.members?.email, registration.guest_name]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    stage: paymentStage({ payment, price: event?.member_price, registrationStatus: registration.status }),
    subtitle: `${formatThaiDateShort(event?.event_date)} · ${orUnset(event?.venue)}`,
    title: orUnset(event?.name),
  };
}

function itemRow(payment: ItemPaymentRow): ReviewRow {
  const purpose: PaymentPurpose = isPaymentPurpose(payment.purpose) ? payment.purpose : "other";
  const expected = Number(readVerification(payment.verification).expected_amount ?? payment.amount ?? 0);
  return {
    anchor: `payment-${payment.id}`,
    createdAt: payment.created_at,
    eventId: null,
    expected,
    guest: false,
    member: payment.members,
    name: payment.members?.full_name ?? "สมาชิก",
    payment,
    purpose,
    registration: null,
    searchText: [payment.description, payment.members?.full_name, payment.members?.member_code, payment.members?.phone, payment.members?.email, payment.receipt_no]
      .filter(Boolean)
      .join(" ")
      .toLowerCase(),
    stage: paymentRecordStage(payment),
    subtitle: `${paymentPurposeLabels[purpose]} · ${formatThaiDateShort(payment.created_at)}`,
    title: paymentItemTitle(purpose, { description: payment.description }),
  };
}

type Keep = { event: string; purpose: string; q: string; stage: string };

function KeepFields({ keep }: { keep: Keep }) {
  return (
    <>
      <input name="keepEvent" type="hidden" value={keep.event === "all" ? "" : keep.event} />
      <input name="keepPurpose" type="hidden" value={keep.purpose === "all" ? "" : keep.purpose} />
      <input name="keepQ" type="hidden" value={keep.q} />
      <input name="keepStage" type="hidden" value={keep.stage === "all" ? "" : keep.stage} />
    </>
  );
}

function PaymentReviewForm({ disabled, keep, row }: { disabled?: boolean; keep: Keep; row: ReviewRow }) {
  const payment = row.payment;

  return (
    <form action={updatePaymentReview} className="rounded-xl border border-line bg-white p-4" key={`${payment?.id ?? "new"}:${payment?.status ?? ""}`}>
      {row.registration ? <input name="registrationId" type="hidden" value={row.registration.id} /> : null}
      {payment ? <input name="paymentId" type="hidden" value={payment.id} /> : null}
      <KeepFields keep={keep} />

      <PaymentDecisionFields
        defaultAmount={payment?.amount ?? row.expected}
        defaultNote={payment?.note ?? ""}
        defaultTransferredAt={toBangkokInputValue(payment?.transferred_at)}
        disabled={disabled}
        hasSlip={Boolean(payment?.slip_file_id)}
      />
    </form>
  );
}

/** Automatic check result and duplicate warnings above the decision buttons. */
function VerificationBlock({ payment }: { payment: PaymentRecord }) {
  const summary = summarizeVerification(payment.verification);
  const auto = readVerification(payment.verification).auto;
  if (!summary.label && !summary.duplicates.length && !summary.reasons.length) return null;

  const passed = summary.tone === "success";
  const Icon = passed ? BadgeCheck : AlertTriangle;
  const lines = [...summary.reasons, ...summary.duplicates];
  const read: string[] = [];
  if (auto && auto.state !== "skipped" && auto.state !== "unavailable") {
    if (typeof auto.amount === "number") read.push(`ยอด ${formatBaht(auto.amount)}`);
    if (auto.receiver?.name || auto.receiver?.account) read.push(`ผู้รับ ${[auto.receiver?.name, auto.receiver?.account].filter(Boolean).join(" ")}`);
    if (auto.transferred_at) read.push(`โอน ${formatThaiDateTime(auto.transferred_at)}`);
    if (auto.trans_ref) read.push(`เลขอ้างอิง ${auto.trans_ref}`);
  }

  return (
    <div className={`rounded-lg border px-4 py-3 text-sm ${passed ? "border-success/25 bg-success-bg text-success" : "border-warning/30 bg-warning-bg text-warning"}`}>
      <p className="flex items-center gap-2 font-semibold">
        <Icon className="size-4 shrink-0" aria-hidden="true" />
        {summary.label ?? "ต้องตรวจเอง"}
      </p>
      {lines.length ? (
        <ul className="mt-1.5 grid list-disc gap-0.5 pl-9 text-ink">
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {read.length ? <p className="mt-1.5 text-ink-muted">ข้อมูลจากสลิป: {read.join(" · ")}</p> : null}
    </div>
  );
}

function ReviewPanel({ disabled, isBypass, keep, row }: { disabled?: boolean; isBypass: boolean; keep: Keep; row: ReviewRow }) {
  if (row.stage === "not_required") {
    return <p className="rounded-lg bg-info-bg px-4 py-3 text-sm text-info">กิจกรรมนี้ไม่มีค่าใช้จ่าย ไม่ต้องตรวจการชำระเงิน</p>;
  }

  const payment = row.payment;
  const recorded = payment ? Number(payment.amount ?? 0) : null;
  const difference = recorded === null ? 0 : recorded - row.expected;
  const phone = row.member?.phone;
  const tel = phoneHref(phone);
  const slipDeleted = Boolean(payment?.files?.deleted_at);
  const receiptHref = payment ? (isBypass ? "/receipts/sample?bypass=admin" : `/receipts/${payment.id}`) : null;

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold text-ink">สลิปโอนเงิน</h3>
        {payment?.slip_file_id && !slipDeleted ? (
          <>
            {isBypass ? (
              <p className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-line bg-white p-4 text-center text-sm text-ink-muted">
                โหมดทดลอง: ไม่มีรูปสลิปจริง
              </p>
            ) : (
              <PaymentsSlipPreview
                href={`/admin/payments/proof/${payment.slip_file_id}`}
                mimeType={payment.files?.mime_type}
                path={payment.files?.object_path}
              />
            )}
            <p className="mt-2 flex items-center gap-1.5 text-sm text-ink-muted">
              <Clock className="size-4 shrink-0" aria-hidden="true" />
              โอนเมื่อ {formatThaiDateTime(payment.transferred_at)}
            </p>
          </>
        ) : slipDeleted ? (
          <p className="rounded-lg border border-dashed border-line bg-white p-4 text-sm text-ink-muted">
            ลบรูปสลิปแล้วตามระยะเวลาเก็บข้อมูลของชมรม รายการชำระเงินยังอยู่ครบ
          </p>
        ) : (
          <div className="rounded-lg border border-dashed border-warning/40 bg-warning-bg p-4 text-sm text-warning">
            <p className="font-semibold">ยังไม่มีสลิปจากสมาชิก</p>
            <p className="mt-1">ถ้ารับเงินทางอื่น เช่น เงินสดหน้างาน อนุมัติได้ แต่ต้องเขียนเหตุผลในช่องหมายเหตุ</p>
          </div>
        )}
      </div>

      <div className="grid min-w-0 content-start gap-4">
        {payment ? <VerificationBlock payment={payment} /> : null}

        <dl className="grid grid-cols-2 gap-3">
          <div className="rounded-lg border border-line bg-white p-3">
            <dt className="text-xs font-medium text-ink-muted">ยอดที่ต้องชำระ</dt>
            <dd className="mt-1 text-h2 font-semibold tabular-nums text-ink">{formatBaht(row.expected)}</dd>
          </div>
          <div className="rounded-lg border border-line bg-white p-3">
            <dt className="text-xs font-medium text-ink-muted">ยอดที่บันทึกไว้</dt>
            <dd className="mt-1 text-h2 font-semibold tabular-nums text-ink">{recorded === null ? "ยังไม่มี" : formatBaht(recorded)}</dd>
          </div>
        </dl>
        {recorded === null ? null : difference === 0 ? (
          <p className="-mt-2 flex items-center gap-1.5 text-sm font-medium text-success">
            <Check className="size-4" aria-hidden="true" />
            ยอดตรงกัน
          </p>
        ) : (
          <p className="-mt-2 flex items-center gap-1.5 text-sm font-medium text-warning">
            <AlertTriangle className="size-4" aria-hidden="true" />
            ยอด{difference > 0 ? "เกิน" : "ขาด"} <span className="tabular-nums">{formatBaht(Math.abs(difference))}</span>
          </p>
        )}

        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <div className="flex flex-wrap items-center gap-2">
            <dt className="text-ink-muted">สถานะตอนนี้</dt>
            <dd>
              {payment ? (
                <StatusBadge kind="payment" status={payment.status}>
                  {paymentRecordStatusLabels[payment.status] ?? payment.status}
                </StatusBadge>
              ) : (
                <span className="text-ink">ยังไม่มีรายการชำระ</span>
              )}
            </dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">{row.registration ? "สมัครเมื่อ" : "ส่งเมื่อ"}</dt>
            <dd className="text-ink">{formatThaiDateTime(row.createdAt)}</dd>
          </div>
          <div className="flex flex-wrap gap-2">
            <dt className="text-ink-muted">โทร</dt>
            <dd>
              {tel ? (
                <a className="font-medium text-brand-600 underline-offset-2 hover:underline" href={tel}>
                  {formatPhone(phone)}
                </a>
              ) : (
                <span className="text-ink">{formatPhone(phone)}</span>
              )}
            </dd>
          </div>
          <div className="flex min-w-0 flex-wrap gap-2">
            <dt className="text-ink-muted">อีเมล</dt>
            <dd className="min-w-0 break-all text-ink">{orUnset(row.member?.email)}</dd>
          </div>
          {payment?.status === "approved" && payment.receipt_no && receiptHref ? (
            <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
              <dt className="text-ink-muted">ใบเสร็จ</dt>
              <dd>
                <Link className="font-semibold tabular-nums text-brand-600 underline-offset-2 hover:underline" href={receiptHref} target="_blank">
                  {payment.receipt_no}
                </Link>
              </dd>
            </div>
          ) : null}
        </dl>

        <PaymentReviewForm disabled={disabled} keep={keep} row={row} />
      </div>
    </div>
  );
}

export default async function AdminPaymentsPage({ searchParams }: AdminPaymentsPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/payments",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("payments", access);
  const q = params.q?.trim() ?? "";
  // `stage` is the list filter; `status` only carries the result of the last save.
  const selectedStage = pickFilter(params.stage, paymentStageOrder);
  const selectedPurpose = pickFilter(params.purpose, purposeTabs) as PurposeTab;
  const selectedEvent = selectedPurpose === "all" || selectedPurpose === "event" ? (params.event ?? "all") : "all";
  let registrations = sampleRegistrations;
  let itemPayments = sampleItemPayments;
  let events: EventOption[] = [{ id: "sample-event-1", name: "ออกรอบประจำเดือน ธ.ค." }];
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const clubId = access.clubId;
    const legacyPayment = "id, amount, status, transferred_at, note, slip_file_id, created_at";
    const fullPayment = `${legacyPayment}, purpose, description, verification, receipt_no, reviewed_at, files(*)`;
    const registrationQuery = (paymentColumns: string) =>
      supabase
        .from("event_registrations")
        .select(
          `id, event_id, guest_name, registration_type, status, created_at, members(full_name, member_code, phone, email), events(name, venue, event_date, tee_off_time, member_price), payment_records(${paymentColumns})`,
        )
        .eq("club_id", clubId)
        .not("status", "in", "(cancelled,no_show)")
        .order("created_at", { ascending: false })
        .limit(300);

    const [registrationResult, itemResult, { data: eventData, error: eventError }] = await Promise.all([
      registrationQuery(fullPayment),
      supabase
        .from("payment_records")
        .select(`${fullPayment}, member_id, reference_id, members(full_name, member_code, phone, email)`)
        .eq("club_id", clubId)
        .neq("purpose", "event")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("events")
        .select("id, name")
        .eq("club_id", clubId)
        .is("archived_at", null)
        .order("event_date", { ascending: false })
        .limit(80),
    ]);

    // Without the payments migration the event list still loads the old way (no receipts or
    // automatic-check results); the banner says the database needs updating.
    let registrationData = registrationResult.data;
    let registrationError = registrationResult.error;
    const outdated = registrationError && classifyDbError(registrationError) === "schema-outdated" ? registrationError : null;
    if (outdated) {
      const legacy = await registrationQuery(`${legacyPayment}, files(mime_type, object_path)`);
      registrationData = legacy.data;
      registrationError = legacy.error;
    }

    loadError = collectLoadErrors("admin.payments", [
      { error: outdated, label: "ผลตรวจสลิปและใบเสร็จ" },
      { error: registrationError, label: "รายการสมัคร" },
      { error: itemResult.error, label: "ค่าแพ็กเกจเรียนและค่าบำรุง" },
      { error: eventError, label: "กิจกรรม" },
    ]);
    registrations = (registrationData ?? []) as unknown as RegistrationRow[];
    itemPayments = (itemResult.data ?? []) as unknown as ItemPaymentRow[];
    events = (eventData ?? []) as EventOption[];
  }

  const allRows = [...registrations.map(eventRow), ...itemPayments.map(itemRow)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // Purpose, event and search narrow the list first; tab and stage counters are computed on that
  // set so each says how many rows its filter will show.
  const searched = allRows.filter((row) => !q || row.searchText.includes(q.toLowerCase()));
  const inPurpose = (row: ReviewRow, purpose: PurposeTab) => purpose === "all" || row.purpose === purpose;
  const scoped = searched.filter((row) => inPurpose(row, selectedPurpose) && (selectedEvent === "all" || row.eventId === selectedEvent));
  const stageCounts = new Map<PaymentStage, number>();
  for (const row of scoped) {
    stageCounts.set(row.stage, (stageCounts.get(row.stage) ?? 0) + 1);
  }
  const visible = selectedStage === "all" ? scoped : scoped.filter((row) => row.stage === selectedStage);

  const statusMessage = params.status ? statusMessages[params.status] : null;
  const keep: Keep = { event: selectedEvent, purpose: selectedPurpose, q, stage: selectedStage };
  const listHref = (next: { purpose?: PurposeTab; stage?: string }) => {
    const query = new URLSearchParams();
    const purpose = next.purpose ?? selectedPurpose;
    if (access.isBypass) query.set("bypass", "admin");
    if (purpose !== "all") query.set("purpose", purpose);
    if (selectedEvent !== "all" && (purpose === "all" || purpose === "event")) query.set("event", selectedEvent);
    if (q) query.set("q", q);
    const stage = next.stage ?? selectedStage;
    if (stage !== "all") query.set("stage", stage);
    const text = query.toString();
    return `/admin/payments${text ? `?${text}` : ""}`;
  };
  const clearHref = `/admin/payments${access.isBypass ? "?bypass=admin" : ""}`;
  const settingsHref = `/admin/payments/settings${access.isBypass ? "?bypass=admin" : ""}`;
  const isFiltered = selectedStage !== "all" || selectedEvent !== "all" || selectedPurpose !== "all" || Boolean(q);
  const showEventFilter = selectedPurpose === "all" || selectedPurpose === "event";
  const cards: Array<{ hint: string; stage: PaymentStage; value: number }> = [
    { hint: "สมาชิกส่งสลิปแล้ว รอคุณตรวจ", stage: "awaiting_review", value: stageCounts.get("awaiting_review") ?? 0 },
    { hint: "ยังไม่ส่งสลิป", stage: "awaiting_payment", value: stageCounts.get("awaiting_payment") ?? 0 },
    { hint: "อนุมัติแล้ว", stage: "approved", value: stageCounts.get("approved") ?? 0 },
    { hint: "รอสมาชิกส่งสลิปใหม่", stage: "rejected", value: stageCounts.get("rejected") ?? 0 },
  ];
  const emptyText =
    selectedStage === "awaiting_review" && !q && selectedEvent === "all"
      ? "ไม่มีสลิปรอตรวจตอนนี้"
      : isFiltered
        ? "ไม่มีรายการที่ตรงกับตัวกรองนี้"
        : "ยังไม่มีรายการที่ต้องชำระเงิน";

  return (
    <main className="min-h-screen px-4 py-6 text-ink">
      <section className="mx-auto w-full max-w-7xl">
        <PageHeader
          actions={
            <Link className={buttonSecondary} href={settingsHref}>
              <Landmark className="size-4" aria-hidden="true" />
              บัญชีรับเงิน
            </Link>
          }
          description="เปิดดูสลิป เทียบยอด แล้วกดอนุมัติหรือไม่อนุมัติ"
          title="ตรวจสลิป"
        />

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <LoadErrorBanner error={loadError} />

        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">
            โหมดทดลอง: แสดงข้อมูลตัวอย่าง กดบันทึกไม่ได้
          </StatusBanner>
        ) : null}

        <nav aria-label="ประเภทการชำระเงิน" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
          {purposeTabs.map((tab) => {
            const active = selectedPurpose === tab;
            const waiting = searched.filter((row) => inPurpose(row, tab) && row.stage === "awaiting_review").length;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={`-mb-px flex shrink-0 items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition ${active ? "border-brand-600 text-brand-600" : "border-transparent text-ink-muted hover:text-ink"}`}
                href={listHref({ purpose: tab })}
                key={tab}
              >
                {purposeTabLabels[tab]}
                {waiting ? (
                  <span className="rounded-full bg-warning-bg px-2 text-xs font-semibold leading-5 text-warning tabular-nums">
                    <span className="sr-only">รอตรวจ </span>
                    {waiting.toLocaleString("th-TH")}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((card) => {
            const active = selectedStage === card.stage;
            const badge = stageBadge[card.stage];
            return (
              <Link
                aria-current={active ? "true" : undefined}
                className={`rounded-xl border bg-white p-4 shadow-card transition sm:p-5 ${active ? "border-brand-600 ring-4 ring-brand-600/10" : "border-line hover:border-brand-600/40"}`}
                href={listHref({ stage: active ? "all" : card.stage })}
                key={card.stage}
              >
                <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
                  <span aria-hidden="true" className={`size-2 rounded-full ${toneDot[statusTone(badge.kind, badge.status)]}`} />
                  {paymentStageLabels[card.stage]}
                </p>
                <p className="mt-2 text-kpi font-semibold tabular-nums text-ink">{card.value.toLocaleString("th-TH")}</p>
                <p className="mt-1 text-xs text-ink-subtle">{card.hint}</p>
              </Link>
            );
          })}
        </div>

        <section aria-labelledby="payments-list-title" className="mt-6 rounded-xl border border-line bg-white shadow-card">
          <div className="border-b border-line p-5">
            <h2 className="text-h3 font-semibold text-ink" id="payments-list-title">
              รายการ <span className="tabular-nums">{visible.length.toLocaleString("th-TH")}</span> รายการ
            </h2>
            <form className={`mt-3 grid gap-3 lg:items-end ${showEventFilter ? "lg:grid-cols-[minmax(0,1fr)_15rem_13rem_auto]" : "lg:grid-cols-[minmax(0,1fr)_13rem_auto]"}`}>
              {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
              {selectedPurpose !== "all" ? <input name="purpose" type="hidden" value={selectedPurpose} /> : null}
              <label className="block">
                <span className={fieldLabel}>ค้นหา</span>
                <span className="relative mt-1.5 block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
                  <input
                    className={`${fieldInputClass("sm", { margin: false })} pl-10`}
                    defaultValue={q}
                    name="q"
                    placeholder="ชื่อ เลขสมาชิก เบอร์โทร หรือรายการ"
                    type="search"
                  />
                </span>
              </label>
              {showEventFilter ? (
                <label className="block">
                  <span className={fieldLabel}>กิจกรรม</span>
                  <select className={fieldInputClass("sm")} defaultValue={selectedEvent} name="event">
                    <option value="all">ทุกกิจกรรม</option>
                    {events.map((event) => (
                      <option key={event.id} value={event.id}>
                        {event.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="block">
                <span className={fieldLabel}>สถานะ</span>
                <select className={fieldInputClass("sm")} defaultValue={selectedStage} name="stage">
                  <option value="all">ทุกสถานะ</option>
                  {paymentStageOrder.map((stage) => (
                    <option key={stage} value={stage}>
                      {paymentStageLabels[stage]}
                    </option>
                  ))}
                </select>
              </label>
              <button className={`${buttonPrimary} w-full lg:w-auto`} type="submit">
                <Search className="size-4" aria-hidden="true" />
                ค้นหา
              </button>
            </form>
          </div>

          {visible.length ? (
            <>
              <div aria-hidden="true" className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2 text-xs font-medium text-ink-subtle lg:grid ${columns}`}>
                <span>ผู้ชำระ</span>
                <span>รายการ</span>
                <span>ยอดเงิน / สลิป</span>
                <span />
              </div>
              <div className="divide-y divide-line">
                {visible.map((row) => {
                  const payment = row.payment;
                  const badge = stageBadge[row.stage];
                  const note = row.registration ? registrationNotes[row.registration.status] : undefined;
                  const toReview = row.stage === "awaiting_review";
                  const auto = summarizeVerification(payment?.verification);
                  const open = row.registration ? params.registration === row.registration.id : params.payment === payment?.id;

                  return (
                    <details className="group scroll-mt-24" id={row.anchor} key={row.anchor} open={open}>
                      <summary
                        className={`grid cursor-pointer list-none gap-3 px-5 py-4 outline-none transition hover:bg-canvas focus-visible:bg-canvas focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-brand-600/20 lg:items-center lg:gap-4 ${columns} [&::-webkit-details-marker]:hidden`}
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-ink">{row.name}</p>
                            <StatusBadge kind={badge.kind} status={badge.status}>
                              {paymentStageLabels[row.stage]}
                            </StatusBadge>
                            {note && note !== paymentStageLabels[row.stage] ? (
                              <StatusBadge kind="registration" status={row.registration?.status}>
                                {note}
                              </StatusBadge>
                            ) : null}
                            {toReview && auto.label ? <StatusBadge tone={auto.tone}>{auto.label}</StatusBadge> : null}
                          </div>
                          <p className="mt-1 text-sm text-ink-muted">
                            {row.member?.member_code ?? (row.guest ? "ผู้เล่นรับเชิญ" : "สมาชิก")} ·{" "}
                            {row.member?.phone ? formatPhone(row.member.phone) : orUnset(row.member?.email)}
                          </p>
                        </div>
                        <div className="min-w-0 text-sm">
                          <p className="text-xs font-medium text-ink-subtle lg:hidden">รายการ</p>
                          <p className="text-ink">
                            {selectedPurpose === "all" && row.purpose !== "event" ? (
                              <span className="font-medium text-ink-muted">{paymentPurposeLabels[row.purpose]} · </span>
                            ) : null}
                            {row.title}
                          </p>
                          <p className="mt-0.5 text-ink-muted">{row.subtitle}</p>
                        </div>
                        <div className="text-sm">
                          <p className="text-xs font-medium text-ink-subtle lg:hidden">ยอดเงิน</p>
                          <p className="font-semibold tabular-nums text-ink">{formatBaht(payment?.amount ?? row.expected)}</p>
                          <p className="mt-0.5 text-ink-muted">
                            {payment?.slip_file_id ? `โอน ${formatThaiDateTime(payment.transferred_at)}` : "ยังไม่มีสลิป"}
                          </p>
                        </div>
                        <span
                          className={`${buttonClass(toReview ? "primary" : "secondary", "sm")} w-full group-open:bg-brand-50 group-open:text-brand-600 lg:w-auto lg:justify-self-end`}
                        >
                          {toReview ? "ตรวจสลิป" : "รายละเอียด"}
                          <ChevronDown className="size-4 transition group-open:rotate-180" aria-hidden="true" />
                        </span>
                      </summary>

                      <div className="border-t border-line bg-canvas px-5 py-5">
                        <ReviewPanel disabled={access.isBypass} isBypass={access.isBypass} keep={keep} row={row} />
                      </div>
                    </details>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="px-5 py-12 text-center">
              <p className="text-sm font-medium text-ink">{emptyText}</p>
              {isFiltered ? (
                <Link className={`${buttonSecondary} mt-4`} href={clearHref}>
                  ดูทุกรายการ
                </Link>
              ) : (
                <Link className={`${buttonPrimary} mt-4`} href={`/admin/events${access.isBypass ? "?bypass=admin" : ""}`}>
                  ไปหน้ากิจกรรมออกรอบ
                </Link>
              )}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
