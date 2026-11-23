import Link from "next/link";
import { BriefcaseBusiness, Search, Upload } from "lucide-react";

import {
  createEmployee,
  importEmployees,
  updateEmployee,
} from "@/app/admin/employees/actions";
import { CreatePanel } from "@/components/create-panel";
import { EmployeesImportFields } from "@/components/employees-import-fields";
import { ImportPreviewCard } from "@/app/admin/employees/import-preview";
import { type ImportPreviewState, loadImportPreview, sampleImportPreview } from "@/app/admin/employees/preview-data";
import { MemberAvatar } from "@/components/member-avatar";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, card, fieldHint, fieldInput, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { isDirectoryStale } from "@/lib/directory/import";
import { formatThaiDateShort, formatThaiDateTime, orUnset } from "@/lib/display";
import { pickFilter } from "@/lib/filters";
import { appIcons } from "@/lib/icons";
import { type StatusTone, statusTone } from "@/lib/status";
import { collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { EMAIL_ERROR } from "@/lib/validation";

const AddIcon = appIcons.add;
const DownloadIcon = appIcons.download;
const EditIcon = appIcons.edit;
const SaveIcon = appIcons.save;

/** Blank Excel/CSV with the column names the import reads (src/lib/directory/import.ts). */
const TEMPLATE_HREF = "/templates/association-directory-template.csv";

type AdminEmployeesPageProps = {
  searchParams: Promise<{
    bypass?: string;
    employee?: string;
    /** directory_import_previews.id waiting for "ยืนยันนำเข้า" ("sample" in bypass). */
    preview?: string;
    q?: string;
    status?: string;
  }>;
};

type EmployeeRow = {
  affiliation: string | null;
  association_member_code?: string | null;
  bureau?: string | null;
  department: string | null;
  division?: string | null;
  email: string | null;
  employee_code: string;
  employment_status: string;
  first_name?: string | null;
  full_name: string;
  id: string;
  last_name?: string | null;
  member_type?: string | null;
  membership_status?: string | null;
  position?: string | null;
  section?: string | null;
  source: string | null;
  title_prefix?: string | null;
  work_line?: string | null;
};

const sampleEmployees: EmployeeRow[] = [
  {
    affiliation: "การไฟฟ้าส่วนภูมิภาค",
    department: "กองบริการ",
    email: "member01@example.com",
    association_member_code: "PEA-GC-0001",
    employee_code: "497901",
    employment_status: "active",
    full_name: "สมาชิก ตัวอย่างหนึ่ง",
    id: "sample-employee-1",
    member_type: "สามัญ",
    membership_status: "active",
    source: "manual",
  },
  {
    affiliation: "PEA",
    department: "กองทดสอบ",
    email: "inactive@example.com",
    employee_code: "498000",
    employment_status: "inactive",
    full_name: "พนักงาน ไม่ใช้งาน",
    id: "sample-employee-2",
    source: "manual",
  },
];

const statusLabels: Record<string, string> = {
  active: "ปฏิบัติงาน",
  inactive: "ไม่ปฏิบัติงาน",
  retired: "เกษียณ",
  unknown: "ไม่ระบุ",
};

const membershipLabels: Record<string, string> = {
  active: "สมาชิกปัจจุบัน",
  inactive: "พ้นสภาพสมาชิก",
  suspended: "พักสิทธิ์",
  unknown: "ไม่ระบุ",
};

const sourceLabels: Record<string, string> = {
  association_monthly: "ไฟล์รายเดือน (แทนทั้งหมด)",
  employee_import: "ไฟล์ (เพิ่ม/อัปเดตบางส่วน)",
  manual: "เพิ่มเองในหน้านี้",
};

/** "สมาชิกปัจจุบัน" is green like "ใช้งาน" on the members page; a suspension needs a look. */
function membershipTone(status: string | null | undefined): StatusTone {
  const value = status ?? "active";
  return value === "suspended" ? "warning" : statusTone("directory", value);
}

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "create-failed": "เพิ่มไม่สำเร็จ",
  duplicate: "บันทึกไม่สำเร็จ รหัสพนักงานนี้มีอยู่แล้ว",
  "import-text-corrupted": "ไม่ได้นำเข้า: พบชื่อในไฟล์ที่เป็น ??? (ภาษาไทยเสียหายตั้งแต่ในไฟล์) กรุณาบันทึกไฟล์จาก Excel เป็น .xlsx หรือ CSV UTF-8 แล้วอัปโหลดใหม่",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่ก่อนบันทึก",
  created: "เพิ่มรายชื่อแล้ว",
  "missing-required": "กรอกรหัสพนักงานและชื่อ-นามสกุล",
  "email-invalid": EMAIL_ERROR,
  "employee-code-taken": "บันทึกไม่สำเร็จ รหัสพนักงานนี้มีอยู่ในฐานแล้ว (ไม่สนใจตัวพิมพ์เล็ก/ใหญ่และช่องว่าง) กรุณาค้นหาแล้วแก้ไขรายการเดิมแทน",
  "update-failed": "แก้ไขไม่สำเร็จ",
  updated: "บันทึกแล้ว",
};

