import { describe, expect, it } from "vitest";

import { auditActionLabel, auditEntityLabel, diffAuditData, formatAuditValue, summarizeAuditChanges } from "./audit-diff";
import { buildAuditRow } from "./audit";

describe("audit labels", () => {
  it("uses exact Thai labels for known actions", () => {
    expect(auditActionLabel("member.approved")).toBe("อนุมัติสมาชิก");
    expect(auditActionLabel("payment.reviewed")).toBe("ตรวจสลิป");
  });

  it("builds a label for new actions from entity and verb", () => {
    expect(auditActionLabel("membership_term.renewed")).toBe("ต่ออายุอายุสมาชิก");
    expect(auditActionLabel("points.adjusted")).toBe("ปรับแต้มสะสม");
    expect(auditActionLabel("something.weird_thing")).toBe("something weird thing");
  });

  it("labels entity types", () => {
    expect(auditEntityLabel("payment_records")).toBe("การชำระเงิน");
    expect(auditEntityLabel(null)).toBe("ยังไม่ระบุ");
  });
});

describe("audit diff", () => {
  it("lists only changed fields with Thai labels and values", () => {
    const changes = diffAuditData(
      { full_name: "สมชาย", id: "x", phone: "0891000004", status: "pending_verification", updated_at: "2026-11-01T00:00:00Z" },
      { full_name: "สมชาย", phone: "0891000005", status: "active", updated_at: "2026-11-02T00:00:00Z" },
    );
    expect(changes.map((change) => change.key).sort()).toEqual(["phone", "status"]);
    const status = changes.find((change) => change.key === "status");
    expect(status).toMatchObject({ after: "ใช้งาน", before: "รอตรวจสอบ", kind: "changed", label: "สถานะ" });
  });

  it("ignores fields an update did not send and numeric formatting differences", () => {
    expect(diffAuditData({ amount: "1000.00", note: "a" }, { amount: 1000 })).toEqual([]);
  });

  it("treats a create as added fields and a delete as removed fields", () => {
    expect(diffAuditData(null, { name: "ออกรอบ", note: null }).map((change) => [change.key, change.kind])).toEqual([["name", "added"]]);
    expect(diffAuditData({ name: "ออกรอบ" }, null)[0]).toMatchObject({ before: "ออกรอบ", kind: "removed" });
  });

  it("formats dates, booleans, arrays and empty values", () => {
    expect(formatAuditValue("2026-12-20")).toBe("20 ธ.ค. 2569");
    expect(formatAuditValue(true)).toBe("ใช่");
    expect(formatAuditValue(null)).toBe("ยังไม่ระบุ");
    expect(formatAuditValue(["a", "b"])).toBe("a, b");
    expect(formatAuditValue("club_admin", "role_key")).toBe("ผู้ดูแลชมรม");
  });

  it("summarises the first changes in one line", () => {
    const changes = diffAuditData({ a: 1, b: 2, status: "review" }, { a: 2, b: 3, status: "approved" });
    expect(summarizeAuditChanges(changes, 1)).toMatch(/และอีก 2 ช่อง$/);
  });
});

describe("audit rows", () => {
  it("keeps non-uuid entity keys in metadata and makes payloads json-safe", () => {
    const row = buildAuditRow({
      action: "club_module.opened",
      actorUserId: "u",
      after: { at: new Date("2026-11-23T00:00:00Z"), fn: () => 1 },
      clubId: "c",
      entityId: "lessons",
      entityType: "club_modules",
    });
    expect(row.entity_id).toBeNull();
    expect(row.metadata).toEqual({ entity_key: "lessons" });
    expect(row.after_data).toEqual({ at: "2026-11-23T00:00:00.000Z" });
    expect(row.before_data).toBeNull();
  });
});
