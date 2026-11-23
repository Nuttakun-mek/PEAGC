import "server-only";

import { saveMyOfficialHandicap } from "@/app/events/actions";
import { SubmitButton } from "@/components/submit-button";
import { buttonClass, fieldHint, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { formatThaiDate } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { loadClubHandicaps } from "@/lib/scoring/club-handicap";
import { MIN_ROUNDS_FOR_INDEX, formatHandicap } from "@/lib/scoring/handicap";
import { createAdminClient } from "@/lib/supabase/admin";
import { logDbError } from "@/lib/supabase/errors";

/**
 * แต้มต่อชมรม (computed from the member's verified rounds) next to the member's own
 * "Handicap Index ทางการ", which they can enter or clear. Hidden when the database is not updated.
 */
export async function EventsMemberHandicap({
  clubId,
  isBypass,
  manualHandicap,
  memberId,
}: {
  clubId: string | null | undefined;
  isBypass: boolean;
  manualHandicap: number | null | undefined;
  memberId: string | null | undefined;
}) {
  let club: { index: number | null; rounds: number } = { index: 12.4, rounds: 9 };
  let official: number | null = 10.8;
  let officialUpdated: string | null = "2026-10-01T03:00:00Z";

  if (!isBypass) {
    if (!memberId || !clubId || !process.env.SUPABASE_SECRET_KEY) return null;
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("members")
      .select("official_handicap_index, official_handicap_updated_at")
      .eq("id", memberId)
      .maybeSingle();
    if (error) {
      logDbError("member.handicap", error);
      return null;
    }
    official = data?.official_handicap_index ?? null;
    officialUpdated = data?.official_handicap_updated_at ?? null;
    // Scoped to this member's own id, already resolved from the session by the page.
    const handicaps = await loadClubHandicaps(admin, clubId, [{ id: memberId, manual: manualHandicap ?? null }]);
    club = handicaps.get(memberId) ?? { index: null, rounds: 0 };
  }

  const SaveIcon = appIcons.save;
  const missing = Math.max(0, MIN_ROUNDS_FOR_INDEX - club.rounds);

  return (
    <section aria-labelledby="handicap-title" className="mt-6">
      <h3 className="text-base font-semibold text-ink" id="handicap-title">แต้มต่อ</h3>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-canvas px-4 py-3">
          <dt className="text-xs font-medium text-ink-subtle">แต้มต่อชมรม</dt>
          <dd className="mt-0.5">
            <span className="text-kpi font-semibold tabular-nums text-ink">
              {club.index !== null ? formatHandicap(club.index) : manualHandicap !== null && manualHandicap !== undefined ? formatHandicap(manualHandicap) : "–"}
            </span>
            <span className="mt-0.5 block text-sm text-ink-muted">
              {club.index !== null
                ? `คิดจาก ${club.rounds} รอบที่ยืนยันแล้ว (8 รอบดีที่สุดจาก 20 รอบล่าสุด)`
                : `ค่าที่ชมรมตั้งไว้ · ต้องมีรอบที่นับได้อีก ${missing} รอบจึงคิดจากสกอร์`}
            </span>
          </dd>
        </div>
        <div className="rounded-lg bg-canvas px-4 py-3">
          <dt className="text-xs font-medium text-ink-subtle">Handicap Index ทางการ</dt>
          <dd className="mt-0.5">
            <span className="text-kpi font-semibold tabular-nums text-ink">{official !== null ? formatHandicap(official) : "–"}</span>
            <span className="mt-0.5 block text-sm text-ink-muted">
              {official !== null && officialUpdated ? `บันทึกเมื่อ ${formatThaiDate(officialUpdated)}` : "จากสมาคมกอล์ฟที่ออกให้ ถ้ามี"}
            </span>
          </dd>
        </div>
      </dl>
      <form action={saveMyOfficialHandicap} className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="block sm:w-56">
          <span className={fieldLabel}>Handicap Index ทางการ</span>
          <input
            className={`${fieldInputClass("md")} tabular-nums`}
            defaultValue={official !== null ? formatHandicap(official) : ""}
            disabled={isBypass}
            inputMode="decimal"
            name="officialIndex"
            placeholder="เช่น 12.4 (เว้นว่าง = ไม่มี)"
          />
          <span className={fieldHint}>แต้มต่อติดบวกใส่ + นำหน้า เช่น +1.5</span>
        </label>
        <SubmitButton className={buttonClass("secondary", "md")} disabled={isBypass}>
          <SaveIcon className="size-4" aria-hidden="true" />
          บันทึก
        </SubmitButton>
      </form>
    </section>
  );
}
