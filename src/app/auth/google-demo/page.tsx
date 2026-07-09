import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  Check,
  ChevronRight,
  CircleUserRound,
  Clock3,
  LogIn,
  Mail,
  ShieldCheck,
} from "lucide-react";

type GoogleDemoPageProps = {
  searchParams: Promise<{ step?: string }>;
};

const steps = ["accounts", "consent", "callback", "profile", "pending"] as const;
type DemoStep = (typeof steps)[number];

const stepOrder: Record<DemoStep, number> = {
  accounts: 1,
  consent: 2,
  callback: 3,
  profile: 4,
  pending: 5,
};

function getStep(value: string | undefined): DemoStep {
  return steps.includes(value as DemoStep) ? (value as DemoStep) : "accounts";
}

function Progress({ current }: { current: DemoStep }) {
  return (
    <div className="mb-6 grid gap-2 sm:grid-cols-5">
      {steps.map((step) => {
        const isDone = stepOrder[step] < stepOrder[current];
        const isCurrent = step === current;

        return (
          <div
            className={`rounded-md border px-3 py-2 text-xs font-semibold ${
              isCurrent
                ? "border-[#0f2d26] bg-[#0f2d26] text-white"
                : isDone
                  ? "border-[#c6d8c0] bg-[#e6f4df] text-[#24613f]"
                  : "border-[#dfe5da] bg-white text-[#687a6d]"
            }`}
            key={step}
          >
            {isDone ? "ผ่านแล้ว" : `ขั้น ${stepOrder[step]}`}
          </div>
        );
      })}
    </div>
  );
}

function PageShell({
  children,
  current,
  eyebrow,
  title,
}: {
  children: React.ReactNode;
  current: DemoStep;
  eyebrow: string;
  title: string;
}) {
  return (
    <main className="min-h-screen bg-[#f6f7f2] px-4 py-6 text-[#11221d]">
      <section className="mx-auto w-full max-w-3xl">
        <div className="mb-4">
          <Link
            className="inline-flex h-10 items-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-3 text-sm font-semibold text-[#0f2d26]"
            href="/login"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            กลับหน้า Login
          </Link>
        </div>
        <Progress current={current} />
        <section className="rounded-lg border border-[#dfe5da] bg-white p-6 shadow-sm">
          <p className="text-sm font-semibold text-[#5b6f62]">{eyebrow}</p>
          <h1 className="mt-1 text-3xl font-semibold text-[#0f2d26]">{title}</h1>
          {children}
        </section>
      </section>
    </main>
  );
}

