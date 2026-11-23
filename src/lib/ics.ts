/**
 * Minimal iCalendar (RFC 5545) builder for "add to calendar" links: lesson bookings and event
 * registrations open in Google / Apple Calendar. Times are Asia/Bangkok wall-clock values.
 */

export type IcsEvent = {
  /** Stable id, e.g. `lesson-booking-<uuid>`; calendars use it to update instead of duplicating. */
  uid: string;
  title: string;
  /** "2026-12-20" */
  date: string;
  /** "16:30" or "16:30:00"; omit both times for an all-day event. */
  startTime?: string | null;
  endTime?: string | null;
  location?: string | null;
  description?: string | null;
  url?: string | null;
};

function escapeText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
}

/** Lines longer than 75 octets are folded with CRLF + space (RFC 5545 §3.1). */
function fold(line: string) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const length = new TextEncoder().encode(char).length;
    if (size + length > (parts.length ? 74 : 75)) {
      parts.push(current);
      current = "";
      size = 0;
    }
    current += char;
    size += length;
  }
  parts.push(current);
  return parts.join("\r\n ");
}

function compactDate(date: string) {
  return date.replace(/-/g, "");
}

function compactTime(time: string) {
  const [hours = "00", minutes = "00", seconds = "00"] = time.split(":");
  return `${hours.padStart(2, "0")}${minutes.padStart(2, "0")}${seconds.padStart(2, "0")}`;
}

function nextDay(date: string) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

export function buildIcs(events: IcsEvent[], { calendarName = "ชมรมกอล์ฟ PEA", now = new Date() }: { calendarName?: string; now?: Date } = {}) {
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//PEAGC//TH",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(calendarName)}`,
    "X-WR-TIMEZONE:Asia/Bangkok",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Bangkok",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0700",
    "TZOFFSETTO:+0700",
    "TZNAME:ICT",
    "END:STANDARD",
    "END:VTIMEZONE",
  ];

  for (const event of events) {
    lines.push("BEGIN:VEVENT", `UID:${event.uid}@peagc`, `DTSTAMP:${stamp}`);
    if (event.startTime) {
      lines.push(`DTSTART;TZID=Asia/Bangkok:${compactDate(event.date)}T${compactTime(event.startTime)}`);
      lines.push(`DTEND;TZID=Asia/Bangkok:${compactDate(event.date)}T${compactTime(event.endTime ?? event.startTime)}`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compactDate(event.date)}`, `DTEND;VALUE=DATE:${compactDate(nextDay(event.date))}`);
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeText(event.description)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

/** Response for a route handler: `return icsResponse(buildIcs([...]), "lesson.ics")`. */
export function icsResponse(body: string, fileName: string) {
  return new Response(body, {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/calendar; charset=utf-8",
    },
  });
}
