import { describe, expect, it } from "vitest";

import {
  formatFee,
  formatPhone,
  formatThaiDateLong,
  formatThaiDateShort,
  formatThaiDateTime,
  formatThaiTime,
  phoneHref,
} from "./display";

describe("display formatting", () => {
  it("formats list dates as short Buddhist-era dates with weekday", () => {
    expect(formatThaiDateShort("2026-12-20")).toBe("อา. 20 ธ.ค. 69");
  });

  it("formats detail dates without the วัน…ที่ filler", () => {
    expect(formatThaiDateLong("2026-11-16")).toBe("จันทร์ 16 พฤศจิกายน 2569");
  });

  it("formats clock times and timestamps in Bangkok time", () => {
    expect(formatThaiTime("17:30:00")).toBe("17:30 น.");
    expect(formatThaiTime("7:05")).toBe("07:05 น.");
    expect(formatThaiDateTime("2026-11-16T03:21:00Z")).toBe("16 พ.ย. 69 · 10:21 น.");
  });

  it("shows free events as ฟรี", () => {
    expect(formatFee(0)).toBe("ฟรี");
    expect(formatFee(null)).toBe("ฟรี");
    expect(formatFee(1000)).toBe("1,000 บาท");
  });

  it("formats and links phone numbers", () => {
    expect(formatPhone("0891000004")).toBe("089-100-0004");
    expect(phoneHref("089-100-0004")).toBe("tel:0891000004");
    expect(phoneHref("abc")).toBeNull();
  });
});
