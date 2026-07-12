import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CircleUserRound,
  Filter,
  Pencil,
  Plus,
  Search,
} from "lucide-react";

import {
  approveMember,
  createMember,
  updateMember,
} from "@/app/admin/members/actions";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type AdminMembersPageProps = {
  searchParams: Promise<{
    bypass?: string;
    member?: string;
    q?: string;
    status?: string;
    type?: string;
  }>;
};

type MemberType = {
  id: string;
  name: string;
};

type MemberRow = {
  affiliation: string | null;
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
    reason?: string;
  } | null;
  employee_match_status: string | null;
  full_name: string;
  handicap: number | null;
  id: string;
  joined_at: string | null;
  line_id: string | null;
  member_code: string | null;
  member_type_id: string | null;
  member_types: { name: string } | null;
  nickname: string | null;
  note: string | null;
  organization: string | null;
  phone: string | null;
  skill_level: string | null;
  status: string;
};

type RawMemberRow = Omit<MemberRow, "member_types"> & {
  member_types: { name: string } | { name: string }[] | null;
};

const sampleTypes: MemberType[] = [
  { id: "regular", name: "สมาชิก" },
  { id: "guest", name: "แขก" },
];

const sampleMembers: MemberRow[] = [
  {
    email: "member01@example.com",
    employee_code: "497901",
    employee_match_detail: {
      checks: {
        activeEmployee: true,
        affiliation: true,
        department: true,
        email: true,
        fullName: true,
      },
      directory: {
        affiliation: "การไฟฟ้าส่วนภูมิภาค",
        department: "กองบริการ",
        email: "member01@example.com",
        employment_status: "active",
        full_name: "สมาชิก ตัวอย่างหนึ่ง",
      },
    },
    employee_match_status: "matched",
    department: "กองบริการ",
    affiliation: "การไฟฟ้าส่วนภูมิภาค",
    full_name: "สมาชิก ตัวอย่างหนึ่ง",
    handicap: 12.4,
    id: "sample-1",
    joined_at: "2026-07-01",
    line_id: "peagc01",
    member_code: "PEA-001",
    member_type_id: "regular",
    member_types: { name: "สมาชิก" },
    nickname: "หนึ่ง",
    note: "ข้อมูลทดลองสำหรับหน้าตัวอย่าง",
    organization: "PEA HQ",
    phone: "0812345678",
    skill_level: "intermediate",
    status: "pending_verification",
  },
  {
    email: "guest01@example.com",
    employee_code: "498888",
    employee_match_detail: { reason: "employee_code_not_found" },
    employee_match_status: "not_found",
    department: "กองทดสอบ",
    affiliation: "PEA",
    full_name: "แขก รับเชิญ",
    handicap: null,
    id: "sample-2",
    joined_at: null,
    line_id: null,
    member_code: "GST-001",
    member_type_id: "guest",
    member_types: { name: "แขก" },
    nickname: "Guest",
    note: null,
    organization: null,
    phone: "0899999999",
    skill_level: "beginner",
    status: "guest",
  },
];

const statusLabels: Record<string, string> = {
  active: "ใช้งาน",
  archived: "เก็บถาวร",
  guest: "บุคคลภายนอก",
  inactive: "ไม่ใช้งาน",
  pending_verification: "รอตรวจสอบ",
};

const statusMessages: Record<string, string> = {
  "approve-failed": "อนุมัติสมาชิกไม่สำเร็จ",
  approved: "อนุมัติสมาชิกเรียบร้อยแล้ว",
  "create-failed": "เพิ่มสมาชิกไม่สำเร็จ กรุณาตรวจรหัสสมาชิกซ้ำหรือข้อมูลที่กรอก",
  created: "เพิ่มสมาชิกเรียบร้อยแล้ว",
  "missing-required": "กรุณากรอกชื่อ-นามสกุล",
  "member-code-generate-failed": "สร้างเลขสมาชิกอัตโนมัติไม่สำเร็จ",
  "member-code-invalid": "เลขสมาชิกต้องอยู่ในรูปแบบ PEAGC-0001",
  "member-code-taken": "เลขสมาชิกนี้ถูกใช้งานแล้ว กรุณาเลือกเลขอื่น",
  "update-failed": "แก้ไขสมาชิกไม่สำเร็จ",
  updated: "แก้ไขสมาชิกเรียบร้อยแล้ว",
};

const employeeMatchLabels: Record<string, string> = {
  matched: "ตรงฐานพนักงาน",
  mismatch: "ข้อมูลไม่ตรง",
  not_checked: "ยังไม่ตรวจ",
  not_found: "ไม่พบรหัสพนักงาน",
};

