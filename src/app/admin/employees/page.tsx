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
} from "lucide-react";

import {
  createEmployee,
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
  department: string | null;
  email: string | null;
  employee_code: string;
  employment_status: string;
  full_name: string;
  id: string;
  source: string | null;
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
    return "bg-[#e6f4df] text-[#24613f]";
  }

  if (status === "inactive") {
    return "bg-[#fff4d8] text-[#8a6112]";
  }

  return "bg-[#f1f3ef] text-[#687a6d]";
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
          <Pencil className="size-4 text-[#0f6b4f]" aria-hidden="true" />
        ) : (
          <Plus className="size-4 text-[#0f6b4f]" aria-hidden="true" />
        )}
        <h2 className="text-lg font-semibold text-[#0f2d26]">{title}</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">รหัสพนักงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={employee?.employee_code ?? ""}
            disabled={disabled}
            name="employeeCode"
            required
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#405249]">ชื่อ-นามสกุล</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={employee?.full_name ?? ""}
            disabled={disabled}
            name="fullName"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">Email องค์กร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={employee?.email ?? ""}
            disabled={disabled}
            name="email"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">หน่วยงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={employee?.department ?? ""}
            disabled={disabled}
            name="department"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">สังกัด</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={employee?.affiliation ?? ""}
            disabled={disabled}
            name="affiliation"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">สถานะพนักงาน</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] bg-white px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
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

      <input name="source" type="hidden" value={employee?.source ?? "manual"} />

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#17453b] disabled:cursor-not-allowed disabled:bg-[#9aa8a1] md:w-fit"
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
        "id, employee_code, full_name, email, department, affiliation, employment_status, source",
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
      employee.department,
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
  const statusMessage = params.status ? statusMessages[params.status] : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-6 text-[#11221d]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#dfe5da] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#5b6f62]">Admin Portal</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#0f2d26]">
              Employee Directory
            </h1>
            <p className="mt-2 text-sm text-[#687a6d]">
              ฐานข้อมูลพนักงานสำหรับเทียบใบสมัครสมาชิกจาก Google login
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26]"
              href={`/admin${bypassQuery}`}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              กลับ Admin
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
              href={access.isBypass ? "/admin/members?bypass=admin" : "/admin/members"}
            >
              ตรวจสมาชิก
            </Link>
          </div>
        </div>

        {statusMessage ? (
          <div className="mt-5 rounded-md bg-[#e6f4df] px-4 py-3 text-sm font-medium text-[#24613f]">
            {statusMessage}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
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
              className="rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm"
              key={item.label}
            >
              <p className="text-sm font-semibold text-[#687a6d]">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold text-[#0f2d26]">
                {item.value}
              </p>
            </article>
          ))}
        </div>

        <section className="mt-6 rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
          <EmployeeForm
            action={createEmployee}
            disabled={access.isBypass}
            title="เพิ่มข้อมูลพนักงาน"
          />
        </section>

        <section className="mt-6 rounded-lg border border-[#dfe5da] bg-white shadow-sm">
          <div className="border-b border-[#dfe5da] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_180px_110px]">
              {access.isBypass ? (
                <input name="bypass" type="hidden" value="admin" />
              ) : null}
              <label className="relative block">
                <Search
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#687a6d]"
                  aria-hidden="true"
                />
                <input
                  className="h-11 w-full rounded-md border border-[#cbd6c7] pl-10 pr-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                  defaultValue={q}
                  name="q"
                  placeholder="ค้นหารหัสพนักงาน ชื่อ email หน่วยงาน"
                />
              </label>
              <label className="relative block">
                <Filter
                  className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#687a6d]"
                  aria-hidden="true"
                />
                <select
                  className="h-11 w-full rounded-md border border-[#cbd6c7] bg-white pl-10 pr-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
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
                className="h-11 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#dfe5da]">
            {employees.length ? (
              employees.map((employee) => (
                <details
                  className="group px-5 py-4"
                  key={employee.id}
                  open={highlightedEmployee === employee.id}
                >
                  <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1fr_0.8fr_0.65fr_96px] lg:items-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                      <CircleUserRound className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#0f2d26]">
                          {employee.full_name}
                        </p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(employee.employment_status)}`}
                        >
                          {statusLabels[employee.employment_status] ??
                            employee.employment_status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#687a6d]">
                        {employee.employee_code} · {employee.email ?? "ไม่มี email"}
                      </p>
                    </div>
                    <div className="text-sm text-[#405249]">
                      <p>{employee.department ?? "-"}</p>
                      <p className="mt-1 text-[#687a6d]">{employee.affiliation ?? "-"}</p>
                    </div>
                    <div className="text-sm text-[#405249]">
                      <p className="flex items-center gap-1">
                        <BriefcaseBusiness className="size-4" aria-hidden="true" />
                        {employee.source ?? "manual"}
                      </p>
                    </div>
                    <span className="w-fit rounded-md border border-[#cbd6c7] px-3 py-2 text-sm font-semibold text-[#0f2d26] group-open:bg-[#fbfcf8]">
                      แก้ไข
                    </span>
                  </summary>

                  <div className="mt-5 rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-4">
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
              <div className="px-5 py-10 text-center text-sm text-[#687a6d]">
                ไม่พบข้อมูลพนักงานตามเงื่อนไขที่ค้นหา
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
