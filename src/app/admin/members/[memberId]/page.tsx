import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, Eye, History } from "lucide-react";

import { MemberAvatar } from "@/components/member-avatar";
import { LoadErrorBanner, StatusBanner } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, card } from "@/components/ui/styles";
import { getSessionRoleKeys, requireAdminArea } from "@/lib/auth/admin-area";
import { resolveAccess } from "@/lib/auth/access";
import { auditActionLabel, auditEntityLabel, summarizeAuditChanges } from "@/lib/audit-diff";
import {
  UNSET,
  formatBaht,
  formatFee,
  formatPhone,
  formatThaiDate,
  formatThaiDateLong,
  formatThaiDateShort,
  formatThaiDateTime,
  formatThaiTime,
  orUnset,
  phoneHref,
} from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { employeeMatchReasonLabels } from "@/lib/labels";
import {
  bookingStatusLabels,
  effectiveMatchStatus,
  employeeMatchLabels,
  matchTone,
  memberStatusLabels,
  memberStatusTone,
  membershipStateLabels,
  membershipStateTones,
  notificationChannelLabels,
  notificationStatusLabels,
  notificationTone,
  notificationTypeLabels,
  paymentPurposeLabels,
  paymentStatusLabels,
  registrationStatusLabels,
} from "@/lib/members/member-360";
import { type Member360Data, sampleMember360 } from "@/lib/members/member-360-data";
import { isMemberId, loadMember360 } from "@/lib/members/member-360-load";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "ข้อมูลสมาชิก" };

type PageProps = {
  params: Promise<{ memberId: string }>;
  searchParams: Promise<{ bypass?: string }>;
};

const previewIcons = {
  event: appIcons.events,
  lesson: appIcons.lessons,
  membership: appIcons.directory,
  notification: appIcons.notifications,
  payment: appIcons.payments,
} as const;

const directoryMembershipLabels: Record<string, string> = {
  active: "สมาชิกปัจจุบัน",
  inactive: "พ้นสภาพสมาชิก",
  suspended: "พักสิทธิ์",
  unknown: UNSET,
};

const sectionTitle = "flex items-center gap-2 text-h3 font-semibold text-ink";
const subTitle = "mt-5 text-sm font-semibold text-ink-muted";
const emptyText = "mt-3 text-sm text-ink-muted";
const link = "font-medium text-brand-600 underline-offset-2 hover:underline";

type Column = { align?: "right"; label: string };

/**
 * Rows with a column header on wider screens; on phones each value carries its own small label
 * (the header row is visual only, screen readers get the per-cell label).
 */
