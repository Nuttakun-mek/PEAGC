import Link from "next/link";
import { BadgeCheck, ChevronLeft, ChevronRight, FileLock2, Search, ShieldAlert } from "lucide-react";

import {
  approveMember,
  archiveMember,
  bulkApproveMembers,
  changeMemberLifecycle,
  createMember,
  resolveDataRequest,
  restoreMember,
  setMembershipExpiry,
  updateMember,
} from "@/app/admin/members/actions";
import { applyLifecycleFilter, applyMemberListFilters, memberListColumns, membersQuery } from "@/app/admin/members/member-query";
import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { MemberAvatar } from "@/components/member-avatar";
import { MembersBulkApproveBar } from "@/components/members-bulk-approve-bar";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldHint, fieldInput, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { formatPhone, formatThaiDate, formatThaiDateShort, formatThaiDateTime, orUnset, phoneHref } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { employeeMatchCheckLabels, employeeMatchReasonLabels, labelFor, memberStatusLabels } from "@/lib/labels";
import {
  type MemberLifecycle,
  addDays,
  bangkokToday,
  daysUntil,
  deriveLifecycle,
  memberLifecycleLabels,
  storedMemberStatuses,
} from "@/lib/membership/lifecycle";
import {
  MEMBERS_PAGE_SIZE,
  type MemberListFilters,
  memberListHref,
  memberSortLabels,
  memberSortOptions,
  parseMemberListParams,
} from "@/lib/membership/member-list";
import { matchReasonLabels, matchReasonOf, matchReasons } from "@/lib/membership/matching";
import { type MembershipSettings, defaultMembershipSettings, loadMembershipSettings } from "@/lib/membership/settings";
import { type StatusTone, statusTone } from "@/lib/status";
import { classifyDbError, collectLoadErrors, dbFailureMessages, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_ERROR, HANDICAP_MAX, HANDICAP_MIN, PHONE_ERROR, PHONE_HINT, PHONE_PATTERN } from "@/lib/validation";

const AddIcon = appIcons.add;
const DeleteIcon = appIcons.delete;
const DownloadIcon = appIcons.download;
const EditIcon = appIcons.edit;
const SaveIcon = appIcons.save;

const BULK_FORM_ID = "bulk-approve-form";

type AdminMembersPageProps = {
  searchParams: Promise<Record<string, string | undefined>>;
};

type MemberType = {
  id: string;
  name: string;
};

type DirectoryLink = {
  archived_at: string | null;
  employment_status: string | null;
  id: string;
  membership_status?: string | null;
};

type Sponsor = { full_name: string; member_code: string | null };

type MemberRow = {
  affiliation: string | null;
  applicant_type?: string | null;
  archived_at?: string | null;
  avatar_url?: string | null;
  created_at?: string | null;
  department: string | null;
  email: string | null;
  employee_code: string | null;
  employee_match_detail: {
    checks?: Record<string, boolean>;
    directory?: {
      affiliation?: string | null;
      department?: string | null;
      email?: string | null;
      employment_status?: string | null;
      full_name?: string | null;
    };
    flagged_at?: string;
    reason?: string;
    sponsor_code?: string;
  } | null;
  employee_directory?: DirectoryLink | null;
  employee_directory_id?: string | null;
  employee_match_status: string | null;
  full_name: string;
  handicap: number | null;
  id: string;
  joined_at: string | null;
  line_id: string | null;
  member_code: string | null;
  member_type_id: string | null;
  member_types: { name: string } | null;
  membership_expires_at?: string | null;
  nickname: string | null;
  note: string | null;
  organization: string | null;
  phone: string | null;
  skill_level: string | null;
  sponsor?: Sponsor | null;
  sponsor_member_id?: string | null;
  status: string;
  status_reason?: string | null;
  updated_at?: string | null;
};

type RawMemberRow = Omit<MemberRow, "employee_directory" | "member_types" | "sponsor"> & {
  employee_directory?: DirectoryLink | DirectoryLink[] | null;
  member_types: { name: string } | { name: string }[] | null;
  sponsor?: Sponsor | Sponsor[] | null;
};

type DataRequest = { created_at: string; id: string; member_id: string; members: Sponsor | null; note: string | null };

