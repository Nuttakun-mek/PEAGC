import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { KeyRound, ShieldCheck, UserPlus } from "lucide-react";

import {
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from "@/app/actions/auth";
import { CLUB_NAME, ClubCrest, PeaLogo } from "@/components/brand";
import { EnvBadge } from "@/components/env-badge";
import { PasswordInput } from "@/components/password-input";
import { StatusBanner } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass, fieldHint, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolvePostLoginPath } from "@/lib/auth/post-login";
import { getSessionUser } from "@/lib/auth/session";
import {
  hasSupabasePublicConfig,
  isGoogleAuthEnabled,
} from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "เข้าสู่ระบบ" };

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    mode?: string;
    next?: string;
    sent?: string;
    signedOut?: string;
    registered?: string;
    reset?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  "invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
  "invalid-credentials": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  "email-in-use": "อีเมลนี้มีบัญชีแล้ว",
  "password-mismatch": "รหัสผ่านทั้งสองช่องไม่ตรงกัน",
  "signup-failed": "สร้างบัญชีไม่สำเร็จ ลองอีกครั้ง",
  "weak-password": "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
  "confirm-failed": "ยืนยันการเข้าสู่ระบบไม่สำเร็จ หรือลิงก์หมดอายุแล้ว",
  "google-failed": "เข้าสู่ระบบด้วย Google ไม่สำเร็จ",
  "missing-config": "ยังเชื่อมต่อฐานข้อมูลไม่ได้ กรุณาติดต่อผู้ดูแลชมรม",
  "reset-link-invalid": "ลิงก์ตั้งรหัสผ่านใหม่ไม่ถูกต้องหรือหมดอายุแล้ว กรุณาขอลิงก์ใหม่",
};

