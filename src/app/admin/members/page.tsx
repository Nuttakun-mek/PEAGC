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

import { createMember, updateMember } from "@/app/admin/members/actions";
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
  email: string | null;
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
    full_name: "สมาชิก ตัวอย่างหนึ่ง",
    handicap: 12.4,
    id: "sample-1",
    joined_at: "2026-07-01",
    line_id: "peagc01",
    member_code: "PEA-001",
    member_type_id: "regular",
    member_types: { name: "สมาชิก" },
    nickname: "หนึ่ง",
    note: "ข้อมูลทดลองสำหรับ preview",
    organization: "PEA HQ",
    phone: "0812345678",
    skill_level: "intermediate",
    status: "active",
  },
  {
    email: "guest01@example.com",
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
  active: "Active",
  archived: "Archived",
  guest: "Guest",
  inactive: "Inactive",
};

const statusMessages: Record<string, string> = {
  "create-failed": "เพิ่มสมาชิกไม่สำเร็จ กรุณาตรวจรหัสสมาชิกซ้ำหรือข้อมูลที่กรอก",
  created: "เพิ่มสมาชิกเรียบร้อยแล้ว",
  "missing-required": "กรุณากรอกชื่อ-นามสกุล",
  "update-failed": "แก้ไขสมาชิกไม่สำเร็จ",
  updated: "แก้ไขสมาชิกเรียบร้อยแล้ว",
};

function getStatusClass(status: string) {
  if (status === "active") {
    return "bg-[#e6f4df] text-[#24613f]";
  }

  if (status === "guest") {
    return "bg-[#eef2ff] text-[#3730a3]";
  }

  if (status === "inactive") {
    return "bg-[#fff4d8] text-[#8a6112]";
  }

  return "bg-[#f1f3ef] text-[#687a6d]";
}

