import Link from "next/link";
import { ArrowLeft, Save, ShieldAlert } from "lucide-react";

import { savePersonalProfile } from "@/app/profile/actions";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type ProfilePageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "member-failed": "บันทึกข้อมูลสมาชิกไม่สำเร็จ",
  "missing-required": "กรุณากรอกชื่อจริง ชื่อแสดงผล และเบอร์โทร",
  "no-club": "ยังไม่มีชมรม active ให้ผูกข้อมูลสมาชิก",
  "profile-failed": "บันทึกข้อมูลโปรไฟล์ไม่สำเร็จ",
};

export default async function ProfilePage({ searchParams }: ProfilePageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "member",
    nextPath: "/profile",
    requiredRole: "member",
    searchParams: params,
  });
  const supabase = access.isBypass ? null : await createClient();
  const [{ data: profile }, { data: member }] = supabase
    ? await Promise.all([
        supabase
          .from("profiles")
          .select("display_name, phone, line_id")
          .eq("id", access.userId)
          .maybeSingle(),
        supabase
          .from("members")
          .select("full_name, nickname, organization, handicap, skill_level")
          .eq("user_id", access.userId)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-6 text-[#11221d]">
      <section className="mx-auto w-full max-w-4xl rounded-lg border border-[#dfe5da] bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-[#dfe5da] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#5b6f62]">Member Profile</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#0f2d26]">
              ข้อมูลส่วนตัวสำหรับสมัครสมาชิก
            </h1>
          </div>
          <Link
            className="flex h-11 w-fit items-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26]"
            href={access.isBypass ? "/member?bypass=member" : "/member"}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับหน้าสมาชิก
          </Link>
        </div>

        {params.status && statusMessages[params.status] ? (
          <div className="mt-5 rounded-md bg-[#fde8df] px-4 py-3 text-sm font-medium text-[#9a3412]">
            {statusMessages[params.status]}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>โหมดทดลองไม่บันทึกข้อมูล กรุณาเข้าสู่ระบบจริงเพื่อบันทึกโปรไฟล์</span>
          </div>
        ) : null}

        <form action={savePersonalProfile} className="mt-6 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อแสดงผล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={profile?.display_name ?? access.displayName}
                disabled={access.isBypass}
                name="displayName"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อ-นามสกุล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={member?.full_name ?? ""}
                disabled={access.isBypass}
                name="fullName"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อเล่น</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={member?.nickname ?? ""}
                disabled={access.isBypass}
                name="nickname"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">เบอร์โทร</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={profile?.phone ?? ""}
                disabled={access.isBypass}
                name="phone"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">Line ID</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={profile?.line_id ?? ""}
                disabled={access.isBypass}
                name="lineId"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block md:col-span-2">
              <span className="text-sm font-semibold text-[#405249]">หน่วยงาน / บริษัท</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={member?.organization ?? ""}
                disabled={access.isBypass}
                name="organization"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">Handicap</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue={member?.handicap ?? ""}
                disabled={access.isBypass}
                name="handicap"
                step="0.1"
                type="number"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-[#405249]">ระดับฝีมือ</span>
            <select
              className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 outline-none focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
              defaultValue={member?.skill_level ?? ""}
              disabled={access.isBypass}
              name="skillLevel"
            >
              <option value="">ยังไม่ระบุ</option>
              <option value="beginner">Beginner</option>
              <option value="intermediate">Intermediate</option>
              <option value="advanced">Advanced</option>
            </select>
          </label>

          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-[#17453b] disabled:cursor-not-allowed disabled:bg-[#9aa8a1]"
            disabled={access.isBypass}
            type="submit"
          >
            <Save className="size-4" aria-hidden="true" />
            บันทึกและไปหน้าสมาชิก
          </button>
        </form>
      </section>
    </main>
  );
}
