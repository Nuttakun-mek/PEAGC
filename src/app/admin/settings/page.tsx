import Link from "next/link";
import { CalendarDays, GraduationCap, Newspaper, Power, Settings2, Trophy } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { resolveAccess } from "@/lib/auth/access";
import { getStaffClub } from "@/lib/auth/staff";
import { type ModuleKey, defaultModuleState, moduleCatalog } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { formatBangkokDateTime } from "@/lib/lessons/booking";

import { setModuleEnabled } from "./actions";

type PageProps = {
  searchParams: Promise<{ bypass?: string; module?: string; status?: string }>;
};

const icons: Record<ModuleKey, typeof GraduationCap> = {
  events: CalendarDays,
  lessons: GraduationCap,
  news: Newspaper,
  scores: Trophy,
};

const statusMessages: Record<string, string> = {
  "invalid-module": "ไม่พบระบบที่เลือก",
  "module-closed": "ปิดระบบสำหรับสมาชิกแล้ว ผู้ดูแลยังเตรียมข้อมูลในหน้าจัดการได้ตามปกติ",
  "module-opened": "เปิดระบบให้สมาชิกใช้งานแล้ว",
  "module-update-failed": "บันทึกไม่สำเร็จ เฉพาะเจ้าของระบบหรือผู้ดูแลชมรมเท่านั้นที่เปิด/ปิดระบบได้",
};

export default async function AdminSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/settings",
    requiredRole: "admin",
    searchParams: params,
  });

  let modules = { ...defaultModuleState };
  let canManage = false;
  const lastChange = new Map<string, string>();

  if (!access.isBypass && access.clubId) {
    const owner = await getStaffClub(["platform_owner", "club_admin"]);
    canManage = owner.status === "ok";
    const supabase = owner.supabase;
    modules = await getClubModules(supabase, access.clubId);
    const { data } = await supabase.from("club_modules").select("module_key, updated_at").eq("club_id", access.clubId);
    for (const row of data ?? []) lastChange.set(row.module_key, row.updated_at);
  }

  const statusMessage = params.status ? statusMessages[params.status] : null;

  return (
    <main className="min-h-screen px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-5xl">
        <div className="border-b border-[#e6e2ee] pb-5">
          <p className="text-sm font-semibold text-[#8b5b7a]">ระบบผู้ดูแล</p>
          <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold text-[#722257]">
            <Settings2 className="size-7" aria-hidden="true" />
            เปิด/ปิดระบบ
          </h1>
          <p className="mt-2 text-sm text-[#6b6475]">
            เลือกว่าสมาชิกจะเห็นและใช้งานส่วนใดได้บ้าง ระบบที่ปิดอยู่จะถูกซ่อนจากหน้าสมาชิกและรับรายการใหม่ไม่ได้
            ส่วนผู้ดูแลยังเข้าไปเตรียมข้อมูลล่วงหน้าได้ เมื่อพร้อมค่อยเปิดทีละส่วน
          </p>
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={params.status === "module-closed" ? "warning" : toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">โหมดทดลอง: แสดงค่าเริ่มต้นและปิดการบันทึก</StatusBanner>
        ) : !canManage ? (
          <StatusBanner className="mt-5" tone="info">
            ดูสถานะได้อย่างเดียว เฉพาะเจ้าของระบบหรือผู้ดูแลชมรม (club_admin) ที่เปิด/ปิดระบบได้
          </StatusBanner>
        ) : null}

        <ul className="mt-6 grid gap-4">
          <li className="rounded-lg border border-[#e6e2ee] bg-[#f8f7fa] p-5 text-sm text-[#6b6475]">
            <p className="font-semibold text-[#3f3a48]">ระบบหลัก (เปิดตลอด)</p>
            <p className="mt-1">บัญชีสมาชิก การยืนยันตัวตนกับฐานสมาชิกสมาคม และข้อมูลส่วนตัว</p>
          </li>
          {moduleCatalog.map((item) => {
            const Icon = icons[item.key];
            const enabled = modules[item.key];
            const highlighted = params.module === item.key;

            return (
              <li
                className={`flex flex-col gap-4 rounded-lg border bg-white p-5 shadow-[0_12px_30px_rgba(114,34,87,0.06)] sm:flex-row sm:items-center sm:justify-between ${highlighted ? "border-[#722257] ring-4 ring-[#722257]/10" : "border-[#e6e2ee]"}`}
                key={item.key}
              >
                <div className="flex items-start gap-4">
                  <span className={`flex size-11 shrink-0 items-center justify-center rounded-md ${enabled ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#f1f3ef] text-[#98a2b3]"}`}>
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-semibold text-[#3f3a48]">{item.label}</h2>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${enabled ? "bg-[#edf9f3] text-[#16794b]" : "bg-[#fdecec] text-[#9f1d1d]"}`}>
                        {enabled ? "เปิดให้สมาชิกใช้งาน" : "ปิดอยู่"}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-[#6b6475]">{item.description}</p>
                    <p className="mt-2 flex flex-wrap gap-x-3 text-xs text-[#98a2b3]">
                      {item.adminPaths.map((path) => (
                        <Link className="font-semibold text-[#8b5b7a] hover:text-[#722257]" href={path} key={path}>
                          หน้าจัดการ {path.replace("/admin/", "")}
                        </Link>
                      ))}
                      {lastChange.has(item.key) ? <span>แก้ไขล่าสุด {formatBangkokDateTime(lastChange.get(item.key))}</span> : <span>ค่าเริ่มต้น</span>}
                    </p>
                  </div>
                </div>

                <form action={setModuleEnabled} className="shrink-0">
                  <input name="module" type="hidden" value={item.key} />
                  <input name="enabled" type="hidden" value={enabled ? "false" : "true"} />
                  {canManage ? (
                    <ConfirmSubmitButton
                      className={`flex h-11 items-center gap-2 rounded-md px-4 text-sm font-semibold transition ${enabled ? "border border-[#efcbd0] bg-white text-[#9f1d1d] hover:bg-[#fdecec]" : "bg-[#16794b] text-white hover:bg-[#126a41]"}`}
                      message={enabled ? `ปิด "${item.label}" สำหรับสมาชิก? สมาชิกจะไม่เห็นและทำรายการใหม่ไม่ได้` : `เปิด "${item.label}" ให้สมาชิกใช้งาน?`}
                    >
                      <Power className="size-4" aria-hidden="true" />
                      {enabled ? "ปิดระบบ" : "เปิดระบบ"}
                    </ConfirmSubmitButton>
                  ) : (
                    <button className="flex h-11 cursor-not-allowed items-center gap-2 rounded-md bg-[#f1f3ef] px-4 text-sm font-semibold text-[#98a2b3]" disabled type="button">
                      <Power className="size-4" aria-hidden="true" />
                      {enabled ? "ปิดระบบ" : "เปิดระบบ"}
                    </button>
                  )}
                </form>
              </li>
            );
          })}
        </ul>
      </section>
    </main>
  );
}
