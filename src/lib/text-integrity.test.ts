import { describe, expect, it } from "vitest";

import { anyCorruptedText, decodeTextFile, hasCorruptedText } from "./text-integrity";

describe("hasCorruptedText", () => {
  it("flags Thai that was turned into question marks or replacement characters", () => {
    expect(hasCorruptedText("?????? PEAGC 1")).toBe(true);
    expect(hasCorruptedText("ชื่อ�")).toBe(true);
  });

  it("keeps real text, including a short question", () => {
    expect(hasCorruptedText("สมาชิก PEAGC 1")).toBe(false);
    expect(hasCorruptedText("ใช่ไหม?")).toBe(false);
    expect(hasCorruptedText("??")).toBe(false);
    expect(hasCorruptedText(null)).toBe(false);
    expect(anyCorruptedText(["ปกติ", undefined, "???? x"])).toBe(true);
  });
});

describe("decodeTextFile", () => {
  it("reads UTF-8 with or without BOM", () => {
    const utf8 = new TextEncoder().encode("รหัส,ชื่อ\n001,สมชาย");
    expect(decodeTextFile(utf8)).toEqual({ encoding: "utf-8", text: "รหัส,ชื่อ\n001,สมชาย" });
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]);
    expect(decodeTextFile(withBom).text).toBe("รหัส,ชื่อ\n001,สมชาย");
  });

  it("falls back to Windows-874 for CSV saved by Thai Excel", () => {
    // "สมชาย" in TIS-620 / Windows-874.
    const tis620 = new Uint8Array([0xca, 0xc1, 0xaa, 0xd2, 0xc2]);
    expect(decodeTextFile(tis620)).toEqual({ encoding: "windows-874", text: "สมชาย" });
  });
});
