import { KeyRound, ShieldAlert, ShieldCheck } from "lucide-react";

import { bootstrapClubAdmin } from "@/app/setup/actions";
import {
  hasBootstrapSetupToken,
  hasSupabasePublicConfig,
} from "@/lib/supabase/env";

type SetupPageProps = {
  searchParams: Promise<{ status?: string }>;
};

const statusMessages: Record<string, { tone: "success" | "warning" | "danger"; text: string }> = {
  "already-bootstrapped": {
    tone: "warning",
    text: "ระบบมีผู้ดูแลชมรมแล้ว หน้าตั้งค่าจึงไม่อนุญาตให้สร้างซ้ำ",
  },
  created: {
    tone: "success",
    text: "สร้างผู้ดูแลชมรมสำเร็จแล้ว สามารถเข้าสู่ระบบด้วยอีเมลและรหัสผ่านนี้ได้",
  },
  failed: {
    tone: "danger",
    text: "ตั้งค่าไม่สำเร็จ กรุณาตรวจ env และ Supabase logs",
  },
  "invalid-email": {
    tone: "danger",
    text: "อีเมลไม่ถูกต้อง",
  },
  "invalid-token": {
    tone: "danger",
    text: "Setup token ไม่ถูกต้อง",
  },
  "weak-password": {
    tone: "danger",
    text: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
  },
};

function statusClass(tone: "success" | "warning" | "danger") {
  if (tone === "success") {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (tone === "warning") {
    return "bg-[#fff5d8] text-[#805300]";
  }

  return "bg-[#fdecec] text-[#8a1f11]";
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const status = params.status ? statusMessages[params.status] : null;
  const isSupabaseReady = hasSupabasePublicConfig();
  const hasSetupToken = hasBootstrapSetupToken();
  const canSubmit = isSupabaseReady && hasSetupToken;

  return (
    <main className="min-h-screen bg-transparent px-4 py-8 text-[#2f3137]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-6 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">ตั้งค่าระบบ PEAGC</p>
            <h1 className="mt-2 text-3xl font-semibold text-[#722257]">
              ตั้งค่าผู้ดูแลชมรมคนแรก
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#3f3a48]">
              หน้านี้ใช้สำหรับตั้งค่าระบบครั้งแรกเท่านั้น
              หลังจากสร้างผู้ดูแลแล้วควรใช้ระบบจัดการผู้ใช้ภายในแอปแทน
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-md bg-[#722257] text-white">
            <KeyRound className="size-5" aria-hidden="true" />
          </div>
        </div>

        {status ? (
          <div className={`mt-5 rounded-md px-4 py-3 text-sm font-medium ${statusClass(status.tone)}`}>
            {status.text}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
            <div className="flex items-start gap-3">
              {isSupabaseReady ? (
                <ShieldCheck className="mt-0.5 size-5 text-[#722257]" aria-hidden="true" />
              ) : (
                <ShieldAlert className="mt-0.5 size-5 text-[#8a1f11]" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#722257]">ค่าการเชื่อมต่อฐานข้อมูล</p>
                <p className="mt-1 text-sm text-[#6b6475]">
                  {isSupabaseReady ? "พร้อมใช้งาน" : "ยังไม่ได้ตั้งค่าการเชื่อมต่อสาธารณะ"}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
            <div className="flex items-start gap-3">
              {hasSetupToken ? (
                <ShieldCheck className="mt-0.5 size-5 text-[#722257]" aria-hidden="true" />
              ) : (
                <ShieldAlert className="mt-0.5 size-5 text-[#8a1f11]" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#722257]">รหัสตั้งค่าระบบ</p>
                <p className="mt-1 text-sm text-[#6b6475]">
                  {hasSetupToken ? "พร้อมใช้งาน" : "ยังไม่ได้ตั้งค่ารหัสตั้งระบบ"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <form action={bootstrapClubAdmin} className="mt-6 grid gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-[#3f3a48]">รหัสตั้งค่าระบบ</span>
            <input
              className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
              name="setupToken"
              required
              type="password"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">ชื่อชมรม</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue="ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค"
                name="clubName"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">ชื่อย่อ</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base uppercase outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                defaultValue="PEAGC"
                name="shortName"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">ชื่อผู้ดูแล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                name="displayName"
                placeholder="ชื่อ-นามสกุล"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#3f3a48]">อีเมลผู้ดูแล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                name="email"
                placeholder="admin@example.com"
                required
                type="email"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-[#3f3a48]">รหัสผ่านเริ่มต้น</span>
            <input
              className="mt-2 h-12 w-full rounded-md border border-[#d9d3e6] bg-white px-4 text-base outline-none transition focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>

          <button
            className="mt-2 flex h-12 w-full items-center justify-center rounded-md bg-[#722257] px-4 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(114,34,87,0.08)] transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6]"
            disabled={!canSubmit}
            type="submit"
          >
            สร้างผู้ดูแลชมรม
          </button>
        </form>
      </section>
    </main>
  );
}
