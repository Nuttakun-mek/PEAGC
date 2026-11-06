import Link from "next/link";
import { ArrowLeft, BadgeCheck, Contact, Flag, IdCard, Save, ShieldCheck, UserRound } from "lucide-react";

import { savePersonalProfile } from "@/app/profile/actions";
import { EmployeeCodeChecker } from "@/components/employee-code-checker";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

type ProfilePageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const statusMessages: Record<string, string> = {
  "account-created": "สร้างบัญชีสำเร็จแล้ว กรอกข้อมูลสมาชิกให้ครบเพื่อเปิดใช้งาน",
  "avatar-too-large": "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5MB",
  "avatar-upload-failed": "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ",
  "invalid-avatar-type": "รองรับเฉพาะรูป JPG, PNG หรือ WebP",
  "member-code-failed": "สร้างเลขสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง",
  "member-failed": "บันทึกข้อมูลสมาชิกไม่สำเร็จ",
  "missing-required": "กรุณากรอกชื่อแสดงผล ชื่อ-นามสกุล เบอร์โทร และรหัสพนักงาน",
  "no-club": "ยังไม่มีชมรมที่เปิดใช้งานสำหรับผูกข้อมูลสมาชิก",
  "pending-review": "ส่งข้อมูลแล้ว กรุณารอผู้ดูแลตรวจสอบและอนุมัติสมาชิก",
  "profile-failed": "บันทึกประวัติสมาชิกไม่สำเร็จ",
};

const inputClass =
  "mt-2 h-12 w-full rounded-lg border border-[#d9d3e6] bg-white px-4 text-[15px] outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10 disabled:bg-[#f6f3f8]";

