import Link from "next/link";
import { ArrowLeft, ChevronDown, MapPin } from "lucide-react";

import { ConfirmSubmitButton } from "@/components/confirm-submit-button";
import { CreatePanel } from "@/components/create-panel";
import { HoleGrid } from "@/components/events-hole-grid";
import { LoadErrorBanner, StatusBanner, toneForStatus } from "@/components/status-banner";
import { SubmitButton } from "@/components/submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { buttonClass, buttonPrimary, card, fieldHint, fieldInput, fieldLabel, fieldTextarea } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";
import { getStaffClub } from "@/lib/auth/staff";
import { orUnset } from "@/lib/display";
import { appIcons } from "@/lib/icons";
import { type TeeColor, isTeeColor, sumPars, teeColorLabels, teeColorSwatch, teeColors } from "@/lib/scoring/courses";
import { scoringRoles } from "@/lib/scoring/data";
import { defaultRules } from "@/lib/scoring/engine";
import { collectLoadErrors, dbFailureMessages } from "@/lib/supabase/errors";

import { archiveCourse, archiveTee, createCourse, saveTee, updateCourse } from "./actions";

type PageProps = { searchParams: Promise<{ bypass?: string; status?: string }> };

type Tee = {
  archived_at: string | null;
  color: string | null;
  course_id: string;
  course_rating: number | null;
  id: string;
  name: string;
  par: number[];
  slope_rating: number | null;
  stroke_index: number[];
};

type Course = { archived_at: string | null; id: string; name: string; note: string | null; province: string | null };

const statusMessages: Record<string, string> = {
  ...dbFailureMessages,
  "course-archived": "เก็บสนามแล้ว ไม่แสดงในตัวเลือกกิจกรรม",
  "course-created": "เพิ่มสนามแล้ว เพิ่มทีของสนามต่อได้เลย",
  "course-failed": "บันทึกสนามไม่สำเร็จ",
  "course-restored": "นำสนามกลับมาแล้ว",
  "course-saved": "บันทึกสนามแล้ว",
  "invalid-pars": "พาร์ต้องครบ 18 หลุม หลุมละ 3-6",
  "invalid-rating": "Course rating ต้องอยู่ระหว่าง 50-90 และ Slope 55-155 ใส่คู่กันหรือเว้นว่างทั้งคู่",
  "invalid-si": "ลำดับความยาก (SI) ต้องเป็นเลข 1-18 ไม่ซ้ำกัน ครบ 18 หลุม",
  "missing-name": "กรอกชื่อสนามก่อนบันทึก",
  "missing-tee-name": "ตั้งชื่อที เช่น ทีขาว",
  "tee-archived": "ลบทีออกจากรายการแล้ว กิจกรรมเดิมยังใช้ข้อมูลเดิม",
  "tee-created": "เพิ่มทีแล้ว",
  "tee-failed": "บันทึกทีไม่สำเร็จ",
  "tee-saved": "บันทึกทีแล้ว",
  "text-corrupted": "ข้อความภาษาไทยเสียหาย (แสดงเป็น ???) พิมพ์ใหม่ก่อนบันทึก",
};

const sampleCourses: Course[] = [
  { archived_at: null, id: "sample-course-1", name: "สนามกอล์ฟรอยัล", note: "จองผ่านคุณสมศักดิ์ 089-100-0004", province: "ปทุมธานี" },
  { archived_at: null, id: "sample-course-2", name: "สนามกอล์ฟบางพระ", note: null, province: "ชลบุรี" },
];

