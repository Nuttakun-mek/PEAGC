import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, House } from "lucide-react";

import { AuthCard } from "@/components/auth-card";
import { buttonClass } from "@/components/ui/styles";

export const metadata: Metadata = {
  title: "ไม่พบหน้านี้",
};

export default function NotFound() {
  return (
    <AuthCard description="ลิงก์อาจพิมพ์ผิด หรือหน้านี้ถูกย้ายหรือลบไปแล้ว" title="ไม่พบหน้านี้">
      <div className="mt-6 grid gap-3">
        <Link className={`${buttonClass("primary", "lg")} w-full`} href="/">
          <House className="size-4" aria-hidden="true" />
          กลับหน้าหลัก
        </Link>
        <Link className={`${buttonClass("secondary", "lg")} w-full`} href="/login">
          <ArrowLeft className="size-4" aria-hidden="true" />
          ไปหน้าเข้าสู่ระบบ
        </Link>
      </div>
    </AuthCard>
  );
}
