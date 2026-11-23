"use server";

import { recordAudit } from "@/lib/audit";
import { requireStaffClub } from "@/lib/auth/staff";
import { membershipSettingsColumns, parseMembershipSettingsForm } from "@/lib/membership/settings";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { failureStatus, logDbError } from "@/lib/supabase/errors";

/** Club membership settings (auto-approve, annual fee, notice and grace days). Owners and club admins only. */
export async function saveMembershipSettings(formData: FormData) {
  const { clubId, supabase, userId } = await requireStaffClub(["platform_owner", "club_admin"], "/admin/settings");
  const parsed = parseMembershipSettingsForm(formData);
  if (!parsed.values) {
    redirect(`/admin/settings?status=${parsed.error}#membership`);
  }

  const { data: before } = await supabase
    .from("club_membership_settings")
    .select(membershipSettingsColumns)
    .eq("club_id", clubId)
    .maybeSingle();

  const { error } = await supabase
    .from("club_membership_settings")
    .upsert({ ...parsed.values, club_id: clubId, updated_by: userId }, { onConflict: "club_id" });
  if (error) {
    logDbError("club_membership_settings.save", error);
    redirect(`/admin/settings?status=${failureStatus("membership-settings-failed", error)}#membership`);
  }

  await recordAudit(supabase, {
    action: "membership_settings.updated",
    actorUserId: userId,
    after: parsed.values,
    before,
    clubId,
    entityId: clubId,
    entityType: "club_membership_settings",
    metadata: { source: "admin.settings" },
  });

  redirect("/admin/settings?status=membership-settings-saved#membership");
}
