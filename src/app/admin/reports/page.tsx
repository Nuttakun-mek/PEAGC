import { ReportsRevenueChart } from "@/components/reports-revenue-chart";
import { LoadErrorBanner, StatusBanner } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass, buttonPrimary, card, fieldInputClass, fieldLabel } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { getStaffClub } from "@/lib/auth/staff";
import { formatBaht, formatThaiDate, formatThaiDateShort } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { bangkokDate } from "@/lib/lessons/booking";
import { NO_DATA, eventAttendance, financeByEvent, lessonUsageByProgram, percent } from "@/lib/reports/aggregate";
import { coachTeachingHours, formatHours, lessonTotals, noShowRate } from "@/lib/reports/lessons";
import { type ReportData, financeRoles, loadReportData, reportPeriod, reportPresets, reportRoles } from "@/lib/reports/load";
import { monthlyRevenue } from "@/lib/reports/revenue";
import { sampleReportData } from "@/lib/reports/sample";

type PageProps = { searchParams: Promise<{ bypass?: string; from?: string; to?: string }> };

const th = "whitespace-nowrap py-2 pr-4 text-left text-xs font-medium text-ink-muted";
const thNum = "whitespace-nowrap py-2 pr-4 text-right text-xs font-medium text-ink-muted";
const td = "py-2.5 pr-4 align-top";
const tdNum = "whitespace-nowrap py-2.5 pr-4 text-right align-top tabular-nums";

/** "12,500 บาท" → "12,500": the KPI shows the unit smaller next to the number. */
function bahtNumber(value: number) {
  return formatBaht(value).replace(/\s*บาท$/, "");
}

/** Bar used inside table cells; width encodes the ratio, the text carries the exact value. */
function Ratio({ empty = NO_DATA, value }: { empty?: string; value: number | null }) {
  if (value === null) return <span className="text-sm text-ink-subtle">{empty}</span>;
  return (
    <div className="flex items-center gap-2">
      <div aria-hidden="true" className="h-2 w-24 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-brand-600" style={{ width: `${Math.min(100, Math.round(value * 100))}%` }} />
      </div>
      <span className="text-sm tabular-nums text-ink">{percent(value)}</span>
    </div>
  );
}

function Kpi({
  icon: Icon,
  label,
  note,
  unit,
  value,
}: {
  icon: (typeof appIcons)[keyof typeof appIcons];
  label: string;
  note?: string;
  unit?: string;
  value: string;
}) {
  return (
    <article className={card}>
      <p className="flex items-center gap-2 text-sm font-medium text-ink-muted">
        <Icon className="size-4" aria-hidden="true" />
        {label}
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-ink">
        <span className={`font-semibold tabular-nums ${unit ? "text-kpi" : "text-h2"}`}>{value}</span>
        {unit ? <span className="text-sm font-medium text-ink-muted">{unit}</span> : null}
      </p>
      {note ? <p className="mt-1 text-xs text-ink-subtle">{note}</p> : null}
    </article>
  );
}

/** A figure inside a section: label, value, one line of context. */
function Figure({ label, note, value }: { label: string; note: string; value: string }) {
  return (
    <div className="rounded-lg bg-canvas px-4 py-3">
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="mt-1 text-h2 font-semibold tabular-nums text-ink">{value}</dd>
      <dd className="mt-0.5 text-xs text-ink-subtle">{note}</dd>
    </div>
  );
}

function ReportsShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen px-4 py-6 text-ink">
      <section className="mx-auto w-full max-w-7xl">
        <PageHeader title="รายงาน" />
        <div className="mt-6">{children}</div>
      </section>
    </main>
  );
}

