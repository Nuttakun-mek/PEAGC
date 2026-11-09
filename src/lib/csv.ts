// Excel-friendly CSV: UTF-8 BOM (so Thai renders in Excel), CRLF line endings, RFC 4180 quoting.

export function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  // Neutralise spreadsheet formula injection from user-entered text (=, +, -, @ prefixes).
  const safe = /^[=+\-@\t\r]/.test(text) && !/^[+-]?[\d\s().-]+$/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function csvLine(cells: unknown[]) {
  return cells.map(csvCell).join(",");
}

export function toCsv(header: string[], rows: unknown[][]) {
  return `﻿${[csvLine(header), ...rows.map(csvLine)].join("\r\n")}`;
}

export function csvResponseInit(filename: string): ResponseInit {
  return {
    headers: {
      "Cache-Control": "no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  };
}
