import { MailCheck, ShieldCheck } from "lucide-react";

import { signInWithEmail } from "@/app/actions/auth";

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
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  const next = params.next?.startsWith("/") && !params.next.startsWith("//")
    ? params.next
    : "/";
  const errorMessage = params.error ? errorMessages[params.error] : null;

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

        <form action={signInWithEmail} className="mt-6 space-y-4">
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
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#17453b]"
            type="submit"
          >
            <MailCheck className="size-4" aria-hidden="true" />
            ส่งลิงก์เข้าสู่ระบบ
          </button>
        </form>
      </section>
    </main>
  );
}
