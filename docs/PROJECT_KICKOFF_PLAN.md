# PEAGC Project Kickoff Plan

## 1. สถานะเริ่มต้น

- เอกสารต้นทาง: `C:\Users\497901\Desktop\PEAGC_SYSTEM_DEVELOPMENT_PLAN.md`
- ระบบเป้าหมาย: PEA Golf Club (PEAGC) - Golf Club & Academy Operating System
- ลักษณะระบบ: Thai-first responsive web application
- Workspace ปัจจุบัน: Git repository ว่าง ยังไม่มี source code

## 2. หลักคิดสำคัญจากเอกสาร

PEAGC เป็นระบบใหญ่ที่ครอบคลุมสมาชิก กิจกรรม ลงทะเบียน ชำระเงิน จัดก๊วน แข่งขัน คะแนน OCR Academy Finance Sponsor และ Analytics แต่การเริ่มงานควรเริ่มจากแกนที่ทำให้ชมรมใช้งานจริงได้ก่อน

ข้อกำหนดที่ต้องยึดตั้งแต่วันแรก:

- ห้ามเริ่มจาก OCR ก่อน
- ห้าม hardcode กติกาการแข่งขันแบบผูกตายกับ code
- ห้ามแก้ทับคะแนนเดิม ต้องแยกชั้นข้อมูลคะแนน
- ต้องมี audit log สำหรับคะแนน การเงิน OCR กติกา และการ publish ผล
- ต้องออกแบบ mobile-first และใช้งานง่ายกว่า Excel
- ต้องรองรับ `club_id` / tenant structure ตั้งแต่แรก

## 3. Scope ที่ควรเริ่มก่อน

### Phase 0: Foundation

เป้าหมายคือวางฐานระบบให้ขยายต่อได้โดยไม่ต้องรื้อใหม่

- Next.js + TypeScript project scaffold
- Tailwind CSS และ design system เบื้องต้น
- Supabase Auth
- PostgreSQL schema foundation
- Role-based access control foundation
- Club / tenant model
- File storage model
- Audit log foundation
- Main responsive layout
- Admin portal shell
- Member portal shell

### MVP 1: Club & Event Core

นี่คือ scope แรกที่ควรทำให้ใช้งานจริงได้

- Member Management
- Event Management
- Registration
- Payment Slip Review
- Pairing / Tee Time
- Check-in
- Excel Export
- Basic Dashboard

### MVP 2: Basic Competition

เพิ่มหลังจาก MVP 1 เริ่มนิ่ง

- Competition Setup
- Stroke Play Gross
- Stroke Play Net
- System 36
- Flight
- Manual Score Entry
- Leaderboard
- Prize Result
- Countback

### Later Phases

ทำหลังจากระบบหลักใช้งานได้แล้ว

- Rule Builder Basic
- Smart Score OCR
- Golf Academy
- Finance / Sponsor Report
- Advanced Analytics / AI

## 4. Recommended Technical Stack

### Initial Stack

- Frontend: Next.js, React, TypeScript
- Styling: Tailwind CSS
- Backend: Next.js API / Server Actions
- Database: Supabase PostgreSQL
- Auth: Supabase Auth
- Storage: Supabase Storage
- Hosting: Vercel
- Export: ExcelJS
- Audit: append-only audit table

### Architecture Principles

- Monolith-first, modular structure
- Keep competition/scoring logic as isolated TypeScript modules
- Store rule configuration as versioned data, not hardcoded branching
- Use normalized tables for core data
- Use JSONB for rule parameters and future flexible config
- Use snapshots for leaderboard/report outputs
- Use soft delete/archive for important business records

## 5. Initial Data Model Groups

### Foundation

- `clubs`
- `profiles`
- `roles`
- `permissions`
- `user_roles`
- `audit_logs`
- `files`

### Club Core

- `members`
- `member_types`
- `committees`
- `announcements`
- `documents`

### Event Core

- `events`
- `event_registrations`
- `payments`
- `pairings`
- `pairing_players`
- `checkins`

### Competition Basic

- `competitions`
- `competition_versions`
- `rule_sets`
- `rule_set_versions`
- `scores`
- `verified_scores`
- `leaderboard_snapshots`
- `prize_results`
- `scoring_audit_logs`

## 6. Sprint Plan

### Sprint 0: Project Setup and Decisions

Outcome: repository พร้อมเริ่มพัฒนา

