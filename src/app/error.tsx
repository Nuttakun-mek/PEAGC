"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Home, RotateCcw, TriangleAlert } from "lucide-react";

export default function Error({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[70vh] items-center justify-center px-4 py-10 text-[#2f3137]">
      <section className="w-full max-w-lg rounded-2xl border border-[#f3c6cb] bg-white/95 p-8 text-center shadow-[0_24px_60px_rgba(114,34,87,0.1)]">
        <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-[#fdecec] text-[#b42318]">
          <TriangleAlert className="size-7" aria-hidden="true" />
        </span>
        <h1 className="mt-6 text-2xl font-semibold text-[#722257]">เกิดข้อผิดพลาดชั่วคราว</h1>
        <p className="mx-auto mt-3 max-w-sm text-sm leading-7 text-[#6b6475]">
          ระบบโหลดหน้านี้ไม่สำเร็จ ลองใหม่อีกครั้ง หากยังเป็นอยู่กรุณาแจ้งผู้ดูแลระบบ
          {error.digest ? <span className="mt-2 block text-xs text-[#98a2b3]">รหัสอ้างอิง: {error.digest}</span> : null}
        </p>
        <div className="mt-8 flex flex-col justify-center gap-2 sm:flex-row">
          <button
            className="flex h-11 items-center justify-center gap-2 rounded-lg bg-[#722257] px-5 text-sm font-semibold text-white transition hover:bg-[#8b2d6b]"
            onClick={() => unstable_retry()}
            type="button"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            ลองใหม่อีกครั้ง
          </button>
          <Link className="flex h-11 items-center justify-center gap-2 rounded-lg border border-[#d9d3e6] bg-white px-5 text-sm font-semibold text-[#722257] transition hover:bg-[#f8edf4]" href="/">
            <Home className="size-4" aria-hidden="true" />
            กลับหน้าหลัก
          </Link>
        </div>
      </section>
    </main>
  );
}
