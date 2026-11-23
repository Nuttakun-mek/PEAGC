"use client";

import { Printer } from "lucide-react";

import { buttonClass } from "@/components/ui/styles";

export function EventsPrintButton({ label = "พิมพ์" }: { label?: string }) {
  return (
    <button className={buttonClass("primary", "md")} onClick={() => window.print()} type="button">
      <Printer className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
