import { Award, Flag, Megaphone, Save, Trash2 } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

import { archiveAnnouncement, createAward, deleteAward, saveAnnouncement, saveScorecard } from "./actions";

const messages: Record<string, string> = {
  "announcement-archived": "เก็บประกาศแล้ว", "announcement-failed": "บันทึกประกาศไม่สำเร็จ", "announcement-missing": "กรุณากรอกหัวข้อประกาศ", "announcement-saved": "บันทึกประกาศแล้ว",
  "award-deleted": "ลบรางวัลแล้ว", "award-failed": "บันทึกรางวัลไม่สำเร็จ", "award-missing": "กรุณากรอกข้อมูลรางวัลให้ครบ", "award-saved": "บันทึกรางวัลแล้ว",
  "score-failed": "บันทึกคะแนนไม่สำเร็จ", "score-invalid": "กรุณากรอกพาร์ 3-6 และสกอร์ 1-20 ให้ครบ 18 หลุม", "score-registration-missing": "กรุณาเลือกผู้สมัคร", "score-saved": "บันทึก Scorecard 18 หลุมแล้ว",
};

function first<T>(value: T | T[] | null) { return Array.isArray(value) ? value[0] ?? null : value; }

export default async function AdminContentPage({ searchParams }: { searchParams: Promise<{ bypass?: string; status?: string }> }) {
  const params = await searchParams;
  const access = await resolveAccess({ nextPath: "/admin/content", requiredRole: "admin", searchParams: params });
  const supabase = await createClient();
  const [{ data: announcements }, { data: members }, { data: events }, { data: registrations }, { data: awards }] = await Promise.all([
    supabase.from("club_announcements").select("id,title,summary,category,is_pinned,status,published_at").eq("club_id", access.clubId!).neq("status", "archived").order("published_at", { ascending: false }),
    supabase.from("members").select("id,full_name,member_code").eq("club_id", access.clubId!).eq("status", "active").order("full_name"),
    supabase.from("events").select("id,name,event_date").eq("club_id", access.clubId!).order("event_date", { ascending: false }).limit(50),
    supabase.from("event_registrations").select("id,member_id,event_id,members(full_name,member_code),events(name,event_date)").eq("club_id", access.clubId!).not("status", "in", "(cancelled,no_show)").order("created_at", { ascending: false }).limit(100),
    supabase.from("member_awards").select("id,title,award_type,awarded_at,members(full_name),events(name)").eq("club_id", access.clubId!).order("awarded_at", { ascending: false }).limit(50),
  ]);
  const inputClass = "h-10 rounded-md border border-[#dce3ea] bg-white px-3 text-sm outline-none focus:border-[#168aad]";
  return <main className="min-h-screen px-4 py-6 text-[#243244]"><div className="mx-auto max-w-[1500px]">
    <div><p className="text-sm font-semibold text-[#168aad]">ศูนย์เนื้อหาและผลการแข่งขัน</p><h1 className="mt-1 text-3xl font-semibold">ข่าว คะแนน และรางวัล</h1><p className="mt-2 text-sm text-[#667085]">ข้อมูลที่บันทึกจะแสดงในหน้าสมาชิกโดยอัตโนมัติ</p></div>
    {params.status && messages[params.status] ? <div className="mt-4 rounded-md bg-[#edf9f6] px-4 py-3 text-sm font-semibold text-[#16794b]">{messages[params.status]}</div> : null}

    <div className="mt-6 grid gap-5 xl:grid-cols-2">
      <section className="rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Megaphone className="size-5 text-[#168aad]"/><h2 className="text-lg font-semibold">สร้างข่าวประชาสัมพันธ์</h2></div>
        <form action={saveAnnouncement} className="mt-4 grid gap-3"><input className={inputClass} name="title" placeholder="หัวข้อประกาศ" required/><textarea className="min-h-24 rounded-md border border-[#dce3ea] p-3 text-sm outline-none focus:border-[#168aad]" name="summary" placeholder="รายละเอียดข่าว"/><div className="grid gap-3 sm:grid-cols-3"><input className={inputClass} name="category" placeholder="หมวดหมู่"/><select className={inputClass} name="status"><option value="published">เผยแพร่</option><option value="draft">ฉบับร่าง</option></select><label className="flex h-10 items-center gap-2 text-sm"><input name="isPinned" type="checkbox"/> ปักหมุด</label></div><button className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#168aad] px-4 text-sm font-semibold text-white"><Save className="size-4"/>บันทึกประกาศ</button></form>
        <div className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3]">{announcements?.map((item) => <div className="flex items-start justify-between gap-3 py-3" key={item.id}><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-[#667085]">{item.category} · {item.status}</p></div><form action={archiveAnnouncement}><input name="id" type="hidden" value={item.id}/><ConfirmSubmitButton className="p-2 text-[#a33a46]" message="ยืนยันเก็บประกาศนี้"><Trash2 className="size-4"/></ConfirmSubmitButton></form></div>)}</div>
      </section>

      <section className="rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Award className="size-5 text-[#b17b0a]"/><h2 className="text-lg font-semibold">เพิ่มรางวัลสมาชิก</h2></div>
        <form action={createAward} className="mt-4 grid gap-3"><select className={inputClass} name="memberId" required><option value="">เลือกสมาชิก</option>{members?.map((m) => <option key={m.id} value={m.id}>{m.member_code} · {m.full_name}</option>)}</select><input className={inputClass} name="title" placeholder="ชื่อรางวัล" required/><div className="grid gap-3 sm:grid-cols-2"><select className={inputClass} name="eventId"><option value="">ไม่ผูกกิจกรรม</option>{events?.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select><input className={inputClass} name="awardedAt" required type="date"/></div><input className={inputClass} name="awardType" placeholder="ประเภทรางวัล เช่น ชนะเลิศ"/><input className={inputClass} name="note" placeholder="หมายเหตุ"/><button className="flex h-10 w-fit items-center gap-2 rounded-md bg-[#C69214] px-4 text-sm font-semibold text-white"><Save className="size-4"/>บันทึกรางวัล</button></form>
        <div className="mt-5 divide-y divide-[#edf0f3] border-t border-[#edf0f3]">{awards?.map((item) => <div className="flex items-start justify-between gap-3 py-3" key={item.id}><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs text-[#667085]">{first(item.members)?.full_name ?? "-"} · {first(item.events)?.name ?? item.award_type}</p></div><form action={deleteAward}><input name="id" type="hidden" value={item.id}/><ConfirmSubmitButton className="p-2 text-[#a33a46]" message="ยืนยันลบรางวัลนี้"><Trash2 className="size-4"/></ConfirmSubmitButton></form></div>)}</div>
      </section>
    </div>

    <section className="mt-5 rounded-lg border border-[#e2e8ef] bg-white p-5 shadow-sm"><div className="flex items-center gap-2"><Flag className="size-5 text-[#722257]"/><h2 className="text-lg font-semibold">บันทึก Scorecard 18 หลุม</h2></div>
      <form action={saveScorecard} className="mt-4"><select className={`${inputClass} w-full max-w-xl`} name="registrationId" required><option value="">เลือกกิจกรรมและสมาชิก</option>{registrations?.map((r) => <option key={r.id} value={r.id}>{first(r.events)?.name ?? "กิจกรรม"} · {first(r.members)?.member_code ?? "-"} {first(r.members)?.full_name ?? "-"}</option>)}</select>
        <div className="mt-4 overflow-x-auto"><div className="grid min-w-[940px] grid-cols-9 gap-2 lg:grid-cols-18">{Array.from({length:18},(_,i)=>i+1).map((hole)=><div className="rounded-md border border-[#e2e8ef] bg-[#f8fafb] p-2" key={hole}><p className="text-center text-xs font-bold text-[#475467]">หลุม {hole}</p><input className="mt-2 h-8 w-full rounded border border-[#dce3ea] px-1 text-center text-xs" defaultValue={4} max={6} min={3} name={`par${hole}`} required type="number"/><input className="mt-1 h-8 w-full rounded border border-[#dce3ea] px-1 text-center text-xs" max={20} min={1} name={`strokes${hole}`} placeholder="สกอร์" required type="number"/></div>)}</div></div>
        <button className="mt-4 flex h-10 items-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"><Save className="size-4"/>บันทึกครบ 18 หลุม</button>
      </form>
    </section>
  </div></main>;
}