const sampleTees: Tee[] = [
  { archived_at: null, color: "blue", course_id: "sample-course-1", course_rating: 73.4, id: "sample-tee-1", name: "ทีน้ำเงิน", par: defaultRules.pars, slope_rating: 131, stroke_index: defaultRules.strokeIndex },
  { archived_at: null, color: "white", course_id: "sample-course-1", course_rating: 71.2, id: "sample-tee-2", name: "ทีขาว", par: defaultRules.pars, slope_rating: 125, stroke_index: defaultRules.strokeIndex },
  { archived_at: null, color: "red", course_id: "sample-course-1", course_rating: 69.8, id: "sample-tee-3", name: "ทีแดง", par: defaultRules.pars, slope_rating: 118, stroke_index: defaultRules.strokeIndex },
];

function TeeDot({ color }: { color: string | null }) {
  if (!isTeeColor(color)) return <span aria-hidden="true" className="inline-block size-3 rounded-full border border-dashed border-line" />;
  return (
    <span
      aria-hidden="true"
      className="inline-block size-3 shrink-0 rounded-full border border-ink-subtle/40"
      style={{ backgroundColor: teeColorSwatch[color as TeeColor] }}
    />
  );
}

function TeeForm({ courseId, disabled, tee }: { courseId: string; disabled: boolean; tee?: Tee }) {
  const SaveIcon = appIcons.save;
  const idPrefix = tee ? `tee-${tee.id}` : `new-tee-${courseId}`;
  return (
    <form action={saveTee} className="grid gap-4">
      <input name="courseId" type="hidden" value={courseId} />
      {tee ? <input name="teeId" type="hidden" value={tee.id} /> : null}
      <div className="grid gap-3 sm:grid-cols-4">
        <label className="block sm:col-span-2">
          <span className={fieldLabel}>
            ชื่อที
            <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
          </span>
          <input className={fieldInput} defaultValue={tee?.name ?? ""} disabled={disabled} name="name" placeholder="เช่น ทีขาว" required />
        </label>
        <label className="block">
          <span className={fieldLabel}>สีที</span>
          <select className={fieldInput} defaultValue={tee?.color ?? ""} disabled={disabled} name="color">
            <option value="">ไม่ระบุ</option>
            {teeColors.map((color) => (
              <option key={color} value={color}>{teeColorLabels[color]}</option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3 sm:col-span-4 sm:max-w-md">
          <label className="block">
            <span className={fieldLabel}>Course rating</span>
            <input
              className={`${fieldInput} tabular-nums`}
              defaultValue={tee?.course_rating ?? ""}
              disabled={disabled}
              inputMode="decimal"
              max={90}
              min={50}
              name="courseRating"
              placeholder="เช่น 71.2"
              step="0.1"
              type="number"
            />
          </label>
          <label className="block">
            <span className={fieldLabel}>Slope rating</span>
            <input
              className={`${fieldInput} tabular-nums`}
              defaultValue={tee?.slope_rating ?? ""}
              disabled={disabled}
              inputMode="numeric"
              max={155}
              min={55}
              name="slopeRating"
              placeholder="เช่น 125"
              type="number"
            />
          </label>
          <span className={`${fieldHint} col-span-2`}>ดูจากสกอร์การ์ดของสนาม ถ้าไม่มีให้เว้นว่าง รอบที่เล่นทีนี้จะยังไม่นับแต้มต่อชมรม</span>
        </div>
      </div>
      <fieldset>
        <legend className={fieldLabel}>พาร์และลำดับความยาก (SI) รายหลุม</legend>
        <div className="mt-1.5">
          <HoleGrid
            disabled={disabled}
            idPrefix={idPrefix}
            pars={tee?.par ?? defaultRules.pars}
            strokeIndex={tee?.stroke_index ?? Array.from({ length: 18 }, () => null)}
          />
        </div>
        <span className={fieldHint}>SI 1 = หลุมยากที่สุด ใช้เลข 1-18 ไม่ซ้ำกัน</span>
      </fieldset>
      <SubmitButton className={`${buttonPrimary} w-full sm:w-fit`} disabled={disabled}>
        <SaveIcon className="size-4" aria-hidden="true" />
        {tee ? "บันทึกที" : "เพิ่มที"}
      </SubmitButton>
    </form>
  );
}

export default async function CoursesPage({ searchParams }: PageProps) {
  const query = await searchParams;
  const access = await resolveAccess({ allowBypassRole: "admin", nextPath: "/admin/events/courses", requiredRole: "admin", searchParams: query });
  await requireAdminArea("events", access);

  let courses: Course[] = sampleCourses;
  let tees: Tee[] = sampleTees;
  let loadError: ReturnType<typeof collectLoadErrors> = null;
  let forbidden = false;

  if (!access.isBypass && access.clubId) {
    const staff = await getStaffClub(scoringRoles);
    if (staff.status !== "ok") {
      forbidden = true;
      courses = [];
      tees = [];
    } else {
      const [{ data: courseData, error: courseError }, { data: teeData, error: teeError }] = await Promise.all([
        staff.supabase.from("golf_courses").select("id, name, province, note, archived_at").eq("club_id", staff.clubId).order("name").limit(200),
        staff.supabase
          .from("golf_course_tees")
          .select("id, course_id, name, color, course_rating, slope_rating, par, stroke_index, archived_at")
          .eq("club_id", staff.clubId)
          .is("archived_at", null)
          .order("course_rating", { ascending: false, nullsFirst: false })
          .limit(1000),
      ]);
      courses = (courseData ?? []) as Course[];
      tees = (teeData ?? []) as Tee[];
      loadError = collectLoadErrors("admin.courses", [
        { error: courseError, label: "สนาม" },
        { error: teeError, label: "ที" },
      ]);
    }
  }

  const disabled = access.isBypass || forbidden;
  const active = courses.filter((course) => !course.archived_at);
  const archived = courses.filter((course) => course.archived_at);
  const statusMessage = query.status ? statusMessages[query.status] : null;
  const EditIcon = appIcons.edit;
  const AddIcon = appIcons.add;
  const DeleteIcon = appIcons.delete;
  const SaveIcon = appIcons.save;

  return (
    <main className="min-h-screen px-4 py-6 text-ink sm:px-6">
      <section className="mx-auto w-full max-w-5xl">
        <Link
          className="inline-flex items-center gap-1 text-sm font-medium text-ink-muted hover:text-brand-600"
          href={access.isBypass ? "/admin/events?bypass=admin" : "/admin/events"}
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          กิจกรรมออกรอบ
        </Link>
        <div className="mt-2">
          <PageHeader
            description="พาร์ ลำดับความยาก (SI) Course rating และ Slope ของแต่ละที ใช้คิดคะแนนและแต้มต่อชมรม"
            title="สนามและที"
          />
        </div>

        {statusMessage ? (
          <StatusBanner className="mt-5" floating tone={toneForStatus(query.status)}>{statusMessage}</StatusBanner>
        ) : null}
        <LoadErrorBanner error={loadError} />
        {access.isBypass ? (
          <StatusBanner className="mt-5" tone="warning">โหมดทดลอง: แสดงข้อมูลตัวอย่างและบันทึกไม่ได้</StatusBanner>
        ) : null}
        {forbidden ? (
          <StatusBanner className="mt-5" tone="error">หน้านี้เฉพาะกรรมการ ผู้อำนวยการการแข่งขัน หรือทีมงานกิจกรรม</StatusBanner>
        ) : null}

        <CreatePanel
          defaultOpen={query.status === "missing-name"}
          hint="ชื่อสนามและจังหวัด แล้วเพิ่มทีแต่ละสีพร้อมพาร์และ SI"
          title="เพิ่มสนาม"
        >
          <form action={createCourse} className="grid gap-4 sm:grid-cols-2">
            <label className="block">
              <span className={fieldLabel}>
                ชื่อสนาม
                <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
              </span>
              <input className={fieldInput} disabled={disabled} name="name" placeholder="เช่น สนามกอล์ฟรอยัล" required />
            </label>
            <label className="block">
              <span className={fieldLabel}>จังหวัด</span>
              <input className={fieldInput} disabled={disabled} name="province" placeholder="เช่น ปทุมธานี" />
            </label>
            <label className="block sm:col-span-2">
              <span className={fieldLabel}>หมายเหตุ</span>
              <textarea className={fieldTextarea} disabled={disabled} name="note" placeholder="ผู้ประสานงาน เบอร์จองสนาม ฯลฯ" rows={2} />
            </label>
            <SubmitButton className={`${buttonPrimary} w-full sm:w-fit`} disabled={disabled}>
              <AddIcon className="size-4" aria-hidden="true" />
              เพิ่มสนาม
            </SubmitButton>
          </form>
        </CreatePanel>

        <div className="mt-6 grid gap-5">
          {active.length ? (
            active.map((course) => {
              const courseTees = tees.filter((tee) => tee.course_id === course.id);
              return (
                <article className={`${card} scroll-mt-20`} id={`course-${course.id}`} key={course.id}>
                  <header className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="text-h2 font-semibold text-ink">{course.name}</h2>
                      <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-muted">
                        <MapPin className="size-4 text-ink-subtle" aria-hidden="true" />
                        {orUnset(course.province)} · ที <span className="tabular-nums">{courseTees.length}</span> สี
                      </p>
                      {course.note ? <p className="mt-1 text-sm text-ink-muted">{course.note}</p> : null}
                    </div>
                  </header>

                  {courseTees.length ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="min-w-full text-sm">
                        <thead>
                          <tr className="border-b border-line text-left text-xs text-ink-subtle">
                            <th className="py-2 pr-3 font-medium" scope="col">ที</th>
                            <th className="py-2 pr-3 text-right font-medium" scope="col">พาร์</th>
                            <th className="py-2 pr-3 text-right font-medium" scope="col">Course rating</th>
                            <th className="py-2 pr-3 text-right font-medium" scope="col">Slope</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {courseTees.map((tee) => (
                            <tr className="scroll-mt-20" id={`tee-${tee.id}`} key={tee.id}>
                              <td className="py-2 pr-3">
                                <span className="flex items-center gap-2 font-semibold text-ink">
                                  <TeeDot color={tee.color} />
                                  {tee.name}
                                </span>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">
                                {sumPars(tee.par)}
                                <span className="text-xs text-ink-subtle"> ({sumPars(tee.par, 0, 9)}/{sumPars(tee.par, 9)})</span>
                              </td>
                              <td className="py-2 pr-3 text-right tabular-nums">{tee.course_rating !== null ? Number(tee.course_rating).toFixed(1) : <span className="text-ink-subtle">ไม่มี</span>}</td>
                              <td className="py-2 pr-3 text-right tabular-nums">{tee.slope_rating ?? <span className="text-ink-subtle">ไม่มี</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="mt-4 rounded-lg bg-canvas px-4 py-3 text-sm text-ink-muted">ยังไม่มีที เพิ่มทีด้านล่างก่อนใช้สนามนี้คิดคะแนน</p>
                  )}

                  <div className="mt-4 grid gap-2">
                    {courseTees.map((tee) => (
                      <details className="group/tee rounded-lg border border-line" key={tee.id}>
                        <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-brand-600">
                          <EditIcon className="size-4" aria-hidden="true" />
                          แก้ไข {tee.name}
                          <ChevronDown className="ml-auto size-4 transition group-open/tee:rotate-180" aria-hidden="true" />
                        </summary>
                        <div className="border-t border-line p-4">
                          <TeeForm courseId={course.id} disabled={disabled} tee={tee} />
                          <form action={archiveTee} className="mt-4 border-t border-line pt-4">
                            <input name="teeId" type="hidden" value={tee.id} />
                            <ConfirmSubmitButton
                              className={buttonClass("danger", "sm")}
                              confirmLabel="ลบที"
                              disabled={disabled}
                              message={`ลบ ${tee.name} ออกจากรายการ? กิจกรรมที่ใช้ทีนี้ไปแล้วยังเก็บพาร์และ SI เดิมไว้`}
                            >
                              <DeleteIcon className="size-4" aria-hidden="true" />
                              ลบทีนี้
                            </ConfirmSubmitButton>
                          </form>
                        </div>
                      </details>
                    ))}
                    <details className="group/add rounded-lg border border-line" open={!courseTees.length && !disabled}>
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold text-brand-600">
                        <AddIcon className="size-4" aria-hidden="true" />
                        เพิ่มที
                        <ChevronDown className="ml-auto size-4 transition group-open/add:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="border-t border-line p-4">
                        <TeeForm courseId={course.id} disabled={disabled} />
                      </div>
                    </details>
                    <details className="group/course rounded-lg border border-line">
                      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-medium text-brand-600">
                        <EditIcon className="size-4" aria-hidden="true" />
                        แก้ไขชื่อสนาม
                        <ChevronDown className="ml-auto size-4 transition group-open/course:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="grid gap-4 border-t border-line p-4">
                        <form action={updateCourse} className="grid gap-4 sm:grid-cols-2">
                          <input name="courseId" type="hidden" value={course.id} />
                          <label className="block">
                            <span className={fieldLabel}>
                              ชื่อสนาม
                              <span aria-hidden="true" className="ml-0.5 text-danger">*</span>
                            </span>
                            <input className={fieldInput} defaultValue={course.name} disabled={disabled} name="name" required />
                          </label>
                          <label className="block">
                            <span className={fieldLabel}>จังหวัด</span>
                            <input className={fieldInput} defaultValue={course.province ?? ""} disabled={disabled} name="province" />
                          </label>
                          <label className="block sm:col-span-2">
                            <span className={fieldLabel}>หมายเหตุ</span>
                            <textarea className={fieldTextarea} defaultValue={course.note ?? ""} disabled={disabled} name="note" rows={2} />
                          </label>
                          <SubmitButton className={`${buttonPrimary} w-full sm:w-fit`} disabled={disabled}>
                            <SaveIcon className="size-4" aria-hidden="true" />
                            บันทึกสนาม
                          </SubmitButton>
                        </form>
                        <form action={archiveCourse} className="border-t border-line pt-4">
                          <input name="courseId" type="hidden" value={course.id} />
                          <ConfirmSubmitButton
                            className={buttonClass("danger", "sm")}
                            confirmLabel="เก็บสนาม"
                            disabled={disabled}
                            message={`เก็บ ${course.name}? สนามจะไม่แสดงในตัวเลือกกิจกรรม นำกลับได้ภายหลัง`}
                          >
                            เก็บสนามนี้
                          </ConfirmSubmitButton>
                        </form>
                      </div>
                    </details>
                  </div>
                </article>
              );
            })
          ) : (
            <p className={`${card} text-center text-sm text-ink-muted`}>
              ยังไม่มีสนาม กด “เพิ่มสนาม” ด้านบน แล้วเพิ่มทีพร้อมพาร์และ SI
            </p>
          )}
        </div>

        {archived.length ? (
          <section className={`${card} mt-6`}>
            <h2 className="text-h3 font-semibold text-ink">สนามที่เก็บไว้</h2>
            <ul className="mt-2 divide-y divide-line">
              {archived.map((course) => (
                <li className="flex flex-wrap items-center justify-between gap-2 py-2" key={course.id}>
                  <span className="text-sm text-ink-muted">{course.name}</span>
                  <form action={archiveCourse}>
                    <input name="courseId" type="hidden" value={course.id} />
                    <input name="restore" type="hidden" value="1" />
                    <button className={buttonClass("secondary", "sm")} disabled={disabled} type="submit">นำกลับมา</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </section>
    </main>
  );
}
