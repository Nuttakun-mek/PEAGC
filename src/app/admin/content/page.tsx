import { Award, Flag, Megaphone, Pencil, Pin, Save, Trash2 } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { resolveAccess } from "@/lib/auth/access";
import { announcementStatusLabels, labelFor } from "@/lib/labels";
import { collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";
import { createClient } from "@/lib/supabase/server";

import { archiveAnnouncement, createAward, deleteAward, saveAnnouncement } from "./actions";

const messages: Record<string, string> = {
  ...dbFailureMessages,
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) กรุณาพิมพ์ใหม่ก่อนบันทึก",
  "announcement-archived": "ลบประกาศออกจากรายการแล้ว (สมาชิกจะไม่เห็นประกาศนี้อีก)", "announcement-failed": "บันทึกประกาศไม่สำเร็จ", "announcement-missing": "กรุณากรอกหัวข้อประกาศ", "announcement-saved": "บันทึกประกาศแล้ว",
  "award-deleted": "ลบรางวัลแล้ว", "award-failed": "บันทึกรางวัลไม่สำเร็จ", "award-missing": "กรุณากรอกข้อมูลรางวัลให้ครบ", "award-saved": "บันทึกรางวัลแล้ว",
  "score-failed": "บันทึกคะแนนไม่สำเร็จ", "score-invalid": "กรุณากรอกพาร์ 3-6 และสกอร์ 1-20 ให้ครบ 18 หลุม", "score-registration-missing": "กรุณาเลือกผู้สมัคร", "score-saved": "บันทึก Scorecard 18 หลุมแล้ว",
};


