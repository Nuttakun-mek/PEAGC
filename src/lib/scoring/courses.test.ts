import { describe, expect, it } from "vitest";

import { defaultRules } from "./engine";
import { invalidStrokeIndexHoles, teeDescription, validateTee } from "./courses";

const valid = { courseRating: 71.2, name: "ทีขาว", pars: defaultRules.pars, slopeRating: 125, strokeIndex: defaultRules.strokeIndex };

describe("tee validation", () => {
  it("accepts a complete tee", () => {
    expect(validateTee(valid)).toEqual([]);
    expect(validateTee({ ...valid, courseRating: null, slopeRating: null })).toEqual([]);
  });

  it("needs 18 pars of 3-6 and SI a permutation of 1-18", () => {
    expect(validateTee({ ...valid, pars: valid.pars.slice(0, 17) })).toContain("พาร์ต้องครบ 18 หลุม หลุมละ 3-6");
    expect(validateTee({ ...valid, pars: [7, ...valid.pars.slice(1)] })).toContain("พาร์ต้องครบ 18 หลุม หลุมละ 3-6");
    const dup = [...valid.strokeIndex];
    dup[1] = dup[0];
    expect(validateTee({ ...valid, strokeIndex: dup })).toContain("ลำดับความยาก (SI) ต้องเป็นเลข 1-18 ไม่ซ้ำกัน ครบ 18 หลุม");
    expect(invalidStrokeIndexHoles(dup)).toEqual([1, 2]);
  });

  it("ratings in range and as a pair", () => {
    expect(validateTee({ ...valid, slopeRating: 200 })).toContain("Slope rating ต้องเป็นจำนวนเต็ม 55-155");
    expect(validateTee({ ...valid, slopeRating: null })).toContain("ใส่ Course rating และ Slope rating คู่กัน (หรือเว้นว่างทั้งคู่)");
  });

  it("describes a tee", () => {
    expect(teeDescription({ course_rating: 71.2, name: "ทีขาว", par: defaultRules.pars, slope_rating: 125 })).toBe("ทีขาว · พาร์ 72 · CR 71.2 / Slope 125");
  });
});
