// Error codes raised by the lesson RPCs (`raise exception 'CODE'`) and their Thai messages.
// Supabase returns the code as error.message (sometimes with extra text after it), and for
// NO_SHOW_BLOCKED / TOO_EARLY the Bangkok time as error.details ("2026-12-01T17:30").

export const lessonRpcErrorMessages = {
  ANNOUNCEMENT: "กดรับทราบประกาศก่อนจอง",
  CANCEL_LOCKED: "เลยกำหนดยกเลิกแล้ว ถ้ายกเลิกตอนนี้จะไม่คืนเครดิต",
  CHANGE_CLOSED: "เปลี่ยนรอบไม่ได้แล้ว เลยกำหนดเปลี่ยนรอบ",
  CLOSED: "ปิดลงทะเบียนแล้ว",
  CLUB_REQUIRED: "ไม่พบชมรม",
  DUPLICATE: "จองรอบนี้ไว้แล้ว",
  ENROLLMENT_INACTIVE: "แพ็กเกจนี้ยังไม่เปิดใช้หรือถูกยกเลิกแล้ว",
  FORBIDDEN: "ไม่มีสิทธิ์ทำรายการนี้",
  FULL: "รอบนี้เต็มแล้ว",
  INSUFFICIENT_CREDIT: "เครดิตคงเหลือไม่พอ",
  INVALID_DATE: "วันที่ไม่ถูกต้อง",
  INVALID_DAYS: "จำนวนวันไม่ถูกต้อง",
  INVALID_DELTA: "จำนวนเครดิตไม่ถูกต้อง",
  INVALID_SKILL: "ระดับฝีมือไม่ถูกต้อง",
  INVALID_TOKEN: "QR นี้ใช้เช็กชื่อไม่ได้",
  INVALID_URL: "ลิงก์คลิปต้องขึ้นต้นด้วย http:// หรือ https://",
  LEDGER_APPEND_ONLY: "แก้ไขประวัติเครดิตไม่ได้ ใช้การปรับเครดิตแทน",
  LIMIT: "จองล่วงหน้าครบจำนวนที่ค้างได้แล้ว",
  MEMBER_INACTIVE: "รอผู้ดูแลอนุมัติก่อนใช้งาน",
  MODULE_DISABLED: "ส่วนนี้ยังไม่เปิดให้บริการ",
  NOTE_REQUIRED: "กรุณาใส่เหตุผลหรือข้อความ",
  NOT_BOOKED: "คุณไม่ได้จองรอบนี้",
  NOT_MEMBER: "รอผู้ดูแลอนุมัติก่อนใช้งาน",
  NOT_OPEN: "ยังไม่เปิดลงทะเบียน",
  NOT_TARGETED: "รอบนี้เปิดให้เฉพาะบางหน่วยงาน",
  NO_BOOKING: "ไม่พบรายการจอง",
  NO_BOOKING_NOW: "ไม่พบรอบเรียนของคุณที่สถานที่นี้ในช่วงเวลานี้",
  NO_CREDIT: "เครดิตเรียนไม่พอ ซื้อแพ็กเกจก่อนจอง",
  NO_ENROLLMENT: "ไม่พบแพ็กเกจของสมาชิกคนนี้",
  NO_OFFER: "รายการนี้ไม่ได้รอการยืนยัน",
  NO_PACKAGE: "แพ็กเกจนี้ปิดขายแล้ว",
  NO_SESSION: "ไม่พบรอบเรียนนี้",
  NO_SHOW_BLOCKED: "ขาดเรียนเกินกำหนด งดจองชั่วคราว",
  NO_VENUE: "ไม่พบสถานที่นี้",
  OFFER_EXPIRED: "หมดเวลายืนยันที่ว่างแล้ว",
  OVERLAP: "เวลาชนกับรอบที่จองไว้",
  PACKAGE_LIMIT: "ซื้อแพ็กเกจนี้ครบจำนวนที่กำหนดแล้ว",
  PRIORITY_WINDOW: "ช่วงนี้เปิดให้พนักงาน กฟภ. จองก่อน",
  REASON_REQUIRED: "กรุณาใส่เหตุผลที่งดเรียน",
  SESSION_CLOSED: "รอบนี้ปิดรับแล้ว",
  STARTED: "รอบนี้เริ่มเรียนแล้ว",
  TARGET_REQUIRED: "เลือกรอบเรียนหรือสถานที่ก่อน",
  TOO_EARLY: "ยังไม่ถึงเวลาเช็กชื่อ เช็กชื่อได้ก่อนเรียน 30 นาที",
  TOO_LATE: "เลยเวลาเรียนแล้ว เช็กชื่อไม่ได้",
  WEEK_LIMIT: "จองครบจำนวนต่อสัปดาห์แล้ว",
  lesson_slot_full: "รอบนี้เต็มแล้ว",
} as const;

export type LessonRpcErrorCode = keyof typeof lessonRpcErrorMessages;

export const LESSON_RPC_FALLBACK_MESSAGE = "ทำรายการไม่สำเร็จ ลองอีกครั้ง";

/** Leading code of a Postgres error message ("NO_CREDIT", "lesson_slot_full"), or null. */
export function rpcErrorCode(message: string | null | undefined): LessonRpcErrorCode | null {
  const code = (message ?? "").trim().match(/^[A-Za-z_]+/)?.[0];
  return code && code in lessonRpcErrorMessages ? (code as LessonRpcErrorCode) : null;
}

/**
 * Thai message for an RPC error code or a raw error message. Unknown values get `fallback`.
 * `rpcErrorMessage(error.message)` is the usual call.
 */
export function rpcErrorMessage(codeOrMessage: string | null | undefined, fallback: string = LESSON_RPC_FALLBACK_MESSAGE) {
  const code = rpcErrorCode(codeOrMessage);
  return code ? lessonRpcErrorMessages[code] : fallback;
}

/** "2026-12-01T17:30" (error.details of NO_SHOW_BLOCKED / TOO_EARLY) -> Date, or null. */
export function rpcErrorTime(details: string | null | undefined) {
  if (!details || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(details)) {
    return null;
  }
  return new Date(`${details}:00+07:00`);
}
