import Link from "next/link";
import { ArrowLeft, BadgeCheck, Check, Flag, IdCard, KeyRound, ShieldCheck, UserRound } from "lucide-react";

import { savePersonalProfile } from "@/app/profile/actions";
import { MembershipConsentFields, MembershipIdentityFields, MembershipPrivacyPanel } from "@/components/membership-profile";
import { AvatarCropInput } from "@/components/avatar-crop-input";
import { MemberAvatar } from "@/components/member-avatar";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass, fieldHint, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";
import { orUnset } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { HANDICAP_MAX, HANDICAP_MIN, PHONE_ERROR, PHONE_HINT, PHONE_PATTERN } from "@/lib/validation";

type ProfilePageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

const SaveIcon = appIcons.save;

const statusMessages: Record<string, string> = {
  "account-created": "สร้างบัญชีแล้ว กรอกข้อมูลสมาชิกต่อได้เลย",
  "avatar-too-large": "รูปโปรไฟล์ต้องมีขนาดไม่เกิน 5 MB",
  "avatar-upload-failed": "อัปโหลดรูปโปรไฟล์ไม่สำเร็จ",
  "invalid-avatar-type": "รองรับเฉพาะรูป JPG, PNG หรือ WebP",
  "member-code-failed": "ออกเลขสมาชิกไม่สำเร็จ ลองอีกครั้ง",
  "member-failed": "บันทึกข้อมูลสมาชิกไม่สำเร็จ",
  "missing-required": "กรอกข้อมูลที่มีเครื่องหมาย * ให้ครบ",
  "no-club": "ยังไม่มีชมรมที่เปิดใช้งาน",
  "pending-review": "ส่งข้อมูลแล้ว รอผู้ดูแลตรวจสอบ",
  "profile-failed": "บันทึกประวัติสมาชิกไม่สำเร็จ",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่ก่อนบันทึก",
  "phone-invalid": PHONE_ERROR,
  "handicap-invalid": `แต้มต่อต้องเป็นตัวเลขระหว่าง ${HANDICAP_MIN} ถึง ${HANDICAP_MAX}`,
  "employee-code-taken": "รหัสพนักงานนี้ถูกใช้สมัครสมาชิกแล้ว หากเป็นรหัสของคุณ กรุณาติดต่อผู้ดูแลชมรม",
  "consent-required": "ติ๊กยินยอมให้ชมรมเก็บและใช้ข้อมูลก่อนบันทึก",
  "delete-already-requested": "ส่งคำขอลบข้อมูลไว้แล้ว รอผู้ดูแลดำเนินการ",
  "delete-request-failed": "ส่งคำขอลบข้อมูลไม่สำเร็จ ลองอีกครั้ง",
  "delete-requested": "ส่งคำขอลบข้อมูลแล้ว ผู้ดูแลจะติดต่อกลับ",
  "delete-unavailable": "ยังส่งคำขอลบข้อมูลทางหน้านี้ไม่ได้ กรุณาติดต่อผู้ดูแลชมรม",
  "sponsor-not-found": "ไม่พบเลขสมาชิกผู้รับรอง หรือผู้รับรองยังไม่ได้ใช้งาน ตรวจเลขอีกครั้ง",
  "sponsor-required": "บุคคลภายนอกต้องกรอกเลขสมาชิกผู้รับรอง",
};

const inputClass = fieldInputClass("lg");

/** Visible "required" mark after a label; the input itself carries `required`. */
function Required() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}*
    </span>
  );
}

