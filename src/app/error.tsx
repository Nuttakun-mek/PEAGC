"use client";

import Link from "next/link";
import { useEffect } from "react";
import { House, RotateCcw } from "lucide-react";

import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/ui/styles";

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
    <AuthCard
      description="โหลดหน้านี้ไม่สำเร็จ ลองใหม่อีกครั้ง ถ้ายังไม่ได้ให้แจ้งผู้ดูแลชมรม"
      title="เกิดข้อผิดพลาดชั่วคราว"
    >
      {error.digest ? (
        <p className="mt-2 text-xs text-ink-subtle">
          รหัสอ้างอิง <span className="font-mono">{error.digest}</span>
        </p>
      ) : null}
      <div className="mt-6 grid gap-3">
        <button className={`${buttonClass("primary", "lg")} w-full`} onClick={() => unstable_retry()} type="button">
          <RotateCcw className="size-4" aria-hidden="true" />
          ลองใหม่อีกครั้ง
        </button>
        <Link className={`${buttonClass("secondary", "lg")} w-full`} href="/">
          <House className="size-4" aria-hidden="true" />
          กลับหน้าหลัก
        </Link>
      </div>
    </AuthCard>
  );
}