export default async function ReportsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: "/admin/reports", requiredRole: "admin", searchParams: params });
  await requireAdminArea("reports", access);
  const today = bangkokDate();
  const period = reportPeriod(params.from, params.to, today);

  let data: ReportData;
  if (access.isBypass) {
    data = sampleReportData(period, today);
  } else {
    if (!access.clubId) {
      return (
        <ReportsShell>
          <StatusBanner tone="error">บัญชีนี้ยังไม่ได้อยู่ในชมรมใด จึงยังดูรายงานไม่ได้</StatusBanner>
        </ReportsShell>
      );
    }
    const staff = await getStaffClub(reportRoles);
    if (staff.status !== "ok") {
      return (
        <ReportsShell>
          <StatusBanner tone="error">ไม่มีสิทธิ์ดูรายงาน</StatusBanner>
        </ReportsShell>
      );
    }
    // Money is shown only to the roles that may read payment_records (RLS would return no rows
    // for the others, which used to look like "no income").
    const finance = await getStaffClub(financeRoles);
    const paymentAccess = finance.status === "ok" && finance.clubId === staff.clubId;
    data = await loadReportData(staff.supabase, staff.clubId, period, { paymentAccess });
  }

  const finance = financeByEvent(data.payments);
  const revenue = monthlyRevenue(data.revenue, period);
  const lessons = lessonUsageByProgram(data.slots, data.bookings);
  const lessonSum = lessonTotals(lessons);
  const coaches = coachTeachingHours(data.coachSlots, today, data.coachNames);
  const coachTotals = coaches.reduce(
    (sum, row) => ({ planned: sum.planned + row.plannedMinutes, taught: sum.taught + row.taughtMinutes }),
    { planned: 0, taught: 0 },
  );
  const events = eventAttendance(data.events, data.registrations);
  const pendingSlips = finance.lines.reduce((sum, line) => sum + line.pendingCount, 0);
  const count = (value: number) => value.toLocaleString("th-TH");
  const bypassQuery = access.isBypass ? "&bypass=admin" : "";
  const periodQuery = `from=${period.from}&to=${period.to}`;

  return (
    <main className="min-h-screen px-4 py-6 text-ink">
      <section className="mx-auto w-full max-w-7xl">
        <PageHeader description="รายรับ การจองที่นั่งเรียน ชั่วโมงสอน และการเข้าร่วมกิจกรรม ตามช่วงวันที่เลือก" title="รายงาน" />

        {access.isBypass ? (
          <StatusBanner className="mt-4" tone="warning">
            โหมดผู้ดูแลทดลอง: ตัวเลขทั้งหมดเป็นข้อมูลตัวอย่าง
          </StatusBanner>
        ) : null}
        <LoadErrorBanner className="mt-4" error={data.loadError} />

        <section aria-labelledby="report-period-title" className={`${card} mt-6`}>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h2 className="text-sm font-medium text-ink-muted" id="report-period-title">
                ช่วงที่แสดง
              </h2>
              <p className="mt-1 text-h2 font-semibold text-ink">
                {formatThaiDate(period.from)} – {formatThaiDate(period.to)}
              </p>
            </div>
            <form className="grid grid-cols-2 gap-3 sm:flex sm:items-end">
              {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
              <label className="block min-w-0">
                <span className={fieldLabel}>ตั้งแต่</span>
                <input className={fieldInputClass("sm")} defaultValue={period.from} name="from" required type="date" />
              </label>
              <label className="block min-w-0">
                <span className={fieldLabel}>ถึง</span>
                <input className={fieldInputClass("sm")} defaultValue={period.to} name="to" required type="date" />
              </label>
              <button className={`${buttonPrimary} col-span-2 sm:col-span-1`} type="submit">
                แสดง
              </button>
            </form>
          </div>

          <nav aria-label="ช่วงเวลาด่วน" className="mt-4 flex flex-wrap gap-2">
            {reportPresets(today).map((preset) => {
              const active = preset.from === period.from && preset.to === period.to;
              return (
                <a
                  aria-current={active ? "true" : undefined}
                  className={`inline-flex h-9 items-center rounded-full border px-3.5 text-sm font-medium transition ${active ? "border-brand-600 bg-brand-600 text-white" : "border-line bg-white text-brand-600 hover:border-brand-600 hover:bg-brand-50"}`}
                  href={`/admin/reports?from=${preset.from}&to=${preset.to}${bypassQuery}`}
                  key={preset.label}
                  title={`${formatThaiDate(preset.from)} – ${formatThaiDate(preset.to)}`}
                >
                  {preset.label}
                </a>
              );
            })}
          </nav>
          <p className="mt-3 text-xs text-ink-subtle">ปีงบประมาณ = 1 ต.ค. – 30 ก.ย. · เลือกวันในอนาคตได้ เพื่อดูรอบเรียนและกิจกรรมที่จะถึง</p>
        </section>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {data.paymentAccess ? (
            <>
              <Kpi
                icon={appIcons.payments}
                label="รายรับที่อนุมัติ"
                note={`สุทธิหลังคืนเงิน ${formatBaht(finance.totals.net)}`}
                unit="บาท"
                value={bahtNumber(finance.totals.approved)}
              />
              <Kpi
                icon={appIcons.payments}
                label="สลิปรอตรวจ"
                note={pendingSlips ? `${count(pendingSlips)} สลิป` : "ไม่มีสลิปค้างตรวจ"}
                unit="บาท"
                value={bahtNumber(finance.totals.pending)}
              />
            </>
          ) : (
            <Kpi icon={appIcons.payments} label="การเงิน" note="ดูได้เฉพาะเจ้าหน้าที่การเงิน ผู้ดูแลชมรม หรือผู้ตรวจสอบ" value="ไม่มีสิทธิ์ดู" />
          )}
          {lessonSum.seats ? (
            <Kpi
              icon={appIcons.lessons}
              label="ที่นั่งเรียนที่จอง"
              note={`จองแล้ว ${percent(lessonSum.fillRate)} ของที่นั่งทั้งหมด`}
              unit={`/ ${count(lessonSum.seats)} ที่นั่ง`}
              value={count(lessonSum.booked)}
            />
          ) : (
            <Kpi icon={appIcons.lessons} label="ที่นั่งเรียนที่จอง" note="ไม่มีรอบเรียนในช่วงนี้" value={NO_DATA} />
          )}
          <Kpi
            icon={appIcons.members}
            label="สมาชิกใช้งาน"
            note={`รออนุมัติ ${count(data.members.pending)} คน · สมัครใหม่ในช่วงนี้ ${count(data.members.new)} คน`}
            unit="คน"
            value={count(data.members.active)}
          />
        </div>

        {data.paymentAccess ? (
          <section aria-labelledby="report-revenue-title" className={`${card} mt-6`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="report-revenue-title">
                  <appIcons.reports className="size-5 text-brand-600" aria-hidden="true" />
                  รายรับรายเดือน
                </h2>
                <p className="mt-1 text-sm text-ink-muted">
                  สลิปที่อนุมัติแล้ว นับตามเดือนที่อนุมัติ · รวม <span className="font-semibold tabular-nums text-ink">{formatBaht(revenue.total)}</span>
                </p>
              </div>
              {!access.isBypass && revenue.total ? (
                <a className={buttonClass("secondary", "sm")} href={`/admin/reports/export?kind=monthly&${periodQuery}`}>
                  <appIcons.download className="size-4" aria-hidden="true" />
                  CSV รายเดือน
                </a>
              ) : null}
            </div>
            <div className="mt-4">
              {revenue.total ? (
                <ReportsRevenueChart revenue={revenue} />
              ) : (
                <p className="text-sm text-ink-muted">ยังไม่มีสลิปที่อนุมัติในช่วงนี้</p>
              )}
            </div>
          </section>
        ) : null}

        <section aria-labelledby="report-finance-title" className={`${card} mt-6`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="report-finance-title">
              <appIcons.payments className="size-5 text-brand-600" aria-hidden="true" />
              การเงินรายกิจกรรม
            </h2>
            {data.paymentAccess && !access.isBypass ? (
              <a className={buttonClass("secondary", "sm")} href={`/admin/reports/export?${periodQuery}`}>
                <appIcons.download className="size-4" aria-hidden="true" />
                CSV สำหรับบัญชี
              </a>
            ) : null}
          </div>
          {!data.paymentAccess ? (
            <p className="mt-3 text-sm text-ink-muted">ข้อมูลการเงินดูได้เฉพาะเจ้าหน้าที่การเงิน ผู้ดูแลชมรม หรือผู้ตรวจสอบ</p>
          ) : finance.lines.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th} scope="col">กิจกรรม</th>
                    <th className={thNum} scope="col">อนุมัติแล้ว</th>
                    <th className={thNum} scope="col">สลิปรอตรวจ</th>
                    <th className={thNum} scope="col">คืนเงิน</th>
                    <th className={thNum} scope="col">สุทธิ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {finance.lines.map((line) => (
                    <tr key={line.eventId}>
                      <td className={td}>{line.eventName}</td>
                      <td className={tdNum}>
                        {formatBaht(line.approved)}
                        <span className="block text-xs text-ink-subtle">{count(line.approvedCount)} รายการ</span>
                      </td>
                      <td className={tdNum}>
                        {formatBaht(line.pending)}
                        <span className="block text-xs text-ink-subtle">{count(line.pendingCount)} สลิป</span>
                      </td>
                      <td className={tdNum}>{formatBaht(line.refunded)}</td>
                      <td className={`${tdNum} font-semibold`}>{formatBaht(line.approved - line.refunded)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-line font-semibold">
                  <tr>
                    <th className={`${td} text-left`} scope="row">รวม</th>
                    <td className={tdNum}>{formatBaht(finance.totals.approved)}</td>
                    <td className={tdNum}>{formatBaht(finance.totals.pending)}</td>
                    <td className={tdNum}>{formatBaht(finance.totals.refunded)}</td>
                    <td className={tdNum}>{formatBaht(finance.totals.net)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">ไม่มีรายการชำระเงินในช่วงนี้</p>
          )}
        </section>

        <section aria-labelledby="report-lessons-title" className={`${card} mt-6`}>
          <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="report-lessons-title">
            <appIcons.lessons className="size-5 text-brand-600" aria-hidden="true" />
            คอร์สเรียน
          </h2>
          {lessons.length ? (
            <>
              <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                <Figure
                  label="อัตราการจอง"
                  note={`จอง ${count(lessonSum.booked)} จาก ${count(lessonSum.seats)} ที่นั่ง ใน ${count(lessonSum.slots)} รอบ`}
                  value={percent(lessonSum.fillRate)}
                />
                <Figure
                  label="ไม่มาเรียน"
                  note={
                    lessonSum.attended + lessonSum.noShow
                      ? `ไม่มา ${count(lessonSum.noShow)} จาก ${count(lessonSum.attended + lessonSum.noShow)} คนที่เช็กชื่อแล้ว`
                      : "ยังไม่มีการเช็กชื่อเข้าเรียนในช่วงนี้"
                  }
                  value={percent(lessonSum.noShowRate)}
                />
                <Figure
                  label="ชั่วโมงสอนแล้ว"
                  note={coachTotals.planned ? `ยังต้องสอนอีก ${formatHours(coachTotals.planned)}` : "ไม่มีรอบที่จะถึงในช่วงนี้"}
                  value={formatHours(coachTotals.taught)}
                />
              </dl>

              <div className="mt-4 overflow-x-auto">
                <table className="min-w-full text-sm">
                  <caption className="sr-only">ที่นั่งและการเข้าเรียนแยกตามคอร์ส</caption>
                  <thead className="border-b border-line">
                    <tr>
                      <th className={th} scope="col">คอร์ส</th>
                      <th className={thNum} scope="col">รอบ</th>
                      <th className={thNum} scope="col">ที่นั่ง</th>
                      <th className={thNum} scope="col">จอง</th>
                      <th className={th} scope="col">อัตราการจอง</th>
                      <th className={thNum} scope="col">คิวสำรองเกินที่นั่ง</th>
                      <th className={thNum} scope="col">มาเรียน</th>
                      <th className={thNum} scope="col">ไม่มา</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {lessons.map((row) => {
                      const rate = noShowRate(row.attended, row.noShow);
                      return (
                        <tr key={row.programId}>
                          <td className={td}>{row.programName}</td>
                          <td className={tdNum}>{count(row.slots)}</td>
                          <td className={tdNum}>{count(row.seats)}</td>
                          <td className={tdNum}>{count(row.booked)}</td>
                          <td className={td}>
                            <Ratio value={row.seats ? row.utilization : null} />
                          </td>
                          <td className={tdNum}>{count(row.waitlisted)}</td>
                          <td className={tdNum}>{count(row.attended)}</td>
                          <td className={tdNum}>
                            {count(row.noShow)}
                            {rate !== null && row.noShow ? <span className="text-ink-subtle"> · {percent(rate)}</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">ไม่มีรอบเรียนในช่วงนี้</p>
          )}
        </section>

        <section aria-labelledby="report-coaches-title" className={`${card} mt-6`}>
          <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="report-coaches-title">
            <appIcons.coach className="size-5 text-brand-600" aria-hidden="true" />
            ชั่วโมงสอนของผู้สอน
          </h2>
          {coaches.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <caption className="sr-only">ชั่วโมงสอนแยกตามผู้สอน นับจากเวลาเริ่มถึงเวลาเลิกของแต่ละรอบ</caption>
                <thead className="border-b border-line">
                  <tr>
                    <th className={th} scope="col">ผู้สอน</th>
                    <th className={thNum} scope="col">รอบ</th>
                    <th className={thNum} scope="col">สอนแล้ว</th>
                    <th className={thNum} scope="col">ที่จะสอน</th>
                    <th className={thNum} scope="col">รวม</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {coaches.map((row) => (
                    <tr key={row.key}>
                      <td className={`${td} ${row.key === "none" ? "text-ink-subtle" : ""}`}>{row.name}</td>
                      <td className={tdNum}>{count(row.slots)}</td>
                      <td className={tdNum}>{formatHours(row.taughtMinutes)}</td>
                      <td className={tdNum}>{formatHours(row.plannedMinutes)}</td>
                      <td className={`${tdNum} font-semibold`}>{formatHours(row.totalMinutes)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-ink-subtle">นับจากเวลาเริ่มถึงเวลาเลิกของรอบเรียนที่ไม่ได้ยกเลิก · สอนแล้ว = รอบที่วันเรียนถึงแล้ว</p>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">ไม่มีรอบเรียนในช่วงนี้</p>
          )}
        </section>

        <section aria-labelledby="report-events-title" className={`${card} mt-6`}>
          <h2 className="flex items-center gap-2 text-h3 font-semibold text-ink" id="report-events-title">
            <appIcons.events className="size-5 text-brand-600" aria-hidden="true" />
            การเข้าร่วมกิจกรรม
          </h2>
          {events.length ? (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="border-b border-line">
                  <tr>
                    <th className={th} scope="col">วันที่</th>
                    <th className={th} scope="col">กิจกรรม</th>
                    <th className={thNum} scope="col">ผู้เล่น</th>
                    <th className={th} scope="col">ความเต็ม</th>
                    <th className={thNum} scope="col">เช็กอิน</th>
                    <th className={thNum} scope="col">ไม่มา</th>
                    <th className={thNum} scope="col">คิวสำรอง</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {events.map((row) => (
                    <tr key={row.eventId}>
                      <td className={`${td} whitespace-nowrap`}>{formatThaiDateShort(row.eventDate)}</td>
                      <td className={td}>
                        {access.isBypass ? (
                          <span className="font-medium text-ink">{row.name}</span>
                        ) : (
                          <a className="font-medium text-brand-600 underline-offset-2 hover:underline" href={`/admin/events/${row.eventId}`}>
                            {row.name}
                          </a>
                        )}
                      </td>
                      <td className={tdNum}>
                        {count(row.seats)}
                        {row.capacity ? <span className="text-ink-subtle"> / {count(row.capacity)}</span> : null}
                      </td>
                      <td className={td}>
                        <Ratio empty="ไม่จำกัดที่นั่ง" value={row.fill} />
                      </td>
                      <td className={tdNum}>{count(row.checkedIn)}</td>
                      <td className={tdNum}>
                        {count(row.noShow)}
                        {row.noShow ? <span className="text-ink-subtle"> · {percent(row.noShowRate)}</span> : null}
                      </td>
                      <td className={tdNum}>{count(row.waitlist)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink-muted">ไม่มีกิจกรรมในช่วงนี้</p>
          )}
        </section>
      </section>
    </main>
  );
}
