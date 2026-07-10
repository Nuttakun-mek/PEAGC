import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  BriefcaseBusiness,
  CircleUserRound,
  Filter,
  Pencil,
  Plus,
  Search,
  Upload,
} from "lucide-react";

import {
  createEmployee,
  importEmployees,
  updateEmployee,
} from "@/app/admin/employees/actions";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type AdminEmployeesPageProps = {
  searchParams: Promise<{
    bypass?: string;
    employee?: string;
    q?: string;
    status?: string;
  }>;
};

type EmployeeRow = {
  affiliation: string | null;
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
    employee_code: "497901",
    employment_status: "active",
    full_name: "สมาชิก ตัวอย่างหนึ่ง",
    id: "sample-employee-1",
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
  active: "Active",
  inactive: "Inactive",
  retired: "Retired",
  unknown: "Unknown",
};

const statusMessages: Record<string, string> = {
  "create-failed": "เพิ่มข้อมูลพนักงานไม่สำเร็จ กรุณาตรวจรหัสพนักงานซ้ำ",
  created: "เพิ่มข้อมูลพนักงานเรียบร้อยแล้ว",
  "missing-required": "กรุณากรอกรหัสพนักงานและชื่อ-นามสกุล",
  "update-failed": "แก้ไขข้อมูลพนักงานไม่สำเร็จ",
  updated: "แก้ไขข้อมูลพนักงานเรียบร้อยแล้ว",
};