function Section({
  children,
  description,
  icon: Icon,
  step,
  title,
}: {
  children: React.ReactNode;
  description: string;
  icon: typeof UserRound;
  step: number;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-[#e6e2ee] bg-white/90 p-5 shadow-[0_8px_24px_rgba(114,34,87,0.05)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[#f8edf4] text-[#722257]">
          <Icon className="size-4" aria-hidden="true" />
        </span>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-[#8b5b7a]">ส่วนที่ {step}</p>
          <h2 className="text-lg font-semibold text-[#722257]">{title}</h2>
          <p className="mt-0.5 text-sm text-[#6b6475]">{description}</p>
        </div>
      </div>
      <div className="mt-5 grid gap-4">{children}</div>
    </section>
  );
}

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
            "avatar_url, title_prefix, first_name, last_name, full_name, nickname, phone, employee_code, position, work_line, bureau, division, department, section, affiliation, organization, handicap, skill_level, status, employee_match_status, association_member_type, association_member_code, association_membership_status",
          )
          .eq("user_id", access.userId)
          .maybeSingle(),
      ])
    : [{ data: null }, { data: null }];

  const statusMessage = params.status ? statusMessages[params.status] : null;
  const isFirstTime = !member;
  const isActive = member?.status === "active";
  const steps = [
    { done: true, label: "สร้างบัญชี" },
    { current: !isActive, done: Boolean(member), label: "กรอกประวัติ" },
    { current: member?.status === "pending_verification", done: isActive, label: "ตรวจสอบกับฐานสมาคม" },
    { done: isActive, label: "พร้อมใช้งาน" },
  ];
  const backHref = access.isBypass ? "/member?bypass=member" : "/member";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <div className="mx-auto w-full max-w-4xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">ระบบสมาชิก PEAGC</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              {isFirstTime ? "สมัครสมาชิกชมรม" : "ประวัติสมาชิก"}
            </h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#6b6475]">
              {isFirstTime
                ? "ใช้เวลาประมาณ 2 นาที ระบบจะตรวจรหัสพนักงานกับฐานสมาชิกสมาคมอัตโนมัติ ถ้าตรงกันบัญชีจะพร้อมใช้ทันที"
                : "แก้ไขข้อมูลติดต่อและข้อมูลกอล์ฟได้ตลอด ส่วนข้อมูลหน่วยงานดึงจากฐานสมาชิกสมาคม"}
            </p>
          </div>
          <Link
            className="flex h-11 w-fit items-center gap-2 rounded-lg border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257] transition hover:border-[#722257]"
            href={backHref}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับหน้าสมาชิก
          </Link>
        </div>

        <ol aria-label="ขั้นตอนการสมัคร" className="mt-6 grid grid-cols-4 gap-2">
          {steps.map((step, index) => (
            <li className="flex flex-col items-center gap-2 text-center" key={step.label}>
              <div className="flex w-full items-center">
                <span className={`h-0.5 flex-1 ${index === 0 ? "opacity-0" : step.done || step.current ? "bg-[#722257]" : "bg-[#e6e2ee]"}`} />
                <span
                  aria-current={step.current ? "step" : undefined}
                  className={`flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-bold ${step.done ? "bg-[#722257] text-white" : step.current ? "border-2 border-[#C69214] bg-white text-[#805300] ring-4 ring-[#fff5d8]" : "border-2 border-[#e6e2ee] bg-white text-[#9a94a6]"}`}
                >
                  {step.done ? "✓" : index + 1}
                </span>
                <span className={`h-0.5 flex-1 ${index === steps.length - 1 ? "opacity-0" : step.done ? "bg-[#722257]" : "bg-[#e6e2ee]"}`} />
              </div>
              <span className={`text-[11px] leading-tight sm:text-xs ${step.current ? "font-semibold text-[#3f3a48]" : "text-[#6b6475]"}`}>{step.label}</span>
            </li>
          ))}
        </ol>

        {statusMessage ? (
          <StatusBanner className="mt-5" tone={params.status === "account-created" ? "success" : toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">โหมดทดลองไม่บันทึกข้อมูล กรุณาเข้าสู่ระบบจริงเพื่อบันทึกประวัติ</StatusBanner>
        ) : member?.status === "pending_verification" ? (
          <StatusBanner className="mt-5" title="รอผู้ดูแลตรวจสอบ" tone="warning">
            รหัสพนักงานหรือชื่อยังไม่ตรงกับฐานสมาชิกสมาคม ตรวจแก้ข้อมูลด้านล่างแล้วบันทึกอีกครั้ง หรือรอผู้ดูแลยืนยัน
          </StatusBanner>
        ) : null}

        <form action={savePersonalProfile} className="mt-6 grid gap-5">
          <Section description="ชื่อที่จะแสดงในชมรม และช่องทางที่ผู้ดูแลติดต่อกลับได้" icon={UserRound} step={1} title="ข้อมูลส่วนตัวและการติดต่อ">
            <div className="grid gap-4 rounded-lg border border-dashed border-[#d9d3e6] bg-[#fbf9fc] p-4 sm:grid-cols-[96px_1fr] sm:items-center">
              <div className="flex size-24 items-center justify-center overflow-hidden rounded-xl bg-[#f8edf4] text-sm font-semibold text-[#722257] ring-4 ring-white">
                {member?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="รูปประจำตัวสมาชิก" className="size-full object-cover" src={member.avatar_url} />
                ) : (
                  <UserRound className="size-9 opacity-60" aria-hidden="true" />
                )}
              </div>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">รูปโปรไฟล์</span>
                <input
                  accept="image/jpeg,image/png,image/webp"
                  className="mt-2 h-12 w-full rounded-lg border border-[#d9d3e6] bg-white px-3 py-2 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-[#f8edf4] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-[#722257]"
                  disabled={access.isBypass}
                  name="avatar"
                  type="file"
                />
                <p className="mt-2 text-xs text-[#6b6475]">ไม่บังคับ · JPG, PNG, WebP ไม่เกิน 5MB · ใช้แสดงบนบัตรสมาชิกและรายชื่อก๊วน</p>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">ชื่อแสดงผล <span className="text-[#a33a46]">*</span></span>
                <input className={inputClass} defaultValue={profile?.display_name ?? access.displayName} disabled={access.isBypass} name="displayName" required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">ชื่อเล่น</span>
                <input className={inputClass} defaultValue={member?.nickname ?? ""} disabled={access.isBypass} name="nickname" placeholder="ใช้เรียกในก๊วน" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">เบอร์โทรศัพท์มือถือ <span className="text-[#a33a46]">*</span></span>
                <input autoComplete="tel" className={inputClass} defaultValue={profile?.phone ?? ""} disabled={access.isBypass} inputMode="tel" name="phone" pattern="[0-9\-\s]{9,12}" placeholder="08x-xxx-xxxx" required />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">LINE ID</span>
                <input autoCapitalize="off" className={inputClass} defaultValue={profile?.line_id ?? ""} disabled={access.isBypass} name="lineId" placeholder="สำหรับแจ้งเตือนกิจกรรม" />
              </label>
            </div>
          </Section>

          <Section description="ระบบตรวจรหัสพนักงานและชื่อกับฐานสมาชิกสมาคมที่ผู้ดูแลอัปเดตทุกเดือน" icon={IdCard} step={2} title="ยืนยันตัวตนกับฐานสมาชิกสมาคม">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">รหัสพนักงาน <span className="text-[#a33a46]">*</span></span>
                <EmployeeCodeChecker defaultValue={member?.employee_code} disabled={access.isBypass} inputClassName={inputClass} />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">ชื่อ-นามสกุล ตามทะเบียนพนักงาน <span className="text-[#a33a46]">*</span></span>
                <input autoComplete="name" className={inputClass} defaultValue={member?.full_name ?? ""} disabled={access.isBypass} name="fullName" placeholder="เช่น สมชาย ใจดี" required />
                <p className="mt-2 text-xs text-[#6b6475]">ไม่ต้องใส่คำนำหน้า ระบบเทียบชื่อ-สกุลกับฐานข้อมูลโดยไม่สนตัวพิมพ์</p>
              </label>
            </div>

            {member?.employee_match_status === "matched" ? (
              <div className="rounded-lg border border-[#bfe3cf] bg-[#edf9f3] p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-[#16794b]">
                  <BadgeCheck className="size-4" aria-hidden="true" /> ตรวจสอบตรงกับฐานสมาชิกสมาคมแล้ว
                </p>
                <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
                  {[
                    ["ชื่อตามทะเบียน", [member.title_prefix, member.first_name, member.last_name].filter(Boolean).join(" ")],
                    ["ประเภทสมาชิกสมาคม", member.association_member_type],
                    ["รหัสสมาชิกสมาคม", member.association_member_code],
                    ["ตำแหน่ง", member.position],
                    ["สายงาน", member.work_line],
                    ["สำนัก", member.bureau],
                    ["ฝ่าย", member.division],
                    ["กอง", member.department],
                    ["แผนก", member.section],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <dt className="text-xs text-[#6b6475]">{label}</dt>
                      <dd className="mt-0.5 font-semibold text-[#3f3a48]">{value || "-"}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg bg-[#f8edf4] px-4 py-3 text-sm text-[#722257]">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>ข้อมูลตำแหน่ง สายงาน และประเภทสมาชิกจะถูกเติมอัตโนมัติจากฐานสมาชิกสมาคมหลังบันทึก ไม่ต้องกรอกเอง</span>
              </div>
            )}
          </Section>

          <Section description="ช่วยผู้ดูแลจัดก๊วนและเลือกคลาสเรียนที่เหมาะกับคุณ" icon={Flag} step={3} title="ข้อมูลกอล์ฟ (ไม่บังคับ)">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block sm:col-span-1">
                <span className="text-sm font-semibold text-[#3f3a48]">แต้มต่อ (Handicap)</span>
                <input className={inputClass} defaultValue={member?.handicap ?? ""} disabled={access.isBypass} inputMode="decimal" name="handicap" placeholder="เช่น 18.5" step="0.1" type="number" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">ระดับฝีมือ</span>
                <select className={inputClass} defaultValue={member?.skill_level ?? ""} disabled={access.isBypass} name="skillLevel">
                  <option value="">ยังไม่ระบุ</option>
                  <option value="beginner">เริ่มต้น</option>
                  <option value="intermediate">ปานกลาง</option>
                  <option value="advanced">ชำนาญ</option>
                </select>
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">หน่วยงาน/บริษัทเพิ่มเติม</span>
                <input className={inputClass} defaultValue={member?.organization ?? ""} disabled={access.isBypass} name="organization" placeholder="กรณีไม่ใช่พนักงาน กฟภ." />
              </label>
            </div>
          </Section>

          <div className="sticky bottom-3 z-10 flex flex-col gap-3 rounded-xl border border-[#e6e2ee] bg-white/95 p-4 shadow-[0_12px_34px_rgba(114,34,87,0.14)] backdrop-blur sm:flex-row sm:items-center sm:justify-between">
            <p className="flex items-center gap-2 text-sm text-[#6b6475]">
              <Contact className="size-4 shrink-0" aria-hidden="true" />
              {isFirstTime ? "กดบันทึกแล้วระบบจะตรวจสอบและออกเลขสมาชิกให้ทันทีเมื่อข้อมูลตรง" : "บันทึกแล้วระบบจะตรวจสอบกับฐานสมาชิกสมาคมอีกครั้ง"}
            </p>
            <SubmitButton
              className="flex h-12 items-center justify-center gap-2 rounded-lg bg-[#722257] px-6 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(114,34,87,0.25)] transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6]"
              disabled={access.isBypass}
              pendingText="กำลังตรวจสอบข้อมูล..."
            >
              <Save className="size-4" aria-hidden="true" />
              {isFirstTime ? "ตรวจสอบและสมัครสมาชิก" : "บันทึกการเปลี่ยนแปลง"}
            </SubmitButton>
          </div>
        </form>
      </div>
    </main>
  );
}
