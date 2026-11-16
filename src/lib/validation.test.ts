import { describe, expect, it } from "vitest";

import { isValidHandicap, normalizeEmail, normalizeEmployeeCode, normalizePhone } from "./validation";

describe("normalizePhone", () => {
  it("accepts 10 digits starting with 0", () => {
    expect(normalizePhone("0812345678")).toEqual({ ok: true, value: "0812345678" });
  });

  it("strips separators and converts +66", () => {
    expect(normalizePhone("081-234-5678")).toEqual({ ok: true, value: "0812345678" });
    expect(normalizePhone(" (081) 234 5678 ")).toEqual({ ok: true, value: "0812345678" });
    expect(normalizePhone("+66 81 234 5678")).toEqual({ ok: true, value: "0812345678" });
    expect(normalizePhone("66812345678")).toEqual({ ok: true, value: "0812345678" });
  });

  it("allows an empty value", () => {
    expect(normalizePhone("")).toEqual({ ok: true, value: null });
    expect(normalizePhone(null)).toEqual({ ok: true, value: null });
  });

  it("rejects letters, short numbers and numbers without a leading 0", () => {
    expect(normalizePhone("abc")).toEqual({ ok: false });
    expect(normalizePhone("08123")).toEqual({ ok: false });
    expect(normalizePhone("1812345678")).toEqual({ ok: false });
    expect(normalizePhone("08123456789")).toEqual({ ok: false });
    expect(normalizePhone("081234567a")).toEqual({ ok: false });
  });
});

describe("normalizeEmail", () => {
  it("lower-cases valid addresses", () => {
    expect(normalizeEmail(" Name@Example.COM ")).toEqual({ ok: true, value: "name@example.com" });
  });

  it("rejects malformed addresses and allows empty", () => {
    expect(normalizeEmail("abc")).toEqual({ ok: false });
    expect(normalizeEmail("a@b")).toEqual({ ok: false });
    expect(normalizeEmail("a b@c.com")).toEqual({ ok: false });
    expect(normalizeEmail("")).toEqual({ ok: true, value: null });
  });
});

describe("normalizeEmployeeCode", () => {
  it("removes spaces and upper-cases", () => {
    expect(normalizeEmployeeCode(" uat 001 ")).toBe("UAT001");
  });
});

describe("isValidHandicap", () => {
  it("accepts empty and the WHS range only", () => {
    expect(isValidHandicap(null)).toBe(true);
    expect(isValidHandicap(12.4)).toBe(true);
    expect(isValidHandicap(-3)).toBe(true);
    expect(isValidHandicap(60)).toBe(false);
    expect(isValidHandicap(-20)).toBe(false);
  });
});
