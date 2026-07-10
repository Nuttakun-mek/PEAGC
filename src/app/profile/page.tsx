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
  "missing-required": "กรุณากรอกชื่อจริง ชื่อแสดงผล เบอร์โทร รหัสพนักงาน หน่วยงาน และสังกัด",
  "no-club": "ยังไม่มีชมรม active ให้ผูกข้อมูลสมาชิก",
  "pending-review": "ส่งข้อมูลแล้ว กรุณารอ Admin ตรวจสอบและอนุมัติสมาชิก",
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
          .select(
            "avatar_url, full_name, nickname, phone, employee_code, department, affiliation, organization, handicap, skill_level, status",
          )
          .eq("user_id", access.userId)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-4xl golf-visual rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">Member Profile</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              ข้อมูลส่วนตัวสำหรับสมัครสมาชิก
            </h1>
          </div>
          <Link
            className="flex h-11 w-fit items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]"
            href={access.isBypass ? "/member?bypass=member" : "/member"}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับหน้าสมาชิก
          </Link>
        </div>

        {params.status && (statusMessages[params.status] || {
          "avatar-too-large": "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5MB",
          "avatar-upload-failed": "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ",
          "invalid-avatar-type": "รองรับเฉพาะรูป JPG, PNG หรือ WebP",
        }[params.status]) ? (
          <div className="mt-5 rounded-md bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#8a1f11]">
            {statusMessages[params.status] || {
              "avatar-too-large": "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5MB",
              "avatar-upload-failed": "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ",
              "invalid-avatar-type": "รองรับเฉพาะรูป JPG, PNG หรือ WebP",
            }[params.status]}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>โหมดทดลองไม่บันทึกข้อมูล กรุณาเข้าสู่ระบบจริงเพื่อบันทึกโปรไฟล์</span>
          </div>
        ) : (
          <div className="mt-5 flex items-start gap-3 rounded-md bg-[#f8edf4] px-4 py-3 text-sm text-[#722257]">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              หลังบันทึกข้อมูล สถานะจะเป็นรอ Admin ตรวจสอบกับฐานข้อมูลพนักงานก่อนอนุมัติเป็นสมาชิก
            </span>
          </div>
        )}

        <form action={savePersonalProfile} className="mt-6 grid gap-4">
          <div className="grid gap-4 rounded-md border border-[#e6e2ee] bg-white/70 p-4 md:grid-cols-[120px_1fr] md:items-center">
            <div className="flex size-24 items-center justify-center overflow-hidden rounded-md bg-[#f8edf4] text-sm font-semibold text-[#722257]">
              {member?.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt="Member avatar"
                  className="size-full object-cover"
                  src={member.avatar_url}
                />
              ) : (
                "PEAGC"
              )}
            </div>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">รูปโปรไฟล์สมาชิก</span>
              <input
                accept="image/jpeg,image/png,image/webp"
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-[#f8edf4] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#722257]"
                disabled={access.isBypass}
                name="avatar"
                type="file"
              />
              <p className="mt-2 text-xs text-[#6b6475]">รองรับ JPG, PNG, WebP ขนาดไม่เกิน 5MB</p>
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">ชื่อแสดงผล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={profile?.display_name ?? access.displayName}
                disabled={access.isBypass}
                name="displayName"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">ชื่อ-นามสกุล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.full_name ?? ""}
                disabled={access.isBypass}
                name="fullName"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">ชื่อเล่น</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.nickname ?? ""}
                disabled={access.isBypass}
                name="nickname"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">เบอร์โทร</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={profile?.phone ?? ""}
                disabled={access.isBypass}
                name="phone"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">Line ID</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={profile?.line_id ?? ""}
                disabled={access.isBypass}
                name="lineId"
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">รหัสพนักงาน</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.employee_code ?? ""}
                disabled={access.isBypass}
                name="employeeCode"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">หน่วยงาน</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.department ?? ""}
                disabled={access.isBypass}
                name="department"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">สังกัด</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.affiliation ?? ""}
                disabled={access.isBypass}
                name="affiliation"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <label className="block md:col-span-2">
              <span className="text-sm font-semibold text-[#3f3a48]">หน่วยงาน / บริษัทเพิ่มเติม</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.organization ?? ""}
                disabled={access.isBypass}
                name="organization"
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">Handicap</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue={member?.handicap ?? ""}
                disabled={access.isBypass}
                name="handicap"
                step="0.1"
                type="number"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-[#3f3a48]">ระดับฝีมือ</span>
            <select
              className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
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
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(114,34,87,0.08)] transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6]"
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
