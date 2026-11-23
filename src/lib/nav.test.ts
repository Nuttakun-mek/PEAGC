import { describe, expect, it } from "vitest";

import { adminNav, filterNavForRoles, navItemArea, navItemRoles, tabBarForRoles } from "./nav";
import { canAccessArea, firstAllowedHref, staffHomeFor } from "./auth/roles";

const hrefs = (roles: string[] | null) => filterNavForRoles(adminNav, roles).flatMap((group) => group.items.map((item) => item.href));

describe("role-based admin menu", () => {
  it("shows everything to club admins and owners", () => {
    const all = adminNav.flatMap((group) => group.items.map((item) => item.href));
    expect(hrefs(["club_admin"])).toEqual(all);
    expect(hrefs(["platform_owner"])).toEqual(all);
  });

  it("shows committee everything except module settings", () => {
    expect(hrefs(["committee"])).not.toContain("/admin/settings");
    expect(hrefs(["committee"])).toContain("/admin/audit");
    expect(hrefs(["committee"])).toContain("/admin/members");
  });

  it("limits finance to overview, slips and reports", () => {
    expect(hrefs(["finance_officer"])).toEqual(["/admin", "/admin/payments", "/admin/reports"]);
  });

  it("limits event staff to overview and events", () => {
    expect(hrefs(["tournament_director"])).toEqual(["/admin", "/admin/events"]);
    expect(hrefs(["scoring_officer"])).toEqual(["/admin", "/admin/events"]);
  });

  it("gives auditors reports and the audit log only", () => {
    expect(hrefs(["auditor"])).toEqual(["/admin/reports", "/admin/audit"]);
  });

  it("unions several roles and drops empty groups", () => {
    const nav = filterNavForRoles(adminNav, ["finance_officer", "auditor"]);
    expect(nav.flatMap((group) => group.items.map((item) => item.href))).toEqual(["/admin", "/admin/payments", "/admin/reports", "/admin/audit"]);
    expect(nav.every((group) => group.items.length > 0)).toBe(true);
  });

  it("keeps the full menu when no staff roles are known (bypass preview)", () => {
    expect(hrefs(null)).toEqual(hrefs(["club_admin"]));
  });

  it("treats coach as a non-admin role", () => {
    expect(canAccessArea(["coach"], "lessons")).toBe(false);
    expect(staffHomeFor(["coach"])).toBe("/coach");
    expect(staffHomeFor(["coach", "member"])).toBe("/coach");
    expect(staffHomeFor(["coach", "committee"])).toBe("/admin");
    expect(staffHomeFor(["member"])).toBeNull();
  });

  it("sends each role to the first page it may open", () => {
    expect(firstAllowedHref(["auditor"])).toBe("/admin/reports");
    expect(firstAllowedHref(["finance_officer"])).toBe("/admin");
    expect(staffHomeFor(["auditor"])).toBe("/admin/reports");
  });

  it("derives the area of items added without one from the href", () => {
    expect(navItemArea({ href: "/admin/points" })).toBe("points");
    expect(navItemArea({ href: "/admin/members/abc" })).toBe("members");
    expect(navItemArea({ href: "/admin" })).toBe("dashboard");
    expect(navItemArea({ href: "/admin/unknown" })).toBeNull();
    expect(navItemRoles({ href: "/admin/unknown" })).toEqual(["platform_owner", "club_admin", "committee"]);
    expect(navItemRoles({ href: "/admin/audit" })).toEqual(["platform_owner", "club_admin", "committee", "auditor"]);
  });

  it("tops up the phone tab bar with the role's own pages", () => {
    expect(tabBarForRoles(["club_admin"]).map((item) => item.href)).toEqual(["/admin", "/admin/payments", "/admin/members"]);
    expect(tabBarForRoles(["tournament_director"]).map((item) => item.label)).toEqual(["วันนี้", "กิจกรรม"]);
    expect(tabBarForRoles(["auditor"]).map((item) => item.href)).toEqual(["/admin/reports", "/admin/audit"]);
  });
});
