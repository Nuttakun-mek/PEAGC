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
    <main className="flex min-h-screen items-center justify-center bg-[#f6f7f2] px-4 py-8 text-[#11221d]">
      <section className="w-full max-w-md rounded-lg border border-[#dfe5da] bg-white p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-md bg-[#d6b25e] text-sm font-bold text-[#0f2d26]">
            PEA
          </div>
          <div>
            <p className="text-sm font-semibold text-[#5b6f62]">PEAGC</p>
            <h1 className="text-2xl font-semibold text-[#0f2d26]">
              เข้าสู่ระบบ
            </h1>
          </div>
        </div>

        <div className="mt-6 rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-[#0f6b4f]" aria-hidden="true" />
            <p className="text-sm leading-6 text-[#405249]">
              ระบบจะส่ง magic link ไปที่อีเมลของคุณ กดลิงก์จากอีเมลเพื่อเข้าสู่ระบบอย่างปลอดภัย
            </p>
          </div>
        </div>

        {params.sent ? (
          <div className="mt-5 rounded-md bg-[#e6f4df] px-4 py-3 text-sm font-medium text-[#24613f]">
            ส่งลิงก์แล้ว กรุณาตรวจอีเมลของคุณ
          </div>
        ) : null}

        {params.signedOut ? (
          <div className="mt-5 rounded-md bg-[#edf4ea] px-4 py-3 text-sm font-medium text-[#24613f]">
            ออกจากระบบแล้ว
          </div>
        ) : null}

        {errorMessage ? (
          <div className="mt-5 rounded-md bg-[#fde8df] px-4 py-3 text-sm font-medium text-[#9a3412]">
            {errorMessage}
          </div>
        ) : null}

        <form action={signInWithGoogle} className="mt-6">
          <input name="next" type="hidden" value={next} />
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#17453b]"
            type="submit"
          >
            <span className="flex size-5 items-center justify-center rounded-full bg-white text-xs font-bold text-[#0f2d26]">
              G
            </span>
            เข้าสู่ระบบด้วย Google
          </button>
        </form>

        <div className="my-5 flex items-center gap-3">
          <div className="h-px flex-1 bg-[#dfe5da]" />
          <span className="text-xs font-semibold text-[#687a6d]">หรือ</span>
          <div className="h-px flex-1 bg-[#dfe5da]" />
        </div>

        <form action={signInWithEmail} className="space-y-4">
          <input name="next" type="hidden" value={next} />
          <label className="block">
            <span className="text-sm font-semibold text-[#405249]">อีเมล</span>
            <input
              className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
              name="email"
              placeholder="name@example.com"
              required
              type="email"
            />
          </label>
          <button
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26] transition hover:border-[#0f2d26]"
            type="submit"
          >
            <MailCheck className="size-4" aria-hidden="true" />
            ส่งลิงก์เข้าสู่ระบบ
          </button>
        </form>

        {showBypass ? (
          <div className="mt-6 rounded-lg border border-[#e0c777] bg-[#fff8e7] p-4">
            <p className="text-sm font-semibold text-[#8a6112]">
              ช่องทางลัดสำหรับพัฒนา
            </p>
            <p className="mt-1 text-sm leading-6 text-[#6d541c]">
              ใช้ดูหน้าระบบชั่วคราวโดยไม่ต้องล็อกอิน ต้องปิดก่อน go live
            </p>
            <Link
              className="mt-4 flex h-11 items-center justify-center gap-2 rounded-md border border-[#e0c777] bg-white px-3 text-sm font-semibold text-[#0f2d26]"
              href="/auth/google-demo"
            >
              <PlayCircle className="size-4" aria-hidden="true" />
              ทดลองโฟล Google ก่อนเชื่อมจริง
            </Link>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Link
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-3 text-sm font-semibold text-white"
                href="/member?bypass=member"
              >
                <UsersRound className="size-4" aria-hidden="true" />
                หน้าสมาชิก
              </Link>
              <Link
                className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#d6b25e] px-3 text-sm font-semibold text-[#0f2d26]"
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
