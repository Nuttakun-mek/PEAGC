import Link from "next/link";
import { KeyRound, LogOut } from "lucide-react";

import { signOut } from "@/app/actions/auth";
import { AdminNav, type NavBadges } from "@/components/admin-nav";
import { EnvBadge } from "@/components/env-badge";
import { PlatformCommandPalette } from "@/components/platform-command-palette";
import { PlatformHeaderSearch } from "@/components/platform-header-search";
import { PlatformOpenHash } from "@/components/platform-open-hash";
import { canAccessArea, isAdminRole } from "@/lib/auth/roles";
import { getSessionIdentity, getSessionRoles, getSessionUser, resolveDisplayName } from "@/lib/auth/session";
import { roleLabels } from "@/lib/labels";
import { type ModuleState, defaultModuleState, modulesForPath } from "@/lib/modules";
import { getClubModules } from "@/lib/modules-server";
import { adminNav, filterNavForRoles, tabBarForRoles } from "@/lib/nav";
import { paletteEntriesFor, paletteScopesFor } from "@/lib/palette";
import { logDbError } from "@/lib/supabase/errors";
import { hasSupabasePublicConfig } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

type StaffUser = { clubId: string | null; name: string; role: string; roleKeys: string[] };

/** Signed-in staff member: name, main role label and the role keys of their club. */
async function loadUser(): Promise<StaffUser | null> {
  if (!hasSupabasePublicConfig()) return null;
  try {
    const user = await getSessionUser();
    if (!user) return null;
    const [identity, roles] = await Promise.all([getSessionIdentity(user.id), getSessionRoles(user.id)]);
    const primary = roles.find((item) => isAdminRole(item.role_key));
    const clubId = primary?.club_id ?? null;
    const roleKeys = roles.filter((item) => !clubId || item.club_id === clubId).map((item) => item.role_key);
    const role = primary?.role_key ?? roles[0]?.role_key;
    return { clubId, name: resolveDisplayName(identity, user), role: role ? (roleLabels[role] ?? role) : "ผู้ใช้งาน", roleKeys };
  } catch {
    return null;
  }
}

/** Module switches and the menu's pending-work counts (only the counts this person may act on). */
async function loadClubState(user: StaffUser | null): Promise<{ badges: NavBadges; modules: ModuleState }> {
  const empty = { badges: {}, modules: defaultModuleState };
  if (!user?.clubId) return empty;
  try {
    const supabase = await createClient();
    const clubId = user.clubId;
    const head = { count: "exact", head: true } as const;
    const seesSlips = canAccessArea(user.roleKeys, "payments");
    const seesMembers = canAccessArea(user.roleKeys, "members");
    const [modules, slips, members] = await Promise.all([
      getClubModules(supabase, clubId),
      // Same scope as the dashboard and the payments page: a slip is attached and not yet decided.
      seesSlips
        ? supabase.from("payment_records").select("id", head).eq("club_id", clubId).in("status", ["pending", "review"]).not("slip_file_id", "is", null)
        : null,
      seesMembers
        ? supabase.from("members").select("id", head).eq("club_id", clubId).eq("status", "pending_verification").is("archived_at", null)
        : null,
    ]);
    if (slips?.error) logDbError("admin.layout pending slips", slips.error);
    if (members?.error) logDbError("admin.layout pending members", members.error);
    return { badges: { pendingMembers: members?.count ?? 0, pendingSlips: slips?.count ?? 0 }, modules };
  } catch {
    return empty;
  }
}

/** A nav item is "closed" when every module behind that page is closed to members. */
function isClosed(href: string, modules: ModuleState) {
  const keys = modulesForPath(href);
  return keys.length > 0 && keys.every((key) => !modules[key]);
}

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const user = await loadUser();
  const { badges, modules } = await loadClubState(user);
  // No signed-in staff (bypass preview, missing config): keep the full menu; pages guard access.
  const roleKeys = user?.roleKeys.some(isAdminRole) ? user.roleKeys : null;
  const nav = filterNavForRoles(adminNav, roleKeys);
  const tabBar = tabBarForRoles(roleKeys);
  const closed = nav.flatMap((group) => group.items.map((item) => item.href)).filter((href) => isClosed(href, modules));
  const scopes = paletteScopesFor(roleKeys);

  const userCard = user ? (
    <div className="mb-2 flex items-center gap-3 rounded-lg bg-canvas px-3 py-2.5">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-600">
        {user.name.trim().charAt(0) || "ผ"}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold text-ink">{user.name}</span>
        <span className="block truncate text-xs text-ink-subtle">{user.role}</span>
      </span>
    </div>
  ) : null;

  const footer = (
    <div className="grid gap-1">
      <Link
        className="flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink-muted transition hover:bg-brand-50 hover:text-brand-600"
        href="/account/password"
      >
        <KeyRound className="size-4" aria-hidden="true" />
        เปลี่ยนรหัสผ่าน
      </Link>
      <form action={signOut}>
        <button className="flex h-10 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium text-ink-muted transition hover:bg-danger-bg hover:text-danger" type="submit">
          <LogOut className="size-4" aria-hidden="true" />
          ออกจากระบบ
        </button>
      </form>
    </div>
  );

  return (
    <div className="min-h-screen bg-canvas lg:flex">
      <a className="skip-link" href="#main-content">
        ข้ามไปยังเนื้อหา
      </a>
      <AdminNav badges={badges} closed={closed} footer={footer} nav={nav} tabBar={tabBar} userCard={userCard} />

      {/* Bottom padding on phones keeps the last row clear of the tab bar. */}
      <div className="min-w-0 flex-1 pb-20 lg:pb-0">
        <header className="app-topbar sticky top-0 z-30 hidden h-16 items-center gap-4 px-6 lg:flex">
          <PlatformHeaderSearch memberSearch={scopes.members} />
          <EnvBadge className="ml-auto" />
        </header>
        <div className="outline-none" id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>

      <PlatformCommandPalette entries={paletteEntriesFor(nav, roleKeys)} scopes={scopes} />
      <PlatformOpenHash />
    </div>
  );
}
