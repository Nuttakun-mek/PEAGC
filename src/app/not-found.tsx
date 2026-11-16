import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Flag, Home } from "lucide-react";

export const metadata: Metadata = {
  title: "ไม่พบหน้านี้ | PEAGC",
};

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10 text-[#2f3137]">
      <section className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#e6e2ee] bg-white/95 p-8 text-center shadow-[0_24px_60px_rgba(114,34,87,0.12)] sm:p-10">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#f8edf4] text-[#722257]">
          <Flag className="size-7" aria-hidden="true" />
        </span>
        <p className="mt-6 text-sm font-semibold tracking-wide text-[#c69214]">ข้อผิดพลาด 404</p>
        <h1 className="mt-2 text-2xl font-semibold text-[#722257] sm:text-3xl">ไม่พบหน้าที่คุณต้องการ</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[#6b6475]">
          ลิงก์อาจพิมพ์ผิด หน้านี้ถูกย้าย หรือถูกลบไปแล้ว กลับไปหน้าหลักเพื่อเริ่มต้นใหม่ได้เลย
        </p>
        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <Link className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#722257] px-5 text-sm font-semibold text-white transition hover:bg-[#8b2d6b]" href="/">
            <Home className="size-4" aria-hidden="true" />
            กลับหน้าหลัก
          </Link>
          <Link className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#d9d3e6] bg-white px-5 text-sm font-semibold text-[#722257] transition hover:bg-[#f8edf4]" href="/login">
            <ArrowLeft className="size-4" aria-hidden="true" />
            ไปหน้าเข้าสู่ระบบ
          </Link>
        </div>
      </section>
    </main>
  );
}
