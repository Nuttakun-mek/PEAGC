import Link from "next/link";
import { MailCheck, PlayCircle, ShieldCheck, UserCog, UsersRound } from "lucide-react";

import { signInWithEmail, signInWithGoogle } from "@/app/actions/auth";
import { isAuthBypassEnabled } from "@/lib/supabase/env";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    next?: string;
    sent?: string;
    signedOut?: string;
  }>;
};

const errorMessages: Record<string, string> = {
  "invalid-email": "กรุณากรอกอีเมลให้ถูกต้อง",
  "send-failed": "ส่งลิงก์เข้าสู่ระบบไม่สำเร็จ กรุณาลองอีกครั้ง",
  "confirm-failed": "ยืนยันการเข้าสู่ระบบไม่สำเร็จ หรือลิงก์หมดอายุ",
  "google-failed": "เข้าสู่ระบบด้วย Google ไม่สำเร็จ กรุณาตรวจการตั้งค่า Google provider",
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") && !params.next.startsWith("//")
    ? params.next
    : "/auth/complete";
  const errorMessage = params.error ? errorMessages[params.error] : null;
  const showBypass = isAuthBypassEnabled();

  return (
    <main className="flex min-h-screen items-center justify-center bg-transparent px-4 py-8 text-[#2f3137]">
      <section className="w-full max-w-md golf-visual rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-6 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-md bg-[#C69214] text-sm font-bold text-[#722257]">
            PEA
          </div>
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">PEAGC</p>
            <h1 className="text-2xl font-semibold text-[#722257]">
              เข้าสู่ระบบ
            </h1>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-[#722257]" aria-hidden="true" />
            <p className="text-sm leading-6 text-[#3f3a48]">
              ระบบจะส่ง magic link ไปที่อีเมลของคุณ กดลิงก์จากอีเมลเพื่อเข้าสู่ระบบอย่างปลอดภัย
            </p>
          </div>
        </div>

        {params.sent ? (
          <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
            ส่งลิงก์แล้ว กรุณาตรวจอีเมลของคุณ
          </div>
        ) : null}

        {params.signedOut ? (
          <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
            ออกจากระบบแล้ว
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-5 rounded-md bg-[#fdecec] px-4 py-3 text-sm font-medium text-[#8a1f11]">
            {errorMessage}
          </div>
        ) : null}

        <form action={signInWithGoogle} className="mt-6">
          <input name="next" type="hidden" value={next} />
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(114,34,87,0.08)] transition hover:bg-[#8b2d6b]"
            type="submit"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-white text-xs font-bold text-[#722257]">
              G
            </span>
            เข้าสู่ระบบด้วย Google
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#e6e2ee]" />
          <span className="text-xs font-semibold text-[#6b6475]">หรือ</span>
          <div className="h-px flex-1 bg-[#e6e2ee]" />
        </div>

        <form action={signInWithEmail} className="space-y-4">
          <input name="next" type="hidden" value={next} />
          <label className="block">
            <span className="text-sm font-semibold text-[#3f3a48]">อีเมล</span>
            <input
              className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
              name="email"
              placeholder="name@example.com"
              required
              type="email"
            />
          </label>
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257] transition hover:border-[#722257]"
            type="submit"
          >
            <MailCheck className="size-4" aria-hidden="true" />
            ส่งลิงก์เข้าสู่ระบบ
          </button>
        </form>

        {showBypass ? (
          <div className="mt-6 rounded-lg border border-[#d7a52c] bg-[#fff9ed] p-4">
            <p className="text-sm font-semibold text-[#805300]">
              ช่องทางลัดสำหรับพัฒนา
            </p>
            <p className="mt-1 text-sm leading-6 text-[#704b00]">
              ใช้ดูหน้าระบบชั่วคราวโดยไม่ต้องล็อกอิน ต้องปิดก่อน go live
            </p>
            <Link
              className="mt-4 flex h-11 items-center justify-center gap-2 rounded-md border border-[#d7a52c] bg-white px-3 text-sm font-semibold text-[#722257]"
              href="/auth/google-demo"
            >
              <PlayCircle className="size-4" aria-hidden="true" />
              ทดลองโฟล Google ก่อนเชื่อมจริง
            </Link>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Link
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#722257] px-3 text-sm font-semibold text-white"
                href="/member?bypass=member"
              >
                <UsersRound className="size-4" aria-hidden="true" />
                หน้าสมาชิก
              </Link>
              <Link
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#C69214] px-3 text-sm font-semibold text-[#722257]"
                href="/admin?bypass=admin"
              >
                <UserCog className="size-4" aria-hidden="true" />
                หน้า Admin
              </Link>
            </div>
          </div>
        ) : null}
      </section>
    </main>
  );
}
