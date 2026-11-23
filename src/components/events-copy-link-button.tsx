"use client";

import { Check, Link2 } from "lucide-react";
import { useState } from "react";

import { buttonClass } from "@/components/ui/styles";

/**
 * Copies the public link of an event (`/events/<id>`) so staff can paste it into a chat group;
 * the page has a preview image and description. Falls back to the share sheet / a prompt.
 */
export function EventsCopyLinkButton({ path, title }: { path: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      if (navigator.share) {
        await navigator.share({ title, url }).catch(() => undefined);
      } else {
        window.prompt("คัดลอกลิงก์นี้", url);
      }
    }
  }

  return (
    <button className={buttonClass("secondary", "md")} onClick={copy} type="button">
      {copied ? <Check className="size-4" aria-hidden="true" /> : <Link2 className="size-4" aria-hidden="true" />}
      <span aria-live="polite">{copied ? "คัดลอกแล้ว" : "คัดลอกลิงก์กิจกรรม"}</span>
    </button>
  );
}
