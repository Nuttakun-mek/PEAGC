import { describe, expect, it } from "vitest";

import { creditSummary, daysUntilExpiry, expiryLabel, expiryWarnings, ledgerBalance, pickEnrollment, type CreditEnrollment } from "./credits";

const NOW = Date.parse("2026-11-23T03:00:00.000Z"); // 23 Nov 2026 10:00 Bangkok

function enrollment(id: string, overrides: Partial<CreditEnrollment>): CreditEnrollment {
  return {
    created_at: "2026-11-01T00:00:00.000Z",
    credits_remaining: 3,
    enrollment_id: id,
    expires_at: "2026-12-31T16:59:59.000Z",
    package_name: id,
    program_id: null,
    status: "active",
    ...overrides,
  };
}

describe("ledgerBalance", () => {
  it("sums the deltas", () => {
    expect(ledgerBalance([{ delta: 8 }, { delta: -1 }, { delta: -1 }, { delta: 1 }])).toBe(7);
    expect(ledgerBalance([])).toBe(0);
  });
});

describe("pickEnrollment", () => {
  const course = "course-a";
  const list = [
    enrollment("late-any", { expires_at: "2027-01-20T16:59:59.000Z" }),
    enrollment("soon-course", { expires_at: "2026-12-10T16:59:59.000Z", program_id: course }),
    enrollment("soon-any", { expires_at: "2026-12-10T16:59:59.000Z" }),
    enrollment("other-course", { expires_at: "2026-11-30T16:59:59.000Z", program_id: "course-b" }),
    enrollment("empty", { credits_remaining: 0, expires_at: "2026-11-25T16:59:59.000Z" }),
    enrollment("pending", { expires_at: null, status: "pending_payment" }),
    enrollment("expired", { expires_at: "2026-11-20T16:59:59.000Z" }),
  ];

  it("takes the soonest expiry that covers the course, course-specific first on a tie", () => {
    expect(pickEnrollment(list, { programId: course }, NOW)?.enrollment_id).toBe("soon-course");
  });

  it("uses any-course credits for other courses and skips the wrong course", () => {
    expect(pickEnrollment(list, { programId: "course-c" }, NOW)?.enrollment_id).toBe("soon-any");
    expect(pickEnrollment(list, { programId: "course-b" }, NOW)?.enrollment_id).toBe("other-course");
  });

  it("needs the credit to be valid at the lesson start", () => {
    const lessonStart = "2026-12-15T10:00:00.000Z";
    expect(pickEnrollment(list, { lessonStart, programId: course }, NOW)?.enrollment_id).toBe("late-any");
    expect(pickEnrollment(list, { lessonStart: "2027-02-01T10:00:00.000Z", programId: course }, NOW)).toBeNull();
  });
});

describe("creditSummary", () => {
  it("adds usable credits and finds the next expiry", () => {
    const summary = creditSummary(
      [
        enrollment("a", { credits_remaining: 5, expires_at: "2026-12-31T16:59:59.000Z" }),
        enrollment("b", { credits_remaining: 1, expires_at: "2026-11-28T16:59:59.000Z" }),
        enrollment("c", { expires_at: null, status: "pending_payment" }),
        enrollment("d", { expires_at: "2026-11-01T16:59:59.000Z" }),
      ],
      { now: NOW },
    );
    expect(summary.available).toBe(6);
    expect(summary.nextExpiry).toBe("2026-11-28T16:59:59.000Z");
    expect(summary.pending).toBe(1);
    expect(summary.usable.map((item) => item.enrollment_id)).toEqual(["b", "a"]);
  });

  it("can be limited to one course", () => {
    const list = [enrollment("a", { program_id: "x" }), enrollment("b", { program_id: "y" }), enrollment("c", {})];
    expect(creditSummary(list, { now: NOW, programId: "x" }).available).toBe(6);
  });
});

describe("expiry", () => {
  it("counts Bangkok calendar days", () => {
    expect(daysUntilExpiry("2026-11-23T16:59:59.000Z", NOW)).toBe(0);
    expect(daysUntilExpiry("2026-11-26T16:59:59.000Z", NOW)).toBe(3);
  });

  it("labels the expiry", () => {
    expect(expiryLabel(null, NOW)).toBe("ยังไม่เริ่มใช้");
    expect(expiryLabel("2026-11-20T16:59:59.000Z", NOW)).toBe("หมดอายุแล้ว");
    expect(expiryLabel("2026-11-23T16:59:59.000Z", NOW)).toBe("หมดอายุวันนี้");
    expect(expiryLabel("2026-11-26T16:59:59.000Z", NOW)).toBe("เหลือ 3 วัน (หมด 26 พ.ย. 2569)");
    expect(expiryLabel("2027-01-22T16:59:59.000Z", NOW)).toBe("ใช้ได้ถึง 22 ม.ค. 2570");
  });

  it("warns only for usable credits inside the window", () => {
    const warnings = expiryWarnings(
      [
        enrollment("soon", { expires_at: "2026-11-27T16:59:59.000Z" }),
        enrollment("later", { expires_at: "2026-12-20T16:59:59.000Z" }),
        enrollment("used-up", { credits_remaining: 0, expires_at: "2026-11-25T16:59:59.000Z" }),
      ],
      7,
      NOW,
    );
    expect(warnings.map((item) => [item.enrollment.enrollment_id, item.daysLeft])).toEqual([["soon", 4]]);
    expect(expiryWarnings([enrollment("soon", { expires_at: "2026-11-27T16:59:59.000Z" })], 0, NOW)).toEqual([]);
  });
});
