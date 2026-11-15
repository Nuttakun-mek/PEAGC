/**
 * Guards against Thai text that was mangled before it reached us: a client or script that
 * sends text through a non-UTF-8 code page turns each Thai character into "?" (the seed
 * accounts were stored as "?????? PEAGC 1"), and a TIS-620 / Windows-874 file read as UTF-8
 * turns into U+FFFD replacement characters. Once stored, the original text cannot be recovered.
 */

const CORRUPTED = /�|\?{3,}/;

export function hasCorruptedText(value: string | null | undefined) {
  return Boolean(value && CORRUPTED.test(value));
}

/** True when any of the given form values looks mangled. */
export function anyCorruptedText(values: Array<string | null | undefined>) {
  return values.some((value) => hasCorruptedText(value));
}

/**
 * Decodes an uploaded text file. Excel on Thai Windows saves "CSV" as Windows-874 (TIS-620),
 * which `File.text()` would decode as UTF-8 into replacement characters. Prefer UTF-8 (with or
 * without BOM) and fall back to Windows-874 when the bytes are not valid UTF-8.
 */
export function decodeTextFile(bytes: ArrayBuffer | Uint8Array) {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return { encoding: "utf-8" as const, text: stripBom(new TextDecoder("utf-8", { fatal: true }).decode(view)) };
  } catch {
    return { encoding: "windows-874" as const, text: stripBom(new TextDecoder("windows-874").decode(view)) };
  }
}

function stripBom(text: string) {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