function getStatusClass(status: string) {
  if (status === "active") {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (status === "inactive") {
    return "bg-[#fff5d8] text-[#805300]";
  }

  return "bg-[#f1f3ef] text-[#6b6475]";
}

function EmployeeForm({
  action,
  disabled,
  employee,
  title,
}: {
  action: (formData: FormData) => void;
  disabled?: boolean;
  employee?: EmployeeRow;
  title: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      {employee ? <input name="employeeId" type="hidden" value={employee.id} /> : null}
      <div className="flex items-center gap-2">
        {employee ? (
          <Pencil className="size-4 text-[#722257]" aria-hidden="true" />
        ) : (
          <Plus className="size-4 text-[#722257]" aria-hidden="true" />
        )}
        <h2 className="text-lg font-semibold text-[#722257]">{title}</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">รหัสพนักงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.employee_code ?? ""}
            disabled={disabled}
            name="employeeCode"
            required
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อ-นามสกุล</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.full_name ?? ""}
            disabled={disabled}
            name="fullName"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">คำนำหน้า</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.title_prefix ?? ""}
            disabled={disabled}
            name="titlePrefix"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อ</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.first_name ?? ""}
            disabled={disabled}
            name="firstName"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">นามสกุล</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.last_name ?? ""}
            disabled={disabled}
            name="lastName"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">Email องค์กร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.email ?? ""}
            disabled={disabled}
            name="email"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">หน่วยงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.department ?? ""}
            disabled={disabled}
            name="department"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สังกัด</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.affiliation ?? ""}
            disabled={disabled}
            name="affiliation"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานะพนักงาน</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.employment_status ?? "active"}
            disabled={disabled}
            name="employmentStatus"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="retired">Retired</option>
            <option value="unknown">Unknown</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ตำแหน่ง</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.position ?? ""}
            disabled={disabled}
            name="position"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สายงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.work_line ?? ""}
            disabled={disabled}
            name="workLine"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สำนัก</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.bureau ?? ""}
            disabled={disabled}
            name="bureau"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ฝ่าย</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.division ?? ""}
            disabled={disabled}
            name="division"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">แผนก</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={employee?.section ?? ""}
            disabled={disabled}
            name="section"
          />
        </label>
      </div>

      <input name="source" type="hidden" value={employee?.source ?? "manual"} />

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6] md:w-fit"
        disabled={disabled}
        type="submit"
      >
        <BadgeCheck className="size-4" aria-hidden="true" />
        {employee ? "บันทึกข้อมูลพนักงาน" : "เพิ่มข้อมูลพนักงาน"}
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
  const q = params.q?.trim() ?? "";
  const selectedStatus = params.status ?? "all";
  let employees = sampleEmployees;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const { data } = await supabase
      .from("employee_directory")
      .select(
        "id, employee_code, title_prefix, first_name, last_name, full_name, email, position, work_line, bureau, division, department, section, affiliation, employment_status, source",
      )
      .eq("club_id", access.clubId)
      .is("archived_at", null)
      .order("employee_code", { ascending: true })
      .limit(100);

    employees = (data ?? []) as EmployeeRow[];
  }

  employees = employees.filter((employee) => {
    const matchesStatus =
      selectedStatus === "all" || employee.employment_status === selectedStatus;
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
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || haystack.includes(q.toLowerCase());

    return matchesStatus && matchesSearch;
  });

  const activeCount = employees.filter(
    (employee) => employee.employment_status === "active",
  ).length;
  const highlightedEmployee = params.employee;
  const statusMessage = params.status
    ? statusMessages[params.status] ??
      {
        "import-empty": "ไม่พบข้อมูลพนักงานในไฟล์ที่อัปโหลด",
        "import-failed": "นำเข้าฐานข้อมูลพนักงานไม่สำเร็จ",
        "import-missing-employee-code": "ไฟล์ต้องมีคอลัมน์ รหัสพนักงาน",
        "import-missing-file": "กรุณาเลือกไฟล์ CSV หรือ TSV",
        imported: "นำเข้าฐานข้อมูลพนักงานเรียบร้อยแล้ว",
      }[params.status]
    : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">Admin Portal</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              Employee Directory
            </h1>
            <p className="mt-2 text-sm text-[#6b6475]">
              ฐานข้อมูลพนักงานสำหรับเทียบใบสมัครสมาชิกจาก Google login
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]"
              href={`/admin${bypassQuery}`}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              กลับ Admin
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
              href={access.isBypass ? "/admin/members?bypass=admin" : "/admin/members"}
            >
              ตรวจสมาชิก
            </Link>
          </div>
        </div>

        {statusMessage ? (
          <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
            {statusMessage}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            โหมด Admin ทดลอง: แสดงข้อมูลตัวอย่างและปิดการบันทึกจริง ต้องปิดก่อน go live
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { label: "พนักงานที่แสดง", value: employees.length },
            { label: "Active", value: activeCount },
            { label: "รอตรวจสมาชิก", value: "Match" },
          ].map((item) => (
            <article
              className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]"
              key={item.label}
            >
              <p className="text-sm font-semibold text-[#6b6475]">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold text-[#722257]">
                {item.value}
              </p>
            </article>
          ))}
        </div>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <form action={importEmployees} className="grid gap-4">
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-[#722257]" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-[#722257]">
                อัปโหลดฐานข้อมูลพนักงาน
              </h2>
            </div>
            <p className="text-sm text-[#6b6475]">
              รองรับไฟล์ CSV/TSV ที่ export จาก Excel โดยใช้หัวคอลัมน์: รหัสพนักงาน, คำนำหน้า, ชื่อ, นามสกุล, ตำแหน่ง, สายงาน, สำนัก, ฝ่าย, กอง, แผนก
            </p>
            <div className="grid gap-3 md:grid-cols-[1fr_160px]">
              <input
                accept=".csv,.tsv,text/csv,text/tab-separated-values"
                className="h-11 rounded-md border border-[#d9d3e6] bg-white px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-[#f8edf4] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#722257]"
                disabled={access.isBypass}
                name="employeeFile"
                required
                type="file"
              />
              <button
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6]"
                disabled={access.isBypass}
                type="submit"
              >
                <Upload className="size-4" aria-hidden="true" />
                Import
              </button>
            </div>
          </form>
        </section>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <EmployeeForm
            action={createEmployee}
            disabled={access.isBypass}
            title="เพิ่มข้อมูลพนักงาน"
          />
        </section>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_180px_110px]">
              {access.isBypass ? (
                <input name="bypass" type="hidden" value="admin" />
              ) : null}
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]"
                  aria-hidden="true"
                />
                <input
                  className="h-11 w-full rounded-md border border-[#d9d3e6] pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={q}
                  name="q"
                  placeholder="ค้นหารหัสพนักงาน ชื่อ email หน่วยงาน"
                />
              </label>
              <label className="relative block">
                <Filter
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]"
                  aria-hidden="true"
                />
                <select
                  className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={selectedStatus}
                  name="status"
                >
                  <option value="all">ทุกสถานะ</option>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                  <option value="retired">Retired</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
              <button
                className="h-11 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#e6e2ee]">
            {employees.length ? (
              employees.map((employee) => (
                <details
                  className="group px-5 py-4"
                  key={employee.id}
                  open={highlightedEmployee === employee.id}
                >
                  <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1fr_0.8fr_0.65fr_96px] lg:items-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                      <CircleUserRound className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#722257]">
                          {employee.full_name}
                        </p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(employee.employment_status)}`}
                        >
                          {statusLabels[employee.employment_status] ??
                            employee.employment_status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#6b6475]">
                        {employee.employee_code} · {employee.email ?? "ไม่มี email"}
                      </p>
                    </div>
                    <div className="text-sm text-[#3f3a48]">
                      <p>{employee.position ?? employee.department ?? "-"}</p>
                      <p className="mt-1 text-[#6b6475]">
                        {employee.work_line ?? employee.affiliation ?? "-"}
                      </p>
                    </div>
                    <div className="text-sm text-[#3f3a48]">
                      <p className="flex items-center gap-1">
                        <BriefcaseBusiness className="size-4" aria-hidden="true" />
                        {employee.source ?? "manual"}
                      </p>
                    </div>
                    <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-white/70">
                      แก้ไข
                    </span>
                  </summary>

                  <div className="mt-5 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
                    <div className="mb-4 grid gap-3 rounded-md bg-white p-4 text-sm text-[#3f3a48] md:grid-cols-4">
                      {[
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
                      ].map((item) => (
                        <div key={item.label}>
                          <p className="font-semibold text-[#6b6475]">{item.label}</p>
                          <p className="mt-1 text-[#722257]">{item.value || "-"}</p>
                        </div>
                      ))}
                    </div>
                    <EmployeeForm
                      action={updateEmployee}
                      disabled={access.isBypass}
                      employee={employee}
                      title={`แก้ไข ${employee.full_name}`}
                    />
                  </div>
                </details>
              ))
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">
                ไม่พบข้อมูลพนักงานตามเงื่อนไขที่ค้นหา
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
