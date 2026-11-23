// Image sizes for every upload, from the audit's "ไฟล์และการบีบอัด" table (Nov 2026).
// Pure math, shared by the browser encoder and its tests.

export type ImagePresetKey = "avatar" | "slip" | "scorecard" | "eventPhoto";

export type ImagePreset = {
  /** Expected size of a typical result, in KB (audit table). */
  expectedKB: readonly [number, number];
  /** Longest edge in px; images are never enlarged. */
  maxEdge: number;
  /** Re-encode again at a lower quality while the result is bigger than this. */
  maxOutputBytes: number;
  /** Encoder qualities tried in order. */
  qualities: readonly number[];
  /** Crop to a centred square (avatar). */
  square?: boolean;
  /** Extra small copy for lists (event photos). */
  thumbnailEdge?: number;
  type: "image/jpeg" | "image/webp";
};

export const imagePresets: Record<ImagePresetKey, ImagePreset> = {
  // Avatar: 512px square WebP 0.8, 30–60 KB.
  avatar: { expectedKB: [30, 60], maxEdge: 512, maxOutputBytes: 200 * 1024, qualities: [0.8, 0.7, 0.6], square: true, type: "image/webp" },
  // Event / news photo: 1920px WebP 0.75 + 480px thumbnail, 150–350 KB.
  eventPhoto: {
    expectedKB: [150, 350],
    maxEdge: 1920,
    maxOutputBytes: 900 * 1024,
    qualities: [0.75, 0.65, 0.55],
    thumbnailEdge: 480,
    type: "image/webp",
  },
  // Scorecard: 2000px JPEG 0.85, 300–600 KB. Handwriting must stay readable: do not go lower than 0.75.
  scorecard: { expectedKB: [300, 600], maxEdge: 2000, maxOutputBytes: 2.5 * 1024 * 1024, qualities: [0.85, 0.8, 0.75], type: "image/jpeg" },
  // Transfer slip: 1600px JPEG 0.85, 150–300 KB.
  slip: { expectedKB: [150, 300], maxEdge: 1600, maxOutputBytes: 1.5 * 1024 * 1024, qualities: [0.85, 0.75, 0.65], type: "image/jpeg" },
};

export type Size = { height: number; width: number };

/** Scales (width, height) so the longer edge is at most `maxEdge`, keeping the ratio. Never enlarges. */
export function fitWithin(width: number, height: number, maxEdge: number): Size {
  if (!(width > 0) || !(height > 0)) return { height: 0, width: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { height: Math.round(height), width: Math.round(width) };
  const scale = maxEdge / longest;
  return { height: Math.max(1, Math.round(height * scale)), width: Math.max(1, Math.round(width * scale)) };
}

export type CropRect = { height: number; width: number; x: number; y: number };

/**
 * Square crop of a (width × height) image. `zoom` ≥ 1 shrinks the square (1 = the largest square
 * that fits); `centerX`/`centerY` (0–1) say where the square is centred and are clamped so it
 * stays inside the image.
 */
export function squareCrop(width: number, height: number, { centerX = 0.5, centerY = 0.5, zoom = 1 }: { centerX?: number; centerY?: number; zoom?: number } = {}): CropRect {
  const side = Math.min(width, height) / Math.max(1, zoom);
  const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), Math.max(0, max));
  const x = clamp(centerX * width - side / 2, width - side);
  const y = clamp(centerY * height - side / 2, height - side);
  return { height: side, width: side, x, y };
}

/** Output size for a preset: square presets are `maxEdge` × `maxEdge` (or smaller for tiny images). */
export function outputSize(preset: ImagePreset, source: Size, crop?: CropRect): Size {
  if (preset.square) {
    const side = Math.min(preset.maxEdge, Math.round(crop?.width ?? Math.min(source.width, source.height)));
    return { height: side, width: side };
  }
  return fitWithin(crop?.width ?? source.width, crop?.height ?? source.height, preset.maxEdge);
}

/** Human size: 182 KB / 1.4 MB. */
export function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toLocaleString("th-TH", { maximumFractionDigits: 1 })} MB`;
  return `${Math.max(1, Math.round(bytes / 1024)).toLocaleString("th-TH")} KB`;
}

/** File name for the encoded copy: "IMG_1234.HEIC" → "IMG_1234.jpg". */
export function renameForType(name: string, type: ImagePreset["type"], suffix = "") {
  const base = (name || "image").replace(/\.[^./\\]+$/, "").slice(0, 80) || "image";
  return `${base}${suffix}.${type === "image/webp" ? "webp" : "jpg"}`;
}
