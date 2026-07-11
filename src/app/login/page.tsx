import Link from "next/link";
import { KeyRound, ShieldCheck, UserPlus } from "lucide-react";

import {
  signInWithGoogle,
  signInWithPassword,
  signUpWithPassword,
} from "@/app/actions/auth";
import { SubmitButton } from "@/components/submit-button";
import {
  hasSupabasePublicConfig,
  isGoogleAuthEnabled,
} from "@/lib/supabase/env";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    mode?: string;
    next?: string;
    sent?: string;
    signedOut?: string;
    registered?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  "invalid-email": "กรุณากรอกอีเมลให้ถูกต้อง",
  "invalid-credentials": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
  "email-in-use": "อีเมลนี้มีบัญชีแล้ว กรุณาเข้าสู่ระบบ",
  "password-mismatch": "รหัสผ่านทั้งสองช่องไม่ตรงกัน",
  "signup-failed": "สมัครสมาชิกไม่สำเร็จ กรุณาลองอีกครั้ง",
  "weak-password": "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
  "confirm-failed": "ยืนยันการเข้าสู่ระบบไม่สำเร็จ หรือลิงก์หมดอายุแล้ว",
  "google-failed": "เข้าสู่ระบบด้วยกูเกิลไม่สำเร็จ",
  "missing-config": "ระบบยังเชื่อมต่อฐานข้อมูลไม่สมบูรณ์",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") && !params.next.startsWith("//")
    ? params.next
    : "/auth/complete";
  const isSignup = params.mode === "signup";
  const hasAuthConfig = hasSupabasePublicConfig();
  const googleEnabled = isGoogleAuthEnabled();
  const showDemoAccounts = process.env.NEXT_PUBLIC_SHOW_DEMO_ACCOUNTS === "true";
  const errorMessage = params.error ? errorMessages[params.error] : null;

  return (
    <main className="grid min-h-screen bg-[#f4f7fa] text-[#2f3137] lg:grid-cols-[1.05fr_0.95fr]">
      <aside className="login-visual relative hidden min-h-screen overflow-hidden p-12 text-white lg:flex lg:flex-col lg:justify-center xl:p-20">
        <div className="relative z-10 max-w-xl">
          <div className="mb-12 flex items-center gap-3">
            <span className="flex size-11 items-center justify-center rounded-md bg-[#C69214] font-bold">PEA</span>
            <div><p className="font-bold">PEAGC</p><p className="text-xs text-white/65">ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค</p></div>
          </div>
          <p className="text-sm font-semibold text-[#efd798]">พื้นที่ของคนรักกอล์ฟ</p>
          <h2 className="mt-3 text-4xl font-semibold leading-tight xl:text-5xl">บริหารชมรม เรียนรู้ และร่วมกิจกรรมได้ในที่เดียว</h2>
          <p className="mt-5 max-w-lg text-base leading-7 text-white/72">ระบบสมาชิกที่เชื่อมข้อมูลพนักงาน ตารางเรียนแบบ Slot และกิจกรรมของแต่ละหน่วยงานอย่างเป็นระบบ</p>
          <div className="mt-10 grid max-w-lg grid-cols-3 gap-3">
            {[['สมาชิก','ข้อมูลครบถ้วน'],['กิจกรรม','สมัครออนไลน์'],['ตารางเรียน','เปลี่ยนเวลาได้']].map(([title, detail]) => (
              <div className="border-l border-white/25 pl-4" key={title}><p className="text-xl font-bold text-[#f1cf79]">{title}</p><p className="mt-1 text-xs text-white/65">{detail}</p></div>
            ))}
          </div>
        </div>
      </aside>
      <div className="flex min-h-screen items-center justify-center px-4 py-8 sm:px-8">
      <section className="w-full max-w-md p-2 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-md bg-[#C69214] text-sm font-bold text-[#722257]">
            PEA
          </div>
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">PEAGC</p>
            <h1 className="text-2xl font-semibold text-[#722257]">
              {isSignup ? "สมัครสมาชิก" : "เข้าสู่ระบบ"}
            </h1>
            <p className="mt-1 text-xs font-medium text-[#6b6475]">
              {isSignup ? "เริ่มต้นบัญชีสมาชิกด้วยอีเมลของคุณ" : "จัดการสมาชิก กิจกรรม และตารางเรียนกอล์ฟ"}
            </p>
          </div>
        </div>

        {!isSignup && showDemoAccounts ? (
          <div className="mt-5 rounded-lg border border-[#d9d3e6] bg-[#f8edf4] p-4">
            <p className="text-sm font-semibold text-[#722257]">บัญชีทดสอบพร้อมใช้</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <form action={signInWithPassword}>
                <input name="email" type="hidden" value="admin@peagc.local" />
                <input name="password" type="hidden" value="Peagc3555!" />
                <input name="next" type="hidden" value="/auth/complete" />
                <SubmitButton className="h-11 w-full rounded-md bg-[#722257] px-3 text-sm font-semibold text-white disabled:bg-[#9a94a6]" pendingText="กำลังเข้า...">
                  เข้าฝั่งผู้ดูแล
                </SubmitButton>
              </form>
              <form action={signInWithPassword}>
                <input name="email" type="hidden" value="member@peagc.local" />
                <input name="password" type="hidden" value="Member3555!" />
                <input name="next" type="hidden" value="/auth/complete" />
                <SubmitButton className="h-11 w-full rounded-md border border-[#722257] bg-white px-3 text-sm font-semibold text-[#722257] disabled:bg-[#f1edf0]" pendingText="กำลังเข้า...">
                  เข้าฝั่งสมาชิก
                </SubmitButton>
              </form>
              <form action={signInWithPassword}>
                <input name="email" type="hidden" value="member2@peagc.local" />
                <input name="password" type="hidden" value="Member23555!" />
                <input name="next" type="hidden" value="/auth/complete" />
                <SubmitButton className="h-11 w-full rounded-md border border-[#b9dce5] bg-[#effaff] px-3 text-sm font-semibold text-[#16738f] disabled:bg-[#f1edf0]" pendingText="กำลังเข้า...">
                  เข้าสมาชิก 2
                </SubmitButton>
              </form>
              <form action={signInWithPassword}>
                <input name="email" type="hidden" value="member3@peagc.local" />
                <input name="password" type="hidden" value="Member33555!" />
                <input name="next" type="hidden" value="/auth/complete" />
                <SubmitButton className="h-11 w-full rounded-md border border-[#e5d5a8] bg-[#fffbef] px-3 text-sm font-semibold text-[#8b6508] disabled:bg-[#f1edf0]" pendingText="กำลังเข้า...">
                  เข้าสมาชิก 3
                </SubmitButton>
              </form>
            </div>
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 rounded-md border border-[#e6e2ee] bg-white p-1 text-sm font-semibold">
          <Link className={`flex h-10 items-center justify-center rounded-md ${!isSignup ? "bg-[#722257] text-white" : "text-[#722257]"}`} href={`/login?mode=signin&next=${encodeURIComponent(next)}`}>
            เข้าสู่ระบบ
          </Link>
          <Link className={`flex h-10 items-center justify-center rounded-md ${isSignup ? "bg-[#722257] text-white" : "text-[#722257]"}`} href={`/login?mode=signup&next=${encodeURIComponent(next)}`}>
            สมัครสมาชิก
          </Link>
        </div>

        {params.registered ? <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">สร้างบัญชีแล้ว กรุณาเข้าสู่ระบบ</div> : null}
        {params.signedOut ? <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">ออกจากระบบแล้ว</div> : null}
        {errorMessage ? <div className="mt-5 rounded-md bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#8a1f11]">{errorMessage}</div> : null}

        {!hasAuthConfig ? (
          <div className="mt-5 rounded-md border border-[#d7a52c] bg-[#fff9ed] px-4 py-3 text-sm text-[#805300]">
            ระบบยังไม่พร้อมรับการเข้าสู่ระบบ กรุณาติดต่อผู้ดูแลระบบ
          </div>
        ) : null}

        {isSignup ? (
          <>
            <div className="mt-6 flex items-start gap-3 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
              <ShieldCheck className="mt-0.5 size-5 shrink-0 text-[#722257]" aria-hidden="true" />
              <p className="text-sm leading-6 text-[#3f3a48]">สร้างบัญชีแล้วกรอกประวัติและรหัสพนักงานต่อได้ทันที ระบบจะเทียบข้อมูลกับฐานพนักงานของชมรม</p>
            </div>
            <form action={signUpWithPassword} className="mt-5 space-y-4">
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">อีเมล</span>
                <input className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" autoComplete="email" name="email" placeholder="name@example.com" required type="email" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">รหัสผ่าน</span>
                <input className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" autoComplete="new-password" minLength={8} name="password" required type="password" />
              </label>
              <label className="block">
                <span className="text-sm font-semibold text-[#3f3a48]">ยืนยันรหัสผ่าน</span>
                <input className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" autoComplete="new-password" minLength={8} name="confirmPassword" required type="password" />
              </label>
              <SubmitButton className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition hover:bg-[#8b2d6b] disabled:cursor-wait disabled:bg-[#9a94a6]" disabled={!hasAuthConfig} pendingText="กำลังสร้างบัญชี...">
                <UserPlus className="size-4" aria-hidden="true" /> สมัครสมาชิก
              </SubmitButton>
            </form>
          </>
        ) : (
          <form action={signInWithPassword} className="mt-6 space-y-4">
            <input name="next" type="hidden" value={next} />
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">อีเมล</span>
              <input className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" autoComplete="email" name="email" required type="email" />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">รหัสผ่าน</span>
              <input className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10" autoComplete="current-password" minLength={8} name="password" required type="password" />
            </label>
            <SubmitButton className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition hover:bg-[#8b2d6b] disabled:cursor-wait disabled:bg-[#9a94a6]" disabled={!hasAuthConfig} pendingText="กำลังเข้าสู่ระบบ...">
              <KeyRound className="size-4" aria-hidden="true" /> เข้าสู่ระบบ
            </SubmitButton>
          </form>
        )}

        {googleEnabled ? (
          <form action={signInWithGoogle} className="mt-3">
            <input name="next" type="hidden" value={next} />
            <button className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white text-sm font-semibold text-[#722257]" type="submit">เข้าสู่ระบบด้วยกูเกิล</button>
          </form>
        ) : null}
      </section>
      </div>
    </main>
  );
}
