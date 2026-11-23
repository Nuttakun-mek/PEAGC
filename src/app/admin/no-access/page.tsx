import Link from "next/link";
import { ShieldAlert } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { card } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { getSessionRoleKeys } from "@/lib/auth/admin-area";
import { type AdminArea, adminAreas } from "@/lib/auth/roles";
import { appIcons } from "@/lib/icons";
import { roleLabels } from "@/lib/labels";
import { adminNav, filterNavForRoles } from "@/lib/nav";

export const metadata = { title: "ไม่มีสิทธิ์เปิดหน้านี้" };

const areaNames: Record<AdminArea, string> = {
  audit: "บันทึกการแก้ไข",
  content: "ข่าวและรางวัล",
  dashboard: "ภาพรวมวันนี้",
  directory: "ฐานสมาชิกสมาคม",
  events: "กิจกรรมออกรอบ",
  lessons: "ตารางเรียน",
  members: "รายชื่อสมาชิก",
  payments: "ตรวจสลิป",
  points: "แต้มสะสม",
  reports: "รายงาน",
  settings: "เปิด/ปิดโมดูล",
};

const areaLink =
  "flex h-11 w-full items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-medium text-brand-600 transition hover:border-brand-600 hover:bg-brand-50";

type PageProps = { searchParams: Promise<{ area?: string; bypass?: string }> };

/** Where requireAdminArea sends staff whose roles do not include the page they opened. */
export default async function NoAccessPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: "/admin/no-access", requiredRole: "admin", searchParams: params });
  const area = (adminAreas as readonly string[]).includes(params.area ?? "") ? (params.area as AdminArea) : null;
  const roleKeys = access.isBypass ? ["finance_officer"] : await getSessionRoleKeys(access.clubId);
  const items = filterNavForRoles(adminNav, roleKeys).flatMap((group) => group.items);
  const roles = roleKeys.map((key) => roleLabels[key] ?? key).join(", ");

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-3xl">
        <PageHeader title="ไม่มีสิทธิ์เปิดหน้านี้" />
        <section className={`${card} mt-6`}>
          <p className="flex items-start gap-3 text-base text-ink">
            <ShieldAlert className="mt-1 size-5 shrink-0 text-warning" aria-hidden="true" />
            <span>
              {area ? <>หน้า &quot;{areaNames[area]}&quot; </> : "หน้านี้ "}
              เปิดได้เฉพาะบทบาทที่ดูแลงานนั้น บัญชีนี้เป็น {roles || "ผู้ใช้งาน"} หากต้องใช้หน้านี้ ให้ผู้ดูแลชมรมเพิ่มบทบาทให้
            </span>
          </p>
          {items.length ? (
            <>
              <h2 className="mt-6 text-sm font-medium text-ink-muted">หน้าที่เปิดได้</h2>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {items.map((item) => {
                  const Icon = appIcons[item.icon];
                  return (
                    <li key={item.href}>
                      <Link className={areaLink} href={access.isBypass ? `${item.href}?bypass=admin` : item.href}>
                        <Icon className="size-4" aria-hidden="true" />
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </main>
  );
}
