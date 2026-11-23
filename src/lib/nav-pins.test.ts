import { describe, expect, it } from "vitest";

import { MAX_PINS, parsePins, togglePin } from "./nav-pins";

const allowed = ["/admin", "/admin/payments", "/admin/members", "/admin/events", "/admin/reports", "/admin/audit"];

describe("pinned menu items", () => {
  it("reads stored pins, dropping unknown, duplicate and forbidden hrefs", () => {
    expect(parsePins(JSON.stringify(["/admin/events", "/admin/settings", "/admin/events", 3, "/admin"]), allowed)).toEqual(["/admin/events", "/admin"]);
  });

  it("survives broken storage", () => {
    expect(parsePins("{not json", allowed)).toEqual([]);
    expect(parsePins(JSON.stringify({ a: 1 }), allowed)).toEqual([]);
    expect(parsePins(null, allowed)).toEqual([]);
  });

  it("caps at four pins", () => {
    expect(parsePins(JSON.stringify(allowed), allowed)).toHaveLength(MAX_PINS);
    const full = allowed.slice(0, 4);
    expect(togglePin(full, "/admin/audit")).toEqual(full);
  });

  it("toggles a pin on and off", () => {
    expect(togglePin([], "/admin/events")).toEqual(["/admin/events"]);
    expect(togglePin(["/admin", "/admin/events"], "/admin")).toEqual(["/admin/events"]);
  });
});
