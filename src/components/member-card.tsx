import Link from "next/link";
import { BadgeCheck, CalendarClock, Clock3, Coins, ShieldAlert, UserX } from "lucide-react";

import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { MemberAvatar } from "@/components/member-avatar";
import { buttonClass } from "@/components/ui/styles";
import { UNSET, formatThaiDate } from "@/lib/display";
import type { MemberLifecycle } from "@/lib/membership/lifecycle";

export type MemberCardData = {
  association_member_code?: string | null;
  association_member_type?: string | null;
  avatar_url?: string | null;
  employee_code?: string | null;
  full_name?: string | null;
  joined_at?: string | null;
  member_code?: string | null;
  nickname?: string | null;
  status?: string | null;
  work_line?: string | null;
};

/** Membership extras loaded by MembershipMemberCard (hidden until the membership migration is applied). */
export type MemberCardMembership = {
  /** members.membership_expires_at; null = no annual expiry. */
  expiresAt?: string | null;
  lifecycle?: MemberLifecycle | null;
  /** Link to the renewal page, shown when renewal is open and the club collects a fee. */
  renewHref?: string | null;
  /** แต้มสะสม balance; null hides the row. */
  points?: number | null;
  pointsHref?: string | null;
};

type Meta = { icon: typeof BadgeCheck; label: string; tone: string };

// Status pills on the plum card: white for usable states, gold (dark text, 6:1) for "waiting",
// dark for blocked states.
const statusMeta: Record<string, Meta> = {
  active: { icon: BadgeCheck, label: "สมาชิกปัจจุบัน", tone: "bg-white text-brand-600" },
  archived: { icon: UserX, label: "เก็บถาวร", tone: "bg-black/30 text-white" },
  expired: { icon: ShieldAlert, label: "หมดอายุ", tone: "bg-black/30 text-white" },
  expiring: { icon: CalendarClock, label: "ใกล้หมดอายุ", tone: "bg-gold-500 text-gold-ink" },
  guest: { icon: Clock3, label: "บุคคลภายนอก", tone: "bg-white text-brand-600" },
  inactive: { icon: ShieldAlert, label: "ปิดใช้งาน", tone: "bg-black/30 text-white" },
  pending: { icon: Clock3, label: "รอตรวจสอบ", tone: "bg-gold-500 text-gold-ink" },
  pending_verification: { icon: Clock3, label: "รอตรวจสอบ", tone: "bg-gold-500 text-gold-ink" },
  resigned: { icon: UserX, label: "พ้นสภาพ/ลาออก", tone: "bg-black/30 text-white" },
  suspended: { icon: ShieldAlert, label: "ระงับสิทธิ์", tone: "bg-black/30 text-white" },
};

function formatJoined(value: string | null | undefined) {
  if (!value) return null;
  return new Date(`${value}T12:00:00+07:00`).toLocaleDateString("th-TH", { month: "short", timeZone: "Asia/Bangkok", year: "numeric" });
}

/**
 * Digital membership card: club crest, member number, association type/code and verification
 * state, like a wallet pass. With `membership`, also the end date, a renew button near expiry and
 * the แต้มสะสม balance.
 */
export function MemberCard({
  displayName,
  member,
  membership,
}: {
  displayName: string;
  member: MemberCardData | null;
  membership?: MemberCardMembership | null;
}) {
  const status = membership?.lifecycle ?? member?.status ?? "pending_verification";
  const meta = statusMeta[status] ?? statusMeta.pending_verification;
  const Icon = meta.icon;
  const joined = formatJoined(member?.joined_at);
  const code = member?.member_code ?? "รอออกเลขสมาชิก";
  const expiresAt = membership?.expiresAt ?? null;
  const points = membership?.points ?? null;
  const showMembershipRow = Boolean(expiresAt) || points !== null;

  return (
    <section aria-label="บัตรสมาชิก" className="rounded-2xl bg-brand-600 p-5 text-white shadow-[0_16px_40px_rgba(74,18,56,0.28)]">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white">
            <ClubCrest size={42} />
          </span>
          <p className="text-sm font-medium leading-5 text-white/90">{CLUB_NAME}</p>
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${meta.tone}`}>
          <Icon className="size-3.5" aria-hidden="true" />
          {meta.label}
        </span>
      </div>

      <div className="mt-5 flex items-center gap-4">
        <div className="rounded-full ring-2 ring-white/30">
          <MemberAvatar avatarUrl={member?.avatar_url} displayName={displayName} size="large" />
        </div>
        <div className="min-w-0">
          <p className="line-clamp-2 text-xl font-semibold leading-tight">{member?.full_name || displayName}</p>
          {member?.nickname || member?.work_line ? (
            <p className="mt-1 line-clamp-2 text-sm text-white/80">
              {member?.nickname ? `“${member.nickname}”` : ""}
              {member?.nickname && member?.work_line ? " · " : ""}
              {member?.work_line ?? ""}
            </p>
          ) : null}
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-white/15 pt-4">
        <div className="col-span-2">
          <dt className="text-xs text-white/70">เลขสมาชิก</dt>
          <dd className="mt-0.5 text-2xl font-semibold tracking-wider tabular-nums">{code}</dd>
        </div>
        <div>
          <dt className="text-xs text-white/70">ประเภทสมาชิกสมาคม</dt>
          <dd className="mt-0.5 font-semibold">{member?.association_member_type ?? UNSET}</dd>
          {member?.association_member_code ? <dd className="text-xs text-white/75 tabular-nums">รหัส {member.association_member_code}</dd> : null}
        </div>
        <div>
          <dt className="text-xs text-white/70">รหัสพนักงาน</dt>
          <dd className="mt-0.5 font-semibold tabular-nums">{member?.employee_code ?? UNSET}</dd>
          {joined ? <dd className="text-xs text-white/75">สมาชิกตั้งแต่ {joined}</dd> : null}
        </div>
        {showMembershipRow ? (
          <>
            <div>
              <dt className="text-xs text-white/70">ใช้ได้ถึง</dt>
              <dd className="mt-0.5 font-semibold tabular-nums">{expiresAt ? formatThaiDate(expiresAt) : "ไม่มีวันหมดอายุ"}</dd>
            </div>
            {points !== null ? (
              <div>
                <dt className="flex items-center gap-1 text-xs text-white/70">
                  <Coins className="size-3.5" aria-hidden="true" />
                  แต้มสะสม
                </dt>
                <dd className="mt-0.5 font-semibold tabular-nums">
                  {membership?.pointsHref ? (
                    <a className="underline decoration-white/40 underline-offset-4 hover:decoration-white" href={membership.pointsHref}>
                      {points.toLocaleString("th-TH")}
                    </a>
                  ) : (
                    points.toLocaleString("th-TH")
                  )}
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>

      {membership?.renewHref ? (
        <Link className={`${buttonClass("secondary", "lg")} mt-4 w-full`} href={membership.renewHref}>
          <CalendarClock className="size-4" aria-hidden="true" />
          {!expiresAt ? "ชำระค่าบำรุงรายปี" : status === "expired" ? "ต่ออายุสมาชิก" : "ต่ออายุล่วงหน้า"}
        </Link>
      ) : null}
    </section>
  );
}
