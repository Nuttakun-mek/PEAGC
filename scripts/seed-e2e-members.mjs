import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#")).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });
const { data: club } = await supabase.from("clubs").select("id").eq("status", "active").limit(1).single();
if (!club) throw new Error("Active club not found");

const accounts = [
  { email: "member@peagc.local", password: "Member3555!", code: "PEAGC-0001", employee: "999001", name: "สมาชิกทดสอบ หนึ่ง", nickname: "สมาชิก 1" },
  { email: "member2@peagc.local", password: "Member23555!", code: "PEAGC-0003", employee: "999002", name: "สมาชิกทดสอบ สอง", nickname: "สมาชิก 2" },
  { email: "member3@peagc.local", password: "Member33555!", code: "PEAGC-0004", employee: "999003", name: "สมาชิกทดสอบ สาม", nickname: "สมาชิก 3" },
];

const { data: listed } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
for (const account of accounts) {
  let user = listed.users.find((candidate) => candidate.email === account.email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({ email: account.email, email_confirm: true, password: account.password, user_metadata: { display_name: account.nickname } });
    if (error) throw error;
    user = data.user;
  } else {
    const { error } = await supabase.auth.admin.updateUserById(user.id, { password: account.password, email_confirm: true });
    if (error) throw error;
  }
  await supabase.from("profiles").upsert({ display_name: account.nickname, id: user.id, updated_at: new Date().toISOString() });
  await supabase.from("user_roles").upsert({ club_id: club.id, role_key: "member", user_id: user.id }, { onConflict: "club_id,user_id,role_key" });
  const { data: directory, error: directoryError } = await supabase.from("employee_directory").upsert({ affiliation: "กฟภ.", bureau: "สำนักงานใหญ่", club_id: club.id, department: "กองทดสอบระบบ", division: "ฝ่ายดิจิทัล", employee_code: account.employee, employment_status: "active", first_name: account.name.split(" ")[0], full_name: account.name, last_name: account.name.split(" ")[1], position: "ผู้ทดสอบระบบ", section: `แผนกสมาชิก ${account.nickname.at(-1)}`, title_prefix: "นาย", work_line: "สายงานดิจิทัล" }, { onConflict: "club_id,employee_code" }).select("id").single();
  if (directoryError) throw directoryError;
  const { error: memberError } = await supabase.from("members").upsert({ affiliation: "กฟภ.", bureau: "สำนักงานใหญ่", club_id: club.id, department: "กองทดสอบระบบ", division: "ฝ่ายดิจิทัล", email: account.email, employee_code: account.employee, employee_directory_id: directory.id, employee_match_status: "matched", first_name: account.name.split(" ")[0], full_name: account.name, last_name: account.name.split(" ")[1], member_code: account.code, nickname: account.nickname, phone: `089000${account.employee.slice(-4)}`, position: "ผู้ทดสอบระบบ", section: `แผนกสมาชิก ${account.nickname.at(-1)}`, status: "active", title_prefix: "นาย", user_id: user.id, work_line: "สายงานดิจิทัล" }, { onConflict: "club_id,user_id" });
  if (memberError) throw memberError;
}
console.log("Seeded member 1/2/3 accounts successfully");