function first<T>(value: T | T[] | null | undefined) {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function normalizeRow(member: RawMemberRow): MemberRow {
  return {
    ...member,
    employee_directory: first(member.employee_directory),
    member_types: first(member.member_types),
    sponsor: first(member.sponsor),
  };
}

/**
 * The stored match result is a snapshot from sign-up. Re-check it against the directory row as
 * it is now, so a member never shows "matches the directory" when that row is gone, archived,
 * or no longer active (the dashboard and the directory page then disagreed with the badge).
 */
function effectiveMatchStatus(member: MemberRow) {
  if (member.employee_match_status !== "matched") {
    return member.employee_match_status ?? "not_checked";
  }
  const directory = member.employee_directory;
  if (!member.employee_directory_id || !directory || directory.archived_at) {
    return "directory_missing";
  }
  if (directory.employment_status !== "active" || (directory.membership_status ?? "active") !== "active") {
    return "directory_inactive";
  }
  return "matched";
}

const sampleTypes: MemberType[] = [
  { id: "regular", name: "สมาชิก" },
  { id: "guest", name: "แขก" },
];

function sampleMembers(today: string): MemberRow[] {
  const base = {
    affiliation: "การไฟฟ้าส่วนภูมิภาค",
    avatar_url: null,
    created_at: "2026-11-01T03:00:00Z",
    department: "กองบริการ",
    employee_directory: null,
    employee_directory_id: null,
    handicap: null,
    line_id: null,
    member_type_id: "regular",
    member_types: { name: "สมาชิก" },
    note: null,
    organization: null,
    skill_level: null,
    sponsor: null,
    sponsor_member_id: null,
  } satisfies Partial<MemberRow>;
  return [
    {
      ...base,
      email: "member01@example.com",
      employee_code: "497901",
      employee_match_detail: { checks: { activeEmployee: true, activeMembership: true, email: true, fullName: false }, reason: "name_mismatch" },
      employee_match_status: "mismatch",
      full_name: "สมาชิก ตัวอย่างหนึ่ง",
      id: "sample-1",
      joined_at: null,
      member_code: null,
      nickname: "หนึ่ง",
      phone: "0812345678",
      status: "pending_verification",
    },
    {
      ...base,
      applicant_type: "external",
      department: null,
      email: "guest01@example.com",
      employee_code: null,
      employee_match_detail: { reason: "external", sponsor_code: "PEAGC-0003" },
      employee_match_status: "not_checked",
      full_name: "แขก รับเชิญ",
      id: "sample-2",
      joined_at: null,
      member_code: null,
      nickname: null,
      organization: "บริษัท ตัวอย่าง จำกัด",
      phone: "0899999999",
      sponsor: { full_name: "สมชาย ใจดี", member_code: "PEAGC-0003" },
      sponsor_member_id: "sample-3",
      status: "pending_verification",
    },
    {
      ...base,
      email: "somchai@example.com",
      employee_code: "497903",
      employee_directory: { archived_at: null, employment_status: "active", id: "d3", membership_status: "active" },
      employee_directory_id: "d3",
      employee_match_detail: { checks: { activeEmployee: true, activeMembership: true, email: true, fullName: true } },
      employee_match_status: "matched",
      full_name: "สมชาย ใจดี",
      id: "sample-3",
      joined_at: "2025-12-10",
      member_code: "PEAGC-0003",
      membership_expires_at: addDays(today, 18),
      nickname: "ชาย",
      phone: "0861112222",
      status: "active",
    },
    {
      ...base,
      email: null,
      employee_code: "497904",
      employee_match_detail: { flagged_at: `${addDays(today, -12)}T02:00:00Z`, reason: "left_directory" },
      employee_match_status: "mismatch",
      full_name: "วิภา รักกอล์ฟ",
      id: "sample-4",
      joined_at: "2024-05-01",
      member_code: "PEAGC-0004",
      nickname: "วิ",
      phone: "0870001111",
      status: "active",
    },
    {
      ...base,
      email: null,
      employee_code: "497905",
      employee_match_detail: { reason: "left_directory" },
      employee_match_status: "mismatch",
      full_name: "ประเสริฐ ตีไกล",
      id: "sample-5",
      joined_at: "2023-03-01",
      member_code: "PEAGC-0005",
      membership_expires_at: addDays(today, -5),
      nickname: null,
      phone: null,
      status: "expired",
      status_reason: "membership_expired",
    },
    {
      ...base,
      email: null,
      employee_code: "497906",
      employee_match_detail: { reason: "left_directory" },
      employee_match_status: "mismatch",
      full_name: "อำนาจ ไดรฟ์ไกล",
      id: "sample-6",
      joined_at: "2022-01-15",
      member_code: "PEAGC-0006",
      nickname: null,
      phone: "0890002222",
      status: "suspended",
      status_reason: "ไม่อยู่ในฐานสมาคมเกินระยะผ่อนผัน",
    },
  ];
}

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "archive-failed": "ลบ (เก็บถาวร) สมาชิกไม่สำเร็จ",
  "member-archive-blocked": "ยังลบสมาชิกนี้ไม่ได้ เพราะยังมีการจองเรียนหรือการสมัครกิจกรรมที่ยังไม่ถึงวัน กรุณายกเลิกรายการเหล่านั้นก่อน",
  "member-archived": "ลบสมาชิกออกจากรายการแล้ว (เก็บถาวร ดูหรือกู้คืนได้ที่สถานะ \"เก็บถาวร\")",
  "member-restored": "กู้คืนสมาชิกแล้ว สถานะเป็น \"ไม่ใช้งาน\" กรุณาตั้งสถานะที่ต้องการแล้วบันทึก",
  "restore-failed": "กู้คืนสมาชิกไม่สำเร็จ",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่ก่อนบันทึก",
  "update-not-found": "ไม่พบสมาชิกนี้ หรือบัญชีนี้ไม่มีสิทธิ์แก้ไข",
  "approve-failed": "อนุมัติสมาชิกไม่สำเร็จ",
  approved: "อนุมัติสมาชิกแล้ว",
  "bulk-approve-failed": "อนุมัติไม่สำเร็จ สมาชิกที่เลือกอาจได้รับอนุมัติไปแล้ว หรือรหัสพนักงานซ้ำกับคนอื่น",
  "bulk-approved": "อนุมัติสมาชิกที่เลือกแล้ว",
  "bulk-none-selected": "ยังไม่ได้เลือกสมาชิก ติ๊กช่องหน้าชื่อก่อนกดอนุมัติ",
  "create-failed": "เพิ่มสมาชิกไม่สำเร็จ กรุณาตรวจเลขสมาชิกซ้ำหรือข้อมูลที่กรอก",
  created: "เพิ่มสมาชิกแล้ว",
  "data-request-archived": "เก็บถาวรสมาชิกตามคำขอลบข้อมูลแล้ว",
  "data-request-closed": "คำขอนี้ดำเนินการไปแล้ว",
  "data-request-rejected": "ปิดคำขอลบข้อมูลแล้ว (ไม่ลบ)",
  "expiry-invalid": "วันหมดอายุไม่ถูกต้อง",
  "expiry-saved": "บันทึกวันหมดอายุแล้ว",
  "lifecycle-needs-reason": "กรุณาใส่เหตุผลก่อนบันทึก",
  "lifecycle-resign": "บันทึกพ้นสภาพ/ลาออกแล้ว",
  "lifecycle-resume": "คืนสิทธิ์สมาชิกแล้ว",
  "lifecycle-suspend": "ระงับสิทธิ์สมาชิกแล้ว",
  "missing-required": "กรุณากรอกชื่อ-นามสกุล",
  "member-code-generate-failed": "ออกเลขสมาชิกถัดไปไม่สำเร็จ กรุณาลองใหม่ หรือกรอกเลขเอง",
  "member-code-invalid": "เลขสมาชิกต้องเป็นรูปแบบ PEAGC-0001 หรือเว้นว่างเพื่อใช้เลขถัดไป",
  "member-code-taken": "เลขสมาชิกนี้ถูกใช้แล้ว (รวมสมาชิกที่ลบแล้ว) กรุณาใช้เลขอื่น หรือเว้นว่างเพื่อใช้เลขถัดไป",
  "update-failed": "แก้ไขสมาชิกไม่สำเร็จ",
  updated: "บันทึกการแก้ไขแล้ว",
  "phone-invalid": PHONE_ERROR,
  "email-invalid": EMAIL_ERROR,
  "handicap-invalid": `แต้มต่อต้องเป็นตัวเลขระหว่าง ${HANDICAP_MIN} ถึง ${HANDICAP_MAX}`,
  "employee-code-taken": "รหัสพนักงานนี้มีสมาชิกใช้อยู่แล้ว (หนึ่งรหัสพนักงานเป็นสมาชิกได้คนเดียว) กรุณาตรวจรหัส หรือแก้ไขสมาชิกเดิมแทน",
};

/** Banner tone for this page's own keys (the shared helper guesses from the wording). */
const successKeys = new Set([
  "bulk-approved",
  "data-request-archived",
  "data-request-rejected",
  "expiry-saved",
  "lifecycle-resign",
  "lifecycle-resume",
  "lifecycle-suspend",
]);

/** Result of comparing the member with the association directory (ฐานสมาชิกสมาคม). */
const employeeMatchLabels: Record<string, string> = {
  directory_inactive: "ไม่ใช้งานในฐานสมาคม",
  directory_missing: "ไม่อยู่ในฐานสมาคมแล้ว",
  matched: "ตรงกับฐานสมาชิกสมาคม",
  mismatch: "ข้อมูลไม่ตรงฐานสมาคม",
  not_checked: "ยังไม่ตรวจกับฐานสมาคม",
  not_found: "ไม่พบในฐานสมาคม",
};

/** Stored reasons for ระงับ/หมดอายุ set by the daily job; free text from admins is shown as typed. */
const statusReasonLabels: Record<string, string> = {
  data_deletion_request: "ขอลบข้อมูล",
  left_directory: "ไม่อยู่ในฐานสมาคมเกินระยะผ่อนผัน",
  membership_expired: "ไม่ได้ต่ออายุตามกำหนด",
};

function matchTone(status: string): StatusTone {
  // "No longer in / not active in the directory" needs a look, like a mismatch.
  return status.startsWith("directory_") ? "warning" : statusTone("employeeMatch", status);
}

/** Why the member is not matched, in Thai: the stored reason first, then the live directory check. */
function mismatchLabel(member: MemberRow, match: string) {
  const reason = matchReasonOf(member.employee_match_detail);
  if (reason) return matchReasonLabels[reason];
  if (match === "matched" || match === "not_checked") return null;
  return labelFor(employeeMatchLabels, match);
}

/** Small check next to the name instead of a pill: matching the directory is the normal case. */
function MatchedMark() {
  return (
    <span className="inline-flex shrink-0" title={employeeMatchLabels.matched}>
      <BadgeCheck className="size-4 text-success" aria-hidden="true" />
      <span className="sr-only">{employeeMatchLabels.matched}</span>
    </span>
  );
}

