"use client";

import Image from "next/image";
import { useState } from "react";

type MemberAvatarProps = {
  avatarUrl?: string | null;
  displayName: string;
  size?: "large" | "small";
};

function getInitials(displayName: string) {
  const words = displayName.trim().split(/\s+/).filter(Boolean);

  if (!words.length) {
    return "ส";
  }

  return words
    .slice(0, 2)
    .map((word) => word.charAt(0))
    .join("");
}

export function MemberAvatar({
  avatarUrl,
  displayName,
  size = "small",
}: MemberAvatarProps) {
  const [imageFailed, setImageFailed] = useState(false);
  const sizeClass = size === "large" ? "size-20 text-2xl" : "size-14 text-lg";

  return (
    <div
      className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-white bg-[#722257] font-semibold text-white shadow-[0_8px_24px_rgba(114,34,87,0.2)] ${sizeClass}`}
      aria-label={`รูปประจำตัวของ ${displayName}`}
      role="img"
    >
      {avatarUrl && !imageFailed ? (
        <Image
          alt=""
          className="object-cover"
          fill
          onError={() => setImageFailed(true)}
          sizes={size === "large" ? "80px" : "56px"}
          src={avatarUrl}
          unoptimized
        />
      ) : (
        <span aria-hidden="true">{getInitials(displayName)}</span>
      )}
    </div>
  );
}
