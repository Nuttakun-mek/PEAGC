// Archives test data (TEST / UAT / E2E records) before the club goes live, so members never see
// test events, courses or people. Nothing is deleted: archived rows can be restored from the
// admin pages ("เก็บถาวร" filters), and a JSON copy of every matched row is written first.
//
//   node scripts/cleanup-test-data.mjs                      # dry run: list what would be archived
//   node scripts/cleanup-test-data.mjs --apply              # archive the listed rows
//   node scripts/cleanup-test-data.mjs --apply --ban=a@x.com,b@y.com
//                                                          # also block sign-in for those test accounts
//
// Matching is deliberately narrow: a name/title must contain TEST, UAT or E2E as a word (or
// "Delete Me"), or a member/directory row must use a test e-mail domain or test employee code.
// Read the dry-run list before applying.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
    .map((line) => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }),
);
const apply = process.argv.includes("--apply");
const banList = (process.argv.find((arg) => arg.startsWith("--ban="))?.slice("--ban=".length) ?? "")
  .split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const marker = /(^|[^a-z])(test|uat|e2e)([^a-z]|$)|delete me/i;
const testEmail = /@(example\.(com|org|net)|peagc\.local)$/i;
const testCode = /^(test|uat|e2e|peagc-e2e|gmail-test)/i;

const { data: club, error: clubError } = await db.from("clubs").select("id, name").eq("status", "active").is("archived_at", null).order("created_at").limit(1).single();
if (clubError || !club) throw new Error(`No active club: ${clubError?.message}`);

async function rows(table, columns) {
  const { data, error } = await db.from(table).select(columns).eq("club_id", club.id).is("archived_at", null).limit(5000);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

const targets = [
  {
    archive: { status: "archived" },
    label: "สมาชิก",
    match: (row) => marker.test(row.full_name ?? "") || testEmail.test(row.email ?? "") || testCode.test(row.employee_code ?? ""),
    rows: await rows("members", "id, member_code, full_name, email, employee_code"),
    show: (row) => `${row.member_code ?? "-"} ${row.full_name} <${row.email ?? ""}> ${row.employee_code ?? ""}`,
    table: "members",
  },
  {
    archive: {},
    label: "ฐานสมาชิกสมาคม",
    match: (row) => marker.test(row.full_name ?? "") || testCode.test(row.employee_code ?? "") || testEmail.test(row.email ?? ""),
    rows: await rows("employee_directory", "id, employee_code, full_name, email"),
    show: (row) => `${row.employee_code} ${row.full_name}`,
    table: "employee_directory",
  },
  {
    archive: { status: "archived" },
    label: "กิจกรรม",
    match: (row) => marker.test(row.name ?? ""),
    rows: await rows("events", "id, name, event_date, member_price, status"),
    show: (row) => `${row.event_date} ${row.name} (${row.member_price} บาท, ${row.status})`,
    table: "events",
  },
  {
    archive: { status: "archived" },
    label: "คอร์สเรียน",
    match: (row) => marker.test(row.name ?? ""),
    rows: await rows("lesson_programs", "id, name, status"),
    show: (row) => `${row.name} (${row.status})`,
    table: "lesson_programs",
  },
  {
    archive: { status: "cancelled" },
    label: "รอบเรียน",
    match: (row) => marker.test(row.title ?? ""),
    rows: await rows("lesson_slots", "id, title, lesson_date, start_time"),
    show: (row) => `${row.lesson_date} ${String(row.start_time).slice(0, 5)} ${row.title}`,
    table: "lesson_slots",
  },
];

// Announcements have no archived_at column; their status is the archive flag.
const { data: announcements, error: announcementError } = await db.from("club_announcements").select("id, title, status").eq("club_id", club.id).neq("status", "archived");
if (announcementError) throw new Error(`club_announcements: ${announcementError.message}`);

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const backup = {};
let total = 0;
console.log(`ชมรม: ${club.name}`);
for (const target of targets) {
  const hits = target.rows.filter(target.match);
  target.hits = hits;
  backup[target.table] = hits;
  total += hits.length;
  console.log(`\n${target.label} (${hits.length})`);
  for (const row of hits) console.log(`  - ${target.show(row)}`);
}
const announcementHits = (announcements ?? []).filter((row) => marker.test(row.title ?? ""));
backup.club_announcements = announcementHits;
total += announcementHits.length;
console.log(`\nข่าวประกาศ (${announcementHits.length})`);
for (const row of announcementHits) console.log(`  - ${row.title} (${row.status})`);
if (banList.length) console.log(`\nบัญชีที่จะปิดการเข้าสู่ระบบ: ${banList.join(", ")}`);

if (!apply) {
  console.log(`\nDry run: พบ ${total} รายการ ยังไม่ได้แก้ไขอะไร เพิ่ม --apply เพื่อเก็บถาวรรายการข้างบน`);
  process.exit(0);
}

const backupFile = `test-data-backup-${stamp}.json`;
fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));
console.log(`\nสำรองรายการที่จะเก็บถาวรไว้ที่ ${backupFile}`);

const now = new Date().toISOString();
for (const target of targets) {
  if (!target.hits.length) continue;
  const { error } = await db.from(target.table).update({ archived_at: now, ...target.archive }).in("id", target.hits.map((row) => row.id));
  console.log(`${error ? "ไม่สำเร็จ" : "เก็บถาวรแล้ว"} ${target.label} ${target.hits.length} รายการ${error ? `: ${error.message}` : ""}`);
}
if (announcementHits.length) {
  const { error } = await db.from("club_announcements").update({ status: "archived" }).in("id", announcementHits.map((row) => row.id));
  console.log(`${error ? "ไม่สำเร็จ" : "เก็บถาวรแล้ว"} ข่าวประกาศ ${announcementHits.length} รายการ${error ? `: ${error.message}` : ""}`);
}

if (banList.length) {
  const { data: listed, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  for (const email of banList) {
    const user = listed.users.find((item) => item.email?.toLowerCase() === email);
    if (!user) {
      console.log(`ไม่พบบัญชี ${email}`);
      continue;
    }
    // ~100 years; undo with ban_duration "none" in the Supabase dashboard or admin API.
    const { error: banError } = await db.auth.admin.updateUserById(user.id, { ban_duration: "876000h" });
    console.log(`${banError ? "ไม่สำเร็จ" : "ปิดการเข้าสู่ระบบแล้ว"} ${email}${banError ? `: ${banError.message}` : ""}`);
  }
}
