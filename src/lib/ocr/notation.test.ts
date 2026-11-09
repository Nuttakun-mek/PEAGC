import { describe, expect, it } from "vitest";

import { interpretCell, interpretRow, matchRows, nameSimilarity, normalizeMark } from "./notation";

const hi = (raw: string, enclosure: "circle" | "square" | null = null) => ({ confidence: "high" as const, enclosure, raw });

describe("normalizeMark", () => {
  it("handles Thai digits, unicode signs and spacing", () => {
    expect(normalizeMark(" ๕ ")).toBe("5");
    expect(normalizeMark("−1")).toBe("-1");
    expect(normalizeMark("D B")).toBe("db");
  });
});

describe("interpretCell - absolute cards", () => {
  it("reads plain and Thai digits", () => {
    expect(interpretCell(hi("5"), 4, "absolute")).toMatchObject({ flags: [], strokes: 5 });
    expect(interpretCell(hi("๖"), 4, "absolute")).toMatchObject({ strokes: 6 });
  });

  it("reads par / birdie / bogey shorthand", () => {
    expect(interpretCell(hi("/"), 4, "absolute").strokes).toBe(4);
    expect(interpretCell(hi("E"), 5, "absolute").strokes).toBe(5);
    expect(interpretCell(hi("B"), 4, "absolute").strokes).toBe(3);
    expect(interpretCell(hi("Bo"), 4, "absolute").strokes).toBe(5);
    expect(interpretCell(hi("DB"), 3, "absolute").strokes).toBe(5);
    expect(interpretCell(hi("Eagle"), 5, "absolute").strokes).toBe(3);
  });

  it("treats X / NR / dash as a pickup on stroke cards", () => {
    for (const raw of ["X", "NR", "PU", "-"]) {
      const cell = interpretCell(hi(raw), 4, "absolute");
      expect(cell.pickup).toBe(true);
      expect(cell.strokes).toBeNull();
    }
  });

  it("accepts a signed number but flags the mixed notation", () => {
    const cell = interpretCell(hi("+2"), 4, "absolute");
    expect(cell.strokes).toBe(6);
    expect(cell.flags).toContain("เขียนแบบเทียบพาร์บนการ์ดแบบนับสโตรก");
  });

  it("cross-checks circles and squares against par", () => {
    expect(interpretCell(hi("3", "circle"), 4, "absolute").flags).toEqual([]);
    expect(interpretCell(hi("5", "circle"), 4, "absolute").flags).toContain("สัญลักษณ์ไม่ตรงกับตัวเลข");
    expect(interpretCell(hi("5", "square"), 4, "absolute").flags).toEqual([]);
  });
});

describe("interpretCell - relative cards", () => {
  it("adds marks to par", () => {
    expect(interpretCell(hi("+1"), 4, "relative").strokes).toBe(5);
    expect(interpretCell(hi("-1"), 5, "relative").strokes).toBe(4);
    expect(interpretCell(hi("0"), 3, "relative").strokes).toBe(3);
    expect(interpretCell(hi("-"), 4, "relative").strokes).toBe(4);
    expect(interpretCell(hi("2"), 4, "relative").strokes).toBe(6);
  });
});

describe("interpretCell - review flags", () => {
  it("flags low confidence, blanks, junk and out-of-range values", () => {
    expect(interpretCell({ confidence: "low", raw: "4" }, 4, "absolute").flags).toContain("อ่านไม่ชัด");
    expect(interpretCell(hi(""), 4, "absolute")).toMatchObject({ flags: ["ช่องว่าง"], strokes: null });
    expect(interpretCell(hi("?#"), 4, "absolute").flags).toContain("อ่านสัญลักษณ์ไม่ได้");
    expect(interpretCell(hi("5."), 4, "absolute")).toMatchObject({ flags: ["มีสัญลักษณ์ปน"], strokes: 5 });
    expect(interpretCell(hi("44"), 4, "absolute")).toMatchObject({ flags: ["ค่าผิดปกติ"], strokes: null });
  });

  it("marks a row for review when any cell or the name is uncertain", () => {
    const pars = [4, 4, 3];
    expect(interpretRow({ cells: [hi("4"), hi("5"), hi("3")], name: "A", nameConfidence: "high" }, pars, "absolute").needsReview).toBe(false);
    expect(interpretRow({ cells: [hi("4"), hi("5"), hi("3")], name: "A", nameConfidence: "medium" }, pars, "absolute").needsReview).toBe(true);
    expect(interpretRow({ cells: [hi("4"), hi("?"), hi("3")], name: "A", nameConfidence: "high" }, pars, "absolute").needsReview).toBe(true);
  });
});

describe("name matching", () => {
  it("ignores titles and spacing", () => {
    expect(nameSimilarity("นายสมชาย ใจดี", "สมชาย ใจดี")).toBe(1);
    expect(nameSimilarity("Mr. John Smith", "john smith")).toBe(1);
    expect(nameSimilarity("สมชาย", "สมชาย ใจดี")).toBe(0.9);
    expect(nameSimilarity("สมชาย", "วิชัย")).toBeLessThan(0.5);
  });

  it("matches rows one-to-one, best first, using nicknames too", () => {
    const roster = [
      { id: "1", names: ["สมชาย ใจดี", "ชาย"] },
      { id: "2", names: ["สมศักดิ์ รักกอล์ฟ", "ศักดิ์"] },
      { id: "3", names: ["Anna Lee", "Ann"] },
    ];
    expect(matchRows(["สมศักดิ์", "ชาย", "anna", "ใครก็ไม่รู้"], roster).map((m) => m.id)).toEqual(["2", "1", "3", null]);
  });
});
