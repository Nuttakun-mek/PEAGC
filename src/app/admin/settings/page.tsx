import Link from "next/link";

import { MembershipSettingsCard } from "@/components/membership-settings-card";
import { PaymentSettingsSection } from "@/components/payments-settings-section";
import { SettingsModuleSwitch } from "@/components/settings-module-switch";
import { StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { getStaffClub } from "@/lib/auth/staff";
import { formatThaiDateTime } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { type ModuleKey, defaultModuleState, moduleCatalog } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { adminNavItems } from "@/lib/nav";

import { setModuleEnabled } from "./actions";

type PageProps = {
  searchParams: Promise<{ bypass?: string; module?: string; status?: string }>;
};

const icons: Record<ModuleKey, (typeof appIcons)[keyof typeof appIcons]> = {
  events: appIcons.events,
  lessons: appIcons.lessons,
  news: appIcons.news,
  scores: appIcons.scores,
};

const statusMessages: Record<string, string> = {
  "invalid-module": "ไม่พบโมดูลที่เลือก",
  "module-closed": "ปิดโมดูลแล้ว สมาชิกจะไม่เห็นเมนูนี้ ผู้ดูแลยังเตรียมข้อมูลได้ตามปกติ",
  "module-opened": "เปิดโมดูลให้สมาชิกใช้แล้ว",
  "module-update-failed": "บันทึกไม่สำเร็จ เฉพาะเจ้าของระบบหรือผู้ดูแลชมรมที่เปิด/ปิดโมดูลได้",
};

/** "/admin/lessons" → the menu name of that page, e.g. "ตารางเรียน". */
function adminPageName(path: string) {
  return adminNavItems.find((item) => item.href === path)?.label ?? path;
}

export default async function AdminSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/settings",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("settings", access);

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
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen px-4 py-6 text-ink">
      <section className="mx-auto w-full max-w-7xl">
        <PageHeader
          description="เลือกว่าสมาชิกเห็นเมนูไหนบ้าง โมดูลที่ปิด สมาชิกจะไม่เห็น แต่ผู้ดูแลยังเตรียมข้อมูลล่วงหน้าได้"
          title="เปิด/ปิดโมดูล"
        />

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={params.status === "module-closed" ? "warning" : toneForStatus(params.status)}>
            {statusMessage}
          </StatusBanner>
        ) : null}

        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">
            โหมดทดลอง: แสดงค่าเริ่มต้น กดเปลี่ยนไม่ได้
          </StatusBanner>
        ) : !canManage ? (
          <StatusBanner className="mt-5" tone="info">
            ดูได้อย่างเดียว เฉพาะเจ้าของระบบหรือผู้ดูแลชมรมที่เปิด/ปิดโมดูลได้
          </StatusBanner>
        ) : null}

        <ul className="mt-6 grid gap-3">
          {moduleCatalog.map((item) => {
            const Icon = icons[item.key];
            const enabled = modules[item.key];
            const highlighted = params.module === item.key;
            const changedAt = lastChange.get(item.key);

            return (
              <li
                className={`flex flex-col gap-4 rounded-xl border bg-white p-5 shadow-card sm:flex-row sm:items-center sm:justify-between ${highlighted ? "border-brand-600 ring-4 ring-brand-600/10" : "border-line"}`}
                key={item.key}
              >
                <div className="flex min-w-0 items-start gap-4">
                  <span
                    className={`flex size-11 shrink-0 items-center justify-center rounded-lg ${enabled ? "bg-brand-50 text-brand-600" : "bg-canvas text-ink-subtle"}`}
                  >
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-h3 font-semibold text-ink">{item.label}</h2>
                      <StatusBadge kind="module" status={enabled ? "on" : "off"}>
                        {enabled ? "สมาชิกใช้ได้" : "ปิดอยู่"}
                      </StatusBadge>
                    </div>
                    <p className="mt-1 text-sm text-ink-muted">{item.description}</p>
                    <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-subtle">
                      {item.adminPaths.map((path) => (
                        <Link
                          className="font-medium text-brand-600 underline-offset-2 hover:underline"
                          href={`${path}${bypassQuery}`}
                          key={path}
                        >
                          จัดการที่หน้า{adminPageName(path)}
                        </Link>
                      ))}
                      <span>{changedAt ? `เปลี่ยนล่าสุด ${formatThaiDateTime(changedAt)}` : "ยังไม่เคยเปลี่ยน"}</span>
                    </p>
                  </div>
                </div>

                <form action={setModuleEnabled} className="shrink-0 self-end sm:self-center">
                  <input name="module" type="hidden" value={item.key} />
                  <input name="enabled" type="hidden" value={enabled ? "false" : "true"} />
                  <SettingsModuleSwitch disabled={!canManage} enabled={enabled} label={item.label} />
                </form>
              </li>
            );
          })}
          <li className="flex flex-col gap-1 rounded-xl border border-line bg-canvas p-5 text-sm text-ink-muted">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-h3 font-semibold text-ink">ส่วนหลัก</h2>
              <StatusBadge tone="success">เปิดตลอด</StatusBadge>
            </div>
            <p>บัญชีสมาชิก การยืนยันกับฐานสมาชิกสมาคม และข้อมูลส่วนตัว ปิดไม่ได้</p>
          </li>
        </ul>

        <MembershipSettingsCard canManage={canManage} clubId={access.clubId} isBypass={access.isBypass} status={params.status} />

        <div className="mt-8">
          <PaymentSettingsSection clubId={access.clubId} isBypass={access.isBypass} returnTo="/admin/settings" status={params.status} />
        </div>
      </section>
    </main>
  );
}
