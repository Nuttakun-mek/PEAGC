"use client";

import { FileText } from "lucide-react";
import { useState } from "react";

import { buttonClass } from "@/components/ui/styles";

/** PDF by stored MIME type or file extension (no need to wait for an image load error). */
function isPdfSlip(mimeType: string | null | undefined, path: string | null | undefined) {
  return mimeType === "application/pdf" || /\.pdf$/i.test(path ?? "");
}

/**
 * Slip thumbnail for the review panel. `href` is the proof route, which redirects to a signed URL
 * that expires after two minutes. PDFs are shown as a file box straight away; an image that still
 * fails to load (deleted, expired) falls back to the same box. "เปิดสลิป" opens the full file.
 */
export function PaymentsSlipPreview({ href, mimeType, path }: { href: string; mimeType?: string | null; path?: string | null }) {
  const pdf = isPdfSlip(mimeType, path);
  const [failed, setFailed] = useState(false);

  return (
    <div className="grid gap-2">
      {pdf || failed ? (
        <div className="flex min-h-40 flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-line bg-white p-4 text-center">
          <FileText className="size-6 text-ink-subtle" aria-hidden="true" />
          <p className="text-sm text-ink-muted">
            {pdf ? "สลิปเป็นไฟล์ PDF กด “เปิดสลิป” เพื่อดู" : "แสดงตัวอย่างไม่ได้ กด “เปิดสลิป” เพื่อดู"}
          </p>
        </div>
      ) : (
        <a
          className="block overflow-hidden rounded-lg border border-line bg-white outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20"
          href={href}
          rel="noopener"
          target="_blank"
        >
          {/* Signed storage URL behind a redirect: next/image would need the bucket host allow-listed. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt="สลิปโอนเงิน (กดเพื่อดูขนาดเต็ม)"
            className="max-h-[28rem] w-full object-contain"
            loading="lazy"
            onError={() => setFailed(true)}
            src={href}
          />
        </a>
      )}
      <a className={`${buttonClass("secondary", "sm")} w-fit`} href={href} rel="noopener" target="_blank">
        <FileText className="size-4" aria-hidden="true" />
        เปิดสลิป{pdf ? " (PDF)" : ""}
      </a>
    </div>
  );
}
