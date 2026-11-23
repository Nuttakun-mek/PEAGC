// File type from the first bytes ("magic bytes"), never from the browser's name or MIME type.
// Only JPEG, PNG, WebP and PDF are accepted anywhere in the app. HEIC (iPhone camera default) is
// recognised so the member gets a message that says what to do instead of "wrong file".

export type FileKind = "jpeg" | "png" | "webp" | "pdf";

export type SniffedType = { ext: string; kind: FileKind; mime: string };

export type SniffResult = { ok: true; type: SniffedType } | { ok: false; reason: "empty" | "heic" | "unsupported" };

const types: Record<FileKind, SniffedType> = {
  jpeg: { ext: "jpg", kind: "jpeg", mime: "image/jpeg" },
  pdf: { ext: "pdf", kind: "pdf", mime: "application/pdf" },
  png: { ext: "png", kind: "png", mime: "image/png" },
  webp: { ext: "webp", kind: "webp", mime: "image/webp" },
};

/** ISO-BMFF brands used by HEIC/HEIF photos (iPhone camera, some Android phones). */
const heifBrands = new Set(["heic", "heix", "hevc", "hevx", "heim", "heis", "hevm", "hevs", "mif1", "msf1"]);

function ascii(bytes: Uint8Array, start: number, length: number) {
  if (bytes.length < start + length) return "";
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

export function sniffFileType(bytes: Uint8Array): SniffResult {
  if (!bytes.length) return { ok: false, reason: "empty" };

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ok: true, type: types.jpeg };
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    ascii(bytes, 1, 3) === "PNG" &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ok: true, type: types.png };
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") {
    return { ok: true, type: types.webp };
  }
  if (ascii(bytes, 0, 5) === "%PDF-") {
    return { ok: true, type: types.pdf };
  }
  if (ascii(bytes, 4, 4) === "ftyp" && heifBrands.has(ascii(bytes, 8, 4))) {
    return { ok: false, reason: "heic" };
  }
  return { ok: false, reason: "unsupported" };
}

/** Kinds that are images (re-encoded on the phone, dimensions stored). */
export function isImageKind(kind: FileKind) {
  return kind !== "pdf";
}
