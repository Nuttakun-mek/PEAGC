import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock,
  Filter,
  ReceiptText,
  Search,
  UserRound,
} from "lucide-react";

import { PaymentDecisionFields } from "@/components/payment-decision-fields";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { resolveAccess } from "@/lib/auth/access";
import { formatBaht, formatPhone, formatThaiDate, orUnset } from "@/lib/display";
import { pickFilter } from "@/lib/filters";
import { formatBangkokDateTime, toBangkokInputValue } from "@/lib/lessons/booking";
import { NO_SLIP_REASON_MIN, type PaymentStage, paymentStage, paymentStageLabels, paymentStageOrder } from "@/lib/payments";
import { collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

import { updatePaymentReview } from "./actions";

type AdminPaymentsPageProps = {
  searchParams: Promise<{
    bypass?: string;
    event?: string;
    q?: string;
    registration?: string;
    stage?: string;
    status?: string;
  }>;
};

type PaymentRecord = {
  amount: number;
  created_at?: string;
  id: string;
  note: string | null;
  status: string;
  slip_file_id: string | null;
  transferred_at: string | null;
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
  members: {
    email: string | null;
    full_name: string;
    member_code: string | null;
    phone: string | null;
  } | null;
  payment_records: PaymentRecord[] | null;
  registration_type: string;
  status: string;
};

type EventOption = {
  id: string;
  name: string;
};

const sampleRegistrations: RegistrationRow[] = [
  {
    created_at: "2026-07-09T09:00:00.000Z",
    event_id: "sample-event-1",
    events: {
      event_date: "2026-08-15",
      member_price: 2200,
      name: "ออกรอบประจำเดือน PEAGC",
      tee_off_time: "11:30",
      venue: "สนามกอล์ฟรอยัล",
    },
    guest_name: null,
    id: "sample-registration-1",
    members: {
      email: "member@example.com",
      full_name: "สมาชิกทดลอง",
      member_code: "PEA001",
      phone: "0812345678",
    },
    payment_records: [
      {
        amount: 2200,
        id: "sample-payment-1",
        note: "รอตรวจหลักฐานการชำระเงิน",
        slip_file_id: null,
        status: "review",
        transferred_at: "2026-07-09T08:45:00.000Z",
      },
    ],
    registration_type: "single",
    status: "payment_review",
  },
  {
    created_at: "2026-07-09T10:30:00.000Z",
    event_id: "sample-event-1",
    events: {
      event_date: "2026-08-15",
      member_price: 2200,
      name: "ออกรอบประจำเดือน PEAGC",
      tee_off_time: "11:30",
      venue: "สนามกอล์ฟรอยัล",
    },
    guest_name: null,
    id: "sample-registration-2",
    members: {
      email: "new.member@example.com",
      full_name: "สมาชิกรอตรวจสอบ",
      member_code: "PEA002",
      phone: "0898765432",
    },
    payment_records: null,
    registration_type: "single",
    status: "pending_payment",
  },
];

const registrationNotes: Record<string, string> = {
  checked_in: "เช็กอินแล้ว",
  waitlist: "รายชื่อสำรอง",
};

const stageClasses: Record<PaymentStage, string> = {
  approved: "bg-[#edf9f3] text-[#16794b]",
  awaiting_payment: "bg-[#f1f3ef] text-[#475467]",
  awaiting_review: "bg-[#fff5d8] text-[#805300]",
  not_required: "bg-[#eef4ff] text-[#3538cd]",
  refunded: "bg-[#f2f4f7] text-[#475467]",
  rejected: "bg-[#fdecec] text-[#9f1d1d]",
  waitlist: "bg-[#f8edf4] text-[#722257]",
};

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "amount-invalid": "จำนวนเงินต้องไม่ติดลบ",
  "approve-needs-reason": `ยังไม่มีสลิปจากสมาชิก หากจะอนุมัติต้องระบุเหตุผลอย่างน้อย ${NO_SLIP_REASON_MIN} ตัวอักษร เช่น รับเงินสดหน้างาน`,
  "invalid-status": "สถานะการชำระเงินไม่ถูกต้อง",
  "missing-registration": "ไม่พบรายการสมัครกิจกรรม",
  "payment-approved": "อนุมัติการชำระเงินแล้ว สถานะผู้สมัครเป็น \"ชำระแล้ว\"",
  "payment-update-failed": "ไม่สามารถบันทึกผลตรวจสอบการชำระเงินได้",
  "payment-updated": "บันทึกผลตรวจสอบการชำระเงินแล้ว",
  "registration-update-failed": "บันทึกการชำระเงินแล้ว แต่ปรับสถานะการสมัครไม่สำเร็จ",
};

