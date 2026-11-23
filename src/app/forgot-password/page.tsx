import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mail } from "lucide-react";

import { requestPasswordReset } from "@/app/actions/password";
import { AuthCard, authButtonClass, authInputClass } from "@/components/auth-card";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { fieldLabel } from "@/components/ui/styles";

export const metadata: Metadata = {
  title: "ลืมรหัสผ่าน",
};

const messages: Record<string, string> = {
  "email-invalid": "รูปแบบอีเมลไม่ถูกต้อง ตัวอย่าง name@example.com",
  "missing-config": "ยังเชื่อมต่อฐานข้อมูลไม่ได้ กรุณาติดต่อผู้ดูแลระบบ",
  "rate-limited": "ขอลิงก์บ่อยเกินไป กรุณารอประมาณ 1 นาทีแล้วลองใหม่",
  sent: "ถ้าอีเมลนี้มีบัญชีอยู่ เราส่งลิงก์ตั้งรหัสผ่านใหม่ไปแล้ว ลิงก์ใช้ได้ครั้งเดียวและมีอายุจำกัด เปิดจากเครื่องและเบราว์เซอร์เดียวกับที่ขอ",
};

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status } = await searchParams;
  const message = status ? messages[status] : null;

  return (
    <AuthCard
      description="กรอกอีเมลที่ใช้เข้าสู่ระบบ เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลนั้น"
      title="ลืมรหัสผ่าน"
    >
      {message ? (
        <StatusBanner className="mt-5" tone={status === "sent" ? "success" : toneForStatus(status)}>
          {message}
        </StatusBanner>
      ) : null}
      <form action={requestPasswordReset} className="mt-6 space-y-4">
        <label className="block">
          <span className={fieldLabel}>
            อีเมล
            <span aria-hidden="true" className="text-danger">
              {" "}*
            </span>
          </span>
          <input autoComplete="email" className={authInputClass} data-required-message="กรุณากรอกอีเมลที่ใช้สมัคร" name="email" placeholder="name@example.com" required type="email" />
        </label>
        <SubmitButton className={authButtonClass} pendingText="กำลังส่งลิงก์...">
          <Mail className="size-4" aria-hidden="true" /> ส่งลิงก์ตั้งรหัสผ่านใหม่
        </SubmitButton>
      </form>
      <p className="mt-5 text-sm text-ink-muted">
        ไม่ได้รับอีเมลภายใน 5 นาที ให้ตรวจโฟลเดอร์สแปม หรือติดต่อผู้ดูแลชมรมเพื่อขอความช่วยเหลือ
      </p>
      <Link className="mt-2 inline-flex h-10 items-center gap-2 text-sm font-semibold text-brand-600 hover:underline" href="/login">
        <ArrowLeft className="size-4" aria-hidden="true" /> กลับไปหน้าเข้าสู่ระบบ
      </Link>
    </AuthCard>
  );
}