function Section({
  children,
  description,
  icon: Icon,
  title,
}: {
  children: React.ReactNode;
  description: string;
  icon: typeof UserRound;
  title: string;
}) {
  return (
    <section className="rounded-xl border border-line bg-white p-4 shadow-card sm:p-6">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
          <Icon className="size-5" aria-hidden="true" />
        </span>
        <div>
          <h2 className="text-h2 font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
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
    { done: true, label: "บัญชี" },
    { current: !isActive, done: Boolean(member), label: "ประวัติ" },
    { current: member?.status === "pending_verification", done: isActive, label: "ยืนยันตัวตน" },
    { done: isActive, label: "พร้อมใช้งาน" },
  ];
  const backHref = access.isBypass ? "/member?bypass=member" : "/member";
  const avatarName = member?.full_name || profile?.display_name || access.displayName;

  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink sm:py-8">
      <div className="mx-auto w-full max-w-4xl">
        <Link className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline" href={backHref}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          หน้าสมาชิก
        </Link>

        <div className="mt-2">
          <PageHeader
            actions={
              access.isBypass ? null : (
                <Link className={buttonClass("secondary", "md")} href="/account/password">
                  <KeyRound className="size-4" aria-hidden="true" />
                  เปลี่ยนรหัสผ่าน
                </Link>
              )
            }
            description={
              isFirstTime
                ? "กรอกช่องที่มีเครื่องหมาย * ให้ครบ แล้วกดสมัครสมาชิก"
                : "แก้ไขข้อมูลติดต่อและข้อมูลกอล์ฟได้ตลอดเวลา"
            }
            title={isFirstTime ? "สมัครสมาชิก" : "ข้อมูลสมาชิก"}
          />
        </div>

        {/* Sign-up progress: only until the member is active. */}
        {isActive ? null : (
          <ol aria-label="ขั้นตอนการสมัคร" className="mt-6 grid grid-cols-4 gap-2">
            {steps.map((step, index) => (
              <li className="flex flex-col items-center gap-2 text-center" key={step.label}>
                <div className="flex w-full items-center">
                  <span className={`h-0.5 flex-1 ${index === 0 ? "opacity-0" : step.done || step.current ? "bg-brand-600" : "bg-line"}`} />
                  <span
                    aria-current={step.current ? "step" : undefined}
                    className={`flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${step.done ? "bg-brand-600 text-white" : step.current ? "border-2 border-gold-500 bg-white text-gold-ink ring-4 ring-gold-500/15" : "border-2 border-line bg-white text-ink-subtle"}`}
                  >
                    {step.done ? <Check className="size-4" aria-hidden="true" /> : index + 1}
                  </span>
                  <span className={`h-0.5 flex-1 ${index === steps.length - 1 ? "opacity-0" : step.done ? "bg-brand-600" : "bg-line"}`} />
                </div>
                <span className={`text-xs ${step.current || step.done ? "font-semibold text-ink" : "font-medium text-ink-subtle"}`}>
                  {step.label}
                  {step.done ? <span className="sr-only"> (เสร็จแล้ว)</span> : null}
                </span>
              </li>
            ))}
          </ol>
        )}

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={params.status === "account-created" ? "success" : toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">โหมดทดลองไม่บันทึกข้อมูล เข้าสู่ระบบจริงเพื่อบันทึกประวัติ</StatusBanner>
        ) : member?.status === "pending_verification" ? (
          <StatusBanner className="mt-5" title="รอการตรวจสอบ" tone="warning">
            ข้อมูลยังไม่ตรงกับฐานสมาชิกสมาคม ตรวจสอบรหัสพนักงานและชื่อ หรือรอผู้ดูแลยืนยัน
          </StatusBanner>
        ) : null}

        <form action={savePersonalProfile} className="mt-6 grid gap-5">
          <Section description="รูปประจำตัวและช่องทางติดต่อ" icon={UserRound} title="ข้อมูลติดต่อ">
            <div className="grid gap-4 rounded-lg border border-line bg-canvas p-4 sm:grid-cols-[auto_1fr] sm:items-center">
              <MemberAvatar avatarUrl={member?.avatar_url} displayName={avatarName} size="large" />
              <AvatarCropInput disabled={access.isBypass} name="avatar" />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className={fieldLabel}>ชื่อเล่น</span>
                <input className={inputClass} defaultValue={member?.nickname ?? ""} disabled={access.isBypass} name="nickname" />
              </label>
              <label className="block">
                <span className={fieldLabel}>
                  เบอร์โทรศัพท์มือถือ<Required />
                </span>
                <input
                  autoComplete="tel"
                  className={`${inputClass} tabular-nums`}
                  data-invalid-message={PHONE_ERROR}
                  data-required-message="กรุณากรอกเบอร์โทรศัพท์มือถือ"
                  defaultValue={(profile?.phone ?? member?.phone ?? "").replace(/\D/g, "")}
                  disabled={access.isBypass}
                  inputMode="numeric"
                  maxLength={10}
                  name="phone"
                  pattern={PHONE_PATTERN}
                  placeholder="0812345678"
                  required
                />
                <span className={fieldHint}>{PHONE_HINT}</span>
              </label>
              <label className="block">
                <span className={fieldLabel}>LINE ID</span>
                <input autoCapitalize="off" className={inputClass} defaultValue={profile?.line_id ?? ""} disabled={access.isBypass} name="lineId" />
              </label>
            </div>
          </Section>

          <Section description="ตรวจกับฐานสมาชิกสมาคม" icon={IdCard} title="ยืนยันตัวตน">
            <div className="grid gap-4 sm:grid-cols-2">
              <MembershipIdentityFields
                defaultEmployeeCode={member?.employee_code}
                disabled={access.isBypass}
                inputClassName={inputClass}
                userId={access.userId}
              />
              <label className="block">
                <span className={fieldLabel}>
                  ชื่อ-นามสกุล<Required />
                </span>
                <input
                  autoComplete="name"
                  className={inputClass}
                  data-required-message="กรุณากรอกชื่อ-นามสกุล"
                  defaultValue={member?.full_name ?? profile?.display_name ?? ""}
                  disabled={access.isBypass}
                  name="fullName"
                  placeholder="เช่น สมชาย ใจดี"
                  required
                />
                <span className={fieldHint}>ไม่ต้องใส่คำนำหน้า ชื่อนี้แสดงในทุกหน้า</span>
              </label>
            </div>

            {member?.employee_match_status === "matched" ? (
              <div className="rounded-lg border border-success/20 bg-success-bg p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-success">
                  <BadgeCheck className="size-4" aria-hidden="true" /> ยืนยันตัวตนแล้ว
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
                      <dt className="text-xs font-medium text-ink-subtle">{label}</dt>
                      <dd className="mt-0.5 font-semibold text-ink">{orUnset(value)}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : (
              <div className="flex items-start gap-3 rounded-lg bg-info-bg px-4 py-3 text-sm text-info">
                <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                <span>ไม่ต้องกรอกตำแหน่งและสังกัด ดึงจากฐานสมาชิกสมาคมหลังบันทึก</span>
              </div>
            )}
          </Section>

          <Section description="ไม่บังคับ ใช้จัดก๊วนและคลาสเรียน" icon={Flag} title="ข้อมูลกอล์ฟ">
            <div className="grid gap-4 sm:grid-cols-3">
              <label className="block">
                <span className={fieldLabel}>แต้มต่อ (แฮนดิแคป)</span>
                <input
                  className={`${inputClass} tabular-nums`}
                  defaultValue={member?.handicap ?? ""}
                  disabled={access.isBypass}
                  inputMode="decimal"
                  max={HANDICAP_MAX}
                  min={HANDICAP_MIN}
                  name="handicap"
                  placeholder="เช่น 18.5"
                  step="0.1"
                  type="number"
                />
              </label>
              <label className="block">
                <span className={fieldLabel}>ระดับฝีมือ</span>
                <select className={inputClass} defaultValue={member?.skill_level ?? ""} disabled={access.isBypass} name="skillLevel">
                  <option value="">ยังไม่ระบุ</option>
                  <option value="beginner">เริ่มต้น</option>
                  <option value="intermediate">ปานกลาง</option>
                  <option value="advanced">ชำนาญ</option>
                </select>
              </label>
              <label className="block">
                <span className={fieldLabel}>หน่วยงาน/บริษัทเพิ่มเติม</span>
                <input className={inputClass} defaultValue={member?.organization ?? ""} disabled={access.isBypass} name="organization" />
              </label>
            </div>
          </Section>

          <MembershipConsentFields disabled={access.isBypass} userId={access.userId} />

          <div
            className={`sticky bottom-3 z-10 flex flex-col gap-3 rounded-xl border border-line bg-white/95 p-4 backdrop-blur sm:flex-row sm:items-center ${isFirstTime ? "sm:justify-between" : "sm:justify-end"}`}
          >
            {isFirstTime ? (
              <p className="text-sm text-ink-muted">ข้อมูลตรงกับฐานสมาชิกสมาคม จะได้เลขสมาชิกทันที</p>
            ) : null}
            <SubmitButton
              className={`${buttonClass("primary", "lg")} w-full sm:w-auto`}
              disabled={access.isBypass}
              pendingText="กำลังบันทึก..."
            >
              <SaveIcon className="size-4" aria-hidden="true" />
              {isFirstTime ? "สมัครสมาชิก" : "บันทึก"}
            </SubmitButton>
          </div>
        </form>

        <MembershipPrivacyPanel isBypass={access.isBypass} userId={access.userId} />
      </div>
    </main>
  );
}