function first<T>(value: T | T[] | null) { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function AdminContentPage({ searchParams }: { searchParams: Promise<{ bypass?: string; status?: string }> }) {
  const params = await searchParams;
  const access = await resolveAccess({ nextPath: "/admin/content", requiredRole: "admin", searchParams: params });
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
    { error: announcementsError, label: "ประกาศ" },
    { error: membersError, label: "รายชื่อสมาชิก" },
    { error: eventsError, label: "กิจกรรม" },
    { error: awardsError, label: "รางวัล" },
  ]);
  const inputClass = "h-10 rounded-md border border-[#dce3ea] bg-white px-3 text-sm outline-none focus:border-[#168aad]";
  return <main className="min-h-screen px-4 py-6 text-[#243244]"><div className="mx-auto max-w-[1500px]">
    <div><p className="text-sm font-semibold text-[#168aad]">ศูนย์เนื้อหาและผลการแข่งขัน</p><h1 className="mt-1 text-3xl font-semibold">ข่าว คะแนน และรางวัล</h1><p className="mt-2 text-sm text-[#667085]">ข้อมูลที่บันทึกจะแสดงในหน้าสมาชิกโดยอัตโนมัติ</p></div>
    {params.status && messages[params.status] ? <StatusBanner className="mt-4" floating tone={toneForStatus(params.status)}>{messages[params.status]}</StatusBanner> : null}
    <LoadErrorBanner className="mt-4" error={loadError} />

    <div className="mt-6 grid gap-5 xl:grid-cols-2">
      <section className="rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Megaphone className="size-5 text-[#168aad]"/><h2 className="text-lg font-semibold">สร้างข่าวประชาสัมพันธ์</h2></div>
        <form action={saveAnnouncement} className="mt-4 grid gap-3"><input className={inputClass} name="title" placeholder="หัวข้อประกาศ" required/><textarea className="min-h-24 rounded-md border border-[#dce3ea] p-3 text-sm outline-none focus:border-[#168aad]" name="summary" placeholder="รายละเอียดข่าว"/><div className="grid gap-3 sm:grid-cols-3"><input className={inputClass} name="category" placeholder="หมวดหมู่"/><select className={inputClass} name="status"><option value="published">เผยแพร่</option><option value="draft">ฉบับร่าง</option></select><label className="flex h-10 items-center gap-2 text-sm"><input name="isPinned" type="checkbox"/> ปักหมุด</label></div><button className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#168aad] px-4 text-sm font-semibold text-white"><Save className="size-4"/>บันทึกประกาศ</button></form>
        <div className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3]">
          {announcements?.length ? null : <p className="py-4 text-sm text-[#667085]">ยังไม่มีประกาศ</p>}
          {announcements?.map((item) => (
            <details className="group scroll-mt-24 py-3" id={`announcement-${item.id}`} key={item.id}>
              <summary className="flex cursor-pointer list-none items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold">
                    {item.is_pinned ? <Pin className="size-3.5 shrink-0 text-[#b17b0a]" aria-label="ปักหมุด" /> : null}
                    <span className="truncate">{item.title}</span>
                  </p>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-[#667085]">
                    <span>{item.category}</span>
                    <span className={`rounded px-1.5 py-0.5 font-semibold ${item.status === "draft" ? "bg-[#fff5d8] text-[#805300]" : "bg-[#edf9f3] text-[#16794b]"}`}>
                      {labelFor(announcementStatusLabels, item.status)}
                    </span>
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1 rounded-md border border-[#dce3ea] px-2.5 py-1.5 text-xs font-semibold text-[#168aad] group-open:bg-[#f2f9fc]">
                  <Pencil className="size-3.5" aria-hidden="true" />แก้ไข
                </span>
              </summary>
              <form action={saveAnnouncement} className="mt-3 grid gap-3 rounded-md border border-[#e2e8ef] bg-[#f8fafc] p-3">
                <input name="id" type="hidden" value={item.id} />
                <input className={inputClass} defaultValue={item.title} name="title" placeholder="หัวข้อประกาศ" required />
                <textarea className="min-h-20 rounded-md border border-[#dce3ea] bg-white p-3 text-sm outline-none focus:border-[#168aad]" defaultValue={item.summary ?? ""} name="summary" placeholder="รายละเอียดข่าว" />
                <div className="grid gap-3 sm:grid-cols-3">
                  <input className={inputClass} defaultValue={item.category ?? ""} name="category" placeholder="หมวดหมู่" />
                  <select className={inputClass} defaultValue={item.status === "draft" ? "draft" : "published"} name="status">
                    <option value="published">เผยแพร่</option>
                    <option value="draft">ฉบับร่าง</option>
                  </select>
                  <label className="flex h-10 items-center gap-2 text-sm"><input defaultChecked={item.is_pinned} name="isPinned" type="checkbox" /> ปักหมุด</label>
                </div>
                <button className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#168aad] px-4 text-sm font-semibold text-white"><Save className="size-4" />บันทึกการแก้ไข</button>
              </form>
              <form action={archiveAnnouncement} className="mt-2 flex justify-end">
                <input name="id" type="hidden" value={item.id} />
                <ConfirmSubmitButton className="flex h-9 items-center gap-1.5 rounded-md border border-[#efcbd0] bg-white px-3 text-xs font-semibold text-[#a33a46] hover:bg-[#fff7f7]" message={`ยืนยันลบประกาศ "${item.title}"? สมาชิกจะไม่เห็นประกาศนี้อีก`}>
                  <Trash2 className="size-3.5" aria-hidden="true" />ลบประกาศ
                </ConfirmSubmitButton>
              </form>
            </details>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Award className="size-5 text-[#b17b0a]"/><h2 className="text-lg font-semibold">เพิ่มรางวัลสมาชิก</h2></div>
        <form action={createAward} className="mt-4 grid gap-3"><select className={inputClass} name="memberId" required><option value="">เลือกสมาชิก</option>{members?.map((m) => <option key={m.id} value={m.id}>{m.member_code} · {m.full_name}</option>)}</select><input className={inputClass} name="title" placeholder="ชื่อรางวัล" required/><div className="grid gap-3 sm:grid-cols-2"><select className={inputClass} name="eventId"><option value="">ไม่ผูกกิจกรรม</option>{events?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select><input className={inputClass} name="awardedAt" required type="date"/></div><input className={inputClass} name="awardType" placeholder="ประเภทรางวัล เช่น ชนะเลิศ"/><input className={inputClass} name="note" placeholder="หมายเหตุ"/><button className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#C69214] px-4 text-sm font-semibold text-white"><Save className="size-4"/>บันทึกรางวัล</button></form>
        <div className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3]">{awards?.map((item) => <div className="flex items-start justify-between gap-3 py-3" key={item.id}><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-[#667085]">{first(item.members)?.full_name ?? "-"} · {first(item.events)?.name ?? item.award_type}</p></div><form action={deleteAward}><input name="id" type="hidden" value={item.id}/><ConfirmSubmitButton className="flex h-9 items-center gap-1.5 rounded-md border border-[#efcbd0] bg-white px-3 text-xs font-semibold text-[#a33a46] hover:bg-[#fff7f7]" message="ยืนยันลบรางวัลนี้"><Trash2 className="size-3.5" aria-hidden="true"/>ลบ</ConfirmSubmitButton></form></div>)}</div>
      </section>
    </div>

    <section className="mt-5 rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Flag className="size-5 text-[#722257]"/><h2 className="text-lg font-semibold">คะแนนการแข่งขัน</h2></div>
      <p className="mt-2 text-sm text-[#667085]">กรอกคะแนน สแกนการ์ด ยืนยัน และประกาศผล ทำในหน้าคะแนนของแต่ละกิจกรรม (เก็บทุกการ์ดเป็นประวัติ ไม่แก้ทับ)</p>
      <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{events?.slice(0, 12).map((event) => <li key={event.id}><a className="flex items-center justify-between rounded-md border border-[#e2e8ef] px-3 py-2 text-sm hover:border-[#722257]" href={`/admin/events/${event.id}/scoring`}><span className="font-semibold">{event.name}</span><span className="text-xs text-[#98a2b3]">{event.event_date}</span></a></li>)}</ul>
    </section>
  </div></main>;
}