const importMessages: Record<string, string> = {
  "import-db-outdated": dbFailureMessages["db-outdated"],
  "import-empty": "ไม่พบรายชื่อในไฟล์ (แต่ละแถวต้องมีรหัสพนักงานและชื่อ)",
  "import-failed": "นำเข้ารายชื่อไม่สำเร็จ",
  "import-missing-employee-code": "ไฟล์ต้องมีคอลัมน์ \"รหัสพนักงาน\" ดูชื่อคอลัมน์จากไฟล์ตัวอย่าง",
  "import-finalize-failed": "นำเข้าแล้ว แต่ตั้งสถานะคนที่ไม่อยู่ในไฟล์ไม่สำเร็จ",
  "import-missing-file": "เลือกไฟล์ Excel หรือ CSV",
  "import-too-large": "ไฟล์ใหญ่เกิน 15 MB",
  "import-unreadable": "อ่านไฟล์ไม่ได้ ตรวจว่าเป็น Excel หรือ CSV",
  imported: "นำเข้าแล้ว",
  "preview-cancelled": "ยกเลิกไฟล์แล้ว ฐานไม่มีการเปลี่ยนแปลง",
  "preview-expired": "ไฟล์หมดเวลายืนยันแล้ว (เก็บไว้ 1 ชั่วโมง) กรุณาอัปโหลดอีกครั้ง",
  "preview-failed": "ตรวจไฟล์ไม่สำเร็จ กรุณาลองอีกครั้ง",
  "preview-not-found": "ไม่พบไฟล์ที่รอยืนยัน กรุณาอัปโหลดอีกครั้ง",
  "preview-used": "ไฟล์นี้นำเข้าไปแล้ว",
};

/** "imported:<n>:<skipped>:<deactivated>:<flagged>[:<restored>][:direct]" → Thai summary. */
function importedMessage(status: string) {
  const [, imported, skipped, deactivated, flagged, ...rest] = status.split(":");
  const restored = rest.find((part) => /^\d+$/.test(part));
  const direct = rest.includes("direct");
  return [
    `นำเข้า ${imported} รายชื่อ`,
    Number(skipped) ? `ข้าม ${skipped} แถว` : null,
    Number(deactivated) ? `พ้นสภาพ ${deactivated} คน` : null,
    Number(flagged) ? `สมาชิกชมรมต้องตรวจ ${flagged} คน` : null,
    Number(restored) ? `คืนสถานะ ${restored} คน` : null,
  ]
    .filter(Boolean)
    .join(" · ") + (direct ? " (นำเข้าทันทีโดยไม่ผ่านหน้าตรวจไฟล์ เพราะฐานข้อมูลยังไม่ได้อัปเดต)" : "");
}

const employeeRowGrid =
  "xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_5.5rem]";
/** Label in front of each value on phones; read out by screen readers on desktop (header row is visual). */
const cellLabel = "w-16 shrink-0 text-ink-subtle xl:sr-only";
const cellWrap = "flex gap-2 pl-12 text-sm xl:block xl:pl-0";
const searchInput =
  "h-10 w-full rounded-lg border border-line bg-white pl-10 pr-3 text-ink outline-none transition focus:border-brand-600 focus:ring-4 focus:ring-brand-600/10";

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}*
    </span>
  );
}

