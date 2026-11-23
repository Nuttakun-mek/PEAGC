import Image from "next/image";

/** Full club name. Use it once per screen next to the crest instead of PEA / PEAGC / PEA Golf Club variants. */
export const CLUB_NAME = "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค";

/** The club crest (PEA GOLF CLUB). One mark for the sidebar, login, member card and app icons. */
export function ClubCrest({ className = "", priority = false, size = 40 }: { className?: string; priority?: boolean; size?: number }) {
  return (
    <Image
      alt="ตราชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค"
      className={`shrink-0 ${className}`}
      height={size}
      priority={priority}
      src={size > 160 ? "/brand/peagc-crest.png" : "/brand/peagc-crest-256.png"}
      width={size}
    />
  );
}

/** The PEA corporate mark, for "การไฟฟ้าส่วนภูมิภาค" (the organisation), not for the club. */
export function PeaLogo({ className = "", height = 24 }: { className?: string; height?: number }) {
  return (
    <Image
      alt="การไฟฟ้าส่วนภูมิภาค (PEA)"
      className={`w-auto shrink-0 ${className}`}
      height={height}
      src="/brand/pea-logo.png"
      style={{ height, width: "auto" }}
      width={Math.round((height * 431) / 562)}
    />
  );
}
