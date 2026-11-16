import Link from "next/link";
import { ExternalLink, KeyRound, LogOut, Search } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { AdminNav } from "@/components/admin-nav";
import { getSessionIdentity, getSessionRoles, getSessionUser, resolveDisplayName } from "@/lib/auth/session";
import { getStaffClub } from "@/lib/auth/staff";
import { roleLabels } from "@/lib/labels";
import { type ModuleState, defaultModuleState, modulesForPath } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";

const navHrefs = [
  "/admin",
  "/admin/members",
  "/admin/employees",
  "/admin/events",
  "/admin/lessons",
  "/admin/payments",
  "/admin/content",
  "/admin/reports",
  "/admin/settings",
];

const staffRoles = [
  "platform_owner",
  "club_admin",
  "committee",
  "finance_officer",
  "tournament_director",
  "scoring_officer",
];

async function loadModules(): Promise<ModuleState> {
  if (!hasSupabasePublicConfig()) return defaultModuleState;
  try {
    const staff = await getStaffClub(staffRoles);
    return staff.status === "ok" ? await getClubModules(staff.supabase, staff.clubId) : defaultModuleState;
  } catch {
    return defaultModuleState;
  }
}

async function loadUser() {
  if (!hasSupabasePublicConfig()) return null;
  try {
    const user = await getSessionUser();
    if (!user) return null;
    const [identity, roles] = await Promise.all([getSessionIdentity(user.id), getSessionRoles(user.id)]);
    const role = roles.find((item) => staffRoles.includes(item.role_key))?.role_key ?? roles[0]?.role_key;
    return { name: resolveDisplayName(identity, user), role: role ? (roleLabels[role] ?? role) : "ผู้ใช้งาน" };
  } catch {
    return null;
  }
}

/** A nav item is "closed" when every module behind that page is closed to members. */
function isClosed(href: string, modules: ModuleState) {
  const keys = modulesForPath(href);
  return keys.length > 0 && keys.every((key) => !modules[key]);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const [modules, user] = await Promise.all([loadModules(), loadUser()]);
  const closed = navHrefs.filter((href) => isClosed(href, modules));

  const userCard = user ? (
    <div className="mb-2 flex items-center gap-3 rounded-lg bg-[#f8f9fb] px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#f8edf4] text-sm font-bold text-[#722257]">
        {user.name.trim().charAt(0) || "ผ"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-[#344054]">{user.name}</span>
        <span className="block truncate text-xs text-[#667085]">{user.role}</span>
      </span>
    </div>
  ) : null;

  const footer = (
    <div className="grid gap-1">
      <Link
        className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-semibold text-[#667085] transition hover:bg-[#f8edf4] hover:text-[#722257]"
        href="/account/password"
      >
        <KeyRound className="size-4" aria-hidden="true" />
        เปลี่ยนรหัสผ่าน
      </Link>
      <form action={signOut}>
        <button className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold text-[#667085] transition hover:bg-[#fdecec] hover:text-[#b42318]" type="submit">
          <LogOut className="size-4" aria-hidden="true" />
          ออกจากระบบ
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f2f5f8] lg:flex">
      <AdminNav closed={closed} footer={footer} userCard={userCard} />

      <div className="min-w-0 flex-1">
        <header className="app-topbar sticky top-0 z-30 hidden h-16 items-center justify-between gap-4 px-6 lg:flex">
          <form action="/admin/members" className="relative w-full max-w-md" role="search">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#98a2b3]" aria-hidden="true" />
            <input
              aria-label="ค้นหาสมาชิก"
              className="h-10 w-full rounded-lg border border-[#e2e8ef] bg-[#f8fafc] pl-9 pr-3 text-sm outline-none transition focus:border-[#722257] focus:bg-white focus:ring-4 focus:ring-[#722257]/10"
              name="q"
              placeholder="ค้นหาสมาชิก: ชื่อ เลขสมาชิก รหัสพนักงาน หรือเบอร์โทร"
              type="search"
            />
          </form>
          <Link
            className="flex h-10 shrink-0 items-center gap-2 rounded-lg border border-[#e2e8ef] bg-white px-3 text-sm font-semibold text-[#475467] transition hover:border-[#c9b3c2] hover:text-[#722257]"
            href="/member"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            ดูหน้าสมาชิก
          </Link>
        </header>
        {children}
      </div>
    </div>
  );
}
