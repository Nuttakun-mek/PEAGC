import { describe, expect, it } from "vitest";

import { addDays, addMonths, bangkokToday, canUseClub, daysUntil, deriveLifecycle, isRenewalOpen, nextTermPeriod } from "./lifecycle";

const today = "2026-11-23";

describe("member lifecycle", () => {
  it("maps stored statuses", () => {
    expect(deriveLifecycle({ status: "pending_verification" }, today)).toBe("pending");
    expect(deriveLifecycle({ status: "suspended" }, today)).toBe("suspended");
    expect(deriveLifecycle({ status: "resigned" }, today)).toBe("resigned");
    expect(deriveLifecycle({ status: "expired" }, today)).toBe("expired");
    expect(deriveLifecycle({ status: "guest" }, today)).toBe("guest");
    expect(deriveLifecycle({ archived_at: "2026-11-01T00:00:00Z", status: "active" }, today)).toBe("archived");
  });

  it("treats active without an end date as active", () => {
    expect(deriveLifecycle({ membership_expires_at: null, status: "active" }, today)).toBe("active");
  });

  it("derives ใกล้หมดอายุ inside the notice window, inclusive", () => {
    expect(deriveLifecycle({ membership_expires_at: "2026-12-23", status: "active" }, today, 30)).toBe("expiring");
    expect(deriveLifecycle({ membership_expires_at: "2026-12-24", status: "active" }, today, 30)).toBe("active");
    expect(deriveLifecycle({ membership_expires_at: today, status: "active" }, today, 30)).toBe("expiring");
  });

  it("counts an active member past the end date as expired before the daily job runs", () => {
    expect(deriveLifecycle({ membership_expires_at: "2026-11-22", status: "active" }, today)).toBe("expired");
  });

  it("lets only active and expiring members use the club", () => {
    expect(canUseClub("active")).toBe(true);
    expect(canUseClub("expiring")).toBe(true);
    expect(canUseClub("expired")).toBe(false);
    expect(canUseClub("suspended")).toBe(false);
  });
});

describe("dates", () => {
  it("adds days and months like Postgres", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2026-11-23", 12)).toBe("2027-11-23");
    expect(daysUntil("2026-12-23", today)).toBe(30);
    expect(daysUntil("2026-11-20", today)).toBe(-3);
  });

  it("uses the Bangkok calendar day", () => {
    expect(bangkokToday(new Date("2026-11-22T18:30:00Z"))).toBe("2026-11-23");
    expect(bangkokToday(new Date("2026-11-22T16:30:00Z"))).toBe("2026-11-22");
  });
});

describe("membership terms", () => {
  it("starts today when new or lapsed", () => {
    expect(nextTermPeriod({ currentExpiresAt: null, termMonths: 12, today })).toEqual({ end: "2027-11-22", start: today });
    expect(nextTermPeriod({ currentExpiresAt: "2026-10-01", termMonths: 12, today })).toEqual({ end: "2027-11-22", start: today });
  });

  it("starts the day after the current end when paying early", () => {
    expect(nextTermPeriod({ currentExpiresAt: "2026-12-10", termMonths: 12, today })).toEqual({ end: "2027-12-10", start: "2026-12-11" });
  });

  it("opens renewal only near or after expiry", () => {
    expect(isRenewalOpen(null, today, 30)).toBe(true);
    expect(isRenewalOpen("2026-12-20", today, 30)).toBe(true);
    expect(isRenewalOpen("2027-06-01", today, 30)).toBe(false);
    expect(isRenewalOpen("2026-11-01", today, 30)).toBe(true);
  });
});
