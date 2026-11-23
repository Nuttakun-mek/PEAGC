import { describe, expect, it } from "vitest";

import { runLessonCron, isAuthorizedCronRequest, lessonCronSteps } from "./cron";
import { LESSON_RPC_FALLBACK_MESSAGE, rpcErrorCode, rpcErrorMessage, rpcErrorTime } from "./errors";
import { isInactiveStatus, isSeatStatus, isUpcomingStatus, lessonBookingStatusLabel, lessonBookingStatusLabels, lessonBookingTone, formatCredits, formatCreditDelta } from "./labels";
import { lessonSampleData } from "./sample-data";
import { lessonBookingStatuses } from "./types";
import { rpcErrorToStatus } from "./booking";

describe("rpcErrorMessage", () => {
  it("maps codes and raw messages to Thai", () => {
    expect(rpcErrorCode("NO_CREDIT")).toBe("NO_CREDIT");
    expect(rpcErrorCode("lesson_slot_full")).toBe("lesson_slot_full");
    expect(rpcErrorCode("  OFFER_EXPIRED extra")).toBe("OFFER_EXPIRED");
    expect(rpcErrorCode("duplicate key value")).toBeNull();
    expect(rpcErrorMessage("NO_CREDIT")).toBe("เครดิตเรียนไม่พอ ซื้อแพ็กเกจก่อนจอง");
    expect(rpcErrorMessage("PRIORITY_WINDOW")).toBe("ช่วงนี้เปิดให้พนักงาน กฟภ. จองก่อน");
    expect(rpcErrorMessage("something else")).toBe(LESSON_RPC_FALLBACK_MESSAGE);
    expect(rpcErrorMessage(null, "x")).toBe("x");
  });

  it("reads the Bangkok time detail", () => {
    expect(rpcErrorTime("2026-12-01T17:30")?.toISOString()).toBe("2026-12-01T10:30:00.000Z");
    expect(rpcErrorTime("junk")).toBeNull();
  });

  it("keeps the member page status keys for old and new codes", () => {
    expect(rpcErrorToStatus("CANCEL_LOCKED", "x")).toBe("lesson-cancel-locked");
    expect(rpcErrorToStatus("NO_CREDIT", "x")).toBe("lesson-no-credit");
    expect(rpcErrorToStatus("OFFER_EXPIRED", "x")).toBe("lesson-offer-expired");
  });
});

describe("booking status labels", () => {
  it("has a Thai label and a tone for every status", () => {
    for (const status of lessonBookingStatuses) {
      expect(lessonBookingStatusLabels[status]).toBeTruthy();
    }
    expect(lessonBookingStatusLabel("waitlist")).toBe("คิวสำรอง");
    expect(lessonBookingStatusLabel("late_cancelled")).toBe("ยกเลิกช้า");
    expect(lessonBookingStatusLabel("weird")).toBe("ไม่ทราบสถานะ");
    expect(lessonBookingTone("offered")).toBe("info");
    expect(lessonBookingTone("waitlist")).toBe("warning");
    expect(lessonBookingTone("no_show")).toBe("danger");
    expect(lessonBookingTone("closed")).toBe("neutral");
  });

  it("groups statuses like the database does", () => {
    expect(lessonBookingStatuses.filter(isSeatStatus)).toEqual(["booked", "offered", "attended", "no_show"]);
    expect(lessonBookingStatuses.filter(isUpcomingStatus)).toEqual(["booked", "waitlist", "offered"]);
    expect(lessonBookingStatuses.filter(isInactiveStatus)).toEqual(["cancelled", "late_cancelled", "closed"]);
  });

  it("formats credits", () => {
    expect(formatCredits(8)).toBe("8 ครั้ง");
    expect(formatCredits(0)).toBe("ไม่มีเครดิต");
    expect(formatCreditDelta(8)).toBe("+8");
    expect(formatCreditDelta(-1)).toBe("-1");
  });
});

describe("lesson cron", () => {
  it("runs every step in order and reports failures without stopping", async () => {
    const called: string[] = [];
    const result = await runLessonCron(async (step) => {
      called.push(step);
      if (step === "mark_lesson_no_shows") return { data: null, error: { code: "42883", message: "function does not exist" } };
      if (step === "expire_lesson_credits") throw new Error("network");
      return { data: { ok: 1 }, error: null };
    });
    expect(called).toEqual([...lessonCronSteps]);
    expect(result.ok).toBe(false);
    expect(result.steps.map((step) => step.ok)).toEqual([true, false, false, true]);
    expect(result.steps[1]).toMatchObject({ code: "42883", error: "function does not exist" });
    expect(result.steps[2].error).toBe("network");
  });

  it("checks the bearer secret", () => {
    expect(isAuthorizedCronRequest("Bearer abc", "abc")).toBe(true);
    expect(isAuthorizedCronRequest("Bearer abd", "abc")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer abc", "")).toBe(false);
    expect(isAuthorizedCronRequest(null, "abc")).toBe(false);
    expect(isAuthorizedCronRequest("Bearer abcd", "abc")).toBe(false);
  });
});

describe("sample data", () => {
  it("is consistent enough for bypass previews", () => {
    const data = lessonSampleData("2026-11-23");
    expect(data.slots[0].lesson_date).toBe("2026-11-23");
    expect(new Set(data.slots.map((slot) => slot.id)).size).toBe(data.slots.length);
    expect(data.roster.every((row) => lessonBookingStatuses.includes(row.booking_status))).toBe(true);
    expect(data.enrollments.filter((item) => item.usable).reduce((sum, item) => sum + item.credits_remaining, 0)).toBe(data.overview.credits_available);
  });
});
