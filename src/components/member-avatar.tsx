"use client";

import Image from "next/image";
import { useState } from "react";

type MemberAvatarProps = {
  avatarUrl?: string | null;
  displayName: string;
  /** Stable value (member code or id) that picks the fallback colour, so each member keeps theirs. */
  seed?: string | null;
  size?: "large" | "small" | "xs";
};

// Fallback backgrounds; every one keeps white text above 4.5:1.
const palette = ["#722257", "#175cd3", "#067647", "#b54708", "#5c1b46", "#475467", "#8c6510", "#6941c6"];

/**
 * One initial from the first name, in the name's own script (no "สP" mixes). A Thai leading
 * vowel (เ แ โ ใ ไ) is skipped so "เอกชัย" shows "อ", not a lone vowel.
 */
export function getInitial(displayName: string) {
  const first = displayName.trim().split(/\s+/)[0] ?? "";
  const letter = first.replace(/^[เแโใไ]+/, "").charAt(0) || first.charAt(0);
  return letter ? letter.toLocaleUpperCase("th-TH") : "ส";
}

function colorFor(seed: string) {
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return palette[hash % palette.length];
}

const sizes = {
  large: { box: "size-20 text-2xl", px: "80px" },
  small: { box: "size-14 text-lg", px: "56px" },
  xs: { box: "size-9 text-sm", px: "36px" },
};

export function MemberAvatar({ avatarUrl, displayName, seed, size = "small" }: MemberAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const { box, px } = sizes[size];

  return (
    <div
      aria-label={`รูปประจำตัวของ ${displayName}`}
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white ${box}`}
      role="img"
      style={{ backgroundColor: colorFor(seed || displayName) }}
    >
      {avatarUrl && !imageFailed ? (
        <Image alt="" className="object-cover" fill onError={() => setImageFailed(true)} sizes={px} src={avatarUrl} unoptimized />
      ) : (
        <span aria-hidden="true">{getInitial(displayName)}</span>
      )}
    </div>
  );
}
