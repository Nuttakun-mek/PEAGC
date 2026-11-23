import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { ImageResponse } from "next/og";

import { formatFee, formatThaiDateLong, formatThaiTime } from "@/lib/display";
import { loadPublicEvent, venueText } from "@/lib/events/public";

// Preview image for a shared event link (chat apps show it with the title and description).

export const alt = "กิจกรรมออกรอบ ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค";
export const size = { height: 630, width: 1200 };
export const contentType = "image/png";

const CLUB_NAME = "ชมรมกอล์ฟการไฟฟ้าส่วนภูมิภาค";
const PLUM = "#722257";
const GOLD = "#C69214";

export default async function Image({ params }: { params: Promise<{ eventId: string }> }) {
  const { eventId } = await params;
  const root = process.cwd();
  const [event, regular, semibold, crest] = await Promise.all([
    loadPublicEvent(eventId).catch(() => null),
    readFile(join(root, "src/app/fonts/Sarabun-Regular.ttf")),
    readFile(join(root, "src/app/fonts/Sarabun-SemiBold.ttf")),
    readFile(join(root, "public/brand/peagc-crest-256.png")),
  ]);
  const crestSrc = `data:image/png;base64,${crest.toString("base64")}`;
  const lines = event
    ? [
        formatThaiDateLong(event.eventDate),
        [event.teeOffTime ? `ออกรอบ ${formatThaiTime(event.teeOffTime)}` : null, venueText(event)].filter(Boolean).join(" · "),
        `ค่าสมัคร ${formatFee(event.memberPrice)}`,
      ]
    : ["สมัครกิจกรรมออกรอบ จองรอบเรียน และดูผลการแข่งขัน"];
  const title = event?.name ?? CLUB_NAME;

  return new ImageResponse(
    (
      <div style={{ background: "#FFFFFF", display: "flex", height: "100%", width: "100%" }}>
        <div style={{ background: PLUM, display: "flex", height: "100%", width: 28 }} />
        <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "space-between", padding: "56px 64px" }}>
          <div style={{ alignItems: "center", display: "flex", gap: 24 }}>
            <img alt="" height={112} src={crestSrc} width={112} />
            <div style={{ color: PLUM, display: "flex", fontSize: 38, fontWeight: 600 }}>{CLUB_NAME}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
            <div style={{ background: GOLD, display: "flex", height: 8, width: 120 }} />
            <div
              style={{
                color: "#1F2937",
                display: "flex",
                fontSize: title.length > 40 ? 56 : 68,
                fontWeight: 600,
                lineHeight: 1.25,
                maxHeight: 180,
                overflow: "hidden",
              }}
            >
              {title}
            </div>
            {lines.map((line) => (
              <div key={line} style={{ color: "#475467", display: "flex", fontSize: 36, lineHeight: 1.3 }}>
                {line}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { data: regular, name: "Sarabun", style: "normal", weight: 400 },
        { data: semibold, name: "Sarabun", style: "normal", weight: 600 },
      ],
    },
  );
}
