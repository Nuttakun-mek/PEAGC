import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const assert = (condition, message) => { if (!condition) throw new Error(message); console.log(`PASS: ${message}`); };
const { data: club } = await db.from("clubs").select("id").eq("status", "active").limit(1).single();
const { data: members } = await db.from("members").select("id,user_id,member_code").eq("club_id", club.id).in("member_code", ["PEAGC-0001", "PEAGC-0003", "PEAGC-0004"]).order("member_code");
assert(members?.length === 3, "พบบัญชีสมาชิกทดสอบครบ 3 คน");
for (const account of [
  ["admin@peagc.local", "Peagc3555!"],
  ["member@peagc.local", "Member3555!"],
  ["member2@peagc.local", "Member23555!"],
  ["member3@peagc.local", "Member33555!"],
]) {
  const authClient = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInWithPassword({ email: account[0], password: account[1] });
  assert(!error && Boolean(data.user), `เข้าสู่ระบบ ${account[0]} ได้`);
  await authClient.auth.signOut();
}
let programId; let eventId; let announcementId; let awardId;
try {
  const { data: program, error: programError } = await db.from("lesson_programs").insert({ club_id: club.id, name: `E2E ${Date.now()}`, status: "active" }).select("id").single();
  if (programError) throw programError; programId = program.id;
  const tomorrow = new Date(Date.now() + 86400000 * 10).toISOString().slice(0, 10);
  const { data: slots, error: slotError } = await db.from("lesson_slots").insert([
    { capacity: 2, club_id: club.id, end_time: "10:00", lesson_date: tomorrow, program_id: program.id, start_time: "09:00", status: "open", title: "E2E Slot A" },
    { capacity: 3, club_id: club.id, end_time: "11:00", lesson_date: tomorrow, program_id: program.id, start_time: "10:00", status: "open", title: "E2E Slot B" },
  ]).select("id,title,booked_count");
  if (slotError) throw slotError;
  const slotA = slots.find((s) => s.title.endsWith("A")); const slotB = slots.find((s) => s.title.endsWith("B"));
  for (const member of members.slice(0, 2)) {
    const { error } = await db.from("lesson_bookings").insert({ club_id: club.id, member_id: member.id, slot_id: slotA.id, status: "booked" });
    if (error) throw error;
  }
  const { error: fullError } = await db.from("lesson_bookings").insert({ club_id: club.id, member_id: members[2].id, slot_id: slotA.id, status: "booked" });
  assert(fullError?.message.includes("lesson_slot_full"), "Slot เต็มปฏิเสธสมาชิกคนที่ 3");
  let { data: countA } = await db.from("lesson_slots").select("booked_count").eq("id", slotA.id).single();
  assert(countA.booked_count === 2, "ตัวนับ Slot A แสดงผู้จอง 2 คน");
  const { data: booking } = await db.from("lesson_bookings").select("id").eq("member_id", members[0].id).eq("slot_id", slotA.id).single();
  const { error: moveError } = await db.from("lesson_bookings").update({ slot_id: slotB.id }).eq("id", booking.id);
  if (moveError) throw moveError;
  const [{ data: movedA }, { data: movedB }] = await Promise.all([db.from("lesson_slots").select("booked_count").eq("id", slotA.id).single(), db.from("lesson_slots").select("booked_count").eq("id", slotB.id).single()]);
  assert(movedA.booked_count === 1 && movedB.booked_count === 1, "เปลี่ยนเวลาแล้วตัวนับ Slot เดิม/ใหม่เป็น 1/1");

  const { data: news, error: newsError } = await db.from("club_announcements").insert({ club_id: club.id, title: "E2E ข่าวทดสอบ", status: "published" }).select("id").single();
  if (newsError) throw newsError; announcementId = news.id;
  const { data: visibleNews } = await db.from("club_announcements").select("id").eq("id", news.id).eq("status", "published").single();
  assert(Boolean(visibleNews), "ข่าวเผยแพร่เชื่อมถึงชุดข้อมูลสมาชิก");

  const { data: event, error: eventError } = await db.from("events").insert({ club_id: club.id, event_date: tomorrow, member_price: 0, name: "E2E สนามทดสอบ", status: "open" }).select("id").single();
  if (eventError) throw eventError; eventId = event.id;
  const { data: registration, error: registrationError } = await db.from("event_registrations").insert({ club_id: club.id, event_id: event.id, member_id: members[0].id, status: "registered" }).select("id").single();
  if (registrationError) throw registrationError;
  const holes = Array.from({ length: 18 }, (_, i) => ({ club_id: club.id, event_registration_id: registration.id, hole_number: i + 1, member_id: members[0].id, par: i % 3 === 0 ? 3 : 4, strokes: i % 4 === 0 ? 5 : 4 }));
  const { error: holesError } = await db.from("golf_hole_scores").insert(holes); if (holesError) throw holesError;
  const { count: holeCount } = await db.from("golf_hole_scores").select("id", { count: "exact", head: true }).eq("event_registration_id", registration.id);
  assert(holeCount === 18, "บันทึกคะแนนครบ 18 หลุม");
  const { data: award, error: awardError } = await db.from("member_awards").insert({ awarded_at: tomorrow, club_id: club.id, event_id: event.id, member_id: members[0].id, title: "E2E รางวัลทดสอบ" }).select("id").single();
  if (awardError) throw awardError; awardId = award.id;
  assert(Boolean(award), "รางวัลเชื่อมสมาชิกและกิจกรรมสำเร็จ");
} finally {
  if (announcementId) await db.from("club_announcements").delete().eq("id", announcementId);
  if (awardId) await db.from("member_awards").delete().eq("id", awardId);
  if (eventId) await db.from("events").delete().eq("id", eventId);
  if (programId) await db.from("lesson_programs").delete().eq("id", programId);
}
console.log("E2E data verification completed and test data cleaned up");
