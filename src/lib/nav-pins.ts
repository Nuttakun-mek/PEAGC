// Pinned admin menu items (per viewer, stored in localStorage by the sidebar). Pure helpers.

export const MAX_PINS = 4;
export const PINS_STORAGE_KEY = "peagc.admin.pins.v1";

/** Stored value → pinned hrefs that still exist in this person's menu, in pin order, max 4. */
export function parsePins(raw: string | null | undefined, allowedHrefs: readonly string[]): string[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const allowed = new Set(allowedHrefs);
  const pins: string[] = [];
  for (const item of value) {
    if (typeof item === "string" && allowed.has(item) && !pins.includes(item)) pins.push(item);
    if (pins.length >= MAX_PINS) break;
  }
  return pins;
}

/** Pin or unpin `href`. Pinning a fifth item is refused (returns the list unchanged). */
export function togglePin(pins: readonly string[], href: string, max = MAX_PINS): string[] {
  if (pins.includes(href)) return pins.filter((item) => item !== href);
  if (pins.length >= max) return [...pins];
  return [...pins, href];
}
