import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ArrowLeft, KeyRound } from "lucide-react";

import { changePassword } from "@/app/actions/password";
import { AuthCard, authButtonClass, authInputClass } from "@/components/auth-card";
import { PasswordInput } from "@/components/password-input";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { RECOVERY_COOKIE, RESET_PASSWORD_PATH } from "@/lib/auth/recovery";
import { getSessionRoles, getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "เปลี่ยนรหัสผ่าน | PEAGC",
};

const messages: Record<string, string> = {
  "current-password-required": "กรุณากรอกรหัสผ่านปัจจุบัน",
  "current-password-wrong": "รหัสผ่านปัจจุบันไม่ถูกต้อง",
  "password-change-failed": "เปลี่ยนรหัสผ่านไม่สำเร็จ กรุณาลองใหม่อีกครั้ง",
  "password-changed": "เปลี่ยนรหัสผ่านเรียบร้อยแล้ว อุปกรณ์อื่นที่เคยเข้าสู่ระบบไว้จะต้องเข้าสู่ระบบใหม่",
  "password-mismatch": "รหัสผ่านใหม่ทั้งสองช่องไม่ตรงกัน",
  "reauth-needed": "เพื่อความปลอดภัย กรุณาออกจากระบบแล้วเข้าสู่ระบบใหม่ก่อนเปลี่ยนรหัสผ่าน",
  "same-password": "รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม",
  "weak-password": "รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร",
};

const staffRoles = ["platform_owner", "club_admin", "committee", "finance_officer", "tournament_director", "scoring_officer"];

export default async function AccountPasswordPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const user = await getSessionUser();

  if (!user) {
    redirect(`/login?next=${encodeURIComponent(RESET_PASSWORD_PATH)}`);
  }

  const [roles, cookieStore] = await Promise.all([getSessionRoles(user.id), cookies()]);
  const viaResetLink = cookieStore.get(RECOVERY_COOKIE)?.value === user.id;
  const home = roles.some((role) => staffRoles.includes(role.role_key)) ? "/admin" : "/member";
  const message = status ? messages[status] : null;
  const changed = status === "password-changed";

  return (
    <AuthCard
      description={viaResetLink ? `ตั้งรหัสผ่านใหม่สำหรับ ${user.email}` : `บัญชี ${user.email}`}
      title={viaResetLink ? "ตั้งรหัสผ่านใหม่" : "เปลี่ยนรหัสผ่าน"}
    >
      {message ? (
        <StatusBanner className="mt-5" tone={changed ? "success" : toneForStatus(status)}>
          {message}
        </StatusBanner>
      ) : null}

      {changed ? (
        <Link className={`${authButtonClass} mt-6`} href={home}>
          ไปหน้าหลักของฉัน
        </Link>
      ) : (
        <form action={changePassword} className="mt-6 space-y-4">
          {viaResetLink ? null : (
            <div>
              <label className="text-sm font-semibold text-[#3f3a48]" htmlFor="current-password">รหัสผ่านปัจจุบัน</label>
              <PasswordInput autoComplete="current-password" className={authInputClass} id="current-password" minLength={1} name="currentPassword" />
            </div>
          )}
          <div>
            <label className="text-sm font-semibold text-[#3f3a48]" htmlFor="new-password">รหัสผ่านใหม่</label>
            <PasswordInput autoComplete="new-password" className={authInputClass} describedBy="new-password-hint" id="new-password" name="password" />
            <span className="mt-1 block text-xs text-[#6b6475]" id="new-password-hint">อย่างน้อย 8 ตัวอักษร ควรผสมตัวอักษรและตัวเลข และไม่ใช้ซ้ำกับระบบอื่น</span>
          </div>
          <div>
            <label className="text-sm font-semibold text-[#3f3a48]" htmlFor="confirm-password">ยืนยันรหัสผ่านใหม่</label>
            <PasswordInput autoComplete="new-password" className={authInputClass} id="confirm-password" name="confirmPassword" />
          </div>
          <SubmitButton className={authButtonClass} pendingText="กำลังบันทึก...">
            <KeyRound className="size-4" aria-hidden="true" /> บันทึกรหัสผ่านใหม่
          </SubmitButton>
        </form>
      )}

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm">
        <Link className="inline-flex items-center gap-2 font-semibold text-[#722257] hover:underline" href={home}>
          <ArrowLeft className="size-4" aria-hidden="true" /> กลับ
        </Link>
        {viaResetLink || changed ? null : (
          <Link className="font-semibold text-[#6b6475] hover:text-[#722257] hover:underline" href="/forgot-password">
            จำรหัสผ่านปัจจุบันไม่ได้?
          </Link>
        )}
      </div>
    </AuthCard>
  );
}