const memberRowGrid =
  "xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,0.8fr)_6.5rem]";
/** Label in front of each value on phones; read out by screen readers on desktop (header row is visual). */
const cellLabel = "w-20 shrink-0 text-ink-subtle xl:sr-only";
const cellWrap = "flex gap-2 pl-12 text-sm xl:block xl:pl-0";
const searchInput =
  "mt-1.5 h-10 w-full rounded-lg border border-line bg-white pl-10 pr-3 text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10";

const lifecycleFilterOptions: Array<MemberLifecycle | "all"> = [
  "all",
  "pending",
  "active",
  "expiring",
  "expired",
  "suspended",
  "resigned",
  "inactive",
  "guest",
  "archived",
];

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}*
    </span>
  );
}

function MemberForm({
  action,
  defaultTypeId,
  disabled,
  member,
  memberTypes,
  nextMemberCode,
}: {
  action: (formData: FormData) => void;
  defaultTypeId: string;
  disabled?: boolean;
  member?: MemberRow;
  memberTypes: MemberType[];
  nextMemberCode: string | null;
}) {
  return (
    <form action={action} className="grid gap-5">
      {member ? <input name="memberId" type="hidden" value={member.id} /> : null}
      {member ? (
        <h3 className="flex items-center gap-2 text-h3 font-semibold text-ink">
          <EditIcon className="size-4 text-brand-600" aria-hidden="true" />
          แก้ไขข้อมูล {member.full_name}
        </h3>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={fieldLabel}>เลขสมาชิก</span>
          <input
            autoComplete="off"
            className={`${fieldInput} uppercase`}
            defaultValue={member?.member_code ?? ""}
            disabled={disabled}
            data-invalid-message="เลขสมาชิกต้องเป็นรูปแบบ PEAGC-0001 (ตัวเลขอย่างน้อย 4 หลัก) หรือเว้นว่างเพื่อใช้เลขถัดไป"
            name="memberCode"
            pattern="[Pp][Ee][Aa][Gg][Cc]-[0-9]{4,}"
            placeholder={nextMemberCode ? `เว้นว่าง = ${nextMemberCode}` : "เว้นว่าง = เลขถัดไป"}
          />
          <span className={fieldHint}>
            {member?.member_code
              ? "เว้นว่างเพื่อใช้เลขเดิม"
              : `เว้นว่างเพื่อใช้เลขถัดไป${nextMemberCode ? ` (${nextMemberCode})` : ""}`}
          </span>
        </label>
        <label className="block">
          <span className={fieldLabel}>รหัสพนักงาน</span>
          <input
            autoComplete="off"
            className={`${fieldInput} uppercase`}
            defaultValue={member?.employee_code ?? ""}
            disabled={disabled}
            maxLength={30}
            name="employeeCode"
          />
          <span className={fieldHint}>พนักงาน PEA เท่านั้น ห้ามซ้ำกับสมาชิกคนอื่น</span>
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>
            ชื่อ-นามสกุล
            <RequiredMark />
          </span>
          <input
            className={fieldInput}
            data-required-message="กรุณากรอกชื่อ-นามสกุลของสมาชิก"
            defaultValue={member?.full_name ?? ""}
            disabled={disabled}
            maxLength={150}
            name="fullName"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={fieldLabel}>ชื่อเล่น</span>
          <input className={fieldInput} defaultValue={member?.nickname ?? ""} disabled={disabled} name="nickname" />
        </label>
        <label className="block">
          <span className={fieldLabel}>เบอร์โทร</span>
          <input
            autoComplete="off"
            className={`${fieldInput} tabular-nums`}
            data-invalid-message={PHONE_ERROR}
            defaultValue={member?.phone?.replace(/\D/g, "") ?? ""}
            disabled={disabled}
            inputMode="numeric"
            maxLength={10}
            name="phone"
            pattern={PHONE_PATTERN}
            placeholder="0812345678"
          />
          <span className={fieldHint}>{PHONE_HINT}</span>
        </label>
        <label className="block">
          <span className={fieldLabel}>อีเมล</span>
          <input
            className={fieldInput}
            data-invalid-message={EMAIL_ERROR}
            defaultValue={member?.email ?? ""}
            disabled={disabled}
            name="email"
            placeholder="name@example.com"
            type="email"
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>ไอดีไลน์</span>
          <input className={fieldInput} defaultValue={member?.line_id ?? ""} disabled={disabled} name="lineId" />
        </label>
      </div>

      {/* Three similar-sounding fields: say which one is for whom. */}
      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold text-ink">หน่วยงาน</legend>
        <label className="block">
          <span className={fieldLabel}>หน่วยงาน (กอง)</span>
          <input className={fieldInput} defaultValue={member?.department ?? ""} disabled={disabled} name="department" />
          <span className={fieldHint}>พนักงาน PEA: ตามฐานสมาชิกสมาคม เช่น กองบริการ</span>
        </label>
        <label className="block">
          <span className={fieldLabel}>สังกัด (สายงาน / สำนัก)</span>
          <input className={fieldInput} defaultValue={member?.affiliation ?? ""} disabled={disabled} name="affiliation" />
          <span className={fieldHint}>พนักงาน PEA: ตามฐานสมาชิกสมาคม</span>
        </label>
        <label className="block">
          <span className={fieldLabel}>หน่วยงาน / บริษัท</span>
          <input className={fieldInput} defaultValue={member?.organization ?? ""} disabled={disabled} name="organization" />
          <span className={fieldHint}>บุคคลภายนอก: ชื่อบริษัทหรือหน่วยงานที่สังกัด</span>
        </label>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>ประเภทสมาชิก</span>
          <select
            className={fieldInput}
            defaultValue={member?.member_type_id ?? defaultTypeId}
            disabled={disabled}
            name="memberTypeId"
            required={memberTypes.length > 0}
          >
            {memberTypes.length ? null : <option value="">ยังไม่มีประเภทสมาชิก</option>}
            {memberTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะ</span>
          <select className={fieldInput} defaultValue={member?.status ?? "active"} disabled={disabled} name="status">
            {storedMemberStatuses.map((value) => (
              <option key={value} value={value}>
                {memberStatusLabels[value] ?? value}
              </option>
            ))}
          </select>
          {member ? <span className={fieldHint}>ระงับหรือพ้นสภาพพร้อมเหตุผล ใช้กล่อง &quot;สถานะสมาชิกภาพ&quot; ด้านบน</span> : null}
        </label>
        <label className="block">
          <span className={fieldLabel}>วันที่สมัคร</span>
          <input className={fieldInput} defaultValue={member?.joined_at ?? ""} disabled={disabled} name="joinedAt" type="date" />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>แต้มต่อ</span>
          <input
            className={`${fieldInput} tabular-nums`}
            defaultValue={member?.handicap ?? ""}
            disabled={disabled}
            inputMode="decimal"
            max={HANDICAP_MAX}
            min={HANDICAP_MIN}
            name="handicap"
            step="0.1"
            type="number"
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>ระดับฝีมือ</span>
          <select className={fieldInput} defaultValue={member?.skill_level ?? ""} disabled={disabled} name="skillLevel">
            <option value="">ยังไม่ระบุ</option>
            <option value="beginner">เริ่มต้น</option>
            <option value="intermediate">ปานกลาง</option>
            <option value="advanced">ชำนาญ</option>
          </select>
        </label>
        <label className="block">
          <span className={fieldLabel}>หมายเหตุ</span>
          <input className={fieldInput} defaultValue={member?.note ?? ""} disabled={disabled} name="note" />
        </label>
      </div>

      <button className={`${buttonClass("primary")} w-full sm:w-fit`} disabled={disabled} type="submit">
        {member ? <SaveIcon className="size-4" aria-hidden="true" /> : <AddIcon className="size-4" aria-hidden="true" />}
        {member ? "บันทึกการแก้ไข" : "เพิ่มสมาชิก"}
      </button>
    </form>
  );
}

/** ระงับ / คืนสิทธิ์ / พ้นสภาพ and the end date, each with a reason. */
function LifecyclePanel({
  disabled,
  lifecycle,
  member,
  schemaReady,
}: {
  disabled: boolean;
  lifecycle: MemberLifecycle;
  member: MemberRow;
  schemaReady: boolean;
}) {
  const changes: Array<{ label: string; value: string }> = [];
  if (lifecycle === "active" || lifecycle === "expiring" || lifecycle === "expired") {
    changes.push({ label: "ระงับสิทธิ์", value: "suspend" }, { label: "พ้นสภาพ/ลาออก", value: "resign" });
  } else if (lifecycle === "suspended") {
    changes.push({ label: "คืนสิทธิ์", value: "resume" }, { label: "พ้นสภาพ/ลาออก", value: "resign" });
  } else if (lifecycle === "resigned") {
    changes.push({ label: "กลับมาเป็นสมาชิก", value: "resume" });
  }
  const reasonText = member.status_reason ? (statusReasonLabels[member.status_reason] ?? member.status_reason) : null;

  return (
    <section className="rounded-lg border border-line bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">สถานะสมาชิกภาพ</h3>
        <StatusBadge kind="memberLifecycle" status={lifecycle}>
          {memberLifecycleLabels[lifecycle]}
        </StatusBadge>
      </div>
      <p className="mt-1 text-ink-muted">
        ใช้ได้ถึง {member.membership_expires_at ? formatThaiDate(member.membership_expires_at) : "ไม่มีวันหมดอายุ"}
        {reasonText ? ` · เหตุผล: ${reasonText}` : ""}
      </p>
      {!schemaReady ? (
        <p className="mt-3 text-warning">ระงับสิทธิ์ คืนสิทธิ์ และวันหมดอายุ ใช้ได้หลังอัปเดตฐานข้อมูล</p>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {changes.length ? (
            <form action={changeMemberLifecycle} className="grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-end">
              <input name="memberId" type="hidden" value={member.id} />
              <label className="block">
                <span className={fieldLabel}>เปลี่ยนเป็น</span>
                <select className={fieldInputClass("sm")} disabled={disabled} name="change">
                  {changes.map((change) => (
                    <option key={change.value} value={change.value}>
                      {change.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>
                  เหตุผล
                  <RequiredMark />
                </span>
                <input
                  className={fieldInputClass("sm")}
                  data-required-message="กรุณาใส่เหตุผล"
                  disabled={disabled}
                  maxLength={300}
                  name="reason"
                  placeholder="เช่น ค้างค่าบำรุง หรือแจ้งลาออกทางโทรศัพท์"
                  required
                />
              </label>
              <button className={`${buttonClass("secondary", "sm")} sm:col-span-2 sm:w-fit`} disabled={disabled} type="submit">
                <SaveIcon className="size-4" aria-hidden="true" />
                บันทึกสถานะ
              </button>
            </form>
          ) : null}
          <form action={setMembershipExpiry} className="grid gap-3 rounded-lg bg-canvas p-3 sm:grid-cols-[11rem_minmax(0,1fr)] sm:items-end">
            <input name="memberId" type="hidden" value={member.id} />
            <label className="block">
              <span className={fieldLabel}>ใช้ได้ถึง</span>
              <input
                className={fieldInputClass("sm")}
                defaultValue={member.membership_expires_at ?? ""}
                disabled={disabled}
                name="membershipExpiresAt"
                type="date"
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>
                เหตุผล
                <RequiredMark />
              </span>
              <input
                className={fieldInputClass("sm")}
                data-required-message="กรุณาใส่เหตุผล"
                disabled={disabled}
                maxLength={300}
                name="reason"
                placeholder="เช่น ชำระเงินสดที่สนาม"
                required
              />
            </label>
            <button className={`${buttonClass("secondary", "sm")} sm:col-span-2 sm:w-fit`} disabled={disabled} type="submit">
              <SaveIcon className="size-4" aria-hidden="true" />
              บันทึกวันหมดอายุ
            </button>
          </form>
        </div>
      )}
    </section>
  );
}

export default async function AdminMembersPage({ searchParams }: AdminMembersPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/members",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("members", access);

  const filters = parseMemberListParams(params);
  const today = bangkokToday();
  const showArchived = filters.lifecycle === "archived";

  let memberTypes = sampleTypes;
  let members: MemberRow[] = [];
  let totalCount = 0;
  let counts: Partial<Record<MemberLifecycle | "all", number>> = {};
  let leftDirectoryMembers: MemberRow[] = [];
  let dataRequests: DataRequest[] = [];
  let pinnedMember: MemberRow | null = null;
  let nextMemberCode: string | null = "PEAGC-0007";
  let settings: MembershipSettings = { ...defaultMembershipSettings };
  let schemaReady = true;
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (access.isBypass) {
    const all = sampleMembers(today);
    const lifecycleOf = (member: MemberRow) => deriveLifecycle(member, today, settings.renewalNoticeDays);
    for (const member of all) {
      const key = lifecycleOf(member);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    counts.all = all.length;
    members = all.filter((member) => {
      if (filters.lifecycle !== "all" && lifecycleOf(member) !== filters.lifecycle) return false;
      if (filters.reason !== "all" && matchReasonOf(member.employee_match_detail) !== filters.reason) return false;
      if (filters.q && !`${member.full_name} ${member.member_code ?? ""} ${member.employee_code ?? ""}`.includes(filters.q)) return false;
      return true;
    });
    totalCount = members.length;
    leftDirectoryMembers = all.filter((member) => member.employee_match_detail?.reason === "left_directory" && member.status === "active");
    dataRequests = [
      {
        created_at: `${addDays(today, -2)}T04:00:00Z`,
        id: "req-1",
        member_id: "sample-5",
        members: { full_name: "ประเสริฐ ตีไกล", member_code: "PEAGC-0005" },
        note: "ย้ายไปทำงานต่างประเทศ",
      },
    ];
  } else if (access.clubId) {
    const supabase = await createClient();
    const clubId = access.clubId;
    const settingsResult = await loadMembershipSettings(supabase, clubId);
    settings = settingsResult.settings;
    schemaReady = classifyDbError(settingsResult.error) !== "schema-outdated";

    const from = (filters.page - 1) * MEMBERS_PAGE_SIZE;
    const listPage = (legacy: boolean) =>
      applyMemberListFilters(
        membersQuery(supabase, clubId, legacy ? memberListColumns.legacy : memberListColumns.current, { count: "exact" }),
        filters,
        { legacy, noticeDays: settings.renewalNoticeDays, today },
      ).range(from, from + MEMBERS_PAGE_SIZE - 1);

    let listResult = await listPage(!schemaReady);
    if (listResult.error && classifyDbError(listResult.error) === "schema-outdated" && schemaReady) {
      schemaReady = false;
      listResult = await listPage(true);
    }
    const ctx = { legacy: !schemaReady, noticeDays: settings.renewalNoticeDays, today };
    const cardKeys: Array<MemberLifecycle | "all"> = ["all", "pending", "active", "expiring", "expired", "suspended"];

    const [typeResult, nextCodeResult, leftResult, requestResult, ...countResults] = await Promise.all([
      supabase.from("member_types").select("id, name").eq("club_id", clubId).neq("status", "archived").order("name"),
      // Same function the save uses, so the hint matches the number that will be issued.
      supabase.rpc("next_member_code", { target_club_id: clubId }),
      membersQuery(supabase, clubId, "id, full_name, employee_code, member_code, employee_match_detail, status")
        .is("archived_at", null)
        .eq("status", "active")
        .eq("employee_match_detail->>reason", "left_directory")
        .order("full_name")
        .range(0, 49),
      schemaReady
        ? supabase
            .from("member_data_requests")
            .select("id, member_id, note, created_at, members(full_name, member_code)")
            .eq("club_id", clubId)
            .eq("status", "open")
            .order("created_at", { ascending: true })
            .limit(50)
        : Promise.resolve({ data: [], error: null }),
      ...cardKeys.map((key) => applyLifecycleFilter(membersQuery(supabase, clubId, "id", { count: "exact", head: true }), key, ctx)),
    ]);

    loadError = collectLoadErrors("admin.members", [
      { error: typeResult.error, label: "ประเภทสมาชิก" },
      { error: listResult.error, label: "รายชื่อสมาชิก" },
    ]);
    if (!schemaReady && !loadError) loadError = { labels: ["สถานะสมาชิกภาพ"], outdated: true };
    if (requestResult.error) logDbError("admin.members data requests", requestResult.error);

    memberTypes = (typeResult.data ?? []) as MemberType[];
    nextMemberCode = typeof nextCodeResult.data === "string" ? nextCodeResult.data : null;
    members = ((listResult.data ?? []) as RawMemberRow[]).map(normalizeRow);
    totalCount = listResult.count ?? members.length;
    leftDirectoryMembers = ((leftResult.data ?? []) as RawMemberRow[]).map(normalizeRow);
    dataRequests = ((requestResult.data ?? []) as Array<Omit<DataRequest, "members"> & { members: Sponsor | Sponsor[] | null }>).map((row) => ({
      ...row,
      members: first(row.members),
    }));
    counts = Object.fromEntries(cardKeys.map((key, index) => [key, countResults[index]?.count ?? 0]));

    // The member just saved (or opened from the detail page) may not be on this page of the list.
    if (params.member && !members.some((member) => member.id === params.member) && /^[0-9a-f-]{36}$/i.test(params.member)) {
      const { data } = await membersQuery(supabase, clubId, schemaReady ? memberListColumns.current : memberListColumns.legacy)
        .eq("id", params.member)
        .range(0, 0);
      const row = (data ?? [])[0] as RawMemberRow | undefined;
      pinnedMember = row ? normalizeRow(row) : null;
    }
  }

  const defaultTypeId = memberTypes.find((type) => type.name === "สมาชิก")?.id ?? memberTypes[0]?.id ?? "";
  const pageCount = Math.max(1, Math.ceil(totalCount / MEMBERS_PAGE_SIZE));
  const pendingOnPage = members.filter((member) => member.status === "pending_verification" && !member.archived_at);

  const highlightedMember = params.member;
  const baseMessage = params.status ? statusMessages[params.status] : null;
  let statusMessage = baseMessage;
  if (baseMessage && params.status === "employee-code-taken" && params.ref) statusMessage = `${baseMessage} · ใช้อยู่โดย ${params.ref}`;
  if (params.status === "bulk-approved") {
    statusMessage = `อนุมัติแล้ว ${params.approved ?? 0} คน${Number(params.skipped ?? 0) > 0 ? ` · ข้าม ${params.skipped} คน (อนุมัติไปแล้วหรือรหัสพนักงานซ้ำ)` : ""}`;
  }
  const bannerTone = params.status && successKeys.has(params.status) ? "success" : toneForStatus(params.status);
  const bypassExtra: Record<string, string> = access.isBypass ? { bypass: "admin" } : {};
  const hasFilters = Boolean(filters.q) || filters.lifecycle !== "all" || filters.reason !== "all" || filters.type !== "all";
  const href = (change: Partial<MemberListFilters> = {}, extra: Record<string, string> = {}) =>
    `/admin/members${memberListHref(filters, change, { ...bypassExtra, ...extra })}`;
  const clearHref = access.isBypass ? "/admin/members?bypass=admin" : "/admin/members";
  const exportHref = `/admin/members/export${memberListHref(filters, { page: 1 })}`;
  const editHref = (memberId: string) => `${href({ page: filters.page }, { member: memberId })}#member-${memberId}`;
  const closeHref = `${href({ page: filters.page })}#member-list-title`;
  const detailHref = (memberId: string) => `/admin/members/${memberId}${access.isBypass ? "?bypass=admin" : ""}`;

  const filterCards: Array<{ filter: MemberLifecycle | "all"; label: string }> = [
    { filter: "all", label: "ทั้งหมด" },
    { filter: "pending", label: "รอตรวจ" },
    { filter: "active", label: "ใช้งาน" },
    { filter: "expiring", label: "ใกล้หมดอายุ" },
    { filter: "expired", label: "หมดอายุ" },
    { filter: "suspended", label: "ระงับ" },
  ];

  function renderPanel(member: MemberRow) {
    const match = effectiveMatchStatus(member);
    const matchLabel = labelFor(employeeMatchLabels, match);
    const lifecycle = deriveLifecycle(member, today, settings.renewalNoticeDays);
    const canApprove = member.status === "pending_verification" && !member.archived_at;
    const reason = matchReasonOf(member.employee_match_detail);

    return (
      <div className="mt-3 grid gap-4 rounded-xl border border-line bg-canvas p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-ink-muted">
            {[
              member.joined_at ? `สมัครเมื่อ ${formatThaiDateShort(member.joined_at)}` : null,
              member.updated_at ? `แก้ไขล่าสุด ${formatThaiDateTime(member.updated_at)}` : null,
            ]
              .filter(Boolean)
              .join(" · ") || "ข้อมูลสมาชิก"}
          </p>
          <Link className={buttonClass("ghost", "sm")} href={closeHref}>
            ปิด
          </Link>
        </div>

        <section className="rounded-lg border border-line bg-white p-4 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold text-ink">ผลเทียบฐานสมาชิกสมาคม</h3>
            {reason ? (
              <StatusBadge tone={reason === "external" ? "info" : "warning"}>{matchReasonLabels[reason]}</StatusBadge>
            ) : (
              <StatusBadge tone={matchTone(match)}>{matchLabel}</StatusBadge>
            )}
          </div>
          {member.employee_match_detail?.checks ? (
            <dl className="mt-3 grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {Object.entries(member.employee_match_detail.checks).map(([key, ok]) => (
                <div className="rounded-md bg-canvas px-3 py-2" key={key}>
                  <dt className="text-xs font-medium text-ink-subtle">{labelFor(employeeMatchCheckLabels, key)}</dt>
                  <dd className={`mt-0.5 font-semibold ${ok ? "text-success" : "text-danger"}`}>{ok ? "ผ่าน" : "ไม่ผ่าน"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className="mt-2 text-ink-muted">
              {member.employee_match_detail?.reason
                ? labelFor(employeeMatchReasonLabels, member.employee_match_detail.reason)
                : "ยังไม่มีผลเทียบกับฐานสมาชิกสมาคม"}
            </p>
          )}
          {member.sponsor ? (
            <p className="mt-2 text-ink">
              สมาชิกผู้รับรอง: <span className="font-semibold">{member.sponsor.full_name}</span>
              {member.sponsor.member_code ? <span className="ml-1 tabular-nums text-ink-muted">{member.sponsor.member_code}</span> : null}
            </p>
          ) : member.employee_match_detail?.sponsor_code ? (
            <p className="mt-2 text-ink">
              เลขสมาชิกผู้รับรองที่กรอก: <span className="font-semibold tabular-nums">{member.employee_match_detail.sponsor_code}</span>
            </p>
          ) : null}
        </section>

        {canApprove ? (
          <form
            action={approveMember}
            className="grid gap-3 rounded-lg border border-warning/30 bg-warning-bg p-4 md:grid-cols-[13rem_minmax(0,1fr)_auto] md:items-end"
          >
            <input name="memberId" type="hidden" value={member.id} />
            <p className="text-sm font-semibold text-warning md:col-span-3">รอตรวจ: อนุมัติแล้วเข้าใช้งานได้ทันที และได้รับอีเมลแจ้ง (ถ้ามีอีเมล)</p>
            <label className="block">
              <span className={fieldLabel}>เลขสมาชิก</span>
              <input
                autoComplete="off"
                className={`${fieldInputClass("sm")} uppercase`}
                defaultValue={member.member_code ?? ""}
                disabled={access.isBypass}
                data-invalid-message="เลขสมาชิกต้องเป็นรูปแบบ PEAGC-0001 หรือเว้นว่างเพื่อใช้เลขถัดไป"
                name="memberCode"
                pattern="[Pp][Ee][Aa][Gg][Cc]-[0-9]{4,}"
                placeholder={nextMemberCode ? `เว้นว่าง = ${nextMemberCode}` : "เว้นว่าง = เลขถัดไป"}
              />
            </label>
            <label className="block">
              <span className={fieldLabel}>หมายเหตุการตรวจสอบ</span>
              <input className={fieldInputClass("sm")} disabled={access.isBypass} name="verificationNote" placeholder="เช่น ตรวจกับฐานสมาคมแล้ว" />
            </label>
            <button className={buttonClass("primary")} disabled={access.isBypass} type="submit">
              <SaveIcon className="size-4" aria-hidden="true" />
              อนุมัติสมาชิก
            </button>
          </form>
        ) : null}

        {member.archived_at ? null : (
          <LifecyclePanel disabled={access.isBypass} lifecycle={lifecycle} member={member} schemaReady={schemaReady} />
        )}

        <MemberForm
          action={updateMember}
          defaultTypeId={defaultTypeId}
          disabled={access.isBypass}
          key={`${member.id}:${member.updated_at ?? ""}`}
          member={member}
          memberTypes={memberTypes}
          nextMemberCode={nextMemberCode}
        />

        {access.isBypass ? null : member.archived_at ? (
          <form action={restoreMember} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4">
            <input name="memberId" type="hidden" value={member.id} />
            <p className="min-w-0 flex-1 text-sm text-ink-muted">สมาชิกนี้ถูกลบ (เก็บถาวร) แล้ว</p>
            <button className={buttonClass("secondary", "sm")} type="submit">
              กู้คืนสมาชิก
            </button>
          </form>
        ) : (
          <form action={archiveMember} className="flex flex-wrap items-center gap-3 rounded-lg border border-danger/20 bg-white p-4">
            <input name="memberId" type="hidden" value={member.id} />
            <p className="min-w-0 flex-1 text-sm text-ink-muted">ลบออกจากรายการ (เก็บถาวร) ประวัติและเลขสมาชิกยังอยู่ กู้คืนได้</p>
            <ConfirmSubmitButton
              className={buttonClass("danger", "sm")}
              confirmLabel="ลบสมาชิก"
              message={`ลบ ${member.full_name} ออกจากรายการ? (เก็บถาวร กู้คืนได้ภายหลัง)`}
              title="ยืนยันลบสมาชิก"
            >
              <DeleteIcon className="size-4" aria-hidden="true" />
              ลบสมาชิก
            </ConfirmSubmitButton>
          </form>
        )}
      </div>
    );
  }

  function renderRow(member: MemberRow) {
    const match = effectiveMatchStatus(member);
    const mismatch = mismatchLabel(member, match);
    const telHref = phoneHref(member.phone);
    const unit = member.department || member.organization;
    const lifecycle = deriveLifecycle(member, today, settings.renewalNoticeDays);
    const canApprove = member.status === "pending_verification" && !member.archived_at;
    const open = highlightedMember === member.id;
    const daysLeft = member.membership_expires_at ? daysUntil(member.membership_expires_at, today) : null;
    const selectBox = (className: string) =>
      canApprove ? (
        <input
          aria-label={`เลือก ${member.full_name}`}
          className={className}
          disabled={access.isBypass}
          form={BULK_FORM_ID}
          name="memberIds"
          type="checkbox"
          value={member.id}
        />
      ) : null;

    return (
      <li className={`scroll-mt-20 px-5 py-4 ${open ? "bg-brand-50/40" : ""}`} id={`member-${member.id}`} key={member.id}>
        <div className={`grid gap-2 xl:items-start xl:gap-4 ${memberRowGrid}`}>
          <div className="flex min-w-0 items-start gap-3">
            {selectBox("mt-2.5 size-5 shrink-0 accent-brand-600")}
            <MemberAvatar avatarUrl={member.avatar_url} displayName={member.full_name} seed={member.member_code ?? member.id} size="xs" />
            <div className="min-w-0">
              <p className="flex min-w-0 items-center gap-1.5">
                <Link className="truncate font-semibold text-ink hover:text-brand-600 hover:underline" href={detailHref(member.id)}>
                  {member.full_name}
                </Link>
                {match === "matched" ? <MatchedMark /> : null}
                {member.nickname ? <span className="shrink-0 text-sm font-normal text-ink-subtle">({member.nickname})</span> : null}
              </p>
              <p className="text-sm text-ink-muted">
                <span className="text-ink-subtle">เลขสมาชิก</span>{" "}
                <span className="tabular-nums">{orUnset(member.member_code, "ยังไม่ออกเลข")}</span>
              </p>
              {member.employee_code ? (
                <p className="text-sm text-ink-muted">
                  <span className="text-ink-subtle">รหัสพนักงาน</span> <span className="tabular-nums">{member.employee_code}</span>
                </p>
              ) : null}
            </div>
          </div>

          <div className={cellWrap}>
            <span className={cellLabel}>ติดต่อ</span>
            <div className="min-w-0">
              {telHref ? (
                <a className="font-medium tabular-nums text-brand-600 hover:underline" href={telHref}>
                  {formatPhone(member.phone)}
                </a>
              ) : (
                <p className="tabular-nums text-ink">{formatPhone(member.phone)}</p>
              )}
              {member.email ? <p className="break-all text-ink-muted">{member.email}</p> : null}
            </div>
          </div>

          <div className={cellWrap}>
            <span className={cellLabel}>ประเภท</span>
            <div className="min-w-0">
              <p className="text-ink">{member.applicant_type === "external" ? "บุคคลภายนอก" : (member.member_types?.name ?? "ยังไม่ระบุประเภท")}</p>
              {unit ? <p className="text-ink-muted">{unit}</p> : null}
              {member.sponsor ? (
                <p className="text-ink-muted">
                  รับรองโดย {member.sponsor.full_name}
                  {member.sponsor.member_code ? <span className="tabular-nums"> ({member.sponsor.member_code})</span> : null}
                </p>
              ) : null}
            </div>
          </div>

          <div className={cellWrap}>
            <span className={cellLabel}>สถานะ</span>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <StatusBadge kind="memberLifecycle" status={lifecycle}>
                {memberLifecycleLabels[lifecycle]}
              </StatusBadge>
              {mismatch ? (
                <StatusBadge tone={matchReasonOf(member.employee_match_detail) === "external" ? "info" : "warning"}>{mismatch}</StatusBadge>
              ) : null}
            </div>
          </div>

          <div className={cellWrap}>
            <span className={cellLabel}>ใช้ได้ถึง</span>
            <div className="min-w-0">
              {member.membership_expires_at ? (
                <>
                  <p className="tabular-nums text-ink">{formatThaiDateShort(member.membership_expires_at)}</p>
                  {daysLeft !== null && daysLeft >= 0 && lifecycle === "expiring" ? <p className="text-xs text-warning">อีก {daysLeft} วัน</p> : null}
                </>
              ) : (
                <p className="text-ink-subtle">ไม่มีวันหมดอายุ</p>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pl-12 xl:flex-col xl:pl-0">
            {canApprove ? (
              <form action={approveMember}>
                <input name="memberId" type="hidden" value={member.id} />
                {access.isBypass ? (
                  <button className={`${buttonClass("primary", "sm")} w-full`} disabled type="submit">
                    <SaveIcon className="size-4" aria-hidden="true" />
                    อนุมัติ
                  </button>
                ) : match === "matched" ? (
                  <button className={`${buttonClass("primary", "sm")} w-full`} title={`อนุมัติ ${member.full_name}`} type="submit">
                    <SaveIcon className="size-4" aria-hidden="true" />
                    อนุมัติ
                  </button>
                ) : (
                  <ConfirmSubmitButton
                    className={`${buttonClass("primary", "sm")} w-full`}
                    confirmLabel="อนุมัติ"
                    message={`ผลเทียบฐานสมาคม: ${mismatch ?? labelFor(employeeMatchLabels, match)} อนุมัติแล้วเข้าใช้งานได้ทันที`}
                    title={`อนุมัติ ${member.full_name}?`}
                    tone="primary"
                  >
                    <SaveIcon className="size-4" aria-hidden="true" />
                    อนุมัติ
                  </ConfirmSubmitButton>
                )}
              </form>
            ) : null}
            <Link
              aria-expanded={open}
              className={`${buttonClass("secondary", "sm")} ${open ? "bg-brand-50" : ""}`}
              href={open ? closeHref : editHref(member.id)}
            >
              <EditIcon className="size-4" aria-hidden="true" />
              {open ? "ปิด" : "แก้ไข"}
            </Link>
          </div>
        </div>

        {open ? renderPanel(member) : null}
      </li>
    );
  }

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader
          actions={
            access.isBypass ? (
              <button className={buttonClass("secondary", "md")} disabled type="button">
                <DownloadIcon className="size-4" aria-hidden="true" />
                ดาวน์โหลด CSV
              </button>
            ) : (
              <a className={buttonClass("secondary", "md")} download href={exportHref}>
                <DownloadIcon className="size-4" aria-hidden="true" />
                ดาวน์โหลด CSV
              </a>
            )
          }
          description="กดชื่อเพื่อดูประวัติสมาชิก กด “แก้ไข” เพื่อแก้ข้อมูล อนุมัติ หรือเปลี่ยนสถานะ"
          title="รายชื่อสมาชิก"
        />

        {statusMessage ? (
          <StatusBanner className="mt-4" floating tone={bannerTone}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <LoadErrorBanner className="mt-4" error={loadError} />

        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่าง บันทึกไม่ได้ (ต้องปิดโหมดนี้ก่อนเปิดใช้งานจริง)
          </StatusBanner>
        ) : null}

        <nav aria-label="กรองตามสถานะ" className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {filterCards.map((item) => {
            const current = filters.lifecycle === item.filter;
            const value = counts[item.filter] ?? 0;
            const attention = (item.filter === "pending" || item.filter === "expiring") && value > 0;
            return (
              <Link
                aria-current={current ? "page" : undefined}
                className={`rounded-xl border bg-white px-4 py-3 shadow-card transition hover:border-brand-600 ${
                  current ? "border-brand-600 ring-2 ring-brand-600/15" : "border-line"
                }`}
                href={href({ lifecycle: item.filter })}
                key={item.filter}
              >
                <span className="block text-sm font-medium text-ink-muted">{item.label}</span>
                <span className={`mt-0.5 block text-h2 font-semibold tabular-nums ${attention ? "text-warning" : "text-ink"}`}>
                  {value.toLocaleString("th-TH")}
                  <span className="ml-1 text-sm font-medium text-ink-subtle">คน</span>
                </span>
              </Link>
            );
          })}
        </nav>

        {dataRequests.length ? (
          <section aria-labelledby="data-requests-title" className="mt-6 rounded-xl border border-danger/20 bg-white p-5 shadow-card">
            <div className="flex items-start gap-3">
              <FileLock2 className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-h3 font-semibold text-ink" id="data-requests-title">
                  คำขอลบข้อมูล <span className="tabular-nums">{dataRequests.length}</span> รายการ
                </h2>
                <p className="mt-1 text-sm text-ink-muted">เก็บถาวรสมาชิกเพื่อปิดบัญชี หรือปิดคำขอพร้อมเหตุผลที่ยังลบไม่ได้</p>
                <ul className="mt-3 grid gap-3">
                  {dataRequests.map((request) => (
                    <li className="grid gap-3 rounded-lg border border-line p-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] lg:items-end" key={request.id}>
                      <div className="min-w-0 text-sm">
                        <Link className="font-semibold text-ink hover:text-brand-600 hover:underline" href={detailHref(request.member_id)}>
                          {request.members?.full_name ?? "สมาชิก"}
                        </Link>
                        {request.members?.member_code ? <span className="ml-1 tabular-nums text-ink-muted">{request.members.member_code}</span> : null}
                        <p className="text-ink-muted">ขอเมื่อ {formatThaiDateTime(request.created_at)}</p>
                        {request.note ? <p className="text-ink">เหตุผล: {request.note}</p> : null}
                      </div>
                      <form action={resolveDataRequest} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-end">
                        <input name="requestId" type="hidden" value={request.id} />
                        <label className="block">
                          <span className={fieldLabel}>บันทึกการดำเนินการ</span>
                          <input className={fieldInputClass("sm")} disabled={access.isBypass} maxLength={500} name="note" placeholder="เช่น โทรยืนยันแล้ว" />
                        </label>
                        <ConfirmSubmitButton
                          className={buttonClass("danger", "sm")}
                          confirmLabel="เก็บถาวร"
                          disabled={access.isBypass}
                          message={`เก็บถาวร ${request.members?.full_name ?? "สมาชิก"} และปิดคำขอ สมาชิกจะเข้าใช้งานไม่ได้`}
                          name="decision"
                          title="ปิดบัญชีตามคำขอ"
                          value="archive"
                        >
                          เก็บถาวรสมาชิก
                        </ConfirmSubmitButton>
                        <button className={buttonClass("secondary", "sm")} disabled={access.isBypass} name="decision" type="submit" value="reject">
                          ปิดคำขอ (ไม่ลบ)
                        </button>
                      </form>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </section>
        ) : null}

        {leftDirectoryMembers.length ? (
          <section aria-labelledby="left-directory-title" className="mt-6 rounded-xl border border-warning/25 bg-warning-bg p-5">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-warning" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 className="text-h3 font-semibold text-warning" id="left-directory-title">
                  ไม่อยู่ในฐานสมาคมเดือนล่าสุด <span className="tabular-nums">{leftDirectoryMembers.length}</span> คน
                </h2>
                <p className="mt-1 text-sm text-ink-muted">ยังจองได้ระหว่างผ่อนผัน {settings.directoryGraceDays} วัน ครบแล้วระงับสิทธิ์จองเอง</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {leftDirectoryMembers.map((member) => {
                    const flaggedAt = member.employee_match_detail?.flagged_at;
                    const flaggedDate = flaggedAt && !Number.isNaN(new Date(flaggedAt).getTime()) ? bangkokToday(new Date(flaggedAt)) : null;
                    const suspendOn = flaggedDate ? addDays(flaggedDate, settings.directoryGraceDays) : null;
                    return (
                      <Link
                        className="flex flex-wrap items-center gap-x-2 rounded-lg border border-line bg-white px-3 py-2 text-sm text-ink transition hover:border-brand-600"
                        href={editHref(member.id)}
                        key={member.id}
                      >
                        <span className="font-semibold">{member.full_name}</span>
                        {member.employee_code ? (
                          <span className="text-xs text-ink-subtle">
                            รหัสพนักงาน <span className="tabular-nums">{member.employee_code}</span>
                          </span>
                        ) : null}
                        {suspendOn ? <span className="text-xs font-medium text-warning">ระงับ {formatThaiDateShort(suspendOn)}</span> : null}
                      </Link>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>
        ) : null}

        <CreatePanel
          defaultOpen={Boolean(params.status && !params.member && toneForStatus(params.status) === "error" && !params.status.startsWith("bulk"))}
          hint={nextMemberCode ? `เลขสมาชิกถัดไป ${nextMemberCode}` : undefined}
          title="เพิ่มสมาชิกใหม่"
        >
          <MemberForm
            action={createMember}
            defaultTypeId={defaultTypeId}
            disabled={access.isBypass}
            memberTypes={memberTypes}
            nextMemberCode={nextMemberCode}
          />
        </CreatePanel>

        {pinnedMember ? (
          <section aria-label="สมาชิกที่กำลังแก้ไข" className="mt-6 rounded-xl border border-brand-600/30 bg-white shadow-card">
            <p className="border-b border-line px-5 py-3 text-sm font-semibold text-brand-600">กำลังแก้ไข</p>
            <ul>{renderRow(pinnedMember)}</ul>
          </section>
        ) : null}

        <section aria-labelledby="member-list-title" className="mt-6 rounded-xl border border-line bg-white shadow-card">
          <div className="border-b border-line p-5">
            <h2 className="scroll-mt-20 text-h3 font-semibold text-ink" id="member-list-title">
              {showArchived
                ? "สมาชิกที่เก็บถาวร"
                : filters.lifecycle === "all"
                  ? "สมาชิก"
                  : `สมาชิก${memberLifecycleLabels[filters.lifecycle]}`}{" "}
              <span className="tabular-nums">{totalCount.toLocaleString("th-TH")}</span> คน
            </h2>
            <form
              className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-[minmax(0,1fr)_10rem_12.5rem_10rem_9.5rem_auto] xl:items-end"
              role="search"
            >
              {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
              <label className="block sm:col-span-2 lg:col-span-3 xl:col-span-1">
                <span className={fieldLabel}>ค้นหา</span>
                <span className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 mt-0.75 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
                  <input className={searchInput} defaultValue={filters.q} name="q" placeholder="ชื่อ เลขสมาชิก รหัสพนักงาน เบอร์โทร อีเมล" type="search" />
                </span>
              </label>
              <label className="block">
                <span className={fieldLabel}>สถานะ</span>
                <select className={fieldInputClass("sm")} defaultValue={filters.lifecycle} name="filter">
                  {lifecycleFilterOptions.map((value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "ทุกสถานะ" : memberLifecycleLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>เหตุผลที่ไม่ตรงฐาน</span>
                <select className={fieldInputClass("sm")} defaultValue={filters.reason} name="reason">
                  <option value="all">ทุกเหตุผล</option>
                  {matchReasons.map((value) => (
                    <option key={value} value={value}>
                      {matchReasonLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>ประเภทสมาชิก</span>
                <select className={fieldInputClass("sm")} defaultValue={filters.type} name="type">
                  <option value="all">ทุกประเภท</option>
                  {memberTypes.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>เรียงตาม</span>
                <select className={fieldInputClass("sm")} defaultValue={filters.sort} name="sort">
                  {memberSortOptions.map((value) => (
                    <option key={value} value={value}>
                      {memberSortLabels[value]}
                    </option>
                  ))}
                </select>
              </label>
              <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
                <button className={`${buttonClass("primary")} flex-1 xl:flex-none`} type="submit">
                  <Search className="size-4" aria-hidden="true" />
                  ค้นหา
                </button>
                {hasFilters ? (
                  <Link className={buttonClass("ghost")} href={clearHref}>
                    ล้างตัวกรอง
                  </Link>
                ) : null}
              </div>
            </form>
          </div>

          {pendingOnPage.length ? (
            <form action={bulkApproveMembers} id={BULK_FORM_ID}>
              <MembersBulkApproveBar disabled={access.isBypass} formId={BULK_FORM_ID} total={pendingOnPage.length} />
            </form>
          ) : null}

          {members.length ? (
            <>
              {/* Column headers (desktop). Phones show a label in front of each value instead. */}
              <div
                aria-hidden="true"
                className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2.5 text-xs font-medium text-ink-subtle xl:grid ${memberRowGrid}`}
              >
                <span>สมาชิก</span>
                <span>ติดต่อ</span>
                <span>ประเภท · หน่วยงาน</span>
                <span>สถานะ</span>
                <span>ใช้ได้ถึง</span>
                <span />
              </div>

              <ul className="divide-y divide-line">{members.map(renderRow)}</ul>

              {pageCount > 1 ? (
                <nav aria-label="เลือกหน้า" className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3 text-sm">
                  <p className="text-ink-muted">
                    หน้า <span className="tabular-nums">{filters.page}</span> จาก <span className="tabular-nums">{pageCount}</span> · คนที่{" "}
                    <span className="tabular-nums">
                      {((filters.page - 1) * MEMBERS_PAGE_SIZE + 1).toLocaleString("th-TH")}–
                      {Math.min(filters.page * MEMBERS_PAGE_SIZE, totalCount).toLocaleString("th-TH")}
                    </span>
                  </p>
                  <div className="flex gap-2">
                    {filters.page > 1 ? (
                      <Link className={buttonClass("secondary", "sm")} href={href({ page: filters.page - 1 })} rel="prev">
                        <ChevronLeft className="size-4" aria-hidden="true" />
                        ก่อนหน้า
                      </Link>
                    ) : null}
                    {filters.page < pageCount ? (
                      <Link className={buttonClass("secondary", "sm")} href={href({ page: filters.page + 1 })} rel="next">
                        ถัดไป
                        <ChevronRight className="size-4" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>
                </nav>
              ) : null}
            </>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-ink-muted">
                {filters.page > 1
                  ? "หน้านี้ไม่มีรายชื่อแล้ว"
                  : hasFilters
                    ? "ไม่พบสมาชิกที่ตรงกับคำค้นหรือตัวกรองนี้"
                    : "ยังไม่มีสมาชิก กด \"เพิ่มสมาชิกใหม่\" ด้านบนเพื่อเพิ่มคนแรก"}
              </p>
              {hasFilters || filters.page > 1 ? (
                <Link className={`${buttonClass("secondary")} mt-3`} href={clearHref}>
                  {filters.page > 1 && !hasFilters ? "กลับหน้าแรก" : "ล้างตัวกรอง"}
                </Link>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
