import Link from "next/link";
import { ArrowLeft, CalendarClock, IdCard } from "lucide-react";

import { payMembershipFee } from "@/app/member/membership/actions";
import { MemberSection } from "@/components/member-section";
import { PaymentSlipInput } from "@/components/payment-slip-input";
import { PromptPayPaymentCard } from "@/components/promptpay-payment-card";
import { StatusBanner } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { UNSET, formatBaht, formatThaiDate, formatThaiDateLong, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { membershipTermStatusLabels } from "@/lib/labels";
import {
  type MemberLifecycle,
  addDays,
  bangkokToday,
  daysUntil,
  deriveLifecycle,
  isRenewalOpen,
  memberLifecycleLabels,
  nextTermPeriod,
} from "@/lib/membership/lifecycle";
import { loadMyMembership } from "@/lib/membership/member-data";
import { type MembershipSettings, defaultMembershipSettings } from "@/lib/membership/settings";
import { type PaymentSettings, loadPaymentSettings } from "@/lib/payments/settings";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

type Term = {
  fee: number | string;
  id: string;
  payment_record_id: string | null;
  period_end: string;
  period_start: string;
  status: string;
};

const PaymentsIcon = appIcons.payments;
const UploadIcon = appIcons.upload;

const statusMessages: Record<string, { text: string; tone: "success" | "info" | "warning" | "error" }> = {
  "fee-approved": { text: "ชำระค่าบำรุงแล้ว บัตรสมาชิกต่ออายุเรียบร้อย", tone: "success" },
  "fee-db-failed": { text: "บันทึกสลิปไม่สำเร็จ ลองอีกครั้ง", tone: "error" },
  "fee-duplicate-slip": { text: "สลิปนี้เคยใช้ชำระรายการอื่นแล้ว ใช้สลิปของการโอนครั้งนี้", tone: "error" },
  "fee-failed": { text: "ส่งสลิปไม่สำเร็จ ลองอีกครั้ง", tone: "error" },
  "fee-in-review": { text: "ส่งสลิปไว้แล้ว รอผู้ดูแลตรวจ", tone: "warning" },
  "fee-invalid-file": { text: "ไฟล์ต้องเป็นรูป JPG, PNG, WebP หรือ PDF", tone: "error" },
  "fee-none": { text: "ชมรมไม่เก็บค่าบำรุงรายปี", tone: "info" },
  "fee-not-approved": { text: "ชำระค่าบำรุงได้หลังผู้ดูแลอนุมัติสมาชิก", tone: "warning" },
  "fee-not-due": { text: "ยังไม่ถึงช่วงต่ออายุ", tone: "info" },
  "fee-slip-required": { text: "แนบสลิปโอนเงินก่อนส่ง", tone: "error" },
  "fee-submitted": { text: "ส่งสลิปแล้ว ผู้ดูแลจะตรวจและต่ออายุให้", tone: "success" },
  "fee-too-large": { text: "ไฟล์ใหญ่เกิน 10 MB", tone: "error" },
  "fee-unavailable": { text: "ยังชำระค่าบำรุงทางหน้านี้ไม่ได้ กรุณาติดต่อผู้ดูแลชมรม", tone: "warning" },
  "fee-upload-failed": { text: "อัปโหลดไม่สำเร็จ ลองอีกครั้ง", tone: "error" },
};

type View = {
  clubId: string | null;
  expiresAt: string | null;
  joinedAt: string | null;
  lifecycle: MemberLifecycle;
  memberId: string | null;
  memberStatus: string | null;
  paymentSettings: PaymentSettings | null;
  pendingPaymentStatus: string | null;
  settings: MembershipSettings;
  sponsor: { full_name: string; member_code: string | null } | null;
  statusReason: string | null;
  terms: Term[];
};

const statusReasonLabels: Record<string, string> = {
  left_directory: "ไม่อยู่ในฐานสมาชิกสมาคมเกินระยะผ่อนผัน",
  membership_expired: "ไม่ได้ต่ออายุตามกำหนด",
};

function sampleView(today: string): View {
  return {
    clubId: null,
    expiresAt: addDays(today, 20),
    joinedAt: "2025-12-14",
    lifecycle: "expiring",
    memberId: "demo-member",
    memberStatus: "active",
    paymentSettings: {
      accountName: "ชมรมกอล์ฟ กฟภ.",
      autoVerify: false,
      bankAccountNo: null,
      bankName: null,
      clubId: "sample",
      note: null,
      promptPayId: "0812345678",
      slipRetentionDays: 365,
      updatedAt: null,
    },
    pendingPaymentStatus: null,
    settings: { ...defaultMembershipSettings, annualFee: 500 },
    sponsor: null,
    statusReason: null,
    terms: [{ fee: 500, id: "t1", payment_record_id: "p1", period_end: addDays(today, 20), period_start: "2025-12-14", status: "active" }],
  };
}

export default async function MembershipPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "member",
    nextPath: "/member/membership",
    requiredRole: "member",
    searchParams: params,
  });
  const today = bangkokToday();
  let view: View | null = null;
  let unavailable = false;

  if (access.isBypass) {
    view = sampleView(today);
  } else {
    const mine = await loadMyMembership(access.userId);
    if (!mine.available) {
      unavailable = true;
    } else if (mine.member) {
      const supabase = await createClient();
      const [{ data: termData }, paymentSettings] = await Promise.all([
        supabase
          .from("membership_terms")
          .select("id, period_start, period_end, fee, status, payment_record_id")
          .eq("member_id", mine.member.id)
          .order("period_end", { ascending: false })
          .limit(12),
        loadPaymentSettings(supabase, mine.member.club_id),
      ]);
      const terms = (termData ?? []) as Term[];
      const pending = terms.find((term) => term.status === "pending_payment");
      let pendingPaymentStatus: string | null = null;
      if (pending?.payment_record_id) {
        const { data: payment } = await supabase.from("payment_records").select("status").eq("id", pending.payment_record_id).maybeSingle();
        pendingPaymentStatus = (payment as { status: string } | null)?.status ?? null;
      }
      view = {
        clubId: mine.member.club_id,
        expiresAt: mine.member.membership_expires_at,
        joinedAt: mine.member.joined_at,
        lifecycle: deriveLifecycle(mine.member, today, mine.settings.renewalNoticeDays),
        memberId: mine.member.id,
        memberStatus: mine.member.status,
        paymentSettings,
        pendingPaymentStatus,
        settings: mine.settings,
        sponsor: mine.sponsor,
        statusReason: mine.member.status_reason,
        terms,
      };
    }
  }

  const backHref = access.isBypass ? "/member?bypass=member" : "/member";
  const message = params.status ? statusMessages[params.status] : null;

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:py-8">
      <div className="mx-auto grid w-full max-w-3xl gap-5">
        <Link className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline" href={backHref}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          หน้าสมาชิก
        </Link>
        <PageHeader description="วันหมดอายุ ค่าบำรุงรายปี และประวัติการต่ออายุ" title="สมาชิกภาพ" />

        {message ? (
          <StatusBanner floating tone={message.tone}>
            {message.text}
          </StatusBanner>
        ) : null}
        {access.isBypass ? <StatusBanner tone="warning">โหมดทดลอง ข้อมูลในหน้านี้เป็นตัวอย่าง ส่งสลิปไม่ได้</StatusBanner> : null}

        {unavailable ? (
          <StatusBanner tone="info">หน้านี้ยังไม่เปิดใช้ กรุณาติดต่อผู้ดูแลชมรมเรื่องค่าบำรุงและวันหมดอายุ</StatusBanner>
        ) : !view ? (
          <StatusBanner tone="info">
            ยังไม่ได้สมัครสมาชิก{" "}
            <Link className="font-semibold underline underline-offset-4" href="/profile">
              สมัครสมาชิก
            </Link>
          </StatusBanner>
        ) : (
          <MembershipBody isBypass={access.isBypass} today={today} view={view} />
        )}
      </div>
    </main>
  );
}

