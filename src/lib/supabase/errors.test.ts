import { describe, expect, it } from "vitest";

import { classifyDbError, collectLoadErrors, failureStatus } from "./errors";

describe("classifyDbError", () => {
  it("recognises a schema that is behind the code", () => {
    expect(classifyDbError({ code: "42703", message: "column lesson_slots.waitlist_capacity does not exist" })).toBe("schema-outdated");
    expect(classifyDbError({ code: "PGRST204", message: "Could not find the 'waitlist_capacity' column" })).toBe("schema-outdated");
    expect(classifyDbError({ code: "PGRST205", message: "Could not find the table" })).toBe("schema-outdated");
  });

  it("recognises duplicates, RLS refusals and constraint failures", () => {
    expect(classifyDbError({ code: "23505", message: "duplicate key" })).toBe("duplicate");
    expect(classifyDbError({ code: "42501", message: "new row violates row-level security policy" })).toBe("permission");
    expect(classifyDbError({ code: "23514", message: "check constraint" })).toBe("constraint");
    expect(classifyDbError({ code: "XX000", message: "boom" })).toBe("unknown");
  });
});

describe("failureStatus", () => {
  it("turns errors into banner keys", () => {
    expect(failureStatus("slot-create-failed", { code: "42703" })).toBe("db-outdated");
    expect(failureStatus("update-failed", { code: "42501" })).toBe("permission-denied");
    expect(failureStatus("update-failed", { code: "23505" })).toBe("duplicate");
    expect(failureStatus("update-failed", { code: "XX000" })).toBe("update-failed");
  });
});

describe("collectLoadErrors", () => {
  it("returns null when every query succeeded", () => {
    expect(collectLoadErrors("test", [{ error: null, label: "รายการ" }])).toBeNull();
  });

  it("lists failed sections and flags an outdated schema", () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect(
        collectLoadErrors("test", [
          { error: null, label: "คอร์ส" },
          { error: { code: "42703", message: "missing column" }, label: "รอบเรียน" },
        ]),
      ).toEqual({ labels: ["รอบเรียน"], outdated: true });
    } finally {
      console.error = original;
    }
  });
});
