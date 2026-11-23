import Link from "next/link";
import { Pin } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { buttonClass, buttonPrimary, fieldInput, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { formatThaiDateShort, orUnset } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { announcementStatusLabels, labelFor } from "@/lib/labels";
import { collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

import { archiveAnnouncement, createAward, deleteAward, saveAnnouncement } from "./actions";

const messages: Record<string, string> = {
  ...dbFailureMessages,
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่ก่อนบันทึก",
  "announcement-archived": "ลบข่าวออกจากรายการแล้ว สมาชิกจะไม่เห็นข่าวนี้อีก",
  "announcement-failed": "บันทึกข่าวไม่สำเร็จ",
  "announcement-missing": "กรุณากรอกหัวข้อข่าว",
  "announcement-saved": "บันทึกข่าวแล้ว",
  "award-deleted": "ลบรางวัลแล้ว",
  "award-failed": "บันทึกรางวัลไม่สำเร็จ",
  "award-missing": "กรุณากรอกข้อมูลรางวัลให้ครบ",
  "award-saved": "บันทึกรางวัลแล้ว",
  "score-failed": "บันทึกคะแนนไม่สำเร็จ",
  "score-invalid": "กรุณากรอกพาร์ 3-6 และสกอร์ 1-20 ให้ครบ 18 หลุม",
  "score-registration-missing": "กรุณาเลือกผู้สมัคร",
  "score-saved": "บันทึกสกอร์การ์ด 18 หลุมแล้ว",
};

function first<T>(value: T | T[] | null) {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

const Required = () => (
  <span aria-hidden="true" className="text-danger">
    {" "}*
  </span>
);

/** Fields shared by "add news" and "edit news" (same names the action reads). */
function AnnouncementFields({
  idPrefix,
  item,
}: {
  idPrefix: string;
  item?: { category: string | null; is_pinned: boolean; status: string; summary: string | null; title: string };
}) {
  return (
    <>
      <div>
        <label className={fieldLabel} htmlFor={`${idPrefix}-title`}>
          หัวข้อ<Required />
        </label>
        <input className={fieldInput} defaultValue={item?.title} id={`${idPrefix}-title`} name="title" required />
      </div>
      <div>
        <label className={fieldLabel} htmlFor={`${idPrefix}-summary`}>
          รายละเอียด
        </label>
        <textarea className={fieldTextarea} defaultValue={item?.summary ?? ""} id={`${idPrefix}-summary`} name="summary" />
      </div>
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
        <div>
          <label className={fieldLabel} htmlFor={`${idPrefix}-category`}>
            หมวดหมู่
          </label>
          <input className={fieldInput} defaultValue={item?.category ?? ""} id={`${idPrefix}-category`} name="category" placeholder="เช่น ข่าวชมรม, ผลการแข่งขัน" />
        </div>
        <div>
          <label className={fieldLabel} htmlFor={`${idPrefix}-status`}>
            สถานะ
          </label>
          <select className={fieldInput} defaultValue={item?.status === "draft" ? "draft" : "published"} id={`${idPrefix}-status`} name="status">
            <option value="published">เผยแพร่</option>
            <option value="draft">ฉบับร่าง</option>
          </select>
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm font-medium text-ink-muted">
        <input className="size-4" defaultChecked={item?.is_pinned} name="isPinned" type="checkbox" />
        ปักหมุดไว้บนสุด
      </label>
    </>
  );
}

export default async function AdminContentPage({ searchParams }: { searchParams: Promise<{ bypass?: string; status?: string }> }) {
  const params = await searchParams;
  const access = await resolveAccess({ nextPath: "/admin/content", requiredRole: "admin", searchParams: params });
  await requireAdminArea("content", access);
  const supabase = await createClient();
  const [
    { data: announcements, error: announcementsError },
    { data: members, error: membersError },
    { data: events, error: eventsError },
    { data: awards, error: awardsError },
  ] = await Promise.all([
    supabase.from("club_announcements").select("id,title,summary,category,is_pinned,status,published_at").eq("club_id", access.clubId!).neq("status", "archived").order("published_at", { ascending: false }),
    supabase.from("members").select("id,full_name,member_code").eq("club_id", access.clubId!).eq("status", "active").is("archived_at", null).order("full_name"),
    supabase.from("events").select("id,name,event_date").eq("club_id", access.clubId!).is("archived_at", null).order("event_date", { ascending: false }).limit(50),
    supabase.from("member_awards").select("id,title,award_type,awarded_at,members(full_name),events(name)").eq("club_id", access.clubId!).order("awarded_at", { ascending: false }).limit(50),
  ]);
  const loadError = collectLoadErrors("admin.content", [
    { error: announcementsError, label: "ข่าว" },
    { error: membersError, label: "รายชื่อสมาชิก" },
    { error: eventsError, label: "กิจกรรม" },
    { error: awardsError, label: "รางวัล" },
  ]);
  const NewsIcon = appIcons.news;
  const AwardIcon = appIcons.awards;
  const ScoreIcon = appIcons.scores;
  const SaveIcon = appIcons.save;
  const EditIcon = appIcons.edit;
  const DeleteIcon = appIcons.delete;
  const failed = Boolean(params.status && toneForStatus(params.status) === "error");

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <div className="mx-auto w-full max-w-6xl">
        <PageHeader description="สมาชิกเห็นทันทีที่กดเผยแพร่" title="ข่าวและรางวัล" />
        {params.status && messages[params.status] ? (
          <StatusBanner className="mt-4" floating tone={toneForStatus(params.status)}>
            {messages[params.status]}
          </StatusBanner>
        ) : null}
        <LoadErrorBanner className="mt-4" error={loadError} />

        <div className="mt-6 grid gap-5 xl:grid-cols-2">
          <section aria-labelledby="news-title" className="rounded-xl border border-line bg-white p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink" id="news-title">
              <NewsIcon className="size-5 text-brand-600" aria-hidden="true" />
              ข่าวประชาสัมพันธ์
              <span className="text-sm font-medium text-ink-subtle tabular-nums">{announcements?.length ?? 0} เรื่อง</span>
            </h2>

            <CreatePanel defaultOpen={failed && params.status?.startsWith("announcement")} title="เพิ่มข่าว">
              <form action={saveAnnouncement} className="grid gap-4">
                <AnnouncementFields idPrefix="new-announcement" />
                <button className={`${buttonPrimary} w-fit`} type="submit">
                  <SaveIcon className="size-4" aria-hidden="true" />
                  บันทึกข่าว
                </button>
              </form>
            </CreatePanel>

            <ul className="mt-4 divide-y divide-line border-t border-line">
              {announcements?.length ? null : (
                <li className="py-4 text-sm text-ink-muted">ยังไม่มีข่าว กด &quot;เพิ่มข่าว&quot; เพื่อประกาศเรื่องแรก</li>
              )}
              {announcements?.map((item) => (
                <li className="scroll-mt-24" id={`announcement-${item.id}`} key={item.id}>
                  <details className="group py-3">
                    <summary className="flex cursor-pointer list-none items-start justify-between gap-3 rounded-lg">
                      <div className="min-w-0">
                        <p className="flex items-center gap-1.5 font-semibold text-ink">
                          {item.is_pinned ? <Pin className="size-4 shrink-0 text-gold-700" aria-label="ปักหมุด" /> : null}
                          <span className="truncate">{item.title}</span>
                        </p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
                          <StatusBadge kind="announcement" status={item.status}>
                            {labelFor(announcementStatusLabels, item.status)}
                          </StatusBadge>
                          {item.category ? <span>{item.category}</span> : null}
                          {item.published_at ? <span>{formatThaiDateShort(item.published_at)}</span> : null}
                        </p>
                      </div>
                      <span className={`${buttonClass("secondary", "sm")} shrink-0 group-open:bg-brand-50`}>
                        <EditIcon className="size-4" aria-hidden="true" />
                        แก้ไข
                      </span>
                    </summary>
                    <form action={saveAnnouncement} className="mt-3 grid gap-4 rounded-lg border border-line bg-canvas p-4">
                      <input name="id" type="hidden" value={item.id} />
                      <AnnouncementFields idPrefix={`announcement-${item.id}`} item={item} />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <button className={buttonPrimary} type="submit">
                          <SaveIcon className="size-4" aria-hidden="true" />
                          บันทึกการแก้ไข
                        </button>
                      </div>
                    </form>
                    <form action={archiveAnnouncement} className="mt-2 flex justify-end">
                      <input name="id" type="hidden" value={item.id} />
                      <ConfirmSubmitButton className={buttonClass("danger", "sm")} message={`ลบข่าว "${item.title}"? สมาชิกจะไม่เห็นข่าวนี้อีก`} title="ยืนยันลบข่าว">
                        <DeleteIcon className="size-4" aria-hidden="true" />
                        ลบข่าว
                      </ConfirmSubmitButton>
                    </form>
                  </details>
                </li>
              ))}
            </ul>
          </section>

          <section aria-labelledby="awards-title" className="rounded-xl border border-line bg-white p-5 shadow-card">
            <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink" id="awards-title">
              <AwardIcon className="size-5 text-gold-700" aria-hidden="true" />
              รางวัลสมาชิก
              <span className="text-sm font-medium text-ink-subtle tabular-nums">{awards?.length ?? 0} รางวัล</span>
            </h2>

            <CreatePanel defaultOpen={failed && params.status?.startsWith("award")} title="เพิ่มรางวัล">
              <form action={createAward} className="grid gap-4">
                <div>
                  <label className={fieldLabel} htmlFor="award-member">
                    สมาชิก<Required />
                  </label>
                  <select className={fieldInput} id="award-member" name="memberId" required>
                    <option value="">เลือกสมาชิก</option>
                    {members?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} ({m.member_code})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className={fieldLabel} htmlFor="award-title">
                    ชื่อรางวัล<Required />
                  </label>
                  <input className={fieldInput} id="award-title" name="title" placeholder="เช่น ชนะเลิศประเภท A" required />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={fieldLabel} htmlFor="award-event">
                      กิจกรรม
                    </label>
                    <select className={fieldInput} id="award-event" name="eventId">
                      <option value="">ไม่ผูกกับกิจกรรม</option>
                      {events?.map((e) => (
                        <option key={e.id} value={e.id}>
                          {e.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="award-date">
                      วันที่ได้รับ<Required />
                    </label>
                    <input className={fieldInput} id="award-date" name="awardedAt" required type="date" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className={fieldLabel} htmlFor="award-type">
                      ประเภทรางวัล
                    </label>
                    <input className={fieldInput} id="award-type" name="awardType" placeholder="เช่น ชนะเลิศ, Best Gross" />
                  </div>
                  <div>
                    <label className={fieldLabel} htmlFor="award-note">
                      หมายเหตุ
                    </label>
                    <input className={fieldInput} id="award-note" name="note" />
                  </div>
                </div>
                <button className={`${buttonPrimary} w-fit`} type="submit">
                  <SaveIcon className="size-4" aria-hidden="true" />
                  บันทึกรางวัล
                </button>
              </form>
            </CreatePanel>

            <ul className="mt-4 divide-y divide-line border-t border-line">
              {awards?.length ? null : <li className="py-4 text-sm text-ink-muted">ยังไม่มีรางวัล กด &quot;เพิ่มรางวัล&quot; หลังประกาศผลกิจกรรม</li>}
              {awards?.map((item) => (
                <li className="flex items-start justify-between gap-3 py-3" key={item.id}>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{item.title}</p>
                    <p className="mt-0.5 text-sm text-ink-muted">
                      {orUnset(first(item.members)?.full_name)}
                      {first(item.events)?.name || item.award_type ? ` · ${first(item.events)?.name ?? item.award_type}` : ""}
                    </p>
                    {item.awarded_at ? <p className="text-xs text-ink-subtle">{formatThaiDateShort(item.awarded_at)}</p> : null}
                  </div>
                  <form action={deleteAward}>
                    <input name="id" type="hidden" value={item.id} />
                    <ConfirmSubmitButton className={buttonClass("danger", "sm")} message={`ลบรางวัล "${item.title}"?`} title="ยืนยันลบรางวัล">
                      <DeleteIcon className="size-4" aria-hidden="true" />
                      ลบ
                    </ConfirmSubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <section aria-labelledby="scores-title" className="mt-5 rounded-xl border border-line bg-white p-5 shadow-card">
          <h2 className="flex items-center gap-2 text-h2 font-semibold text-ink" id="scores-title">
            <ScoreIcon className="size-5 text-brand-600" aria-hidden="true" />
            สกอร์การแข่งขัน
          </h2>
          <p className="mt-1 text-sm text-ink-muted">กรอกสกอร์ อ่านสกอร์การ์ด ยืนยัน และประกาศผล ในหน้าสกอร์ของแต่ละกิจกรรม ทุกการ์ดเก็บเป็นประวัติ ไม่แก้ทับ</p>
          {events?.length ? (
            <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {events.slice(0, 12).map((event) => (
                <li key={event.id}>
                  <Link
                    className="flex items-center justify-between gap-3 rounded-lg border border-line px-3 py-2.5 text-sm transition hover:border-brand-600 hover:bg-brand-50"
                    href={`/admin/events/${event.id}/scoring`}
                  >
                    <span className="min-w-0 truncate font-medium text-ink">{event.name}</span>
                    <span className="shrink-0 text-xs text-ink-subtle">{formatThaiDateShort(event.event_date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">
              ยังไม่มีกิจกรรม{" "}
              <Link className="font-semibold text-brand-600 hover:underline" href="/admin/events">
                สร้างกิจกรรมออกรอบ
              </Link>
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
