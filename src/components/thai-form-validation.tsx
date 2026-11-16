"use client";

import { useEffect } from "react";

type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

function isField(target: unknown): target is Field {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLSelectElement ||
    target instanceof HTMLTextAreaElement
  );
}

const dateTypes = new Set(["date", "datetime-local", "month", "time", "week"]);

function describeLimit(field: Field, value: string) {
  if (!(field instanceof HTMLInputElement)) return value;
  if (field.type === "number" || field.type === "range") {
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("th-TH") : value;
  }
  if (field.type === "date") {
    const date = new Date(`${value}T12:00:00+07:00`);
    return Number.isNaN(date.getTime())
      ? value
      : date.toLocaleDateString("th-TH", { day: "numeric", month: "short", timeZone: "Asia/Bangkok", year: "numeric" });
  }
  return value;
}

/**
 * Thai wording for the browser's built-in form checks. Per-field overrides:
 * `data-required-message` (empty field) and `data-invalid-message` (wrong format/range).
 */
export function thaiValidationMessage(field: Field) {
  const validity = field.validity;
  const custom = field.dataset.invalidMessage;

  if (validity.valueMissing) {
    if (field.dataset.requiredMessage) return field.dataset.requiredMessage;
    if (field instanceof HTMLSelectElement) return "กรุณาเลือกรายการ";
    if (field instanceof HTMLInputElement) {
      if (field.type === "checkbox") return "กรุณาติ๊กช่องนี้ก่อนดำเนินการต่อ";
      if (field.type === "radio") return "กรุณาเลือกหนึ่งตัวเลือก";
      if (field.type === "file") return "กรุณาเลือกไฟล์";
      if (dateTypes.has(field.type)) return "กรุณาเลือกวันที่หรือเวลา";
    }
    return "กรุณากรอกข้อมูลช่องนี้";
  }
  if (custom) return custom;
  if (validity.typeMismatch) {
    if (field.type === "email") return "รูปแบบอีเมลไม่ถูกต้อง ตัวอย่าง name@example.com";
    if (field.type === "url") return "รูปแบบลิงก์ไม่ถูกต้อง ต้องขึ้นต้นด้วย https://";
    return "รูปแบบข้อมูลไม่ถูกต้อง";
  }
  if (validity.badInput) {
    if (field.type === "number") return "กรุณากรอกเป็นตัวเลขเท่านั้น";
    if (dateTypes.has(field.type)) return "วันที่หรือเวลาไม่ครบ กรุณาเลือกใหม่";
    return "รูปแบบข้อมูลไม่ถูกต้อง";
  }
  if (validity.patternMismatch) {
    return field.title ? `รูปแบบไม่ถูกต้อง: ${field.title}` : "รูปแบบข้อมูลไม่ถูกต้อง";
  }
  if (validity.tooShort && "minLength" in field) {
    return `ต้องมีอย่างน้อย ${field.minLength} ตัวอักษร (ตอนนี้ ${field.value.length} ตัวอักษร)`;
  }
  if (validity.tooLong && "maxLength" in field) {
    return `ยาวได้ไม่เกิน ${field.maxLength} ตัวอักษร`;
  }
  if (field instanceof HTMLInputElement) {
    const isDate = dateTypes.has(field.type);
    if (validity.rangeUnderflow) {
      const min = describeLimit(field, field.min);
      if (isDate) return `กรุณาเลือกตั้งแต่ ${min} เป็นต้นไป`;
      return Number(field.min) === 0 ? "ค่าต้องไม่ติดลบ (ตั้งแต่ 0 ขึ้นไป)" : `ค่าต้องไม่น้อยกว่า ${min}`;
    }
    if (validity.rangeOverflow) {
      const max = describeLimit(field, field.max);
      return isDate ? `กรุณาเลือกไม่เกิน ${max}` : `ค่าต้องไม่เกิน ${max}`;
    }
    if (validity.stepMismatch) {
      const step = Number(field.step);
      if (Number.isFinite(step) && step > 0 && step < 1) {
        const decimals = String(field.step).split(".")[1]?.length ?? 0;
        return `ใส่ทศนิยมได้ไม่เกิน ${decimals} ตำแหน่ง`;
      }
      return step === 1 ? "กรุณากรอกเป็นจำนวนเต็ม" : `กรุณากรอกค่าทีละ ${field.step}`;
    }
  }
  return "กรุณาตรวจสอบข้อมูลช่องนี้";
}

/**
 * Replaces the browser's own validation bubbles (English on most machines) with Thai messages
 * for every form in the app. Mounted once in the root layout.
 */
export function ThaiFormValidation() {
  useEffect(() => {
    const onInvalid = (event: Event) => {
      const field = event.target;
      if (!isField(field)) return;
      field.setCustomValidity("");
      if (!field.validity.valid) {
        field.setCustomValidity(thaiValidationMessage(field));
      }
    };
    const clear = (event: Event) => {
      if (isField(event.target)) event.target.setCustomValidity("");
    };
    // Before a submit button runs the browser checks, drop messages left from an earlier try so
    // a corrected field is not still reported as invalid.
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest("button, input[type=submit]") as HTMLButtonElement | HTMLInputElement | null;
      const form = button?.form;
      if (!form || button.type !== "submit") return;
      for (const element of Array.from(form.elements)) {
        if (isField(element)) element.setCustomValidity("");
      }
    };

    document.addEventListener("invalid", onInvalid, true);
    document.addEventListener("input", clear, true);
    document.addEventListener("change", clear, true);
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("invalid", onInvalid, true);
      document.removeEventListener("input", clear, true);
      document.removeEventListener("change", clear, true);
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
