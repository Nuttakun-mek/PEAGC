"use client";

import { Printer } from "lucide-react";

import { buttonClass } from "@/components/ui/styles";

/** Opens the browser print dialog; "Save as PDF" there gives the member a PDF receipt. */
export function ReceiptPrintButton() {
  return (
    <button className={buttonClass("primary", "md")} onClick={() => window.print()} type="button">
      <Printer className="size-4" aria-hidden="true" />
      พิมพ์ / บันทึกเป็น PDF
    </button>
  );
}
