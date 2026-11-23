"use server";

import { getSessionUser } from "@/lib/auth/session";
import { requireModuleOpen } from "@/lib/modules-server";
import { redirectAfterAction as redirect } from "@/lib/navigation";
import { logDbError } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

// Member actions from the member page's scores section: confirm a scorecard (as the player, or as
// the marker of a group-mate's card) and keep one's own "Handicap Index ทางการ".

function str(formData: FormData, key: string) {
  return String(formData.get(key) ?? "").trim();
}

async function requireMember() {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/member%23scores");
  const supabase = await createClient();
  const { data: member } = await supabase
    .from("members")
    .select("id, club_id, status")
    .eq("user_id", user.id)
    .is("archived_at", null)
    .maybeSingle();
  if (!member) redirect("/member");
  return { member, supabase };
}

const confirmStatus: Record<string, string> = {
  COMPETITION_LOCKED: "score-confirm-closed",
  ENTRY_SUPERSEDED: "score-confirm-superseded",
  NOT_ALLOWED: "score-confirm-denied",
  PLAYER_NOT_CONFIRMED: "score-confirm-player-first",
};

export async function confirmMyScoreCard(formData: FormData) {
  const entryId = str(formData, "entryId");
  const role = str(formData, "role") === "marker" ? "marker" : "player";
  const { member, supabase } = await requireMember();
  await requireModuleOpen(supabase, member.club_id, "scores");

  const { data, error } = await supabase.rpc("confirm_score_entry", { p_entry_id: entryId, p_role: role });
  if (error) {
    logDbError("member.confirm_score", error);
    const code = (error.message ?? "").match(/[A-Z_]{6,}/)?.[0];
    redirect(`/member?status=${(code && confirmStatus[code]) || "score-confirm-failed"}#scores`);
  }
  const verified = Boolean((data as { verified?: boolean } | null)?.verified);
  redirect(`/member?status=${verified ? "score-verified" : role === "player" ? "score-confirmed" : "score-marked"}#scores`);
}

export async function saveMyOfficialHandicap(formData: FormData) {
  // "+1.5" is a plus handicap, stored as -1.5.
  const raw = str(formData, "officialIndex").replace(/^\+/, "-");
  const value = raw ? Number(raw) : null;
  if (value !== null && (!Number.isFinite(value) || value < -10 || value > 54)) redirect("/member?status=handicap-invalid#scores");
  const { member, supabase } = await requireMember();

  const { error } = await supabase.rpc("set_official_handicap_index", { p_index: value, p_member_id: member.id });
  if (error) {
    logDbError("member.official_index", error);
    redirect("/member?status=handicap-failed#scores");
  }
  redirect("/member?status=handicap-saved#scores");
}
