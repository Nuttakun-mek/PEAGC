import Link from "next/link";

import { bootstrapClubAdmin } from "@/app/setup/actions";
import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { StatusBanner } from "@/components/status-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, fieldHint, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import {
  hasBootstrapSetupToken,
  hasSupabasePublicConfig,
} from "@/lib/supabase/env";

type SetupPageProps = {
  searchParams: Promise<{ status?: string }>;
};

const statusMessages: Record<string, { tone: "success" | "warning" | "error"; text: string }> = {
  "already-bootstrapped": {
    tone: "warning",
    text: "มีผู้ดูแลชมรมแล้ว สร้างซ้ำจากหน้านี้ไม่ได้",
  },
  created: {
    tone: "success",
    text: "สร้างผู้ดูแลชมรมแล้ว เข้าสู่ระบบด้วยอีเมลและรหัสผ่านที่ตั้งไว้ได้เลย",
  },
  failed: {
    tone: "error",
    text: "ตั้งค่าไม่สำเร็จ ตรวจค่าตัวแปรสภาพแวดล้อม (env) และ log ของ Supabase",
  },
  "invalid-email": {
    tone: "error",
    text: "อีเมลไม่ถูกต้อง",
  },
  "invalid-token": {
    tone: "error",
    text: "รหัสตั้งค่าระบบไม่ถูกต้อง",
  },
  "weak-password": {
    tone: "error",
    text: "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร",
  },
};

const inputClass = fieldInputClass("lg");

function Required() {
  return (
    <span aria-hidden="true" className="text-danger">
      {" "}*
    </span>
  );
}

export default async function SetupPage({ searchParams }: SetupPageProps) {
  const params = await searchParams;
  const status = params.status ? statusMessages[params.status] : null;
  const isSupabaseReady = hasSupabasePublicConfig();
  const hasSetupToken = hasBootstrapSetupToken();
  const canSubmit = isSupabaseReady && hasSetupToken;
  const checks = [
    { label: "การเชื่อมต่อฐานข้อมูล", missing: "ยังไม่ได้ตั้งค่าการเชื่อมต่อสาธารณะ", ok: isSupabaseReady },
    { label: "รหัสตั้งค่าระบบ", missing: "ยังไม่ได้ตั้งรหัสตั้งค่าระบบ", ok: hasSetupToken },
  ];

  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink sm:py-12">
      <section className="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-white p-5 shadow-card sm:p-8">
        <div className="flex items-center gap-3">
          <ClubCrest priority size={52} />
          <span className="text-sm font-semibold leading-5 text-brand-600">{CLUB_NAME}</span>
        </div>
        <h1 className="mt-6 text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600 sm:text-display">
          ตั้งค่าผู้ดูแลชมรมคนแรก
        </h1>
        <p className="mt-2 max-w-2xl text-base text-ink-muted">
          ใช้ครั้งเดียวตอนติดตั้ง หลังสร้างผู้ดูแลคนแรกแล้ว เพิ่มผู้ดูแลคนอื่นจากหน้าผู้ดูแล
        </p>

        {status ? (
          <StatusBanner className="mt-5" tone={status.tone}>
            {status.text}
            {params.status === "created" ? (
              <>
                {" "}
                <Link className="font-semibold underline underline-offset-4" href="/login">
                  ไปหน้าเข้าสู่ระบบ
                </Link>
              </>
            ) : null}
          </StatusBanner>
        ) : null}

        <ul aria-label="ความพร้อมก่อนตั้งค่า" className="mt-6 divide-y divide-line rounded-lg border border-line">
          {checks.map((check) => (
            <li className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" key={check.label}>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{check.label}</p>
                {check.ok ? null : <p className="text-sm text-ink-muted">{check.missing}</p>}
              </div>
              <StatusBadge tone={check.ok ? "success" : "danger"}>{check.ok ? "พร้อมใช้งาน" : "ยังไม่พร้อม"}</StatusBadge>
            </li>
          ))}
        </ul>

        <form action={bootstrapClubAdmin} className="mt-6 grid gap-4">
          <label className="block">
            <span className={fieldLabel}>
              รหัสตั้งค่าระบบ<Required />
            </span>
            <input autoComplete="off" className={inputClass} name="setupToken" required type="password" />
          </label>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>
                ชื่อชมรม<Required />
              </span>
              <input className={inputClass} defaultValue={CLUB_NAME} name="clubName" required />
            </label>
            <label className="block">
              <span className={fieldLabel}>
                ชื่อย่อ<Required />
              </span>
              <input className={`${inputClass} uppercase`} defaultValue="PEAGC" name="shortName" required />
            </label>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>
                ชื่อผู้ดูแล<Required />
              </span>
              <input autoComplete="name" className={inputClass} name="displayName" placeholder="ชื่อ-นามสกุล" required />
            </label>
            <label className="block">
              <span className={fieldLabel}>
                อีเมลผู้ดูแล<Required />
              </span>
              <input autoComplete="email" className={inputClass} name="email" placeholder="admin@example.com" required type="email" />
            </label>
          </div>

          <label className="block">
            <span className={fieldLabel}>
              รหัสผ่านเริ่มต้น<Required />
            </span>
            <input autoComplete="new-password" className={inputClass} minLength={8} name="password" required type="password" />
            <span className={fieldHint}>อย่างน้อย 8 ตัวอักษร</span>
          </label>

          <button className={`${buttonClass("primary", "lg")} mt-2 w-full`} disabled={!canSubmit} type="submit">
            สร้างผู้ดูแลชมรม
          </button>
        </form>
      </section>
    </main>
  );
}
