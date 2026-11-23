import { describe, expect, it } from "vitest";

import {
  bookingDisplayStatus,
  effectiveMatchStatus,
  buildMemberPreview,
  ledgerBalance,
  membershipSummary,
  mergeAuditRows,
  pickField,
  queuePositions,
  splitByDate,
} from "./member-360";

describe("pickField", () => {
  it("returns the first non-empty candidate", () => {
    expect(pickField({ a: null, b: "", c: 3 }, ["a", "b", "c"])).toBe(3);
    expect(pickField({ a: 0 }, ["a"])).toBe(0);
    expect(pickField(null, ["a"])).toBeNull();
  });
});

describe("splitByDate", () => {
  const rows = [
    { d: "2026-11-20" },
    { d: "2026-11-23" },
    { d: "2026-12-01" },
    { d: "2026-11-25" },
    { d: "2026-10-01" },
    { d: null },
  ];
  it("puts today and later first, soonest first; past latest first", () => {
    const { past, upcoming } = splitByDate(rows, (row) => row.d, "2026-11-23");
    expect(upcoming.map((row) => row.d)).toEqual(["2026-11-23", "2026-11-25", "2026-12-01"]);
    expect(past.map((row) => row.d)).toEqual(["2026-11-20", "2026-10-01"]);
  });
  it("caps past rows", () => {
    expect(splitByDate(rows, (row) => row.d, "2027-01-01", 2).past).toHaveLength(2);
  });
});

describe("queuePositions / bookingDisplayStatus", () => {
  const rows = [
    { id: "b3", queue_seq: 30, slot_id: "s1", status: "booked" },
    { id: "b1", queue_seq: 10, slot_id: "s1", status: "booked" },
    { id: "bx", queue_seq: 5, slot_id: "s1", status: "cancelled" },
    { id: "b2", queue_seq: 20, slot_id: "s1", status: "attended" },
    { id: "c1", queue_seq: 1, slot_id: "s2", status: "booked" },
  ];
  it("ranks active bookings per slot by queue order, ignoring cancelled", () => {
    const positions = queuePositions(rows);
    expect(positions.get("b1")).toBe(1);
    expect(positions.get("b2")).toBe(2);
    expect(positions.get("b3")).toBe(3);
    expect(positions.get("c1")).toBe(1);
    expect(positions.has("bx")).toBe(false);
  });
  it("marks bookings beyond capacity as waitlist", () => {
    expect(bookingDisplayStatus("booked", 3, 2)).toBe("waitlist");
    expect(bookingDisplayStatus("booked", 2, 2)).toBe("booked");
    expect(bookingDisplayStatus("attended", 5, 2)).toBe("attended");
  });
});

describe("ledgerBalance", () => {
  it("sums signed amounts from the first known column", () => {
    expect(ledgerBalance([{ delta: 10 }, { delta: -3 }, { delta: "2" }])).toBe(9);
    expect(ledgerBalance([{ points: 30 }, { points: -10 }])).toBe(20);
    expect(ledgerBalance([{ note: "x" }])).toBe(0);
  });
});

describe("membershipSummary", () => {
  it("uses the latest counted term and flags expiring within 30 days", () => {
    const summary = membershipSummary(
      [
        { ends_on: "2026-03-31", status: "active" },
        { ends_on: "2026-12-10", starts_on: "2026-01-01", status: "active" },
        { ends_on: "2027-12-31", status: "cancelled" },
      ],
      "2026-11-23",
    );
    expect(summary.state).toBe("expiring");
    expect(summary.endsOn).toBe("2026-12-10");
    expect(summary.daysLeft).toBe(17);
  });
  it("reads other column names and detects expired / none", () => {
    expect(membershipSummary([{ expires_at: "2026-11-01T00:00:00Z" }], "2026-11-23").state).toBe("expired");
    expect(membershipSummary([{ end_date: "2027-06-30" }], "2026-11-23").state).toBe("active");
    expect(membershipSummary([], "2026-11-23").state).toBe("none");
  });
  it("keeps a pending renewal aside", () => {
    const summary = membershipSummary([{ ends_on: "2027-12-31", status: "pending_payment" }], "2026-11-23");
    expect(summary.state).toBe("none");
    expect(summary.pending).not.toBeNull();
  });
});

describe("mergeAuditRows", () => {
  it("dedupes by id and sorts newest first", () => {
    const merged = mergeAuditRows(
      [
        [
          { created_at: "2026-11-01T00:00:00Z", id: "a" },
          { created_at: "2026-11-03T00:00:00Z", id: "b" },
        ],
        [{ created_at: "2026-11-03T00:00:00Z", id: "b" }, { created_at: "2026-11-02T00:00:00Z", id: "c" }],
        null,
      ],
      2,
    );
    expect(merged.map((row) => row.id)).toEqual(["b", "c"]);
  });
});

describe("buildMemberPreview", () => {
  it("lists appointments, slips to attach, unread notices and expiring membership", () => {
    const items = buildMemberPreview({
      events: [{ date: "2026-12-20", id: "e1", name: "ออกรอบประจำเดือน", status: "pending_payment" }],
      lessons: [{ date: "2026-11-25", id: "l1", status: "waitlist", title: "พื้นฐานวงสวิง" }],
      membership: { daysLeft: 10, endsOn: "2026-12-03", state: "expiring" },
      pendingPayments: [{ amount: 1000, id: "p1", label: "ค่าออกรอบ" }],
      unread: 2,
    });
    expect(items.map((item) => item.kind)).toEqual(["lesson", "event", "payment", "notification", "membership"]);
    expect(items[0].detail).toBe("อยู่ในคิวสำรอง");
    expect(items[2].title).toBe("ค่าออกรอบ 1,000 บาท");
    expect(items[4].detail).toBe("เหลือ 10 วัน");
  });
  it("is empty when nothing is coming up", () => {
    expect(
      buildMemberPreview({ events: [], lessons: [], membership: { daysLeft: 200, endsOn: "2027-06-01", state: "active" }, pendingPayments: [], unread: 0 }),
    ).toEqual([]);
  });
});

describe("effectiveMatchStatus", () => {
  it("re-checks a stored match against the linked directory row", () => {
    expect(effectiveMatchStatus("matched", { employment_status: "active", membership_status: "active" }, true)).toBe("matched");
    expect(effectiveMatchStatus("matched", { membership_status: "inactive" }, true)).toBe("directory_inactive");
    expect(effectiveMatchStatus("matched", { archived_at: "2026-11-01" }, true)).toBe("directory_missing");
    expect(effectiveMatchStatus("matched", null, false)).toBe("directory_missing");
    expect(effectiveMatchStatus("mismatch", null, false)).toBe("mismatch");
    expect(effectiveMatchStatus(null, null, false)).toBe("not_checked");
  });
});