const inputClass = fieldInputClass("lg");

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") && !params.next.startsWith("//")
    ? params.next
    : "/auth/complete";
  const isSignup = params.mode === "signup";
  const hasAuthConfig = hasSupabasePublicConfig();
  const googleEnabled = isGoogleAuthEnabled();
  const errorMessage = params.error ? errorMessages[params.error] : null;

  // Someone who is already signed in goes straight to their page instead of seeing the form again.
  if (hasAuthConfig && !params.error && !params.signedOut) {
    const user = await getSessionUser();
    if (user) {
      const explicit = next !== "/auth/complete" && !next.startsWith("/login");
      redirect(explicit ? next : await resolvePostLoginPath(await createClient(), user.id));
    }
  }

  return (
    <main className="grid min-h-screen bg-white text-ink lg:grid-cols-[1fr_1fr]">
      <aside className="relative hidden min-h-screen flex-col justify-between bg-brand-600 p-12 text-white lg:flex xl:p-16">
        <div />
        <div className="flex flex-col items-center text-center">
          <div className="flex size-[min(26rem,36vw)] items-center justify-center rounded-full bg-white shadow-[0_24px_60px_rgba(0,0,0,0.25)]">
            <ClubCrest className="size-[78%]" priority size={420} />
          </div>
          <h2 className="mt-10 text-[2rem] font-semibold leading-[2.5rem]">{CLUB_NAME}</h2>
        </div>
        <div className="flex items-center gap-3 text-sm text-white/80">
          <span className="flex h-11 items-center rounded-lg bg-white px-3">
            <PeaLogo height={28} />
          </span>
          การไฟฟ้าส่วนภูมิภาค
        </div>
      </aside>

      <div className="flex min-h-screen items-center justify-center bg-canvas px-4 py-8 sm:px-8 lg:bg-white">
        <section className="w-full max-w-md">
          {/* The brand panel is hidden on phones, so the crest and name sit above the form there. */}
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <ClubCrest priority size={64} />
            <p className="text-base font-semibold leading-6 text-brand-600">{CLUB_NAME}</p>
          </div>

          <EnvBadge className="mb-3" />
          <h1 className="text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600 sm:text-display">
            {isSignup ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}
          </h1>
          <p className="mt-1 text-ink-subtle">
            {isSignup ? "สร้างบัญชีด้วยอีเมล แล้วกรอกรหัสพนักงานเพื่อยืนยันตัวตน" : "ใช้อีเมลและรหัสผ่านที่สมัครไว้"}
          </p>

          <div className="mt-6 grid grid-cols-2 rounded-lg border border-line bg-white p-1 text-sm font-semibold">
            <Link
              aria-current={!isSignup ? "page" : undefined}
              className={`flex h-10 items-center justify-center rounded-md ${!isSignup ? "bg-brand-600 text-white" : "text-brand-600 hover:bg-brand-50"}`}
              href={`/login?mode=signin&next=${encodeURIComponent(next)}`}
            >
              เข้าสู่ระบบ
            </Link>
            <Link
              aria-current={isSignup ? "page" : undefined}
              className={`flex h-10 items-center justify-center rounded-md ${isSignup ? "bg-brand-600 text-white" : "text-brand-600 hover:bg-brand-50"}`}
              href={`/login?mode=signup&next=${encodeURIComponent(next)}`}
            >
              สมัครสมาชิก
            </Link>
          </div>

          {params.registered ? <StatusBanner className="mt-5" tone="success">สร้างบัญชีแล้ว กรุณาเข้าสู่ระบบ</StatusBanner> : null}
          {params.signedOut ? <StatusBanner className="mt-5" tone="info">ออกจากระบบแล้ว</StatusBanner> : null}
          {params.reset ? <StatusBanner className="mt-5" tone="success">ตั้งรหัสผ่านใหม่แล้ว กรุณาเข้าสู่ระบบด้วยรหัสผ่านใหม่</StatusBanner> : null}
          {errorMessage ? <StatusBanner className="mt-5" tone="error">{errorMessage}</StatusBanner> : null}

          {!hasAuthConfig ? (
            <StatusBanner className="mt-5" tone="warning">ยังเข้าสู่ระบบไม่ได้ กรุณาติดต่อผู้ดูแลชมรม</StatusBanner>
          ) : null}

          {isSignup ? (
            <>
              <div className="mt-6 flex items-start gap-3 rounded-lg border border-line bg-white p-4">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-brand-600" aria-hidden="true" />
                <p className="text-sm text-ink-muted">ถ้ารหัสพนักงานและชื่อตรงกับฐานสมาชิกสมาคม ได้เลขสมาชิกทันที ถ้าไม่ตรง ผู้ดูแลชมรมจะตรวจให้</p>
              </div>
              <form action={signUpWithPassword} className="mt-5 space-y-4">
                <label className="block">
                  <span className={fieldLabel}>อีเมล</span>
                  <input autoComplete="email" className={inputClass} name="email" placeholder="name@example.com" required type="email" />
                </label>
                <div>
                  <label className={fieldLabel} htmlFor="signup-password">รหัสผ่าน</label>
                  <PasswordInput autoComplete="new-password" className={inputClass} describedBy="signup-password-hint" id="signup-password" name="password" />
                  <span className={fieldHint} id="signup-password-hint">อย่างน้อย 8 ตัวอักษร</span>
                </div>
                <div>
                  <label className={fieldLabel} htmlFor="signup-confirm-password">ยืนยันรหัสผ่าน</label>
                  <PasswordInput autoComplete="new-password" className={inputClass} id="signup-confirm-password" name="confirmPassword" />
                </div>
                <SubmitButton className={`${buttonClass("primary", "lg")} w-full`} disabled={!hasAuthConfig} pendingText="กำลังสร้างบัญชี...">
                  <UserPlus className="size-4" aria-hidden="true" /> สมัครสมาชิก
                </SubmitButton>
              </form>
            </>
          ) : (
            <form action={signInWithPassword} className="mt-6 space-y-4">
              <input name="next" type="hidden" value={next} />
              <label className="block">
                <span className={fieldLabel}>อีเมล</span>
                <input autoComplete="username" className={inputClass} data-required-message="กรุณากรอกอีเมลที่ใช้สมัคร" name="email" placeholder="name@example.com" required type="email" />
              </label>
              <div>
                <div className="flex items-center justify-between gap-3">
                  <label className={fieldLabel} htmlFor="signin-password">รหัสผ่าน</label>
                  <Link className="text-sm font-medium text-brand-600 hover:underline" href="/forgot-password">ลืมรหัสผ่าน?</Link>
                </div>
                <PasswordInput autoComplete="current-password" className={inputClass} id="signin-password" name="password" />
              </div>
              <SubmitButton className={`${buttonClass("primary", "lg")} w-full`} disabled={!hasAuthConfig} pendingText="กำลังเข้าสู่ระบบ...">
                <KeyRound className="size-4" aria-hidden="true" /> เข้าสู่ระบบ
              </SubmitButton>
            </form>
          )}

          {googleEnabled ? (
            <form action={signInWithGoogle} className="mt-3">
              <input name="next" type="hidden" value={next} />
              <button className={`${buttonClass("secondary", "lg")} w-full`} type="submit">เข้าสู่ระบบด้วย Google</button>
            </form>
          ) : null}

          <div className="mt-10 flex items-center gap-2 text-xs text-ink-subtle lg:hidden">
            <PeaLogo height={20} />
            การไฟฟ้าส่วนภูมิภาค
          </div>
        </section>
      </div>
    </main>
  );
}
