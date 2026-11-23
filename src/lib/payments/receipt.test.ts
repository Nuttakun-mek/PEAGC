import { describe, expect, it } from "vitest";

import { bahtText, buddhistYear, formatReceiptNo, parseReceiptNo } from "./receipt";

describe("bahtText", () => {
  it.each([
    [0, "ศูนย์บาทถ้วน"],
    [1, "หนึ่งบาทถ้วน"],
    [10, "สิบบาทถ้วน"],
    [11, "สิบเอ็ดบาทถ้วน"],
    [20, "ยี่สิบบาทถ้วน"],
    [21, "ยี่สิบเอ็ดบาทถ้วน"],
    [101, "หนึ่งร้อยเอ็ดบาทถ้วน"],
    [250, "สองร้อยห้าสิบบาทถ้วน"],
    [2200, "สองพันสองร้อยบาทถ้วน"],
    [3500, "สามพันห้าร้อยบาทถ้วน"],
    [10001, "หนึ่งหมื่นเอ็ดบาทถ้วน"],
    [100000, "หนึ่งแสนบาทถ้วน"],
    [1000000, "หนึ่งล้านบาทถ้วน"],
    [1000001, "หนึ่งล้านเอ็ดบาทถ้วน"],
    [21000000, "ยี่สิบเอ็ดล้านบาทถ้วน"],
    [1000000000000, "หนึ่งล้านล้านบาทถ้วน"],
  ])("%d → %s", (amount, words) => {
    expect(bahtText(amount)).toBe(words);
  });

  it("reads satang and rounds to two decimals", () => {
    expect(bahtText(1234.5)).toBe("หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์");
    expect(bahtText(12345678.91)).toBe("สิบสองล้านสามแสนสี่หมื่นห้าพันหกร้อยเจ็ดสิบแปดบาทเก้าสิบเอ็ดสตางค์");
    expect(bahtText(0.25)).toBe("ยี่สิบห้าสตางค์");
    expect(bahtText(0.01)).toBe("หนึ่งสตางค์");
    expect(bahtText(99.999)).toBe("หนึ่งร้อยบาทถ้วน");
    expect(bahtText(-50)).toBe("ลบห้าสิบบาทถ้วน");
    expect(bahtText(Number.NaN)).toBe("");
  });
});

describe("receipt numbers", () => {
  it("formats RC + Buddhist year + 6-digit running number", () => {
    expect(formatReceiptNo(2569, 123)).toBe("RC2569-000123");
    expect(formatReceiptNo(2570, 1)).toBe("RC2570-000001");
    expect(formatReceiptNo(2569, 1234567)).toBe("RC2569-1234567");
  });

  it("parses only well-formed numbers", () => {
    expect(parseReceiptNo("RC2569-000123")).toEqual({ beYear: 2569, sequence: 123 });
    expect(parseReceiptNo(" RC2570-1000000 ")).toEqual({ beYear: 2570, sequence: 1000000 });
    expect(parseReceiptNo("RC2569-123")).toBeNull();
    expect(parseReceiptNo("INV2569-000123")).toBeNull();
    expect(parseReceiptNo(null)).toBeNull();
  });

  it("uses the Bangkok calendar for the Buddhist year", () => {
    expect(buddhistYear(new Date("2026-11-23T03:00:00Z"))).toBe(2569);
    expect(buddhistYear(new Date("2026-12-31T20:00:00Z"))).toBe(2570);
  });
});