function RowList({ columns, grid, rows }: { columns: Column[]; grid: string; rows: Array<{ cells: React.ReactNode[]; key: string }> }) {
  return (
    <div className="mt-3">
      <div aria-hidden="true" className={`hidden gap-4 border-b border-line pb-2 text-xs font-medium text-ink-subtle md:grid ${grid}`}>
        {columns.map((column) => (
          <span className={column.align === "right" ? "text-right" : undefined} key={column.label}>
            {column.label}
          </span>
        ))}
      </div>
      <ul className="divide-y divide-line">
        {rows.map((row) => (
          <li className={`grid gap-1.5 py-3 md:items-start md:gap-4 ${grid}`} key={row.key}>
            {row.cells.map((cell, index) => (
              <div className={`flex gap-2 text-sm md:block ${columns[index]?.align === "right" ? "md:text-right" : ""}`} key={columns[index]?.label ?? index}>
                <span className="w-20 shrink-0 text-ink-subtle md:sr-only">{columns[index]?.label}</span>
                <div className="min-w-0 text-ink">{cell}</div>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({
  action,
  children,
  icon: Icon,
  id,
  title,
}: {
  action?: React.ReactNode;
  children: React.ReactNode;
  icon: (typeof appIcons)[keyof typeof appIcons] | typeof History;
  id: string;
  title: React.ReactNode;
}) {
  return (
    <section aria-labelledby={`${id}-title`} className={card} id={id}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={sectionTitle} id={`${id}-title`}>
          <Icon className="size-5 text-brand-600" aria-hidden="true" />
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
    </div>
  );
}

function timeRange(start: string | null, end: string | null) {
  if (!start) return null;
  const from = formatThaiTime(start).replace(/\s*น\.$/, "");
  return end ? `${from}–${formatThaiTime(end)}` : formatThaiTime(start);
}

function PhoneValue({ phone }: { phone: string | null }) {
  const href = phoneHref(phone);
  return href ? (
    <a className={link} href={href}>
      {formatPhone(phone)}
    </a>
  ) : (
    <>{formatPhone(phone)}</>
  );
}

function ProfileCard({ data }: { data: Member360Data }) {
  const { member } = data;
  return (
    <section aria-label="ข้อมูลติดต่อ" className={card}>
      <div className="flex items-start gap-4">
        <MemberAvatar avatarUrl={member.avatar_url} displayName={member.full_name} seed={member.member_code ?? member.id} size="small" />
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={memberStatusTone(member.status)}>{memberStatusLabels[member.status] ?? member.status}</StatusBadge>
            {member.member_type ? <span className="text-sm text-ink-muted">{member.member_type}</span> : null}
          </p>
          <p className="mt-1 text-sm text-ink-muted">
            {member.nickname ? `ชื่อเล่น ${member.nickname} · ` : ""}เป็นสมาชิกตั้งแต่ {formatThaiDate(member.joined_at)}
          </p>
        </div>
      </div>
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Detail label="เลขสมาชิก" value={<span className="tabular-nums">{orUnset(member.member_code)}</span>} />
        <Detail label="รหัสพนักงาน" value={<span className="tabular-nums">{orUnset(member.employee_code)}</span>} />
        <Detail label="เบอร์โทร" value={<PhoneValue phone={member.phone} />} />
        <Detail
          label="อีเมล"
          value={
            member.email ? (
              <a className={`${link} break-all`} href={`mailto:${member.email}`}>
                {member.email}
              </a>
            ) : (
              UNSET
            )
          }
        />
        <Detail label="LINE ID" value={orUnset(member.line_id)} />
        <Detail label="หน่วยงาน" value={orUnset(member.department || member.organization)} />
        <Detail label="สังกัด" value={orUnset(member.affiliation)} />
        <Detail label="แต้มต่อ" value={member.handicap === null ? UNSET : <span className="tabular-nums">{member.handicap.toLocaleString("th-TH")}</span>} />
      </dl>
    </section>
  );
}

function MemberPreview({ data }: { data: Member360Data }) {
  const { member, membership, preview } = data;
  const firstName = member.nickname || member.full_name.trim().split(/\s+/)[0] || member.full_name;
  return (
    <section aria-labelledby="member-view-title" className={card} id="member-view">
      <h2 className={sectionTitle} id="member-view-title">
        <Eye className="size-5 text-brand-600" aria-hidden="true" />
        สิ่งที่สมาชิกเห็น
      </h2>
      <p className="mt-1 text-sm text-ink-muted">ตัวอย่างหน้าแรกของสมาชิกคนนี้ ดูได้อย่างเดียว ไม่ได้เข้าระบบแทนสมาชิก</p>

      <div className="mx-auto mt-4 max-w-sm rounded-[1.75rem] border-[6px] border-neutral-bg bg-canvas p-3">
        <p className="px-1 text-sm font-semibold text-ink">สวัสดี คุณ{firstName}</p>
        <div className="mt-2 rounded-xl bg-brand-600 px-4 py-3 text-white">
          <p className="font-semibold">{member.full_name}</p>
          <p className="text-sm tabular-nums text-white/85">{orUnset(member.member_code, "ยังไม่มีเลขสมาชิก")}</p>
          <p className="mt-1 text-sm text-white/85">
            {membership.endsOn ? `สมาชิกถึง ${formatThaiDate(membership.endsOn)}` : memberStatusLabels[member.status] ?? member.status}
          </p>
        </div>

        <h3 className="mt-4 px-1 text-xs font-medium text-ink-subtle">นัดครั้งต่อไปและสิ่งที่ต้องทำ</h3>
        {preview.length ? (
          <ul className="mt-2 grid gap-2">
            {preview.map((item) => {
              const Icon = previewIcons[item.kind];
              return (
                <li className="flex items-start gap-3 rounded-xl border border-line bg-white px-3 py-2.5" key={item.key}>
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                    <Icon className="size-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-ink">{item.title}</span>
                    {item.date ? <span className="block text-xs text-ink-muted">{formatThaiDateShort(item.date)}</span> : null}
                    <StatusBadge className="mt-1" tone={item.tone}>
                      {item.detail}
                    </StatusBadge>
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 rounded-xl border border-line bg-white px-3 py-4 text-center text-sm text-ink-muted">ตอนนี้ไม่มีนัดหรือเรื่องที่ต้องทำ</p>
        )}
      </div>
    </section>
  );
}

function DirectoryCard({ data, suffix }: { data: Member360Data; suffix: string }) {
  const { directory, member } = data;
  const linked = Boolean(member.employee_directory_id);
  const status = effectiveMatchStatus(member.employee_match_status, linked ? directory : null, linked);
  const reason = member.employee_match_detail?.reason ? employeeMatchReasonLabels[member.employee_match_detail.reason] : null;
  const code = directory?.employee_code ?? member.employee_code;
  return (
    <Section
      action={
        code ? (
          <Link className={link} href={`/admin/employees?q=${encodeURIComponent(code)}${suffix ? `&${suffix.slice(1)}` : ""}`}>
            ดูในฐาน
          </Link>
        ) : null
      }
      icon={appIcons.directory}
      id="directory"
      title="ฐานสมาชิกสมาคม"
    >
      <div className="mt-3">
        {status === "matched" ? (
          <p className="flex items-center gap-2 text-sm font-medium text-success">
            <BadgeCheck className="size-4" aria-hidden="true" />
            ตรงกับฐานสมาชิกสมาคม
          </p>
        ) : (
          <StatusBadge tone={matchTone(status)}>{employeeMatchLabels[status] ?? status}</StatusBadge>
        )}
        {reason && status !== "matched" ? <p className="mt-1.5 text-sm text-ink-muted">{reason}</p> : null}
      </div>
      {directory ? (
        <>
          {!linked ? <p className="mt-2 text-sm text-warning">พบรหัสพนักงานนี้ในฐาน แต่ยังไม่ได้ผูกกับสมาชิกคนนี้</p> : null}
          <dl className="mt-4 grid grid-cols-2 gap-3">
            <Detail label="ชื่อในฐาน" value={directory.full_name} />
            <Detail label="รหัสสมาชิกสมาคม" value={<span className="tabular-nums">{orUnset(directory.association_member_code)}</span>} />
            <Detail label="ประเภท" value={orUnset(directory.member_type)} />
            <Detail
              label="สถานะสมาชิกสมาคม"
              value={directoryMembershipLabels[directory.membership_status ?? "active"] ?? directory.membership_status}
            />
            <Detail label="ตำแหน่ง" value={orUnset(directory.position)} />
            <Detail label="หน่วยงาน" value={orUnset(directory.department || directory.affiliation)} />
          </dl>
        </>
      ) : (
        <p className={emptyText}>{member.employee_code ? "ไม่พบรหัสพนักงานนี้ในฐานสมาชิกสมาคม" : "ยังไม่ได้กรอกรหัสพนักงาน"}</p>
      )}
    </Section>
  );
}

function MembershipCard({ data }: { data: Member360Data }) {
  const { member, membership } = data;
  return (
    <Section icon={appIcons.members} id="membership" title="อายุสมาชิก">
      {membership.available && membership.endsOn ? (
        <div className="mt-3">
          <StatusBadge tone={membershipStateTones[membership.state]}>{membershipStateLabels[membership.state]}</StatusBadge>
          <p className="mt-2 text-sm text-ink">
            ใช้ได้ถึง <span className="font-semibold">{formatThaiDateLong(membership.endsOn)}</span>
          </p>
          {membership.daysLeft !== null && membership.daysLeft >= 0 ? (
            <p className="text-sm text-ink-muted">
              เหลือ <span className="tabular-nums">{membership.daysLeft.toLocaleString("th-TH")}</span> วัน
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <StatusBadge tone={memberStatusTone(member.status)}>{memberStatusLabels[member.status] ?? member.status}</StatusBadge>
          <p className="mt-2 text-sm text-ink-muted">ยังไม่มีข้อมูลวันหมดอายุ · เป็นสมาชิกตั้งแต่ {formatThaiDate(member.joined_at)}</p>
        </div>
      )}
      {membership.hasPending ? <p className="mt-2 text-sm text-warning">มีคำขอต่ออายุที่รอชำระค่าบำรุง</p> : null}
      {membership.terms.length ? (
        <>
          <h3 className={subTitle}>ประวัติการต่ออายุ</h3>
          <ul className="mt-2 divide-y divide-line text-sm">
            {membership.terms.slice(0, 5).map((term) => (
              <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={term.id}>
                <span className="text-ink">
                  {formatThaiDate(term.startsOn)} – {formatThaiDate(term.endsOn)}
                  <span className="block text-xs text-ink-subtle tabular-nums">ค่าบำรุง {formatFee(term.fee)}</span>
                </span>
                <StatusBadge tone={term.status === "active" ? "success" : term.status === "cancelled" ? "danger" : "warning"}>
                  {term.status === "active" ? "ใช้งาน" : term.status === "cancelled" ? "ยกเลิก" : "รอชำระ"}
                </StatusBadge>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

function PointsCard({ data }: { data: Member360Data }) {
  const { points } = data;
  if (!points.available) return null;
  return (
    <Section icon={appIcons.points} id="points" title="แต้มสะสม">
      <p className="mt-3 flex items-baseline gap-1.5 text-ink">
        <span className="text-kpi font-semibold tabular-nums">{points.balance.toLocaleString("th-TH")}</span>
        <span className="text-sm font-medium text-ink-muted">แต้มสะสมคงเหลือ</span>
      </p>
      {points.recent.length ? (
        <ul className="mt-3 divide-y divide-line text-sm">
          {points.recent.map((row) => (
            <li className="flex items-start justify-between gap-3 py-2" key={row.id}>
              <span className="min-w-0">
                <span className="block text-ink">{orUnset(row.reason)}</span>
                <span className="block text-xs text-ink-subtle">{formatThaiDateShort(row.date)}</span>
              </span>
              <span className={`shrink-0 font-semibold tabular-nums ${row.amount < 0 ? "text-danger" : "text-success"}`}>
                {row.amount > 0 ? "+" : row.amount < 0 ? "−" : ""}
                {Math.abs(row.amount).toLocaleString("th-TH")}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className={emptyText}>ยังไม่มีรายการแต้มสะสม</p>
      )}
    </Section>
  );
}

function LessonsSection({ data }: { data: Member360Data }) {
  const { credits, lessons, packages } = data;
  const columns: Column[] = [{ label: "วันที่" }, { label: "รอบเรียน" }, { label: "ผู้สอน" }, { label: "สถานะ" }];
  const grid = "md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)_minmax(0,1fr)_7rem]";
  const toRows = (rows: Member360Data["lessons"]["upcoming"]) =>
    rows.map((row) => ({
      cells: [
        <>
          <span className="block whitespace-nowrap">{formatThaiDateShort(row.date)}</span>
          {timeRange(row.startTime, row.endTime) ? <span className="block text-xs text-ink-subtle tabular-nums">{timeRange(row.startTime, row.endTime)}</span> : null}
        </>,
        <>
          <span className="block font-medium">{row.title}</span>
          {row.program || row.venue ? <span className="block text-xs text-ink-subtle">{[row.program, row.venue].filter(Boolean).join(" · ")}</span> : null}
        </>,
        orUnset(row.coach),
        <StatusBadge key="status" kind="booking" status={row.status}>
          {bookingStatusLabels[row.status] ?? row.status}
        </StatusBadge>,
      ],
      key: row.id,
    }));
  const hasAny = lessons.upcoming.length || lessons.past.length;

  return (
    <Section icon={appIcons.lessons} id="lessons" title="การเรียน">
      {(packages.available && packages.rows.length) || (credits.available && credits.balance !== null) ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {credits.available && credits.balance !== null ? (
            <p className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-ink-muted">
              เครดิตเรียนคงเหลือ <span className="text-h3 font-semibold tabular-nums text-ink">{credits.balance.toLocaleString("th-TH")}</span> ครั้ง
            </p>
          ) : null}
          {packages.rows.map((row) => (
            <div className="rounded-lg border border-line bg-canvas px-3 py-2 text-sm" key={row.id}>
              <p className="font-medium text-ink">{row.name}</p>
              <p className="text-ink-muted">
                {row.creditsLeft !== null ? (
                  <>
                    เหลือ <span className="tabular-nums">{row.creditsLeft.toLocaleString("th-TH")}</span>
                    {row.creditsTotal !== null ? <span className="tabular-nums"> / {row.creditsTotal.toLocaleString("th-TH")}</span> : null} ครั้ง
                  </>
                ) : null}
                {row.expiresOn ? ` · หมดอายุ ${formatThaiDate(row.expiresOn)}` : ""}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {hasAny ? (
        <>
          <h3 className={subTitle}>รอบที่จะถึง</h3>
          {lessons.upcoming.length ? <RowList columns={columns} grid={grid} rows={toRows(lessons.upcoming)} /> : <p className={emptyText}>ไม่มีรอบเรียนที่จองไว้</p>}
          {lessons.past.length ? (
            <>
              <h3 className={subTitle}>ย้อนหลัง {lessons.past.length.toLocaleString("th-TH")} รอบล่าสุด</h3>
              <RowList columns={columns} grid={grid} rows={toRows(lessons.past)} />
            </>
          ) : null}
        </>
      ) : (
        <p className={emptyText}>ยังไม่เคยจองรอบเรียน</p>
      )}
    </Section>
  );
}

function EventsSection({ data, suffix }: { data: Member360Data; suffix: string }) {
  const { events } = data;
  const columns: Column[] = [{ label: "วันที่" }, { label: "กิจกรรม" }, { label: "สถานะ" }, { label: "เช็กอิน · สกอร์" }];
  const grid = "md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)_9rem_minmax(0,1.2fr)]";
  const toRows = (rows: Member360Data["events"]["upcoming"]) =>
    rows.map((row) => ({
      cells: [
        <span className="whitespace-nowrap" key="date">
          {formatThaiDateShort(row.date)}
        </span>,
        <>
          <Link className={link} href={`/admin/events/${row.eventId}${suffix}`}>
            {row.name}
          </Link>
          {row.venue ? <span className="block text-xs text-ink-subtle">{row.venue}</span> : null}
        </>,
        <StatusBadge key="status" kind="registration" status={row.status}>
          {registrationStatusLabels[row.status] ?? row.status}
        </StatusBadge>,
        <>
          {row.checkedInAt ? <span className="block">เช็กอิน {formatThaiDateTime(row.checkedInAt)}</span> : null}
          {row.score ? (
            <span className="block tabular-nums text-ink-muted">
              {[
                row.score.gross !== null ? `สกอร์ ${row.score.gross}` : null,
                row.score.net !== null ? `สุทธิ ${row.score.net}` : null,
                row.score.points !== null ? `${row.score.points} คะแนน` : null,
                row.score.rank !== null ? `อันดับ ${row.score.rank}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          ) : null}
          {!row.checkedInAt && !row.score ? <span className="text-ink-subtle">ยังไม่มี</span> : null}
        </>,
      ],
      key: row.id,
    }));

  return (
    <Section icon={appIcons.events} id="events" title="กิจกรรม">
      {events.upcoming.length || events.past.length ? (
        <>
          <h3 className={subTitle}>ที่จะถึง</h3>
          {events.upcoming.length ? <RowList columns={columns} grid={grid} rows={toRows(events.upcoming)} /> : <p className={emptyText}>ไม่มีกิจกรรมที่สมัครไว้</p>}
          {events.past.length ? (
            <>
              <h3 className={subTitle}>ย้อนหลัง</h3>
              <RowList columns={columns} grid={grid} rows={toRows(events.past)} />
            </>
          ) : null}
        </>
      ) : (
        <p className={emptyText}>ยังไม่เคยสมัครกิจกรรม</p>
      )}
    </Section>
  );
}

function PaymentsSection({ data, suffix }: { data: Member360Data; suffix: string }) {
  const { payments } = data;
  const columns: Column[] = [{ label: "วันที่" }, { label: "รายการ" }, { align: "right", label: "ยอดเงิน" }, { label: "สถานะ" }, { label: "ตรวจเมื่อ" }];
  const grid = "md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.5fr)_7rem_8rem_minmax(0,1fr)]";
  const waiting = payments.rows.some((row) => row.status === "review" || (row.status === "pending" && row.hasSlip));
  return (
    <Section
      action={
        waiting ? (
          <Link className={link} href={`/admin/payments${suffix}`}>
            ไปหน้าตรวจสลิป
          </Link>
        ) : null
      }
      icon={appIcons.payments}
      id="payments"
      title="การชำระเงิน"
    >
      {!payments.access ? (
        <p className={emptyText}>ดูได้เฉพาะเจ้าหน้าที่การเงิน ผู้ดูแลชมรม หรือผู้ตรวจสอบ</p>
      ) : payments.rows.length ? (
        <RowList
          columns={columns}
          grid={grid}
          rows={payments.rows.map((row) => ({
            cells: [
              <span className="whitespace-nowrap" key="date">
                {formatThaiDateShort(row.createdAt)}
              </span>,
              <>
                <span className="block font-medium">{row.label}</span>
                <span className="block text-xs text-ink-subtle">{paymentPurposeLabels[row.purpose] ?? "อื่นๆ"}</span>
              </>,
              <span className="font-semibold tabular-nums" key="amount">
                {formatBaht(row.amount)}
              </span>,
              <StatusBadge key="status" kind="payment" status={row.status}>
                {row.status === "pending" && row.hasSlip ? "รอตรวจ" : (paymentStatusLabels[row.status] ?? row.status)}
              </StatusBadge>,
              row.reviewedAt ? formatThaiDateTime(row.reviewedAt) : <span className="text-ink-subtle">ยังไม่ตรวจ</span>,
            ],
            key: row.id,
          }))}
        />
      ) : (
        <p className={emptyText}>ยังไม่มีรายการชำระเงิน</p>
      )}
    </Section>
  );
}

function NotificationsSection({ data }: { data: Member360Data }) {
  const { notifications } = data;
  const columns: Column[] = [{ label: "วันที่" }, { label: "เรื่อง" }, { label: "ช่องทาง" }, { label: "สถานะ" }];
  const grid = "md:grid-cols-[minmax(0,0.9fr)_minmax(0,2fr)_5rem_8rem]";
  return (
    <Section
      icon={appIcons.notifications}
      id="notifications"
      title={
        <>
          การแจ้งเตือน
          {notifications.unread ? (
            <span className="text-sm font-medium text-ink-muted">
              · ยังไม่อ่าน <span className="tabular-nums">{notifications.unread.toLocaleString("th-TH")}</span>
            </span>
          ) : null}
        </>
      }
    >
      {notifications.rows.length ? (
        <RowList
          columns={columns}
          grid={grid}
          rows={notifications.rows.map((row) => ({
            cells: [
              <span className="whitespace-nowrap" key="date">
                {formatThaiDateTime(row.sentAt ?? row.createdAt)}
              </span>,
              <>
                <span className="block font-medium">{orUnset(row.subject)}</span>
                <span className="block text-xs text-ink-subtle">{notificationTypeLabels[row.type] ?? row.type}</span>
              </>,
              notificationChannelLabels[row.channel] ?? row.channel,
              <>
                <StatusBadge tone={notificationTone(row.status)}>{notificationStatusLabels[row.status] ?? row.status}</StatusBadge>
                <span className="mt-1 block text-xs text-ink-subtle">{row.readAt ? "อ่านแล้ว" : "ยังไม่อ่าน"}</span>
              </>,
            ],
            key: row.id,
          }))}
        />
      ) : (
        <p className={emptyText}>ยังไม่เคยส่งการแจ้งเตือนถึงสมาชิกคนนี้</p>
      )}
    </Section>
  );
}

function AuditSection({ data, suffix }: { data: Member360Data; suffix: string }) {
  const columns: Column[] = [{ label: "เวลา" }, { label: "รายการ" }, { label: "โดย" }, { label: "ก่อน → หลัง" }];
  const grid = "md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.3fr)_minmax(0,0.9fr)_minmax(0,1.8fr)]";
  return (
    <Section
      action={
        <Link className={link} href={`/admin/audit?entity=members&entityId=${data.member.id}${suffix ? `&${suffix.slice(1)}` : ""}`}>
          ดูทั้งหมด
        </Link>
      }
      icon={History}
      id="audit"
      title="ประวัติการแก้ไข"
    >
      {data.audit.length ? (
        <RowList
          columns={columns}
          grid={grid}
          rows={data.audit.map((row) => ({
            cells: [
              <span className="whitespace-nowrap" key="time">
                {formatThaiDateTime(row.createdAt)}
              </span>,
              <>
                <span className="block font-medium">{auditActionLabel(row.action)}</span>
                <span className="block text-xs text-ink-subtle">{auditEntityLabel(row.entityType)}</span>
              </>,
              row.actorName,
              row.changes.length ? (
                <span className="text-ink-muted">{summarizeAuditChanges(row.changes)}</span>
              ) : (
                <span className="text-ink-subtle">ไม่มีรายละเอียดที่เปลี่ยน</span>
              ),
            ],
            key: row.id,
          }))}
        />
      ) : (
        <p className={emptyText}>ยังไม่มีประวัติการแก้ไขของสมาชิกคนนี้</p>
      )}
    </Section>
  );
}

export default async function Member360Page({ params, searchParams }: PageProps) {
  const [{ memberId }, query] = await Promise.all([params, searchParams]);
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: `/admin/members/${memberId}`,
    requiredRole: "admin",
    searchParams: query,
  });
  await requireAdminArea("members", access);

  let data: Member360Data | null;
  if (access.isBypass || !access.clubId) {
    data = sampleMember360(memberId);
  } else {
    if (!isMemberId(memberId)) notFound();
    const [supabase, roleKeys] = await Promise.all([createClient(), getSessionRoleKeys(access.clubId)]);
    data = await loadMember360(supabase, access.clubId, memberId, roleKeys);
  }
  if (!data) notFound();

  const suffix = access.isBypass ? "?bypass=admin" : "";
  const { member } = data;
  const editHref = `/admin/members?q=${encodeURIComponent(member.member_code ?? member.full_name)}${access.isBypass ? "&bypass=admin" : ""}`;
  const EditIcon = appIcons.edit;

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <nav aria-label="ตำแหน่งหน้า" className="mb-3 text-sm">
          <ol className="flex flex-wrap items-center gap-1.5 text-ink-muted">
            <li>
              <Link className={link} href={`/admin/members${suffix}`}>
                รายชื่อสมาชิก
              </Link>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="truncate">
              {member.full_name}
            </li>
          </ol>
        </nav>

        <PageHeader
          actions={
            <Link className={buttonClass("secondary")} href={editHref}>
              <EditIcon className="size-4" aria-hidden="true" />
              แก้ไขข้อมูล
            </Link>
          }
          description={[member.member_code ? `เลขสมาชิก ${member.member_code}` : null, member.nickname ? `ชื่อเล่น ${member.nickname}` : null]
            .filter(Boolean)
            .join(" · ") || undefined}
          title={member.full_name}
        />

        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่าง
          </StatusBanner>
        ) : null}
        <LoadErrorBanner className="mt-4" error={data.loadError} />

        <div className="mt-6">
          <ProfileCard data={data} />
        </div>

        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          {/* Phones: the member's view and status come first; desktop: a side column. */}
          <div className="grid gap-6 lg:order-2">
            <MemberPreview data={data} />
            <DirectoryCard data={data} suffix={suffix} />
            <MembershipCard data={data} />
            <PointsCard data={data} />
          </div>
          <div className="grid min-w-0 gap-6 lg:order-1">
            <LessonsSection data={data} />
            <EventsSection data={data} suffix={suffix} />
            <PaymentsSection data={data} suffix={suffix} />
            <NotificationsSection data={data} />
            <AuditSection data={data} suffix={suffix} />
          </div>
        </div>
      </div>
    </main>
  );
}
