"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";

import { requireStaffClub } from "@/lib/auth/staff";
import { getClubModules } from "@/lib/modules-server";
import { isModuleKey } from "@/lib/modules";

/** Only club owners/admins may open or close member-facing modules. */
const moduleAdminRoles = ["platform_owner", "club_admin"];

export async function setModuleEnabled(formData: FormData) {
  const key = String(formData.get("module") ?? "");
  const enabled = formData.get("enabled") === "true";

  if (!isModuleKey(key)) {
    redirect("/admin/settings?status=invalid-module");
  }

  const staff = await requireStaffClub(moduleAdminRoles, "/admin/settings");
  const before = await getClubModules(staff.supabase, staff.clubId);

  const { error } = await staff.supabase.from("club_modules").upsert(
    { club_id: staff.clubId, enabled, module_key: key, updated_by: staff.userId },
    { onConflict: "club_id,module_key" },
  );

  if (error) {
    redirect("/admin/settings?status=module-update-failed");
  }

  await staff.supabase.from("audit_logs").insert({
    action: enabled ? "club_module.opened" : "club_module.closed",
    actor_user_id: staff.userId,
    after_data: { enabled, module_key: key },
    before_data: { enabled: before[key], module_key: key },
    club_id: staff.clubId,
    entity_id: null,
    entity_type: "club_modules",
    metadata: { source: "admin.settings" },
  });

  redirect(`/admin/settings?status=${enabled ? "module-opened" : "module-closed"}&module=${key}`);
}