function EmployeeForm({
  action,
  disabled,
  employee,
}: {
  action: (formData: FormData) => void;
  disabled?: boolean;
  employee?: EmployeeRow;
}) {
  return (
    <form action={action} className="grid gap-5">
      {employee ? <input name="employeeId" type="hidden" value={employee.id} /> : null}
      {employee ? (
        <h3 className="flex items-center gap-2 text-h3 font-semibold text-ink">
          <EditIcon className="size-4 text-brand-600" aria-hidden="true" />
          แก้ไขข้อมูล {employee.full_name}
        </h3>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>
            รหัสพนักงาน
            <RequiredMark />
          </span>
          <input
            autoComplete="off"
            className={`${fieldInput} uppercase`}
            data-required-message="กรุณากรอกรหัสพนักงาน"
            defaultValue={employee?.employee_code ?? ""}
            disabled={disabled}
            maxLength={30}
            name="employeeCode"
            required
          />
          <span className={fieldHint}>ห้ามซ้ำ ช่องว่างจะถูกตัดและเปลี่ยนเป็นตัวพิมพ์ใหญ่</span>
        </label>
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>
            ชื่อ-นามสกุล
            <RequiredMark />
          </span>
          <input
            className={fieldInput}
            data-required-message="กรุณากรอกชื่อ-นามสกุล"
            defaultValue={employee?.full_name ?? ""}
            disabled={disabled}
            name="fullName"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="block">
          <span className={fieldLabel}>คำนำหน้า</span>
          <input className={fieldInput} defaultValue={employee?.title_prefix ?? ""} disabled={disabled} name="titlePrefix" />
        </label>
        <label className="block">
          <span className={fieldLabel}>ชื่อ</span>
          <input className={fieldInput} defaultValue={employee?.first_name ?? ""} disabled={disabled} name="firstName" />
        </label>
        <label className="block">
          <span className={fieldLabel}>นามสกุล</span>
          <input className={fieldInput} defaultValue={employee?.last_name ?? ""} disabled={disabled} name="lastName" />
        </label>
      </div>

      <fieldset className="grid gap-4 rounded-lg border border-line bg-white p-4 sm:grid-cols-3">
        <legend className="px-1 text-sm font-semibold text-ink">สมาชิกสมาคม</legend>
        <label className="block">
          <span className={fieldLabel}>รหัสสมาชิกสมาคม/สโมสร</span>
          <input
            className={`${fieldInput} uppercase`}
            defaultValue={employee?.association_member_code ?? ""}
            disabled={disabled}
            name="associationMemberCode"
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>ประเภทสมาชิก</span>
          <input
            className={fieldInput}
            defaultValue={employee?.member_type ?? ""}
            disabled={disabled}
            name="memberType"
            placeholder="เช่น สามัญ, วิสามัญ, สมทบ"
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะสมาชิกสมาคม</span>
          <select className={fieldInput} defaultValue={employee?.membership_status ?? "active"} disabled={disabled} name="membershipStatus">
            <option value="active">สมาชิกปัจจุบัน</option>
            <option value="inactive">พ้นสภาพสมาชิก</option>
            <option value="suspended">พักสิทธิ์</option>
            <option value="unknown">ไม่ระบุ</option>
          </select>
        </label>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className={fieldLabel}>อีเมลองค์กร</span>
          <input
            className={fieldInput}
            data-invalid-message={EMAIL_ERROR}
            defaultValue={employee?.email ?? ""}
            disabled={disabled}
            name="email"
            placeholder="name@pea.co.th"
            type="email"
          />
        </label>
        <label className="block">
          <span className={fieldLabel}>หน่วยงาน (กอง)</span>
          <input className={fieldInput} defaultValue={employee?.department ?? ""} disabled={disabled} name="department" />
        </label>
        <label className="block">
          <span className={fieldLabel}>สังกัด (สายงาน / สำนัก)</span>
          <input className={fieldInput} defaultValue={employee?.affiliation ?? ""} disabled={disabled} name="affiliation" />
        </label>
        <label className="block">
          <span className={fieldLabel}>สถานะพนักงาน</span>
          <select className={fieldInput} defaultValue={employee?.employment_status ?? "active"} disabled={disabled} name="employmentStatus">
            <option value="active">ปฏิบัติงาน</option>
            <option value="inactive">ไม่ปฏิบัติงาน</option>
            <option value="retired">เกษียณ</option>
            <option value="unknown">ไม่ระบุ</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className={fieldLabel}>ตำแหน่ง</span>
          <input className={fieldInput} defaultValue={employee?.position ?? ""} disabled={disabled} name="position" />
        </label>
        <label className="block">
          <span className={fieldLabel}>สายงาน</span>
          <input className={fieldInput} defaultValue={employee?.work_line ?? ""} disabled={disabled} name="workLine" />
        </label>
        <label className="block">
          <span className={fieldLabel}>สำนัก</span>
          <input className={fieldInput} defaultValue={employee?.bureau ?? ""} disabled={disabled} name="bureau" />
        </label>
        <label className="block">
          <span className={fieldLabel}>ฝ่าย</span>
          <input className={fieldInput} defaultValue={employee?.division ?? ""} disabled={disabled} name="division" />
        </label>
        <label className="block">
          <span className={fieldLabel}>แผนก</span>
          <input className={fieldInput} defaultValue={employee?.section ?? ""} disabled={disabled} name="section" />
        </label>
      </div>

      <input name="source" type="hidden" value={employee?.source ?? "manual"} />

      <button className={`${buttonClass("primary")} w-full sm:w-fit`} disabled={disabled} type="submit">
        {employee ? <SaveIcon className="size-4" aria-hidden="true" /> : <AddIcon className="size-4" aria-hidden="true" />}
        {employee ? "บันทึก" : "เพิ่มรายชื่อ"}
      </button>
    </form>
  );
}

export default async function AdminEmployeesPage({
  searchParams,
}: AdminEmployeesPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/employees",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("directory", access);
  const q = params.q?.trim() ?? "";
  const selectedStatus = pickFilter(params.status, ["active", "inactive", "retired", "suspended", "unknown", "m:active", "m:inactive", "m:suspended"]);
  let employees = sampleEmployees;
  let lastImport: { deactivated_count: number; file_name: string; flagged_member_count: number; imported_at: string; imported_count: number; mode: string } | null = null;
  let totalActiveMembers = sampleEmployees.filter((employee) => employee.membership_status === "active").length;
  let loadError: ReturnType<typeof collectLoadErrors> = null;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const [
      { data, error: directoryError },
      { data: importRows, error: importsError },
      { count: activeMembershipCount, error: countError },
    ] = await Promise.all([
      supabase
        .from("employee_directory")
        .select(
          "id, employee_code, title_prefix, first_name, last_name, full_name, email, position, work_line, bureau, division, department, section, affiliation, employment_status, membership_status, member_type, association_member_code, source",
        )
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("employee_code", { ascending: true })
        .limit(300),
      supabase
        .from("directory_imports")
        .select("file_name, mode, imported_count, deactivated_count, flagged_member_count, imported_at")
        .eq("club_id", access.clubId)
        .order("imported_at", { ascending: false })
        .limit(1),
      supabase
        .from("employee_directory")
        .select("id", { count: "exact", head: true })
        .eq("club_id", access.clubId)
        .eq("membership_status", "active")
        .is("archived_at", null),
    ]);

    loadError = collectLoadErrors("admin.employees", [
      { error: directoryError, label: "รายชื่อในฐาน" },
      { error: importsError, label: "ประวัติการนำเข้า" },
      { error: countError, label: "จำนวนสมาชิกที่ใช้งาน" },
    ]);
    employees = (data ?? []) as EmployeeRow[];
    lastImport = importRows?.[0] ?? null;
    totalActiveMembers = activeMembershipCount ?? 0;
  }
  const directoryStale = !access.isBypass && isDirectoryStale(lastImport?.imported_at);
  // Step 2 of the import: the uploaded file waits here until "ยืนยันนำเข้า".
  let importPreview: ImportPreviewState | null = null;
  if (params.preview) {
    if (access.isBypass) {
      importPreview = params.preview === "sample" ? sampleImportPreview() : { state: "not-found" };
    } else if (access.clubId) {
      importPreview = await loadImportPreview(await createClient(), access.clubId, params.preview);
    }
  }
  const previewReady = importPreview?.state === "ready";

  employees = employees.filter((employee) => {
    const matchesStatus =
      selectedStatus === "all" ||
      employee.employment_status === selectedStatus ||
      (selectedStatus.startsWith("m:") && (employee.membership_status ?? "active") === selectedStatus.slice(2));
    const haystack = [
      employee.employee_code,
      employee.full_name,
      employee.email,
      employee.position,
      employee.work_line,
      employee.bureau,
      employee.division,
      employee.department,
      employee.section,
      employee.affiliation,
      employee.association_member_code,
      employee.member_type,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || haystack.includes(q.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  const highlightedEmployee = params.employee;
  const statusMessage = params.status
    ? statusMessages[params.status] ??
      importMessages[params.status] ??
      (params.status.startsWith("imported:") ? importedMessage(params.status) : null)
    : null;
  const createFailed = Boolean(
    params.status &&
      !params.employee &&
      !params.status.startsWith("import") &&
      !params.status.startsWith("preview") &&
      toneForStatus(params.status) === "error",
  );
  const hasFilters = Boolean(q) || selectedStatus !== "all";
  const clearHref = access.isBypass ? "/admin/employees?bypass=admin" : "/admin/employees";

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-7xl">
        <PageHeader description="รายชื่อจากสมาคม อัปโหลดทุกเดือน ใช้ตรวจผู้สมัครสมาชิก" title="ฐานสมาชิกสมาคม" />

        {statusMessage ? (
          <StatusBanner className="mt-4" floating tone={toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        <LoadErrorBanner className="mt-4" error={loadError} />

        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่าง บันทึกไม่ได้ (ต้องปิดโหมดนี้ก่อนเปิดใช้งานจริง)
          </StatusBanner>
        ) : null}

        {directoryStale ? (
          <StatusBanner className="mt-4" tone="warning">
            {lastImport
              ? `อัปเดตล่าสุด ${formatThaiDateShort(lastImport.imported_at)} เกิน 31 วันแล้ว อัปโหลดไฟล์ของเดือนนี้เพื่อให้ตรวจผู้สมัครได้ถูกต้อง`
              : "ยังไม่เคยอัปโหลดรายชื่อ อัปโหลดไฟล์ของสมาคมด้านล่างเพื่อใช้ตรวจผู้สมัคร"}
          </StatusBanner>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <article className="rounded-xl border border-line bg-white px-4 py-3 shadow-card">
            <p className="text-sm font-medium text-ink-muted">สมาชิกสมาคมปัจจุบัน</p>
            <p className="mt-0.5 text-h2 font-semibold tabular-nums text-ink">
              {totalActiveMembers.toLocaleString("th-TH")}
              <span className="ml-1 text-sm font-medium text-ink-subtle">คน</span>
            </p>
          </article>
          <article className="rounded-xl border border-line bg-white px-4 py-3 shadow-card">
            <p className="text-sm font-medium text-ink-muted">อัปเดตล่าสุด</p>
            <p className={`mt-0.5 text-h2 font-semibold ${directoryStale ? "text-warning" : "text-ink"}`}>
              {lastImport ? formatThaiDateShort(lastImport.imported_at) : "ยังไม่เคยอัปโหลด"}
            </p>
          </article>
        </div>

        <section aria-labelledby="import-title" className={`${card} mt-6 scroll-mt-20`} id="import">
          <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="import-title">
            <Upload className="size-5 text-brand-600" aria-hidden="true" />
            อัปโหลดรายชื่อประจำเดือน
          </h2>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 text-sm text-ink-muted">
              <p>
                Excel (.xlsx) หรือ CSV แถวแรกเป็นชื่อคอลัมน์ ต้องมี <span className="font-semibold text-ink">รหัสพนักงาน</span> และ
                <span className="font-semibold text-ink"> ชื่อ</span> + <span className="font-semibold text-ink">นามสกุล</span> (หรือคอลัมน์ ชื่อ-นามสกุล)
              </p>
              <p className="mt-1">
                คอลัมน์อื่นที่อ่านได้: คำนำหน้า, รหัสสมาชิกสมาคมสโมสร, ประเภท, สถานะ, อีเมล, ตำแหน่ง, สายงาน, สำนัก, ฝ่าย, กอง, แผนก
              </p>
              <p className="mt-1">
                ช่อง &quot;สถานะ&quot;: เว้นว่างหรือ &quot;ปกติ&quot; = สมาชิกปัจจุบัน, &quot;พ้นสภาพ&quot;, &quot;พักสิทธิ์&quot;
              </p>
            </div>
            <a className={`${buttonClass("secondary", "sm")} shrink-0 self-start`} download href={TEMPLATE_HREF}>
              <DownloadIcon className="size-4" aria-hidden="true" />
              ดาวน์โหลดไฟล์ตัวอย่าง
            </a>
          </div>

          {importPreview ? <ImportPreviewCard bypass={access.isBypass} preview={importPreview} /> : null}

          {previewReady ? null : (
            <form action={importEmployees} className="mt-4 grid gap-3">
              <EmployeesImportFields activeMembers={totalActiveMembers} disabled={access.isBypass} />
            </form>
          )}

          {access.isBypass && !importPreview ? (
            <p className="mt-3 text-sm text-ink-muted">
              <Link className="font-medium text-brand-600 underline-offset-2 hover:underline" href="/admin/employees?bypass=admin&preview=sample#import">
                ดูตัวอย่างหน้าตรวจไฟล์ก่อนนำเข้า
              </Link>
            </p>
          ) : null}

          {lastImport ? (
            <p className="mt-3 text-sm text-ink-subtle">
              ครั้งล่าสุด {formatThaiDateTime(lastImport.imported_at)} · {lastImport.file_name} ·{" "}
              <span className="tabular-nums">{lastImport.imported_count.toLocaleString("th-TH")}</span> รายชื่อ
              {lastImport.mode === "replace"
                ? ` · แทนทั้งหมด: พ้นสภาพ ${lastImport.deactivated_count} คน · สมาชิกชมรมต้องตรวจ ${lastImport.flagged_member_count} คน`
                : " · เพิ่ม/อัปเดตบางส่วน"}
            </p>
          ) : null}
        </section>

        <CreatePanel
          defaultOpen={createFailed}
          hint="สำหรับคนที่ยังไม่อยู่ในไฟล์ของสมาคม"
          title="เพิ่มรายชื่อในฐาน"
        >
          <EmployeeForm action={createEmployee} disabled={access.isBypass} />
        </CreatePanel>

        <section aria-labelledby="directory-list-title" className="mt-6 rounded-xl border border-line bg-white shadow-card">
          <div className="border-b border-line p-5">
            <h2 className="text-h3 font-semibold text-ink" id="directory-list-title">
              รายชื่อ <span className="tabular-nums">{employees.length.toLocaleString("th-TH")}</span> คน
            </h2>
            <form
              className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_14rem] xl:grid-cols-[minmax(0,1fr)_14rem_auto] xl:items-end"
              role="search"
            >
              {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
              <label className="block">
                <span className={fieldLabel}>ค้นหา</span>
                <span className="relative mt-1.5 block">
                  <Search
                    className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle"
                    aria-hidden="true"
                  />
                  <input
                    className={searchInput}
                    defaultValue={q}
                    name="q"
                    placeholder="รหัสพนักงาน ชื่อ อีเมล หน่วยงาน"
                    type="search"
                  />
                </span>
              </label>
              <label className="block">
                <span className={fieldLabel}>สถานะ</span>
                <select className={fieldInputClass("sm")} defaultValue={selectedStatus} name="status">
                  <option value="all">ทุกสถานะ</option>
                  <optgroup label="สมาชิกสมาคม">
                    <option value="m:active">สมาชิกปัจจุบัน</option>
                    <option value="m:inactive">พ้นสภาพสมาชิก</option>
                    <option value="m:suspended">พักสิทธิ์</option>
                  </optgroup>
                  <optgroup label="พนักงาน">
                    <option value="active">ปฏิบัติงาน</option>
                    <option value="inactive">ไม่ปฏิบัติงาน</option>
                    <option value="retired">เกษียณ</option>
                    <option value="unknown">ไม่ระบุ</option>
                  </optgroup>
                </select>
              </label>
              <div className="flex gap-2 sm:col-span-2 xl:col-span-1">
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

          {employees.length ? (
            <>
              {/* Column headers (desktop). Phones show a label in front of each value instead. */}
              <div
                aria-hidden="true"
                className={`hidden gap-4 border-b border-line bg-canvas px-5 py-2.5 text-xs font-medium text-ink-subtle xl:grid ${employeeRowGrid}`}
              >
                <span>ชื่อ</span>
                <span>รหัสสมาชิกสมาคม · ประเภท</span>
                <span>ตำแหน่ง · หน่วยงาน</span>
                <span>สถานะ</span>
                <span />
              </div>

              <ul className="divide-y divide-line">
                {employees.map((employee) => (
                  <li className="scroll-mt-20" id={`employee-${employee.id}`} key={employee.id}>
                    <details className="group px-5 py-4" open={highlightedEmployee === employee.id}>
                      <summary className={`grid cursor-pointer gap-2 rounded-lg xl:items-start xl:gap-4 ${employeeRowGrid}`}>
                        <div className="flex min-w-0 items-start gap-3">
                          <MemberAvatar displayName={employee.full_name} seed={employee.employee_code} size="xs" />
                          <div className="min-w-0">
                            <p className="truncate font-semibold text-ink">{employee.full_name}</p>
                            <p className="text-sm text-ink-muted">
                              <span className="text-ink-subtle">รหัสพนักงาน</span>{" "}
                              <span className="tabular-nums">{employee.employee_code}</span>
                            </p>
                            {employee.email ? <p className="break-all text-sm text-ink-muted">{employee.email}</p> : null}
                          </div>
                        </div>

                        <div className={cellWrap}>
                          <span className={cellLabel}>สมาคม</span>
                          <div className="min-w-0">
                            <p className="tabular-nums text-ink">{orUnset(employee.association_member_code, "ยังไม่มีรหัสสมาชิก")}</p>
                            {employee.member_type ? <p className="text-ink-muted">ประเภท {employee.member_type}</p> : null}
                          </div>
                        </div>

                        <div className={cellWrap}>
                          <span className={cellLabel}>ตำแหน่ง</span>
                          <div className="min-w-0">
                            <p className="text-ink">{orUnset(employee.position || employee.department)}</p>
                            {employee.work_line || employee.affiliation ? (
                              <p className="text-ink-muted">{employee.work_line || employee.affiliation}</p>
                            ) : null}
                          </div>
                        </div>

                        <div className={cellWrap}>
                          <span className={cellLabel}>สถานะ</span>
                          <div className="min-w-0">
                            <StatusBadge tone={membershipTone(employee.membership_status)}>
                              {membershipLabels[employee.membership_status ?? "active"] ?? employee.membership_status}
                            </StatusBadge>
                            <p className="mt-1 flex items-center gap-1 text-ink-muted">
                              <BriefcaseBusiness className="size-4 shrink-0" aria-hidden="true" />
                              {statusLabels[employee.employment_status] ?? employee.employment_status}
                            </p>
                          </div>
                        </div>

                        <div className="pl-12 xl:pl-0">
                          <span className={`${buttonClass("secondary", "sm")} group-open:bg-brand-50`}>
                            <EditIcon className="size-4" aria-hidden="true" />
                            แก้ไข
                          </span>
                        </div>
                      </summary>

                      <div className="mt-4 grid gap-4 rounded-xl border border-line bg-canvas p-4 sm:p-5">
                        <dl className="grid gap-3 rounded-lg border border-line bg-white p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
                          {[
                            { label: "รหัสสมาชิกสมาคม", value: employee.association_member_code },
                            { label: "ประเภทสมาชิก", value: employee.member_type },
                            { label: "สถานะสมาชิก", value: membershipLabels[employee.membership_status ?? "active"] },
                            { label: "ตำแหน่ง", value: employee.position },
                            { label: "สายงาน", value: employee.work_line },
                            { label: "สำนัก", value: employee.bureau },
                            { label: "ฝ่าย", value: employee.division },
                            { label: "กอง", value: employee.department },
                            { label: "แผนก", value: employee.section },
                            { label: "คำนำหน้า", value: employee.title_prefix },
                            {
                              label: "ชื่อ-นามสกุล",
                              value:
                                [employee.first_name, employee.last_name]
                                  .filter(Boolean)
                                  .join(" ") || employee.full_name,
                            },
                            { label: "ที่มา", value: employee.source ? (sourceLabels[employee.source] ?? employee.source) : null },
                          ].map((item) => (
                            <div key={item.label}>
                              <dt className="text-xs font-medium text-ink-subtle">{item.label}</dt>
                              <dd className="mt-0.5 text-ink">{orUnset(item.value)}</dd>
                            </div>
                          ))}
                        </dl>
                        <EmployeeForm action={updateEmployee} disabled={access.isBypass} employee={employee} />
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="px-5 py-10 text-center">
              <p className="text-sm text-ink-muted">
                {hasFilters
                  ? "ไม่พบรายชื่อที่ตรงกับคำค้นหรือตัวกรองนี้"
                  : "ยังไม่มีรายชื่อในฐาน อัปโหลดไฟล์ของสมาคมเพื่อเริ่มใช้ตรวจผู้สมัคร"}
              </p>
              {hasFilters ? (
                <Link className={`${buttonClass("secondary")} mt-3`} href={clearHref}>
                  ล้างตัวกรอง
                </Link>
              ) : (
                <a className={`${buttonClass("primary")} mt-3`} href="#import">
                  <Upload className="size-4" aria-hidden="true" />
                  ไปที่อัปโหลดรายชื่อ
                </a>
              )}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
