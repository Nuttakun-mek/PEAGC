// Browser-only image re-encoding before upload. Drawing the photo on a canvas and encoding it
// again shrinks it to the preset size and drops every EXIF field (including GPS). The bitmap is
// decoded with `imageOrientation: "from-image"` so phone photos are turned upright first.

import { type CropRect, type ImagePreset, type ImagePresetKey, type Size, imagePresets, outputSize, renameForType, squareCrop, fitWithin } from "./presets";

export type CompressFailure = "decode" | "encode";

export class ImageCompressError extends Error {
  constructor(public readonly reason: CompressFailure) {
    super(reason);
    this.name = "ImageCompressError";
  }
}

export const compressFailureMessages: Record<CompressFailure, string> = {
  decode: "เปิดรูปนี้ไม่ได้ ถ้าเป็นไฟล์ HEIC ให้ถ่ายภาพหน้าจอแล้วเลือกใหม่ หรือเลือกรูป JPG/PNG",
  encode: "ย่อรูปไม่สำเร็จ ลองเลือกรูปอีกครั้ง",
};

export type CompressedImage = {
  file: File;
  height: number;
  originalBytes: number;
  thumbnail: File | null;
  width: number;
};

export async function decodeImage(file: Blob): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageCompressError("decode");
  }
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

async function drawAndEncode(bitmap: ImageBitmap, crop: CropRect, size: Size, type: string, quality: number): Promise<Blob> {
  const paint = (context: Canvas2D | null) => {
    if (!context) throw new ImageCompressError("encode");
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    if (type === "image/jpeg") {
      // JPEG has no transparency: a transparent PNG screenshot would otherwise turn black.
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, size.width, size.height);
    }
    context.drawImage(bitmap, crop.x, crop.y, crop.width, crop.height, 0, 0, size.width, size.height);
  };

  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(size.width, size.height);
    paint(canvas.getContext("2d"));
    return canvas.convertToBlob({ quality, type });
  }

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  paint(canvas.getContext("2d"));
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new ImageCompressError("encode"))), type, quality);
  });
}

async function encodeWithPreset(bitmap: ImageBitmap, crop: CropRect, size: Size, preset: ImagePreset): Promise<Blob> {
  let type: string = preset.type;
  let blob: Blob | null = null;
  for (const quality of preset.qualities) {
    blob = await drawAndEncode(bitmap, crop, size, type, quality);
    // Older Safari cannot encode WebP and silently returns PNG: use JPEG instead.
    if (blob.type !== type) {
      type = "image/jpeg";
      blob = await drawAndEncode(bitmap, crop, size, type, quality);
    }
    if (blob.size <= preset.maxOutputBytes) break;
  }
  if (!blob) throw new ImageCompressError("encode");
  return blob;
}

function toFile(blob: Blob, name: string, preset: ImagePreset, suffix = "") {
  const type = blob.type === "image/webp" ? "image/webp" : "image/jpeg";
  return new File([blob], renameForType(name, type as ImagePreset["type"], suffix), { lastModified: Date.now(), type });
}

/**
 * Re-encodes `file` with a preset. `crop` (source pixels) is used by the avatar cropper; square
 * presets otherwise take the centred square.
 */
export async function compressImage(file: File, presetKey: ImagePresetKey, { crop }: { crop?: CropRect } = {}): Promise<CompressedImage> {
  const preset = imagePresets[presetKey];
  const bitmap = await decodeImage(file);
  try {
    const source = { height: bitmap.height, width: bitmap.width };
    const area = crop ?? (preset.square ? squareCrop(source.width, source.height) : { height: source.height, width: source.width, x: 0, y: 0 });
    const size = outputSize(preset, source, area);
    if (!size.width || !size.height) throw new ImageCompressError("decode");

    const main = await encodeWithPreset(bitmap, area, size, preset);
    let thumbnail: File | null = null;
    if (preset.thumbnailEdge) {
      const thumbSize = fitWithin(area.width, area.height, preset.thumbnailEdge);
      thumbnail = toFile(await encodeWithPreset(bitmap, area, thumbSize, preset), file.name, preset, "-thumb");
    }

    return { file: toFile(main, file.name, preset), height: size.height, originalBytes: file.size, thumbnail, width: size.width };
  } finally {
    bitmap.close();
  }
}

/** True when the browser can decode and re-encode images (all current phone browsers). */
export function canCompressImages() {
  return typeof window !== "undefined" && typeof createImageBitmap === "function" && typeof DataTransfer === "function";
}