function getEmployeeMatchClass(status: string | null) {
  if (status === "matched") {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (status === "mismatch" || status === "not_found") {
    return "bg-[#fdecec] text-[#8a1f11]";
  }

  return "bg-[#f1f3ef] text-[#6b6475]";
}

function getStatusClass(status: string) {
  if (status === "active") {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (status === "pending_verification") {
    return "bg-[#fff5d8] text-[#805300]";
  }

  if (status === "guest") {
    return "bg-[#eef2ff] text-[#3730a3]";
  }

  if (status === "inactive") {
    return "bg-[#fff5d8] text-[#805300]";
  }

  return "bg-[#f1f3ef] text-[#6b6475]";
}

function MemberForm({
  action,
  disabled,
  member,
  memberCodeOptions,
  memberTypes,
  title,
}: {
  action: (formData: FormData) => void;
  disabled?: boolean;
  member?: MemberRow;
  memberCodeOptions: string[];
  memberTypes: MemberType[];
  title: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      {member ? <input name="memberId" type="hidden" value={member.id} /> : null}
      <div className="flex items-center gap-2">
        {member ? (
          <Pencil className="size-4 text-[#722257]" aria-hidden="true" />
        ) : (
          <Plus className="size-4 text-[#722257]" aria-hidden="true" />
        )}
        <h2 className="text-lg font-semibold text-[#722257]">{title}</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">เลขสมาชิก</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.member_code ?? ""}
            disabled={disabled}
            name="memberCode"
            required
          >
            <option value="">เลือกเลขสมาชิก</option>
            {member?.member_code ? (
              <option value={member.member_code}>{member.member_code} (เลขปัจจุบัน)</option>
            ) : null}
            {memberCodeOptions
              .filter((code) => code !== member?.member_code)
              .map((code) => (
                <option key={code} value={code}>{code}</option>
              ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">รหัสพนักงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.employee_code ?? ""}
            disabled={disabled}
            name="employeeCode"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อ-นามสกุล</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.full_name ?? ""}
            disabled={disabled}
            name="fullName"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ชื่อเล่น</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.nickname ?? ""}
            disabled={disabled}
            name="nickname"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">เบอร์โทร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.phone ?? ""}
            disabled={disabled}
            name="phone"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">อีเมล</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.email ?? ""}
            disabled={disabled}
            name="email"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ไอดีไลน์</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.line_id ?? ""}
            disabled={disabled}
            name="lineId"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">หน่วยงาน</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.department ?? ""}
            disabled={disabled}
            name="department"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สังกัด</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.affiliation ?? ""}
            disabled={disabled}
            name="affiliation"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">วันที่สมัคร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.joined_at ?? ""}
            disabled={disabled}
            name="joinedAt"
            type="date"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#3f3a48]">หน่วยงาน / บริษัท</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.organization ?? ""}
            disabled={disabled}
            name="organization"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ประเภท</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.member_type_id ?? ""}
            disabled={disabled}
            name="memberTypeId"
          >
            <option value="">ไม่ระบุ</option>
            {memberTypes.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">สถานะ</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.status ?? "active"}
            disabled={disabled}
            name="status"
          >
            <option value="pending_verification">รอตรวจสอบ</option>
            <option value="active">ใช้งาน</option>
            <option value="inactive">ไม่ใช้งาน</option>
            <option value="guest">บุคคลภายนอก</option>
            <option value="archived">เก็บถาวร</option>
          </select>
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">แต้มต่อ</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.handicap ?? ""}
            disabled={disabled}
            name="handicap"
            step="0.1"
            type="number"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">ระดับฝีมือ</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.skill_level ?? ""}
            disabled={disabled}
            name="skillLevel"
          >
            <option value="">ยังไม่ระบุ</option>
            <option value="beginner">เริ่มต้น</option>
            <option value="intermediate">ปานกลาง</option>
            <option value="advanced">ชำนาญ</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">หมายเหตุ</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={member?.note ?? ""}
            disabled={disabled}
            name="note"
          />
        </label>
      </div>

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6] md:w-fit"
        disabled={disabled}
        type="submit"
      >
        <BadgeCheck className="size-4" aria-hidden="true" />
        {member ? "บันทึกการแก้ไข" : "เพิ่มสมาชิก"}
      </button>
    </form>
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
  const q = params.q?.trim() ?? "";
  const selectedStatus = params.status ?? "all";
  const selectedType = params.type ?? "all";

  let memberTypes = sampleTypes;
  let members = sampleMembers;

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const [{ data: typeData }, { data: memberData }] = await Promise.all([
      supabase
        .from("member_types")
        .select("id, name")
        .eq("club_id", access.clubId)
        .neq("status", "archived")
        .order("name"),
      supabase
        .from("members")
        .select(
          "id, member_code, employee_code, employee_match_status, employee_match_detail, department, affiliation, full_name, nickname, phone, line_id, email, organization, handicap, skill_level, status, joined_at, note, member_type_id, member_types(name)",
        )
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

    memberTypes = typeData ?? [];
    members = ((memberData ?? []) as unknown as RawMemberRow[]).map((member) => ({
      ...member,
      member_types: Array.isArray(member.member_types)
        ? (member.member_types[0] ?? null)
        : member.member_types,
    }));
  }

  const usedMemberCodes = new Set(
    members.map((member) => member.member_code).filter((code): code is string => Boolean(code)),
  );
  const highestMemberNumber = [...usedMemberCodes].reduce((highest, code) => {
    const match = /^PEAGC-(\d+)$/.exec(code);

    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  const memberCodeOptions: string[] = [];
  let candidateNumber = highestMemberNumber + 1;

  while (memberCodeOptions.length < 20) {
    const candidate = `PEAGC-${String(candidateNumber).padStart(4, "0")}`;

    if (!usedMemberCodes.has(candidate)) {
      memberCodeOptions.push(candidate);
    }

    candidateNumber += 1;
  }

  members = members.filter((member) => {
    const matchesStatus = selectedStatus === "all" || member.status === selectedStatus;
    const matchesType =
      selectedType === "all" || member.member_type_id === selectedType;
    const haystack = [
      member.member_code,
      member.full_name,
      member.employee_code,
      member.department,
      member.affiliation,
      member.nickname,
      member.phone,
      member.email,
      member.organization,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || haystack.includes(q.toLowerCase());

    return matchesStatus && matchesType && matchesSearch;
  });

  const activeCount = members.filter((member) => member.status === "active").length;
  const guestCount = members.filter((member) => member.status === "guest").length;
  const pendingCount = members.filter(
    (member) => member.status === "pending_verification",
  ).length;
  const highlightedMember = params.member;
  const statusMessage = params.status ? statusMessages[params.status] : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">ระบบผู้ดูแล</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              จัดการสมาชิก
            </h1>
            <p className="mt-2 text-sm text-[#6b6475]">
              ค้นหา เพิ่ม แก้ไข และตรวจข้อมูลสมาชิกชมรม
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
              href={access.isBypass ? "/member?bypass=member" : "/member"}
            >
              ดูหน้าสมาชิก
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
            โหมดผู้ดูแลทดลอง: แสดงข้อมูลตัวอย่างและปิดการบันทึกจริง ต้องปิดก่อนเปิดใช้งาน
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            { label: "สมาชิกที่แสดง", value: members.length },
            { label: "รอตรวจสอบ", value: pendingCount },
            { label: "ใช้งาน", value: activeCount },
            { label: "บุคคลภายนอก", value: guestCount },
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
          <MemberForm
            action={createMember}
            disabled={access.isBypass}
            memberCodeOptions={memberCodeOptions}
            memberTypes={memberTypes}
            title="เพิ่มสมาชิกใหม่"
          />
        </section>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_180px_180px_110px]">
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
                  placeholder="ค้นหาชื่อ รหัส เบอร์ หรือ email"
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
                  <option value="pending_verification">รอตรวจสอบ</option>
                  <option value="active">ใช้งาน</option>
                  <option value="inactive">ไม่ใช้งาน</option>
                  <option value="guest">บุคคลภายนอก</option>
                  <option value="archived">เก็บถาวร</option>
                </select>
              </label>
              <select
                className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={selectedType}
                name="type"
              >
                <option value="all">ทุกประเภท</option>
                {memberTypes.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <button
                className="h-11 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#e6e2ee]">
            {members.length ? (
              members.map((member) => (
                <details
                  className="group px-5 py-4"
                  key={member.id}
                  open={highlightedMember === member.id}
                >
                  <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1.15fr_0.8fr_0.65fr_96px] lg:items-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                      <CircleUserRound className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#722257]">
                          {member.full_name}
                        </p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(member.status)}`}
                        >
                          {statusLabels[member.status] ?? member.status}
                        </span>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getEmployeeMatchClass(member.employee_match_status)}`}
                        >
                          {employeeMatchLabels[
                            member.employee_match_status ?? "not_checked"
                          ] ?? member.employee_match_status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#6b6475]">
                        {member.employee_code ?? "ไม่มีรหัสพนักงาน"} ·{" "}
                        {member.member_code ?? "ไม่มีรหัสสมาชิก"} ·{" "}
                        {member.nickname ?? "ไม่มีชื่อเล่น"}
                      </p>
                    </div>
                    <div className="text-sm text-[#3f3a48]">
                      <p>{member.phone ?? "-"}</p>
                      <p className="mt-1 text-[#6b6475]">{member.email ?? "-"}</p>
                    </div>
                    <div className="text-sm text-[#3f3a48]">
                      <p>{member.member_types?.name ?? "ไม่ระบุประเภท"}</p>
                      <p className="mt-1 text-[#6b6475]">{member.department ?? "-"}</p>
                    </div>
                    <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-white/70">
                      แก้ไข
                    </span>
                  </summary>

                  <div className="mt-5 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
                    <div className="mb-4 grid gap-3 rounded-md bg-white p-4 text-sm text-[#3f3a48] md:grid-cols-3">
                      <div>
                        <p className="font-semibold text-[#6b6475]">รหัสพนักงาน</p>
                        <p className="mt-1 text-[#722257]">
                          {member.employee_code ?? "-"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#6b6475]">หน่วยงาน</p>
                        <p className="mt-1 text-[#722257]">
                          {member.department ?? "-"}
                        </p>
                      </div>
                      <div>
                        <p className="font-semibold text-[#6b6475]">สังกัด</p>
                        <p className="mt-1 text-[#722257]">
                          {member.affiliation ?? "-"}
                        </p>
                      </div>
                    </div>

                    <div className="mb-4 rounded-md bg-white p-4 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="font-semibold text-[#722257]">
                          ผลเทียบฐานพนักงาน
                        </p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getEmployeeMatchClass(member.employee_match_status)}`}
                        >
                          {employeeMatchLabels[
                            member.employee_match_status ?? "not_checked"
                          ] ?? member.employee_match_status}
                        </span>
                      </div>
                      {member.employee_match_detail?.checks ? (
                        <div className="mt-3 grid gap-2 md:grid-cols-5">
                          {Object.entries(member.employee_match_detail.checks).map(
                            ([key, ok]) => (
                              <div
                                className="rounded-md bg-white/70 px-3 py-2"
                                key={key}
                              >
                                <p className="text-xs font-semibold text-[#6b6475]">
                                  {key}
                                </p>
                                <p
                                  className={`mt-1 font-semibold ${
                                    ok ? "text-[#722257]" : "text-[#8a1f11]"
                                  }`}
                                >
                                  {ok ? "ผ่าน" : "ไม่ผ่าน"}
                                </p>
                              </div>
                            ),
                          )}
                        </div>
                      ) : (
                        <p className="mt-2 text-[#6b6475]">
                          {member.employee_match_detail?.reason ??
                            "ยังไม่มีผลการตรวจฐานพนักงาน"}
                        </p>
                      )}
                    </div>

                    {member.status === "pending_verification" ? (
                      <form
                        action={approveMember}
                        className="mb-4 grid gap-3 rounded-md border border-[#d7a52c] bg-[#fff9ed] p-4 md:grid-cols-[190px_1fr_auto]"
                      >
                        <input name="memberId" type="hidden" value={member.id} />
                        <label className="block">
                          <span className="text-sm font-semibold text-[#805300]">เลขสมาชิก</span>
                          <select
                            className="mt-2 h-11 w-full rounded-md border border-[#d7a52c] bg-white px-3 outline-none focus:border-[#722257]"
                            defaultValue={member.member_code ?? memberCodeOptions[0]}
                            disabled={access.isBypass}
                            name="memberCode"
                            required
                          >
                            {member.member_code ? <option value={member.member_code}>{member.member_code} (เลขปัจจุบัน)</option> : null}
                            {memberCodeOptions.filter((code) => code !== member.member_code).map((code) => (
                              <option key={code} value={code}>{code}</option>
                            ))}
                          </select>
                        </label>
                        <label className="block">
                          <span className="text-sm font-semibold text-[#805300]">
                            หมายเหตุการตรวจสอบ
                          </span>
                          <input
                            className="mt-2 h-11 w-full rounded-md border border-[#d7a52c] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                            disabled={access.isBypass}
                            name="verificationNote"
                            placeholder="ตรวจสอบกับฐานพนักงานแล้ว"
                          />
                        </label>
                        <button
                          className="flex h-11 items-center justify-center gap-2 self-end rounded-md bg-[#722257] px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-[#9a94a6]"
                          disabled={access.isBypass}
                          type="submit"
                        >
                          <BadgeCheck className="size-4" aria-hidden="true" />
                          อนุมัติสมาชิก
                        </button>
                      </form>
                    ) : null}

                    <MemberForm
                      action={updateMember}
                      disabled={access.isBypass}
                      member={member}
                      memberCodeOptions={memberCodeOptions}
                      memberTypes={memberTypes}
                      title={`แก้ไข ${member.full_name}`}
                    />
                  </div>
                </details>
              ))
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">
                ไม่พบสมาชิกตามเงื่อนไขที่ค้นหา
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
