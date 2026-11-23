// Server-side checks for every uploaded file: real type from magic bytes, size limit, sha256,
// image dimensions, and the storage path `{category}/{yyyy}/{mm}/{uuid}.{ext}` (Bangkok calendar).
// Pure apart from node:crypto, so it is unit-tested without Supabase.

import { createHash, randomUUID } from "node:crypto";

import { type ImageSize, readImageSize } from "./image-size";
import { type FileKind, type SniffedType, sniffFileType } from "./sniff";

/** Largest file the server accepts (audit: PDF / Excel up to 10 MB, images are compressed first). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export type UploadProblem = "empty" | "too-large" | "heic" | "unsupported";

/** Thai text for each problem, shown to whoever picked the file. */
export const uploadProblemMessages: Record<UploadProblem, string> = {
  empty: "ไม่พบไฟล์ เลือกไฟล์ใหม่อีกครั้ง",
  heic: "รูปแบบ HEIC ใช้ไม่ได้ ถ่ายภาพหน้าจอแล้วส่งใหม่ หรือตั้งกล้อง iPhone เป็น “เข้ากันได้มากที่สุด”",
  "too-large": "ไฟล์ใหญ่เกิน 10 MB",
  unsupported: "ไฟล์ต้องเป็นรูป JPG, PNG, WebP หรือ PDF",
};

export type InspectedFile = SniffedType & {
  bytes: Uint8Array;
  sha256: string;
  size: number;
  /** Null for PDF or when the header could not be read. */
  dimensions: ImageSize | null;
};

export type InspectResult = { ok: true; file: InspectedFile } | { ok: false; problem: UploadProblem; message: string };

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function inspectBytes(
  bytes: Uint8Array,
  { allowed = ["jpeg", "png", "webp", "pdf"], maxBytes = MAX_UPLOAD_BYTES }: { allowed?: readonly FileKind[]; maxBytes?: number } = {},
): InspectResult {
  const fail = (problem: UploadProblem): InspectResult => ({ message: uploadProblemMessages[problem], ok: false, problem });
  if (!bytes.length) return fail("empty");
  if (bytes.length > maxBytes) return fail("too-large");

  const sniffed = sniffFileType(bytes);
  if (!sniffed.ok) return fail(sniffed.reason);
  if (!allowed.includes(sniffed.type.kind)) return fail("unsupported");

  return {
    file: {
      ...sniffed.type,
      bytes,
      dimensions: readImageSize(sniffed.type.kind, bytes),
      sha256: sha256Hex(bytes),
      size: bytes.length,
    },
    ok: true,
  };
}

/** Reads a FormData file and runs `inspectBytes`. Non-files and empty inputs are "empty". */
export async function inspectUpload(file: unknown, options?: Parameters<typeof inspectBytes>[1]): Promise<InspectResult> {
  if (!(file instanceof Blob) || file.size === 0) {
    return { message: uploadProblemMessages.empty, ok: false, problem: "empty" };
  }
  // Refuse before reading a huge body into memory.
  if (file.size > (options?.maxBytes ?? MAX_UPLOAD_BYTES)) {
    return { message: uploadProblemMessages["too-large"], ok: false, problem: "too-large" };
  }
  return inspectBytes(new Uint8Array(await file.arrayBuffer()), options);
}

/** Year and month on the Bangkok calendar (UTC+7, no DST). */
export function bangkokYearMonth(now: Date) {
  const shifted = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return { month: String(shifted.getUTCMonth() + 1).padStart(2, "0"), year: String(shifted.getUTCFullYear()) };
}

/** `{category}/{yyyy}/{mm}/{uuid}.{ext}`. The category is reduced to [a-z0-9_-]. */
export function buildObjectPath(category: string, ext: string, { id = randomUUID(), now = new Date() }: { id?: string; now?: Date } = {}) {
  const safeCategory = category.toLowerCase().replace(/[^a-z0-9_-]/g, "") || "file";
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
  const { month, year } = bangkokYearMonth(now);
  return `${safeCategory}/${year}/${month}/${id}.${safeExt}`;
}
