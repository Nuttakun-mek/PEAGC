import Link from "next/link";
import {
  BadgeCheck,
  CircleUserRound,
  ClipboardCheck,
  ExternalLink,
  FilePenLine,
  GraduationCap,
  LogIn,
  ShieldAlert,
  UserCheck,
} from "lucide-react";

const flowSteps = [
  {
    action: "เปิดหน้า Login",
    detail: "ผู้ใช้กดปุ่มเข้าสู่ระบบด้วย Google ปุ่มเดียวกันนี้ใช้ได้ทั้งสมัครใหม่และเข้าใช้งานเดิม",
    href: "/login?next=/profile",
    icon: LogIn,
    state: "ยังไม่ login",
    title: "1. เข้าสู่ระบบด้วย Google",
  },
  {
    action: "ดูหน้ากรอกข้อมูล",
    detail: "หลัง Google กลับเข้าระบบ ถ้า user ยังไม่มีข้อมูลสมาชิก ระบบพาไปกรอกชื่อ เบอร์ รหัสพนักงาน หน่วยงาน และสังกัด",
    href: "/profile?bypass=member",
    icon: FilePenLine,
    state: "สมัครครั้งแรก",
    title: "2. กรอกข้อมูลสมัครสมาชิก",
  },
  {
    action: "ดูสถานะรอตรวจ",
    detail: "เมื่อบันทึก profile แล้ว ระบบตั้งสถานะสมาชิกเป็นรอตรวจสอบ เพื่อให้ Admin เทียบกับฐานข้อมูลพนักงานก่อน",
    href: "/member?bypass=member&status=pending-review",
    icon: CircleUserRound,
    state: "pending_verification",
    title: "3. รอ Admin อนุมัติ",
  },
  {
    action: "เปิดหน้า Admin ตรวจ",
    detail: "Admin เห็นสมาชิกที่รอตรวจ ผลเทียบฐานพนักงาน และปุ่มอนุมัติสมาชิก",
    href: "/admin/members?bypass=admin&status=all",
    icon: UserCheck,
    state: "admin review",
    title: "4. Admin ตรวจและอนุมัติ",
  },
  {
    action: "ดูหน้าสมาชิก",
    detail: "หลังอนุมัติแล้ว user เข้าด้วย Google account เดิม ระบบพาเข้าหน้าสมาชิก ใช้จองเรียนและสมัครกิจกรรมได้",
    href: "/member?bypass=member",
    icon: BadgeCheck,
    state: "active member",
    title: "5. เข้าใช้งานสมาชิก",
  },
  {
    action: "ดูระบบจองเรียน",
    detail: "สมาชิกที่ active เลือกรอบเรียน Academy ได้ ส่วน Admin ลงเวลาเข้าเรียนจากเมนู Lesson & Academy",
    href: "/admin/lessons?bypass=admin",
    icon: GraduationCap,
    state: "lesson booking",
    title: "6. จองเรียนและลงเวลาเรียน",
  },
];

export default function DemoAuthFlowPage() {
  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">Flow Simulator</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">
              จำลองการสมัครและเข้าใช้งานด้วย Google
            </h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[#6b6475]">
              หน้านี้เป็นตัวช่วยเดินลิงก์ของ flow จริงก่อนเปิด Google provider ใน Supabase เพื่อให้เห็นว่า user และ Admin จะเจอหน้าไหนตามลำดับ
            </p>
          </div>
          <Link
            className="flex h-11 w-fit items-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
            href="/login"
          >
            <LogIn className="size-4" aria-hidden="true" />
            ไปหน้า Login
          </Link>
        </div>

        <div className="mt-5 flex items-start gap-3 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            ตอนนี้ Google provider ใน Supabase ยังไม่เปิด จึงใช้ bypass links เพื่อเดินดูหน้าจอจริงทีละขั้น หลังเปิด provider แล้วระบบจะวิ่งผ่าน `/auth/complete` เพื่อตัดสินทางให้เอง
          </span>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {flowSteps.map((step) => (
            <article
              className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]"
              key={step.title}
            >
              <div className="flex items-start gap-4">
                <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                  <step.icon className="size-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-[#722257]">
                      {step.title}
                    </h2>
                    <span className="rounded-md bg-white/70 px-2 py-1 text-xs font-semibold text-[#6b6475]">
                      {step.state}
                    </span>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[#6b6475]">
                    {step.detail}
                  </p>
                  <Link
                    className="mt-4 flex h-10 w-fit items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-3 text-sm font-semibold text-[#722257]"
                    href={step.href}
                  >
                    <ExternalLink className="size-4" aria-hidden="true" />
                    {step.action}
                  </Link>
                </div>
              </div>
            </article>
          ))}
        </div>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
              <ClipboardCheck className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-[#722257]">
                เงื่อนไข flow จริง
              </h2>
              <p className="mt-1 text-sm text-[#6b6475]">
                Google account ใหม่จะสมัครให้อัตโนมัติใน Supabase Auth ส่วนสมาชิก PEAGC จะใช้งานเต็มระบบได้หลังกรอก profile และ Admin อนุมัติ
              </p>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
