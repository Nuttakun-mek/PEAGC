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
    text: "ระบบมี club admin แล้ว หน้า setup จึงถูกปิดสำหรับการสร้างซ้ำ",
  },
  created: {
    tone: "success",
    text: "สร้าง/ผูก club admin สำเร็จแล้ว สามารถเข้าสู่ระบบด้วยอีเมลนี้ได้",
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
    return "bg-[#e6f4df] text-[#24613f]";
  }

  if (tone === "warning") {
    return "bg-[#fff4d8] text-[#8a6112]";
  }

  return "bg-[#fde8df] text-[#9a3412]";
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const status = params.status ? statusMessages[params.status] : null;
  const isSupabaseReady = hasSupabasePublicConfig();
  const hasSetupToken = hasBootstrapSetupToken();
  const canSubmit = isSupabaseReady && hasSetupToken;

  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-8 text-[#11221d]">
      <section className="mx-auto w-full max-w-3xl rounded-lg border border-[#dfe5da] bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-4 border-b border-[#dfe5da] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#5b6f62]">PEAGC Setup</p>
            <h1 className="mt-2 text-3xl font-semibold text-[#0f2d26]">
              ตั้งค่า Club Admin คนแรก
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#405249]">
              หน้านี้ใช้สำหรับ bootstrap ระบบครั้งแรกเท่านั้น
              หลังจากสร้าง admin แล้วควรใช้ระบบจัดการผู้ใช้ภายในแอปแทน
            </p>
          </div>
          <div className="flex size-12 items-center justify-center rounded-md bg-[#0f2d26] text-white">
            <KeyRound className="size-5" aria-hidden="true" />
          </div>
        </div>

        {status ? (
          <div className={`mt-5 rounded-md px-4 py-3 text-sm font-medium ${statusClass(status.tone)}`}>
            {status.text}
          </div>
        ) : null}

        <div className="mt-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-4">
            <div className="flex items-start gap-3">
              {isSupabaseReady ? (
                <ShieldCheck className="mt-0.5 size-5 text-[#0f6b4f]" aria-hidden="true" />
              ) : (
                <ShieldAlert className="mt-0.5 size-5 text-[#9a3412]" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#0f2d26]">Supabase env</p>
                <p className="mt-1 text-sm text-[#687a6d]">
                  {isSupabaseReady ? "พร้อมใช้งาน" : "ยังไม่ได้ตั้งค่า public env"}
                </p>
              </div>
            </div>
          </div>
          <div className="rounded-lg border border-[#dfe5da] bg-[#fbfcf8] p-4">
            <div className="flex items-start gap-3">
              {hasSetupToken ? (
                <ShieldCheck className="mt-0.5 size-5 text-[#0f6b4f]" aria-hidden="true" />
              ) : (
                <ShieldAlert className="mt-0.5 size-5 text-[#9a3412]" aria-hidden="true" />
              )}
              <div>
                <p className="text-sm font-semibold text-[#0f2d26]">Setup token</p>
                <p className="mt-1 text-sm text-[#687a6d]">
                  {hasSetupToken ? "พร้อมใช้งาน" : "ยังไม่ได้ตั้งค่า token"}
                </p>
              </div>
            </div>
          </div>
        </div>

        <form action={bootstrapClubAdmin} className="mt-6 grid gap-4">
          <label className="block">
            <span className="text-sm font-semibold text-[#405249]">Setup token</span>
            <input
              className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
              name="setupToken"
              required
              type="password"
            />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อชมรม</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue="PEA Golf Club"
                name="clubName"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อย่อ</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base uppercase outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                defaultValue="PEAGC"
                name="shortName"
                required
              />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อผู้ดูแล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                name="displayName"
                placeholder="ชื่อ-นามสกุล"
                required
              />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">อีเมลผู้ดูแล</span>
              <input
                className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
                name="email"
                placeholder="admin@example.com"
                required
                type="email"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-semibold text-[#405249]">รหัสผ่านเริ่มต้น</span>
            <input
              className="mt-2 h-12 w-full rounded-md border border-[#cbd6c7] bg-white px-4 text-base outline-none transition focus:border-[#0f6b4f] focus:ring-4 focus:ring-[#0f6b4f]/10"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </label>

          <button
            className="mt-2 flex h-12 w-full items-center justify-center rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white shadow-sm transition enabled:hover:bg-[#17453b] disabled:cursor-not-allowed disabled:bg-[#9aa8a1]"
            disabled={!canSubmit}
            type="submit"
          >
            สร้าง Club Admin
          </button>
        </form>
      </section>
    </main>
  );
}
