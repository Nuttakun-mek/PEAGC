import { BarChart3, CalendarDays, CircleDollarSign, Download, GraduationCap, UsersRound } from "lucide-react";

import { StatusBanner } from "@/components/status-banner";
import { resolveAccess } from "@/lib/auth/access";
import { getStaffClub } from "@/lib/auth/staff";
import { baht, eventAttendance, financeByEvent, lessonUsageByProgram, percent } from "@/lib/reports/aggregate";
import { loadReportData, reportPeriod, reportRoles } from "@/lib/reports/load";

type PageProps = { searchParams: Promise<{ bypass?: string; from?: string; to?: string }> };

const card = "rounded-lg border border-[#e6e2ee] bg-white p-5 shadow-[0_12px_30px_rgba(114,34,87,0.06)]";
const th = "py-2 pr-4 text-left text-xs font-semibold text-[#6b6475]";
const td = "py-2 pr-4 tabular-nums";

/** Bar used inside table cells; width encodes the ratio, the text carries the exact value. */
function Ratio({ value }: { value: number | null }) {
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-[#f1eef5]">
        <div className="h-full rounded-full bg-[#722257]" style={{ width: `${Math.min(100, Math.round((value ?? 0) * 100))}%` }} />
      </div>
      <span className="text-xs tabular-nums">{percent(value)}</span>
    </div>
  );
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: "/admin/reports", requiredRole: "admin", searchParams: params });
  const period = reportPeriod(params.from, params.to);

  if (access.isBypass || !access.clubId) {
    return (
      <main className="px-4 py-6">
        <StatusBanner className="mx-auto max-w-3xl" tone="warning">รายงานต้องเข้าสู่ระบบด้วยบัญชีผู้ดูแลจริง</StatusBanner>
      </main>
    );
  }

  const staff = await getStaffClub(reportRoles);
  if (staff.status !== "ok") {
    return (
      <main className="px-4 py-6">
        <StatusBanner className="mx-auto max-w-3xl" tone="error">ไม่มีสิทธิ์ดูรายงาน</StatusBanner>
      </main>
    );
  }

  const data = await loadReportData(staff.supabase, staff.clubId, period);
  const finance = financeByEvent(data.payments);
  const lessons = lessonUsageByProgram(data.slots, data.bookings);
  const events = eventAttendance(data.events, data.registrations);
  const lessonTotals = lessons.reduce(
    (sum, row) => ({ attended: sum.attended + row.attended, booked: sum.booked + row.booked, seats: sum.seats + row.seats }),
    { attended: 0, booked: 0, seats: 0 },
  );

  const kpis = [
    { icon: CircleDollarSign, label: "รายรับที่อนุมัติ", value: data.paymentAccess ? baht(finance.totals.approved) : "-" },
    { icon: CircleDollarSign, label: "รอตรวจสอบ", value: data.paymentAccess ? baht(finance.totals.pending) : "-" },
    { icon: GraduationCap, label: "ที่นั่งเรียนที่จอง", value: `${lessonTotals.booked}/${lessonTotals.seats} (${percent(lessonTotals.seats ? lessonTotals.booked / lessonTotals.seats : null)})` },
    { icon: UsersRound, label: "สมาชิกใช้งาน / รออนุมัติ", value: `${data.members.active} / ${data.members.pending}` },
  ];

  return (
    <main className="min-h-screen px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">ระบบผู้ดูแล</p>
            <h1 className="mt-1 flex items-center gap-2 text-3xl font-semibold text-[#722257]">
              <BarChart3 className="size-7" aria-hidden="true" /> รายงานการเงินและการใช้งาน
            </h1>
            <p className="mt-2 text-sm text-[#6b6475]">ช่วง {period.from} ถึง {period.to} · สมาชิกใหม่ในช่วงนี้ {data.members.new} คน</p>
          </div>
          <form className="flex flex-wrap items-end gap-2">
            <label className="text-xs font-semibold">ตั้งแต่<input className="mt-1 block h-10 rounded-md border border-[#d9d3e6] px-2 text-sm" defaultValue={period.from} name="from" type="date" /></label>
            <label className="text-xs font-semibold">ถึง<input className="mt-1 block h-10 rounded-md border border-[#d9d3e6] px-2 text-sm" defaultValue={period.to} name="to" type="date" /></label>
            <button className="h-10 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white" type="submit">แสดง</button>
          </form>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((item) => (
            <article className={card} key={item.label}>
              <p className="flex items-center gap-2 text-xs font-semibold text-[#6b6475]"><item.icon className="size-4" aria-hidden="true" />{item.label}</p>
              <p className="mt-2 text-xl font-semibold text-[#722257]">{item.value}</p>
            </article>
          ))}
        </div>

        <section className={`${card} mt-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]"><CircleDollarSign className="size-5" aria-hidden="true" />การเงินรายกิจกรรม</h2>
            {data.paymentAccess ? (
              <a className="flex h-9 items-center gap-2 rounded-md border border-[#d9d3e6] px-3 text-sm font-semibold text-[#722257]" href={`/admin/reports/export?from=${period.from}&to=${period.to}`}>
                <Download className="size-4" aria-hidden="true" /> CSV สำหรับบัญชี
              </a>
            ) : null}
          </div>
          {!data.paymentAccess ? (
            <p className="mt-3 text-sm text-[#6b6475]">ข้อมูลการเงินดูได้เฉพาะเจ้าหน้าที่การเงิน ผู้ดูแลชมรม หรือผู้ตรวจสอบ</p>
          ) : finance.lines.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr><th className={th}>กิจกรรม</th><th className={th}>อนุมัติแล้ว</th><th className={th}>รอตรวจ</th><th className={th}>คืนเงิน</th><th className={th}>สุทธิ</th></tr></thead>
                <tbody className="divide-y divide-[#f3f0f6]">
                  {finance.lines.map((line) => (
                    <tr key={line.eventId}>
                      <td className="py-2 pr-4">{line.eventName}</td>
                      <td className={td}>{baht(line.approved)} <span className="text-xs text-[#98a2b3]">({line.approvedCount})</span></td>
                      <td className={td}>{baht(line.pending)} <span className="text-xs text-[#98a2b3]">({line.pendingCount})</span></td>
                      <td className={td}>{baht(line.refunded)}</td>
                      <td className={`${td} font-semibold`}>{baht(line.approved - line.refunded)}</td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="py-2 pr-4">รวม</td><td className={td}>{baht(finance.totals.approved)}</td><td className={td}>{baht(finance.totals.pending)}</td>
                    <td className={td}>{baht(finance.totals.refunded)}</td><td className={td}>{baht(finance.totals.net)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#6b6475]">ไม่มีรายการชำระเงินในช่วงนี้</p>
          )}
        </section>

        <section className={`${card} mt-6`}>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]"><GraduationCap className="size-5" aria-hidden="true" />การใช้ที่นั่งคอร์สเรียน</h2>
          {lessons.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr><th className={th}>คอร์ส</th><th className={th}>รอบ</th><th className={th}>ที่นั่ง</th><th className={th}>จอง</th><th className={th}>อัตราการจอง</th><th className={th}>คิวสำรองล้น</th><th className={th}>มาเรียน</th><th className={th}>ไม่มา</th></tr></thead>
                <tbody className="divide-y divide-[#f3f0f6]">
                  {lessons.map((row) => (
                    <tr key={row.programId}>
                      <td className="py-2 pr-4">{row.programName}</td><td className={td}>{row.slots}</td><td className={td}>{row.seats}</td><td className={td}>{row.booked}</td>
                      <td className="py-2 pr-4"><Ratio value={row.utilization} /></td>
                      <td className={td}>{row.waitlisted}</td><td className={td}>{row.attended}</td><td className={td}>{row.noShow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#6b6475]">ไม่มีรอบเรียนในช่วงนี้</p>
          )}
        </section>

        <section className={`${card} mt-6`}>
          <h2 className="flex items-center gap-2 text-lg font-semibold text-[#722257]"><CalendarDays className="size-5" aria-hidden="true" />การเข้าร่วมกิจกรรม</h2>
          {events.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead><tr><th className={th}>วันที่</th><th className={th}>กิจกรรม</th><th className={th}>ผู้เล่น</th><th className={th}>เต็ม</th><th className={th}>เช็กอิน</th><th className={th}>ไม่มา</th><th className={th}>สำรอง</th></tr></thead>
                <tbody className="divide-y divide-[#f3f0f6]">
                  {events.map((row) => (
                    <tr key={row.eventId}>
                      <td className={td}>{row.eventDate}</td>
                      <td className="py-2 pr-4"><a className="font-semibold text-[#722257] hover:underline" href={`/admin/events/${row.eventId}`}>{row.name}</a></td>
                      <td className={td}>{row.seats}{row.capacity ? `/${row.capacity}` : ""}</td>
                      <td className="py-2 pr-4"><Ratio value={row.fill} /></td>
                      <td className={td}>{row.checkedIn}</td>
                      <td className={td}>{row.noShow} <span className="text-xs text-[#98a2b3]">({percent(row.noShowRate)})</span></td>
                      <td className={td}>{row.waitlist}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-[#6b6475]">ไม่มีกิจกรรมในช่วงนี้</p>
          )}
        </section>
      </section>
    </main>
  );
}
