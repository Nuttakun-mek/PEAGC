import { describe, expect, it } from "vitest";

import { crc16, formatPromptPayId, normalizePromptPayId, promptPayPayload } from "./promptpay";

describe("crc16", () => {
  it("matches the CRC-16/CCITT-FALSE check value", () => {
    expect(crc16("123456789")).toBe("29B1");
  });
});

describe("promptPayPayload", () => {
  it("encodes a mobile number without amount as a reusable QR", () => {
    expect(promptPayPayload("0812345678")).toBe(
      "00020101021129370016A000000677010111011300668123456785303764" + "5802TH6304" + crc16("00020101021129370016A000000677010111011300668123456785303764" + "5802TH6304"),
    );
  });

  it("encodes an amount as a one-time QR with two decimals", () => {
    const payload = promptPayPayload("081-234-5678", 350);
    expect(payload).toContain("010212");
    expect(payload).toContain("5406350.00");
    expect(payload.slice(-8, -4)).toBe("6304");
    expect(payload.slice(-4)).toBe(crc16(payload.slice(0, -4)));
  });

  it("uses tag 02 for a 13-digit national ID", () => {
    expect(promptPayPayload("1234567890123")).toContain("02131234567890123");
  });

  it("rejects an invalid receiver", () => {
    expect(() => promptPayPayload("12345")).toThrow("INVALID_PROMPTPAY_ID");
  });
});

describe("normalizePromptPayId / formatPromptPayId", () => {
  it("keeps digits and validates length", () => {
    expect(normalizePromptPayId("081 234 5678")).toBe("0812345678");
    expect(normalizePromptPayId("812345678")).toBeNull();
    expect(formatPromptPayId("0812345678")).toBe("081-234-5678");
    expect(formatPromptPayId("1234567890123")).toBe("1-2345-67890-12-3");
  });
});
