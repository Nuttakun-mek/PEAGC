import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { CLUB_NAME, ClubCrest } from "@/components/brand";
import { formatThaiDate } from "@/lib/display";

export const metadata: Metadata = {
  description: `${CLUB_NAME} เก็บข้อมูลอะไร ใช้ทำอะไร เก็บนานเท่าไร และสิทธิ์ของสมาชิก`,
  title: "ประกาศความเป็นส่วนตัว",
};

/** Policy version shown here; members' consent stores the same value (members.pdpa_policy_version). */
const POLICY_DATE = "2026-11-23";

const sections: { body: React.ReactNode; title: string }[] = [
  {
    title: "ข้อมูลที่ชมรมเก็บ",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>ชื่อ-นามสกุล ชื่อเล่น เบอร์โทร อีเมล และรูปโปรไฟล์</li>
        <li>รหัสพนักงาน สังกัด และสถานะสมาชิกสมาคม (เทียบกับฐานสมาชิกสมาคมที่ชมรมได้รับ)</li>
        <li>ประวัติการจองเรียน การสมัครกิจกรรม สกอร์ และแต้มสะสม</li>
        <li>สลิปโอนเงินและรายการชำระเงิน</li>
      </ul>
    ),
  },
  {
    title: "ใช้ทำอะไร",
    body: (
      <ul className="list-disc space-y-1 pl-5">
        <li>ยืนยันว่าเป็นสมาชิก ออกเลขสมาชิก และบัตรสมาชิก</li>
        <li>จัดคลาสเรียน กิจกรรมออกรอบ ก๊วน และประกาศผล</li>
        <li>ตรวจการชำระเงิน ออกใบเสร็จ และแจ้งเตือนในหน้าสมาชิก</li>
      </ul>
    ),
  },
  {
    title: "ใครเห็นข้อมูล",
    body: (
      <p>
        ผู้ดูแลชมรม กรรมการ และเจ้าหน้าที่ เฉพาะส่วนที่ต้องใช้ตามหน้าที่ สมาชิกคนอื่นเห็นเพียงชื่อในรายชื่อก๊วน ผลการแข่งขัน
        และอันดับแต้มสะสม ชมรมไม่ขายหรือส่งต่อข้อมูลให้ผู้อื่น
      </p>
    ),
  },
  {
    title: "รูปกิจกรรม",
    body: <p>ชมรมเผยแพร่รูปกิจกรรมที่มีคุณเฉพาะเมื่อคุณยินยอม เปลี่ยนใจได้ทุกเมื่อที่หน้าข้อมูลสมาชิก</p>,
  },
  {
    title: "เก็บนานเท่าไร",
    body: (
      <p>
        เก็บตลอดที่เป็นสมาชิก สลิปโอนเงินลบตามระยะที่ชมรมกำหนด (เริ่มต้น 1 ปีหลังตรวจเสร็จ) ส่วนรายการเงินที่ต้องเก็บตามกฎหมาย
        ชมรมเก็บต่อตามระยะที่กฎหมายกำหนด
      </p>
    ),
  },
  {
    title: "สิทธิ์ของคุณ",
    body: (
      <p>
        ดูและแก้ไขข้อมูล ดาวน์โหลดข้อมูลของฉัน ขอลบข้อมูล หรือถอนความยินยอมได้ที่{" "}
        <Link className="font-semibold text-brand-600 underline underline-offset-4" href="/profile#privacy">
          หน้าข้อมูลสมาชิก
        </Link>{" "}
        หรือแจ้งผู้ดูแลชมรมโดยตรง
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-8 text-ink sm:py-12">
      <article className="mx-auto w-full max-w-3xl rounded-2xl border border-line bg-white p-5 shadow-card sm:p-8">
        <Link className="inline-flex h-10 items-center gap-1.5 text-sm font-semibold text-brand-600 hover:underline" href="/member">
          <ArrowLeft className="size-4" aria-hidden="true" />
          หน้าสมาชิก
        </Link>
        <div className="mt-4 flex items-center gap-3">
          <ClubCrest size={48} />
          <span className="text-sm font-semibold leading-5 text-brand-600">{CLUB_NAME}</span>
        </div>
        <h1 className="mt-6 text-[1.625rem] font-semibold leading-[2.125rem] text-brand-600 sm:text-display">ประกาศความเป็นส่วนตัว</h1>
        <p className="mt-2 text-sm text-ink-subtle">ฉบับวันที่ {formatThaiDate(POLICY_DATE)}</p>

        <div className="mt-6 grid gap-6 text-base text-ink">
          {sections.map((section) => (
            <section key={section.title}>
              <h2 className="text-h3 font-semibold text-ink">{section.title}</h2>
              <div className="mt-2 text-ink-muted">{section.body}</div>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
