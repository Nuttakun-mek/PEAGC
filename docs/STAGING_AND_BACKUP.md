# ระบบทดสอบ (UAT) และการสำรองฐานข้อมูล

สรุปสั้นสำหรับผู้ดูแลระบบ: แยกระบบทดสอบออกจากระบบจริง ใส่ข้อมูลทดสอบด้วยสคริปต์ และสำรองฐานข้อมูลทุกวัน

## 1. แยก 2 ระบบ

| | ระบบจริง (production) | ระบบทดสอบ (UAT) |
|---|---|---|
| Supabase | โปรเจกต์ของระบบจริง | สร้างโปรเจกต์ใหม่อีกอัน (ฟรีได้) แยกฐานข้อมูล ผู้ใช้ และไฟล์ทั้งหมด |
| Vercel | Environment **Production** (branch `main`) | Environment **Preview** (branch อื่น) หรือ **Custom Environment** ชื่อ `uat` |
| `NEXT_PUBLIC_APP_ENV` | เว้นว่าง | `uat` (เว็บจะขึ้นป้าย **UAT** ที่หน้าเข้าสู่ระบบ หน้าสมาชิก และแถบบนของผู้ดูแล) |
| `AUTH_BYPASS_ENABLED` | `false` เสมอ | ใช้ได้ถ้าต้องการดูหน้าตัวอย่าง (`?bypass=admin`) |

ขั้นตอน

1. สร้างโปรเจกต์ Supabase ใหม่สำหรับ UAT แล้วรัน migration ทั้งหมดในโฟลเดอร์ `supabase/migrations` ตามลำดับชื่อไฟล์
   (`npx supabase link --project-ref <ref-ของ-UAT>` แล้ว `npx supabase db push`) ตรวจให้แน่ใจว่า link อยู่กับโปรเจกต์ UAT ก่อนกด push
2. ใน Vercel > Settings > Environment Variables ใส่ค่าของโปรเจกต์ UAT ให้ Environment ที่ใช้ทดสอบ
   (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`, `NEXT_PUBLIC_APP_ENV=uat`)
   ส่วนค่าของระบบจริงใส่เฉพาะ Production ห้ามใช้คีย์ชุดเดียวกันข้ามระบบ
3. ใน Supabase ของ UAT ตั้ง Authentication > URL Configuration ให้ Site URL และ Redirect URLs เป็นโดเมนของ UAT
4. เปิด `/setup` บนเว็บ UAT เพื่อสร้างผู้ดูแลคนแรก (ใช้ `BOOTSTRAP_SETUP_TOKEN` ของ UAT)

## 2. ข้อมูลทดสอบ

สคริปต์อ่านค่าจาก `.env.local` ในเครื่อง ก่อนรันให้ใส่ค่าของโปรเจกต์ **UAT** เท่านั้น

```bash
# สร้างบัญชีสมาชิกทดสอบ 3 คน (ตั้งรหัสผ่านใน .env.local: E2E_MEMBER_PASSWORD, E2E_MEMBER2_PASSWORD, E2E_MEMBER3_PASSWORD)
npm run seed:e2e

# ตรวจว่าบัญชีทดสอบเข้าระบบได้และเห็นข้อมูลถูกต้อง
npm run verify:e2e

# ก่อนเปิดใช้จริง: เก็บข้อมูลที่ชื่อมี TEST / UAT / E2E (ดูรายการก่อน แล้วค่อยใส่ --apply)
node scripts/cleanup-test-data.mjs
node scripts/cleanup-test-data.mjs --apply
```

ห้ามรัน `seed:e2e` กับระบบจริง ถ้าข้อมูลทดสอบหลุดเข้าระบบจริงแล้ว ใช้ `cleanup-test-data.mjs` (ไม่ลบ แค่เก็บถาวร และเขียนไฟล์สำรอง JSON ก่อนทุกครั้ง)

## 3. สำรองฐานข้อมูลทุกวัน

ไฟล์ `.github/workflows/db-backup.yml` รันทุกวันเวลา 02:30 น. (เวลาไทย) และกดรันเองได้จากแท็บ Actions

- ใช้ `pg_dump` ดึงโครงสร้างและข้อมูลของ schema `public` (ข้อมูลชมรมทั้งหมด) และ `auth` (บัญชีเข้าระบบ) เป็นไฟล์ `.dump` แบบบีบอัด
- เก็บเป็น Artifact ของ GitHub Actions 14 วัน แล้วลบเอง
- ตั้งค่าครั้งเดียว: GitHub > Settings > Secrets and variables > Actions > New repository secret
  ชื่อ `SUPABASE_DB_URL` ค่าเป็น connection string ของระบบจริงจาก Supabase > Project Settings > Database
  (แบบ Session pooler พอร์ต 5432 เช่น `postgresql://postgres.<ref>:<รหัสผ่าน>@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres`)
- ถ้ายังไม่ได้ตั้ง secret งานจะข้ามไปเฉยๆ ไม่ขึ้นว่าล้มเหลว
- ไฟล์สลิปและรูปใน Storage ไม่อยู่ในไฟล์นี้ (Supabase เก็บแยก)

กู้ข้อมูลกลับ (ทำกับโปรเจกต์ UAT หรือโปรเจกต์ใหม่ก่อนเสมอ แล้วตรวจให้ครบก่อนแตะระบบจริง)

```bash
# ดาวน์โหลด artifact จากหน้า Actions แล้วแตกไฟล์ zip
pg_restore --clean --if-exists --no-owner --no-privileges -d "<connection-string-ปลายทาง>" peagc-YYYYMMDD-HHMM.dump
```

แผน Supabase แบบเสียเงินมี daily backup และ Point-in-Time Recovery ในตัวด้วย ไฟล์จาก GitHub เป็นสำเนาเพิ่มอีกชั้นที่อยู่นอก Supabase

## 4. ดู error ของเซิร์ฟเวอร์

ทุก error ฝั่งเซิร์ฟเวอร์เขียน log หนึ่งบรรทัดแบบ JSON (`"event":"request_error"`, หน้า, digest, ข้อความ) จาก `src/instrumentation.ts`
ดูได้ที่ Vercel > Project > Logs ถ้าผู้ใช้แจ้ง "รหัสอ้างอิง" ที่ขึ้นบนหน้า error ให้ค้นใน log ด้วยรหัสนั้น (ช่อง digest)
