"use server";

import { redirectAfterAction as redirect } from "@/lib/navigation";
import { createAdminClient } from "@/lib/supabase/admin";
import { failureStatus, logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";
import { anyCorruptedText } from "@/lib/text-integrity";

const roles = ["platform_owner", "club_admin", "committee"];
const value = (data: FormData, key: string) => String(data.get(key) ?? "").trim();
const go = (status: string, anchor = ""): never => redirect(`/admin/content?status=${encodeURIComponent(status)}${anchor ? `#${anchor}` : ""}`);

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/admin/content");
  const { data: role } = await supabase.from("user_roles").select("club_id").eq("user_id", user.id).in("role_key", roles).limit(1).maybeSingle();
  if (!role) redirect("/member?status=admin-required");
  return { admin: createAdminClient(), clubId: role.club_id as string, userId: user.id };
}

export async function saveAnnouncement(formData: FormData) {
  const { admin, clubId, userId } = await requireAdmin();
  const id = value(formData, "id");
  const title = value(formData, "title");
  if (!title) go("announcement-missing");
  const summary = value(formData, "summary");
  const category = value(formData, "category");
  if (anyCorruptedText([title, summary, category])) go("text-corrupted");
  const status = value(formData, "status") === "draft" ? "draft" : "published";
  const payload = { club_id: clubId, title, summary: summary || null, category: category || "ทั่วไป", is_pinned: formData.get("isPinned") === "on", status, updated_by: userId };
  // Read the row back so an edit that matched nothing is reported instead of "saved".
  const result = id
    ? await admin.from("club_announcements").update(payload).eq("id", id).eq("club_id", clubId).select("id").maybeSingle()
    : await admin.from("club_announcements").insert({ ...payload, created_by: userId }).select("id").single();
  const savedId = result.data?.id;
  if (result.error || !savedId) {
    logDbError("club_announcements.save", result.error);
    return go(failureStatus("announcement-failed", result.error));
  }
  go("announcement-saved", `announcement-${savedId}`);
}

export async function archiveAnnouncement(formData: FormData) {
  const { admin, clubId, userId } = await requireAdmin();
  const id = value(formData, "id");
  if (!id) go("announcement-failed");
  const { data, error } = await admin.from("club_announcements").update({ status: "archived", updated_by: userId }).eq("id", id).eq("club_id", clubId).select("id").maybeSingle();
  if (error || !data) {
    logDbError("club_announcements.archive", error);
    go(failureStatus("announcement-failed", error));
  }
  go("announcement-archived");
}

// Scorecards are no longer written here: entering scores overwrote golf_hole_scores in place.
// Scoring now lives in /admin/events/[eventId]/scoring (append-only entries -> verify -> publish).

export async function createAward(formData: FormData) {
  const { admin, clubId, userId } = await requireAdmin();
  const memberId = value(formData, "memberId");
  const title = value(formData, "title");
  const awardedAt = value(formData, "awardedAt");
  if (!memberId || !title || !awardedAt) go("award-missing");
  if (anyCorruptedText([title, value(formData, "awardType"), value(formData, "note")])) go("text-corrupted");
  const { error } = await admin.from("member_awards").insert({ awarded_at: awardedAt, award_type: value(formData, "awardType") || "achievement", club_id: clubId, created_by: userId, event_id: value(formData, "eventId") || null, member_id: memberId, note: value(formData, "note") || null, title });
  if (error) {
    logDbError("member_awards.create", error);
    go(failureStatus("award-failed", error));
  }
  go("award-saved");
}

export async function deleteAward(formData: FormData) {
  const { admin, clubId } = await requireAdmin();
  const { error } = await admin.from("member_awards").delete().eq("id", value(formData, "id")).eq("club_id", clubId);
  if (error) {
    logDbError("member_awards.delete", error);
    go(failureStatus("award-failed", error));
  }
  go("award-deleted");
}