function getLatestPayment(registration: RegistrationRow) {
  // PostgREST does not order embedded rows, so pick the newest explicitly.
  return (
    [...(registration.payment_records ?? [])].sort((a, b) =>
      (b.created_at ?? "").localeCompare(a.created_at ?? ""),
    )[0] ?? null
  );
}

function stageOf(registration: RegistrationRow) {
  return paymentStage({
    payment: getLatestPayment(registration),
    price: registration.events?.member_price,
    registrationStatus: registration.status,
  });
}

const inputClass =
  "mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10";

function PaymentReviewForm({
  disabled,
  keep,
  registration,
}: {
  disabled?: boolean;
  keep: { event: string; q: string; stage: string };
  registration: RegistrationRow;
}) {
  const payment = getLatestPayment(registration);
  const hasSlip = Boolean(payment?.slip_file_id);
  const defaultAmount = payment?.amount ?? registration.events?.member_price ?? 0;
  // A slip waiting for review opens as "approve"; without a slip the form starts at the current state.
  const defaultStatus = payment?.status ?? (hasSlip ? "review" : "pending");

  return (
    <form
      action={updatePaymentReview}
      className="grid gap-4 rounded-lg border border-[#e6e2ee] bg-white p-4"
      key={`${payment?.id ?? "new"}:${payment?.status ?? ""}`}
    >
      <input name="registrationId" type="hidden" value={registration.id} />
      {payment ? <input name="paymentId" type="hidden" value={payment.id} /> : null}
      <input name="keepEvent" type="hidden" value={keep.event === "all" ? "" : keep.event} />
      <input name="keepQ" type="hidden" value={keep.q} />
      <input name="keepStage" type="hidden" value={keep.stage === "all" ? "" : keep.stage} />

      <div className="grid gap-4 md:grid-cols-[160px_200px_1fr]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">จำนวนเงิน (บาท)</span>
          <input
            className={`${inputClass} tabular-nums`}
            defaultValue={defaultAmount}
            disabled={disabled}
            min="0"
            name="amount"
            step="0.01"
            type="number"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">วันเวลาที่โอน</span>
          <input
            className={inputClass}
            defaultValue={toBangkokInputValue(payment?.transferred_at)}
            disabled={disabled}
            name="transferredAt"
            type="datetime-local"
          />
        </label>
        <div className="hidden md:block" />
      </div>

      <div className="grid gap-4 md:grid-cols-[260px_1fr]">
        <PaymentDecisionFields
          defaultNote={payment?.note ?? ""}
          defaultStatus={defaultStatus}
          disabled={disabled}
          hasSlip={hasSlip}
          inputClass={inputClass}
        />
      </div>

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-5 text-sm font-semibold text-white transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6] md:w-fit"
        disabled={disabled}
        type="submit"
      >
        <BadgeCheck className="size-4" aria-hidden="true" />
        บันทึกผลตรวจสอบ
      </button>
    </form>
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
  const q = params.q?.trim() ?? "";
  // `stage` is the list filter; `status` only carries the result of the last save.
  const selectedStage = pickFilter(params.stage, paymentStageOrder);
  const selectedEvent = params.event ?? "all";
  let registrations = sampleRegistrations;
  let events: EventOption[] = [{ id: "sample-event-1", name: "ออกรอบประจำเดือน PEAGC" }];
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const [{ data: registrationData, error: registrationError }, { data: eventData, error: eventError }] = await Promise.all([
      supabase
        .from("event_registrations")
        .select(
          "id, event_id, guest_name, registration_type, status, created_at, members(full_name, member_code, phone, email), events(name, venue, event_date, tee_off_time, member_price), payment_records(id, amount, status, transferred_at, note, slip_file_id, created_at)",
        )
        .eq("club_id", access.clubId)
        .not("status", "in", "(cancelled,no_show)")
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("events")
        .select("id, name")
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("event_date", { ascending: false })
        .limit(80),
    ]);

    loadError = collectLoadErrors("admin.payments", [
      { error: registrationError, label: "รายการสมัคร" },
      { error: eventError, label: "กิจกรรม" },
    ]);
    registrations = (registrationData ?? []) as unknown as RegistrationRow[];
    events = (eventData ?? []) as EventOption[];
  }

  // Event + search narrow the list first; the stage counters are computed on that set so each
  // card says how many rows its filter will show.
  const scoped = registrations.filter((registration) => {
    const matchesEvent = selectedEvent === "all" || registration.event_id === selectedEvent;
    const haystack = [
      registration.events?.name,
      registration.events?.venue,
      registration.members?.full_name,
      registration.members?.member_code,
      registration.members?.phone,
      registration.members?.email,
      registration.guest_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    return matchesEvent && (!q || haystack.includes(q.toLowerCase()));
  });
  const stageCounts = new Map<PaymentStage, number>();
  for (const registration of scoped) {
    const stage = stageOf(registration);
    stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
  }
  const visible = selectedStage === "all" ? scoped : scoped.filter((registration) => stageOf(registration) === selectedStage);

  const statusMessage = params.status ? statusMessages[params.status] : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";
  const keep = { event: selectedEvent, q, stage: selectedStage };
  const filterHref = (stage: string) => {
    const query = new URLSearchParams();
    if (access.isBypass) query.set("bypass", "admin");
    if (selectedEvent !== "all") query.set("event", selectedEvent);
    if (q) query.set("q", q);
    if (stage !== "all") query.set("stage", stage);
    const text = query.toString();
    return `/admin/payments${text ? `?${text}` : ""}`;
  };
  const cards: Array<{ hint: string; stage: PaymentStage | "all"; value: number }> = [
    { hint: "สมาชิกส่งสลิปแล้ว รอผู้ดูแลตรวจ", stage: "awaiting_review", value: stageCounts.get("awaiting_review") ?? 0 },
    { hint: "ยังไม่ได้ส่งสลิป", stage: "awaiting_payment", value: stageCounts.get("awaiting_payment") ?? 0 },
    { hint: "อนุมัติแล้ว", stage: "approved", value: stageCounts.get("approved") ?? 0 },
    { hint: "รอสมาชิกส่งสลิปใหม่", stage: "rejected", value: stageCounts.get("rejected") ?? 0 },
  ];

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">ระบบผู้ดูแล</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">ตรวจสอบการชำระเงิน</h1>
            <p className="mt-2 text-sm text-[#6b6475]">
              ตรวจสลิป อนุมัติยอดชำระ และติดตามผู้สมัครที่ยังไม่ชำระในจุดเดียว
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]"
              href={`/admin${bypassQuery}`}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              กลับหน้าผู้ดูแล
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
              href={`/admin/events${bypassQuery}`}
            >
              จัดการกิจกรรม
            </Link>
          </div>
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <LoadErrorBanner error={loadError} />

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลการชำระเงินตัวอย่างและปิดการบันทึกจริง
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          {cards.map((card) => {
            const active = selectedStage === card.stage;
            return (
              <Link
                aria-current={active ? "true" : undefined}
                className={`rounded-lg border p-4 transition sm:p-5 ${active ? "border-[#722257] bg-[#fdf7fb] shadow-[0_10px_28px_rgba(114,34,87,0.14)]" : "border-[#e6e2ee] bg-white/95 hover:border-[#c9b3c2]"}`}
                href={filterHref(active ? "all" : card.stage)}
                key={card.stage}
              >
                <p className="flex items-center gap-2 text-sm font-semibold text-[#3f3a48]">
                  <span className={`size-2 rounded-full ${card.stage === "awaiting_review" ? "bg-[#d7a52c]" : card.stage === "approved" ? "bg-[#16794b]" : card.stage === "rejected" ? "bg-[#b42318]" : "bg-[#98a2b3]"}`} />
                  {paymentStageLabels[card.stage as PaymentStage]}
                </p>
                <p className="mt-2 text-3xl font-semibold tabular-nums text-[#722257]">{card.value}</p>
                <p className="mt-1 text-xs text-[#6b6475]">{card.hint}</p>
              </Link>
            );
          })}
        </div>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_220px_200px_110px]">
              {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]" aria-hidden="true" />
                <input
                  aria-label="ค้นหา"
                  className="h-11 w-full rounded-md border border-[#d9d3e6] pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={q}
                  name="q"
                  placeholder="ค้นหาชื่อ เลขสมาชิก โทรศัพท์ กิจกรรม หรือสนาม"
                  type="search"
                />
              </label>
              <label className="relative block">
                <CalendarDays className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]" aria-hidden="true" />
                <select
                  aria-label="กิจกรรม"
                  className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={selectedEvent}
                  name="event"
                >
                  <option value="all">ทุกกิจกรรม</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative block">
                <Filter className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]" aria-hidden="true" />
                <select
                  aria-label="สถานะการชำระเงิน"
                  className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={selectedStage}
                  name="stage"
                >
                  <option value="all">ทุกสถานะ</option>
                  {paymentStageOrder.map((stage) => (
                    <option key={stage} value={stage}>
                      {paymentStageLabels[stage]}
                    </option>
                  ))}
                </select>
              </label>
              <button className="h-11 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white" type="submit">
                ค้นหา
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#e6e2ee]">
            {visible.length ? (
              visible.map((registration) => {
                const payment = getLatestPayment(registration);
                const stage = stageOf(registration);
                const memberName = registration.members?.full_name ?? registration.guest_name ?? "ผู้สมัคร";
                const note = registrationNotes[registration.status];

                return (
                  <details
                    className="group scroll-mt-24 px-5 py-4"
                    id={`registration-${registration.id}`}
                    key={registration.id}
                    open={params.registration === registration.id}
                  >
                    <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1fr_0.9fr_0.7fr_104px] lg:items-center">
                      <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                        <ReceiptText className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[#722257]">{memberName}</p>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${stageClasses[stage]}`}>
                            {paymentStageLabels[stage]}
                          </span>
                          {note ? (
                            <span className="rounded-md bg-[#f1f3ef] px-2 py-1 text-xs font-semibold text-[#6b6475]">{note}</span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-sm text-[#6b6475]">
                          {registration.members?.member_code ?? "ผู้เล่นรับเชิญ"} · {registration.members?.phone ? formatPhone(registration.members.phone) : orUnset(registration.members?.email)}
                        </p>
                      </div>
                      <div className="text-sm text-[#3f3a48]">
                        <p>{orUnset(registration.events?.name)}</p>
                        <p className="mt-1 text-[#6b6475]">
                          {formatThaiDate(registration.events?.event_date)} · {orUnset(registration.events?.venue)}
                        </p>
                      </div>
                      <div className="text-sm text-[#3f3a48]">
                        <p className="tabular-nums">{formatBaht(payment?.amount ?? registration.events?.member_price ?? 0)}</p>
                        <p className="mt-1 text-[#6b6475]">
                          {payment?.slip_file_id ? `โอน ${formatBangkokDateTime(payment.transferred_at)}` : "ยังไม่มีสลิป"}
                        </p>
                      </div>
                      <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-[#f8edf4]">
                        ตรวจสอบ
                      </span>
                    </summary>

                    <div className="mt-5 grid gap-4">
                      {payment?.slip_file_id ? (
                        <div className="flex flex-col gap-3 rounded-lg border border-[#bfe3cf] bg-[#f3fbf6] p-4 sm:flex-row sm:items-center sm:justify-between">
                          <p className="flex items-center gap-2 text-sm font-semibold text-[#16794b]">
                            <BadgeCheck className="size-4" aria-hidden="true" />
                            สมาชิกส่งสลิปแล้ว · โอนเมื่อ {formatBangkokDateTime(payment.transferred_at)}
                          </p>
                          <Link
                            className="flex h-10 w-fit items-center gap-2 rounded-md border border-[#16794b] bg-white px-4 text-sm font-semibold text-[#16794b]"
                            href={`/admin/payments/proof/${payment.slip_file_id}`}
                            target="_blank"
                          >
                            <ReceiptText className="size-4" aria-hidden="true" />
                            เปิดดูสลิป
                          </Link>
                        </div>
                      ) : stage === "not_required" ? null : (
                        <div className="flex items-start gap-2 rounded-lg border border-[#efd9a6] bg-[#fff9ed] p-4 text-sm text-[#805300]">
                          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                          <span>
                            ยังไม่มีสลิปจากสมาชิก หากรับเงินช่องทางอื่น (เช่น เงินสดหน้างาน) และต้องการอนุมัติ ต้องระบุเหตุผลในช่องหมายเหตุ
                          </span>
                        </div>
                      )}
                      <div className="grid gap-3 rounded-md bg-[#fafbfc] p-4 text-sm text-[#3f3a48] md:grid-cols-3">
                        <div className="flex items-start gap-2">
                          <UserRound className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                          <div>
                            <p className="font-semibold text-[#6b6475]">ผู้สมัคร</p>
                            <p className="mt-1 text-[#722257]">{memberName}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <CircleDollarSign className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                          <div>
                            <p className="font-semibold text-[#6b6475]">ยอดที่ต้องชำระ</p>
                            <p className="mt-1 tabular-nums text-[#722257]">{formatBaht(registration.events?.member_price ?? 0)}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <Clock className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                          <div>
                            <p className="font-semibold text-[#6b6475]">วันที่สมัคร</p>
                            <p className="mt-1 text-[#722257]">{formatBangkokDateTime(registration.created_at)}</p>
                          </div>
                        </div>
                      </div>

                      {stage === "not_required" ? (
                        <p className="rounded-md bg-[#eef4ff] px-4 py-3 text-sm text-[#3538cd]">กิจกรรมนี้ไม่มีค่าใช้จ่าย ไม่ต้องตรวจการชำระเงิน</p>
                      ) : (
                        <PaymentReviewForm disabled={access.isBypass} keep={keep} registration={registration} />
                      )}
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="px-5 py-12 text-center">
                <ReceiptText className="mx-auto size-8 text-[#c9c3d3]" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-[#3f3a48]">ไม่มีรายการในตัวกรองนี้</p>
                <p className="mt-1 text-sm text-[#6b6475]">ลองเลือก &quot;ทุกสถานะ&quot; หรือเปลี่ยนกิจกรรม</p>
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