- Scaffold Next.js + TypeScript project
- Add Tailwind CSS and base layout
- Set lint/format/test baseline
- Create `.env.example`
- Decide app routes and folder structure
- Draft Supabase schema migration for Foundation
- Define initial roles and permissions
- Define visual direction: premium golf, Thai-first, mobile-first

### Sprint 1: Authentication and Shell

Outcome: ผู้ใช้เข้าใช้งานและเห็น portal ตาม role ได้

- Supabase Auth integration
- Login / Logout
- Protected routes
- Admin layout
- Member layout
- Basic role guard
- Club context
- Audit helper foundation

### Sprint 2: Member Management

Outcome: Admin จัดการสมาชิกได้จริง

- Member list - started in `/admin/members`
- Search and filters - started in `/admin/members`
- Add / edit member - started with server actions and audit log
- Member profile
- Member type setting
- Handicap field
- Import/export planning
- Audit log on member changes

### Sprint 3: Event and Registration

Outcome: เปิดกิจกรรมและรับสมัครได้

- Event list and dashboard - started in `/admin/events`
- Create / edit event - started with server actions and audit log
- Event detail
- Registration form
- Register self / guest foundation
- Registration status flow
- Mobile registration UX

### Sprint 4: Payment and Participant Admin

Outcome: Admin ตรวจสถานะผู้สมัครและ slip ได้

- Slip upload
- Payment review queue
- Payment status update
- Participant list
- Export paid/unpaid participants
- Audit log for payment changes

### Sprint 5: Pairing and Check-in

Outcome: ลดงาน Excel หน้างานได้

- Pairing board foundation
- Assign players to groups
- Tee time fields
- Group capacity validation
- Check-in status
- Pairing sheet export

### Sprint 6: Basic Competition Foundation

Outcome: เริ่มคำนวณคะแนนพื้นฐานได้

- Competition setup from event
- Score entry 1-18 holes
- Gross / Net calculation
- System 36 foundation
- Flight assignment
- Leaderboard snapshot
- Score verification status

## 7. Decisions Needed Before Coding

ควรยืนยันเรื่องเหล่านี้ก่อนเริ่มเขียนระบบจริง:

- จะใช้ Supabase project ใดสำหรับ development
- Login ระยะแรกใช้ email/password, magic link, Google หรือทั้งสองแบบ
- มี logo / สีประจำ / font preference ของ PEAGC หรือไม่
- รายชื่อ role ระยะแรกจะใช้ครบทั้งหมดหรือย่อเหลือ Admin, Finance, Scoring, Member ก่อน
- ต้อง import สมาชิกจากไฟล์ Excel รูปแบบใด
- กิจกรรมตัวอย่างแรกที่จะใช้ทดสอบระบบคือกิจกรรมประเภทใด
- Payment review ต้องเก็บหลักฐานอะไรบ้าง เช่น slip, amount, transfer date, reviewer
- Pairing ต้องเริ่มจาก drag-and-drop เลยหรือเริ่มจาก assign แบบง่ายก่อน
- ต้อง deploy staging ตั้งแต่ sprint แรกหรือทำ local prototype ก่อน

## 8. Main Risks

- Scope ใหญ่เกินไปถ้าทำทุก module พร้อมกัน
- Rule Builder และ OCR มีความซับซ้อนสูง ไม่ควรอยู่ใน MVP แรก
- ถ้าไม่วาง `club_id`, RBAC, audit log ตั้งแต่ต้น จะรื้อยากภายหลัง
- Admin UX ต้องเร็วกว่า Excel ไม่เช่นนั้น adoption จะต่ำ
- Payment, score, and publish flows ต้องตรวจสอบย้อนหลังได้
- Mobile UX สำคัญมากเพราะสมาชิกจะลงทะเบียนและแนบ slip ผ่านมือถือ

## 9. Recommended First Implementation Target

เริ่มสร้างโปรเจคด้วย Foundation + MVP 1 โดยตั้งเป้าหมายแรกว่า:

> Admin สามารถเพิ่มสมาชิก สร้างกิจกรรม เปิดรับสมัคร ให้สมาชิกลงทะเบียน แนบ slip และดูรายชื่อผู้สมัครได้จากมือถือและ desktop

เมื่อ target นี้สำเร็จแล้ว จึงต่อด้วย Pairing และ Basic Competition