function MemberForm({
  action,
  disabled,
  member,
  memberTypes,
  title,
}: {
  action: (formData: FormData) => void;
  disabled?: boolean;
  member?: MemberRow;
  memberTypes: MemberType[];
  title: string;
}) {
  return (
    <form action={action} className="grid gap-4">
      {member ? <input name="memberId" type="hidden" value={member.id} /> : null}
      <div className="flex items-center gap-2">
        {member ? (
          <Pencil className="size-4 text-[#0f6b4f]" aria-hidden="true" />
        ) : (
          <Plus className="size-4 text-[#0f6b4f]" aria-hidden="true" />
        )}
        <h2 className="text-lg font-semibold text-[#0f2d26]">{title}</h2>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">รหัสสมาชิก</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.member_code ?? ""}
            disabled={disabled}
            name="memberCode"
          />
        </label>
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#405249]">ชื่อ-นามสกุล</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.full_name ?? ""}
            disabled={disabled}
            name="fullName"
            required
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">ชื่อเล่น</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.nickname ?? ""}
            disabled={disabled}
            name="nickname"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">เบอร์โทร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.phone ?? ""}
            disabled={disabled}
            name="phone"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">Email</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.email ?? ""}
            disabled={disabled}
            name="email"
            type="email"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">Line ID</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.line_id ?? ""}
            disabled={disabled}
            name="lineId"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-5">
        <label className="block md:col-span-2">
          <span className="text-sm font-semibold text-[#405249]">หน่วยงาน / บริษัท</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.organization ?? ""}
            disabled={disabled}
            name="organization"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">ประเภท</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] bg-white px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
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
          <span className="text-sm font-semibold text-[#405249]">สถานะ</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] bg-white px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.status ?? "active"}
            disabled={disabled}
            name="status"
          >
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="guest">Guest</option>
            <option value="archived">Archived</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">วันที่สมัคร</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.joined_at ?? ""}
            disabled={disabled}
            name="joinedAt"
            type="date"
          />
        </label>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">Handicap</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.handicap ?? ""}
            disabled={disabled}
            name="handicap"
            step="0.1"
            type="number"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">ระดับฝีมือ</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] bg-white px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.skill_level ?? ""}
            disabled={disabled}
            name="skillLevel"
          >
            <option value="">ยังไม่ระบุ</option>
            <option value="beginner">Beginner</option>
            <option value="intermediate">Intermediate</option>
            <option value="advanced">Advanced</option>
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#405249]">หมายเหตุ</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
            defaultValue={member?.note ?? ""}
            disabled={disabled}
            name="note"
          />
        </label>
      </div>

      <button
        className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#17453b] disabled:cursor-not-allowed disabled:bg-[#9aa8a1] md:w-fit"
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
          "id, member_code, full_name, nickname, phone, line_id, email, organization, handicap, skill_level, status, joined_at, note, member_type_id, member_types(name)",
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

  members = members.filter((member) => {
    const matchesStatus = selectedStatus === "all" || member.status === selectedStatus;
    const matchesType =
      selectedType === "all" || member.member_type_id === selectedType;
    const haystack = [
      member.member_code,
      member.full_name,
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
  const highlightedMember = params.member;
  const statusMessage = params.status ? statusMessages[params.status] : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-6 text-[#11221d]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#dfe5da] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#5b6f62]">Admin Portal</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#0f2d26]">
              Member Management
            </h1>
            <p className="mt-2 text-sm text-[#687a6d]">
              ค้นหา เพิ่ม แก้ไข และตรวจข้อมูลสมาชิกชมรม
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
              href={access.isBypass ? "/member?bypass=member" : "/member"}
            >
              ดูหน้าสมาชิก
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
            { label: "สมาชิกที่แสดง", value: members.length },
            { label: "Active", value: activeCount },
            { label: "Guest", value: guestCount },
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
          <MemberForm
            action={createMember}
            disabled={access.isBypass}
            memberTypes={memberTypes}
            title="เพิ่มสมาชิกใหม่"
          />
        </section>

        <section className="mt-6 rounded-lg border border-[#dfe5da] bg-white shadow-sm">
          <div className="border-b border-[#dfe5da] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_180px_180px_110px]">
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
                  placeholder="ค้นหาชื่อ รหัส เบอร์ หรือ email"
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
                  <option value="guest">Guest</option>
                  <option value="archived">Archived</option>
                </select>
              </label>
              <select
                className="h-11 w-full rounded-md border border-[#cbd6c7] bg-white px-3 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
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
                className="h-11 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
                type="submit"
              >
                ค้นหา
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#dfe5da]">
            {members.length ? (
              members.map((member) => (
                <details
                  className="group px-5 py-4"
                  key={member.id}
                  open={highlightedMember === member.id}
                >
                  <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1.15fr_0.8fr_0.65fr_96px] lg:items-center">
                    <div className="flex size-11 items-center justify-center rounded-md bg-[#edf4ea] text-[#0f6b4f]">
                      <CircleUserRound className="size-5" aria-hidden="true" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-semibold text-[#0f2d26]">
                          {member.full_name}
                        </p>
                        <span
                          className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(member.status)}`}
                        >
                          {statusLabels[member.status] ?? member.status}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#687a6d]">
                        {member.member_code ?? "ไม่มีรหัส"} ·{" "}
                        {member.nickname ?? "ไม่มีชื่อเล่น"}
                      </p>
                    </div>
                    <div className="text-sm text-[#405249]">
                      <p>{member.phone ?? "-"}</p>
                      <p className="mt-1 text-[#687a6d]">{member.email ?? "-"}</p>
                    </div>
                    <div className="text-sm text-[#405249]">
                      <p>{member.member_types?.name ?? "ไม่ระบุประเภท"}</p>
                      <p className="mt-1 text-[#687a6d]">
                        HCP {member.handicap ?? "-"}
                      </p>
                    </div>
                    <span className="w-fit rounded-md border border-[#cbd6c7] px-3 py-2 text-sm font-semibold text-[#0f2d26] group-open:bg-[#fbfcf8]">
                      แก้ไข
                    </span>
                  </summary>

                  <div className="mt-5 rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-4">
                    <MemberForm
                      action={updateMember}
                      disabled={access.isBypass}
                      member={member}
                      memberTypes={memberTypes}
                      title={`แก้ไข ${member.full_name}`}
                    />
                  </div>
                </details>
              ))
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#687a6d]">
                ไม่พบสมาชิกตามเงื่อนไขที่ค้นหา
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