export default async function GoogleDemoPage({ searchParams }: GoogleDemoPageProps) {
  const params = await searchParams;
  const step = getStep(params.step);

  if (step === "accounts") {
    return (
      <PageShell
        current="accounts"
        eyebrow="Google"
        title="เลือกบัญชี Google"
      >
        <p className="mt-2 text-sm leading-6 text-[#687a6d]">
          หน้านี้แทนหน้าจอ Google จริง เมื่อเปิด provider แล้ว user จะเห็นบัญชี Google ของตัวเองหรือปุ่มใช้อีกบัญชี
        </p>
        <div className="mt-6 grid gap-3">
          {[
            ["สมาชิก ทดสอบ", "member.demo@gmail.com"],
            ["ใช้อีกบัญชี", "กรอกอีเมล Google อื่น"],
          ].map(([name, email]) => (
            <Link
              className="flex items-center justify-between gap-4 rounded-md border border-[#dfe5da] bg-[#fbfcf8] p-4 transition hover:border-[#0f2d26]"
              href="/auth/google-demo?step=consent"
              key={email}
            >
              <div className="flex items-center gap-3">
                <div className="flex size-11 items-center justify-center rounded-full bg-[#0f2d26] text-sm font-bold text-white">
                  {name.slice(0, 1)}
                </div>
                <div>
                  <p className="font-semibold text-[#0f2d26]">{name}</p>
                  <p className="mt-1 text-sm text-[#687a6d]">{email}</p>
                </div>
              </div>
              <ChevronRight className="size-5 text-[#687a6d]" aria-hidden="true" />
            </Link>
          ))}
        </div>
      </PageShell>
    );
  }

  if (step === "consent") {
    return (
      <PageShell current="consent" eyebrow="Google OAuth" title="ยืนยันการเข้าใช้งาน">
        <div className="mt-5 rounded-md border border-[#dfe5da] bg-[#fbfcf8] p-4">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 text-[#0f6b4f]" aria-hidden="true" />
            <div>
              <p className="font-semibold text-[#0f2d26]">PEAGC ต้องการข้อมูลพื้นฐาน</p>
              <p className="mt-1 text-sm leading-6 text-[#687a6d]">
                ระบบจะใช้ชื่อ อีเมล และรูปโปรไฟล์จาก Google เพื่อสร้าง session เข้าสู่ระบบ แต่ข้อมูลสมาชิก PEAGC ต้องกรอกเพิ่มเติมในขั้นถัดไป
              </p>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link
            className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
            href="/auth/google-demo?step=callback"
          >
            <Check className="size-4" aria-hidden="true" />
            อนุญาตและไปต่อ
          </Link>
          <Link
            className="flex h-11 items-center justify-center rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26]"
            href="/login"
          >
            ยกเลิก
          </Link>
        </div>
      </PageShell>
    );
  }

  if (step === "callback") {
    return (
      <PageShell current="callback" eyebrow="PEAGC Auth" title="กำลังกลับเข้าสู่ระบบ PEAGC">
        <div className="mt-5 grid gap-3">
          {[
            "Supabase รับ callback จาก Google",
            "PEAGC แลก code เป็น session",
            "ระบบตรวจว่า user นี้มี profile สมาชิกหรือยัง",
          ].map((item) => (
            <div
              className="flex items-center gap-3 rounded-md bg-[#fbfcf8] px-4 py-3 text-sm text-[#405249]"
              key={item}
            >
              <BadgeCheck className="size-4 text-[#0f6b4f]" aria-hidden="true" />
              {item}
            </div>
          ))}
        </div>
        <Link
          className="mt-6 flex h-11 w-fit items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
          href="/auth/google-demo?step=profile"
        >
          <LogIn className="size-4" aria-hidden="true" />
          ไปกรอกข้อมูลสมาชิก
        </Link>
      </PageShell>
    );
  }

  if (step === "profile") {
    return (
      <PageShell current="profile" eyebrow="Member Profile" title="กรอกข้อมูลสมัครสมาชิก">
        <p className="mt-2 text-sm leading-6 text-[#687a6d]">
          หลัง Google login สำเร็จ user ใหม่จะต้องกรอกข้อมูลนี้ก่อน ระบบจึงส่งให้ Admin ตรวจอนุมัติ
        </p>
        <div className="mt-6 grid gap-4">
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">ชื่อ-นามสกุล</span>
              <input className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3" defaultValue="สมาชิก ทดสอบ" readOnly />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">อีเมล Google</span>
              <input className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3" defaultValue="member.demo@gmail.com" readOnly />
            </label>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">รหัสพนักงาน</span>
              <input className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3" defaultValue="497901" readOnly />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">หน่วยงาน</span>
              <input className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3" defaultValue="กองบริการ" readOnly />
            </label>
            <label className="block">
              <span className="text-sm font-semibold text-[#405249]">สังกัด</span>
              <input className="mt-2 h-11 w-full rounded-md border border-[#cbd6c7] px-3" defaultValue="PEA" readOnly />
            </label>
          </div>
          <Link
            className="flex h-11 w-fit items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
            href="/auth/google-demo?step=pending"
          >
            <Building2 className="size-4" aria-hidden="true" />
            ส่งข้อมูลให้ Admin ตรวจ
          </Link>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell current="pending" eyebrow="Member Status" title="รอ Admin อนุมัติก่อนเข้าระบบสมาชิกเต็มรูปแบบ">
      <div className="mt-5 rounded-md bg-[#fff4d8] px-4 py-3 text-sm text-[#8a6112]">
        <div className="flex items-start gap-3">
          <Clock3 className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <span>
            ตอนนี้ user login สำเร็จแล้ว แต่ยังเป็นสถานะรอตรวจสอบ จึงยังจองเรียนหรือสมัครกิจกรรมไม่ได้จนกว่า Admin จะอนุมัติ
          </span>
        </div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link
          className="flex h-11 items-center justify-center gap-2 rounded-md border border-[#cbd6c7] bg-white px-4 text-sm font-semibold text-[#0f2d26]"
          href="/admin/members?bypass=admin&status=pending_verification"
        >
          <CircleUserRound className="size-4" aria-hidden="true" />
          ดูหน้า Admin อนุมัติ
        </Link>
        <Link
          className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#0f2d26] px-4 text-sm font-semibold text-white"
          href="/member?bypass=member&status=pending-review"
        >
          <Mail className="size-4" aria-hidden="true" />
          ดูหน้าสมาชิกขณะรออนุมัติ
        </Link>
      </div>
    </PageShell>
  );
}
