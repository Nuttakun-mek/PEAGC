// Width and height read from the image header (no image library needed on the server).
// Returns null when the header is cut off or not understood; the upload still goes through.

import type { FileKind } from "./sniff";

export type ImageSize = { height: number; width: number };

function u16be(bytes: Uint8Array, offset: number) {
  return (bytes[offset] << 8) | bytes[offset + 1];
}

function u32be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function u24le(bytes: Uint8Array, offset: number) {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  // 8-byte signature, then the IHDR chunk: length(4) "IHDR"(4) width(4) height(4)
  if (bytes.length < 24) return null;
  return { height: u32be(bytes, 20), width: u32be(bytes, 16) };
}

/** SOFn markers carry the frame size; C4 (DHT), C8 (JPG) and CC (DAC) share the range but do not. */
function isStartOfFrame(marker: number) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function jpegSize(bytes: Uint8Array): ImageSize | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1; // fill byte
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2; // markers without a length
      continue;
    }
    if (marker === 0xd9) return null;
    if (isStartOfFrame(marker)) {
      return { height: u16be(bytes, offset + 5), width: u16be(bytes, offset + 7) };
    }
    offset += 2 + u16be(bytes, offset + 2);
  }
  return null;
}

function webpSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 30) return null;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === "VP8 ") {
    return { height: (bytes[28] | (bytes[29] << 8)) & 0x3fff, width: (bytes[26] | (bytes[27] << 8)) & 0x3fff };
  }
  if (chunk === "VP8L") {
    const b0 = bytes[21];
    const b1 = bytes[22];
    const b2 = bytes[23];
    const b3 = bytes[24];
    return {
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
      width: 1 + (((b1 & 0x3f) << 8) | b0),
    };
  }
  if (chunk === "VP8X") {
    return { height: 1 + u24le(bytes, 27), width: 1 + u24le(bytes, 24) };
  }
  return null;
}

export function readImageSize(kind: FileKind, bytes: Uint8Array): ImageSize | null {
  const size = kind === "png" ? pngSize(bytes) : kind === "jpeg" ? jpegSize(bytes) : kind === "webp" ? webpSize(bytes) : null;
  if (!size || size.width <= 0 || size.height <= 0) return null;
  return size;
}
