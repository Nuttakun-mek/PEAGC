import { describe, expect, it } from "vitest";

import { auditActionOptions, auditDayRange, auditQueryString, pageWindow, parseAuditFilters } from "./audit-query";

describe("audit page filters", () => {
  it("defaults to the last 30 days (Bangkok) and page 1", () => {
    expect(parseAuditFilters({}, "2026-11-23")).toEqual({ action: "", actor: "", entity: "", entityId: "", from: "2026-10-25", page: 1, to: "2026-11-23" });
  });

  it("swaps a reversed range and rejects junk", () => {
    const filters = parseAuditFilters({ action: "x;drop", actor: "bob", entity: "Members!", from: "2026-11-30", page: "-3", to: "2026-11-01" }, "2026-11-23");
    expect(filters).toMatchObject({ action: "", actor: "", entity: "", from: "2026-11-01", page: 1, to: "2026-11-30" });
  });

  it("accepts an action prefix, an actor uuid or 'none' and an entity id (whole history)", () => {
    const id = "00000000-0000-0000-0000-0000000000E1";
    const filters = parseAuditFilters({ action: "member.", actor: "none", entityId: id }, "2026-11-23");
    expect(filters).toMatchObject({ action: "member.", actor: "none", entityId: id.toLowerCase(), from: "2020-01-01" });
  });

  it("builds query strings without empty values", () => {
    expect(auditQueryString({ entity: "members", from: "2026-11-01", page: 1, to: "2026-11-23" })).toBe("?from=2026-11-01&to=2026-11-23&entity=members");
    expect(auditQueryString({ page: 3 }, { bypass: "admin" })).toBe("?page=3&bypass=admin");
  });

  it("turns Bangkok days into UTC instants", () => {
    expect(auditDayRange("2026-11-01", "2026-11-01")).toEqual({ end: "2026-11-01T16:59:59.999Z", start: "2026-10-31T17:00:00.000Z" });
  });

  it("groups action options by entity", () => {
    const member = auditActionOptions().find((group) => group.prefix === "member");
    expect(member?.label).toBe("สมาชิก");
    expect(member?.options.map((option) => option.value)).toContain("member.approved");
  });

  it("links first, last and neighbouring pages", () => {
    expect(pageWindow(5, 10)).toEqual([1, 4, 5, 6, 10]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});
