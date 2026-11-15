// Repairs Thai text that was stored as "?" by an earlier seeding run (a non-UTF-8 shell turned
// every Thai character into "?"; the original text cannot be recovered from the database).
//
//   node scripts/repair-corrupted-thai.mjs            # dry run: prints every change
//   node scripts/repair-corrupted-thai.mjs --apply    # writes the changes
//
// Only the seeded test accounts and directory rows are affected. Names are restored to
// readable Thai test names (matching the original character counts where they are certain);
// other corrupted fields (department, position, ...) are cleared instead of guessed.
// Also gives members without a member type the club's "สมาชิก" (or "แขก" for guests) type.
import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

const apply = process.argv.includes("--apply");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8").split(/\r?\n/).filter((line) => line && !line.startsWith("#"))
    .map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, { auth: { persistSession: false } });

const CORRUPTED = /\?{2,}|�/;
const isCorrupted = (value) => typeof value === "string" && CORRUPTED.test(value);

// Corrupted names whose wording is certain from the character count and the account
// ("???????????" is the 11 characters of "ผู้ดูแลระบบ"; "??????" the 6 of "สมาชิก").
const knownNames = new Map([
  ["??????????? PEAGC", "ผู้ดูแลระบบ PEAGC"],
  ["?????? ?????", "สมาชิก ทดสอบ"],
  ["?????? PEAGC 1", "สมาชิก PEAGC 1"],
  ["?????? PEAGC 2", "สมาชิก PEAGC 2"],
  ["?????? PEAGC 3", "สมาชิก PEAGC 3"],
  ["?????? PEAGC 4", "สมาชิก PEAGC 4"],
  ["?????? Production", "สมาชิก Production"],
]);
// Short values, only trusted in their own column.
const knownByField = {
  affiliation: new Map([["???.", "กฟภ."]]),
  title_prefix: new Map([["???", "นาย"]]),
};
const nameFields = new Set(["full_name", "display_name", "nickname"]);

/** New value for one field, or undefined to leave it. */
function repairField(table, field, value, row) {
  if (!isCorrupted(value)) return undefined;
  if (nameFields.has(field) && knownNames.has(value)) return knownNames.get(value);
  if (knownByField[field]?.has(value)) return knownByField[field].get(value);
  // Keep first/last name consistent with the repaired full name ("สมาชิก" + "PEAGC 1").
  if ((field === "first_name" || field === "last_name") && knownNames.has(row.full_name)) {
    const [first, ...rest] = knownNames.get(row.full_name).split(" ");
    return field === "first_name" ? first : rest.join(" ") || null;
  }
  // Required columns get a neutral test label; optional ones are cleared rather than guessed.
  if (field === "full_name") return "สมาชิกทดสอบ";
  if (field === "display_name") return "ผู้ใช้ทดสอบ";
  return null;
}

const textFields = {
  employee_directory: ["full_name", "first_name", "last_name", "title_prefix", "affiliation", "bureau", "division", "department", "section", "position", "work_line"],
  members: ["full_name", "nickname", "first_name", "last_name", "title_prefix", "affiliation", "bureau", "division", "department", "section", "position", "work_line", "organization", "note"],
  profiles: ["display_name"],
};

let changeCount = 0;

for (const [table, fields] of Object.entries(textFields)) {
  const { data, error } = await db.from(table).select(["id", ...fields].join(", "));
  if (error) throw new Error(`${table}: ${error.message}`);
  for (const row of data) {
    const update = {};
    for (const field of fields) {
      const next = repairField(table, field, row[field], row);
      if (next !== undefined) update[field] = next;
    }
    if (!Object.keys(update).length) continue;
    changeCount += 1;
    console.log(`${apply ? "UPDATE" : "would update"} ${table} ${row.id}`);
    for (const [field, next] of Object.entries(update)) console.log(`    ${field}: ${JSON.stringify(row[field])} -> ${JSON.stringify(next)}`);
    if (apply) {
      const { error: updateError } = await db.from(table).update(update).eq("id", row.id);
      if (updateError) throw new Error(`${table} ${row.id}: ${updateError.message}`);
    }
  }
}

// Auth display names (shown before a profile exists).
const { data: userPage, error: usersError } = await db.auth.admin.listUsers({ perPage: 1000 });
if (usersError) throw usersError;
for (const user of userPage.users) {
  const name = user.user_metadata?.display_name;
  if (!isCorrupted(name)) continue;
  const next = knownNames.get(name) ?? "ผู้ใช้ทดสอบ";
  changeCount += 1;
  console.log(`${apply ? "UPDATE" : "would update"} auth user ${user.email}: display_name ${JSON.stringify(name)} -> ${JSON.stringify(next)}`);
  if (apply) {
    const { error } = await db.auth.admin.updateUserById(user.id, { user_metadata: { ...user.user_metadata, display_name: next } });
    if (error) throw error;
  }
}

// Members without a type showed "ไม่ระบุประเภท".
const { data: types, error: typesError } = await db.from("member_types").select("id, club_id, name").eq("status", "active");
if (typesError) throw typesError;
const { data: untyped, error: untypedError } = await db.from("members").select("id, club_id, full_name, status").is("member_type_id", null).is("archived_at", null);
if (untypedError) throw untypedError;
for (const member of untyped) {
  const clubTypes = types.filter((type) => type.club_id === member.club_id);
  const wanted = member.status === "guest" ? "แขก" : "สมาชิก";
  const type = clubTypes.find((item) => item.name === wanted) ?? clubTypes[0];
  if (!type) continue;
  changeCount += 1;
  console.log(`${apply ? "UPDATE" : "would update"} members ${member.id}: member_type -> ${type.name}`);
  if (apply) {
    const { error } = await db.from("members").update({ member_type_id: type.id }).eq("id", member.id);
    if (error) throw new Error(`members ${member.id}: ${error.message}`);
  }
}

console.log(`\n${changeCount} record(s) ${apply ? "updated" : "to update (dry run, re-run with --apply)"}`);