function MembershipBody({ isBypass, today, view }: { isBypass: boolean; today: string; view: View }) {
  const { settings } = view;
  const usable = view.lifecycle === "active" || view.lifecycle === "expiring" || view.lifecycle === "expired";
  const renewalOpen = isRenewalOpen(view.expiresAt, today, settings.renewalNoticeDays);
  const next = nextTermPeriod({ currentExpiresAt: view.expiresAt, termMonths: settings.termMonths, today });
  const pendingTerm = view.terms.find((term) => term.status === "pending_payment");
  const waitingReview = Boolean(pendingTerm && (view.pendingPaymentStatus === "review" || view.pendingPaymentStatus === "pending"));
  const rejected = view.pendingPaymentStatus === "rejected";
  const daysLeft = view.expiresAt ? daysUntil(view.expiresAt, today) : null;
  const opensOn = view.expiresAt ? addDays(view.expiresAt, -settings.renewalNoticeDays) : null;

  return (
    <>
      <MemberSection icon={IdCard} id="status" title="สถานะสมาชิก">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge kind="memberLifecycle" status={view.lifecycle}>
            {memberLifecycleLabels[view.lifecycle]}
          </StatusBadge>
          {view.lifecycle === "expiring" && daysLeft !== null ? (
            <span className="text-sm font-medium text-warning">อีก {daysLeft} วันหมดอายุ</span>
          ) : null}
        </div>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-medium text-ink-subtle">ใช้ได้ถึง</dt>
            <dd className="mt-0.5 font-semibold text-ink">{view.expiresAt ? formatThaiDateLong(view.expiresAt) : "ไม่มีวันหมดอายุ"}</dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-ink-subtle">สมาชิกตั้งแต่</dt>
            <dd className="mt-0.5 font-semibold text-ink">{formatThaiDate(view.joinedAt)}</dd>
          </div>
          {view.sponsor ? (
            <div>
              <dt className="text-xs font-medium text-ink-subtle">สมาชิกผู้รับรอง</dt>
              <dd className="mt-0.5 font-semibold text-ink">
                {view.sponsor.full_name}
                {view.sponsor.member_code ? <span className="ml-1 font-normal tabular-nums text-ink-muted">{view.sponsor.member_code}</span> : null}
              </dd>
            </div>
          ) : null}
        </dl>
        {view.lifecycle === "suspended" || view.lifecycle === "resigned" ? (
          <p className="mt-4 rounded-lg bg-danger-bg px-3 py-2.5 text-sm text-danger">
            {view.lifecycle === "suspended" ? "ระงับสิทธิ์ชั่วคราว" : "พ้นสภาพสมาชิกแล้ว"}
            {view.statusReason ? ` · ${statusReasonLabels[view.statusReason] ?? view.statusReason}` : ""} ติดต่อผู้ดูแลชมรมหากข้อมูลไม่ถูกต้อง
          </p>
        ) : null}
      </MemberSection>

      <MemberSection icon={PaymentsIcon} id="fee" title="ค่าบำรุงรายปี">
        {settings.annualFee <= 0 ? (
          <p className="text-base text-ink-muted">ชมรมไม่เก็บค่าบำรุงรายปี บัตรสมาชิกใช้ได้ต่อเนื่อง</p>
        ) : !usable ? (
          <p className="text-base text-ink-muted">ชำระค่าบำรุงได้เมื่อสมาชิกได้รับอนุมัติและยังไม่ถูกระงับ</p>
        ) : waitingReview ? (
          <p className="rounded-lg bg-warning-bg px-3 py-2.5 text-base text-warning">
            ส่งสลิปค่าบำรุง {formatBaht(pendingTerm?.fee)} แล้ว รอผู้ดูแลตรวจ อนุมัติแล้วบัตรจะต่ออายุเอง
          </p>
        ) : !renewalOpen ? (
          <p className="text-base text-ink-muted">
            ค่าบำรุงปีละ <span className="font-semibold tabular-nums text-ink">{formatBaht(settings.annualFee)}</span> ต่ออายุได้ตั้งแต่{" "}
            <span className="font-semibold text-ink">{formatThaiDate(opensOn)}</span>
          </p>
        ) : (
          <div className="grid gap-4">
            <p className="text-base text-ink">
              {view.expiresAt ? "ต่ออายุ" : "ค่าบำรุง"} {settings.termMonths} เดือน{" "}
              <span className="font-semibold">
                {formatThaiDate(next.start)} – {formatThaiDate(next.end)}
              </span>
            </p>
            {rejected ? (
              <p className="rounded-lg bg-danger-bg px-3 py-2.5 text-sm font-medium text-danger">สลิปเดิมไม่ผ่านการตรวจ ส่งใหม่อีกครั้ง</p>
            ) : null}
            <PromptPayPaymentCard amount={Number(pendingTerm?.fee ?? settings.annualFee)} description="ค่าบำรุงสมาชิกรายปี" settings={view.paymentSettings} />
            <form action={payMembershipFee} className="grid gap-3">
              <PaymentSlipInput disabled={isBypass} required />
              <SubmitButton className={`${buttonClass("primary", "lg")} w-full sm:w-fit`} disabled={isBypass} pendingText="กำลังส่งสลิป...">
                <UploadIcon className="size-4" aria-hidden="true" />
                ส่งสลิปค่าบำรุง
              </SubmitButton>
            </form>
          </div>
        )}
      </MemberSection>

      {view.terms.length ? (
        <MemberSection icon={CalendarClock} id="terms" title="ประวัติการต่ออายุ">
          <ul className="divide-y divide-line">
            {view.terms.map((term) => (
              <li className="flex flex-wrap items-start justify-between gap-2 py-3 first:pt-0 last:pb-0" key={term.id}>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">
                    {formatThaiDateShort(term.period_start)} – {formatThaiDateShort(term.period_end)}
                  </p>
                  <p className="text-sm tabular-nums text-ink-muted">{formatBaht(term.fee)}</p>
                </div>
                <StatusBadge kind="membershipTerm" status={term.status}>
                  {membershipTermStatusLabels[term.status] ?? term.status ?? UNSET}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </MemberSection>
      ) : null}
    </>
  );
}
