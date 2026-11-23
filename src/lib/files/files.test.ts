import { describe, expect, it } from "vitest";

import { readImageSize } from "./image-size";
import { MAX_UPLOAD_BYTES, bangkokYearMonth, buildObjectPath, inspectBytes, sha256Hex } from "./inspect";
import { sniffFileType } from "./sniff";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => Array.from(value, (char) => char.charCodeAt(0));

function png(width: number, height: number) {
  const out = new Uint8Array(33);
  out.set([0x89, ...text("PNG"), 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, ...text("IHDR")]);
  new DataView(out.buffer).setUint32(16, width);
  new DataView(out.buffer).setUint32(20, height);
  return out;
}

function jpeg(width: number, height: number) {
  // SOI, APP0 (16 bytes payload), SOF0 with height/width
  return bytes(
    0xff, 0xd8,
    0xff, 0xe0, 0x00, 0x10, ...text("JFIF"), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0,
    0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1,
    0xff, 0xd9,
  );
}

function webpVp8x(width: number, height: number) {
  const out = new Uint8Array(30);
  out.set([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...text("VP8X"), 10, 0, 0, 0, 0, 0, 0, 0]);
  const w = width - 1;
  const h = height - 1;
  out.set([w & 0xff, (w >> 8) & 0xff, (w >> 16) & 0xff, h & 0xff, (h >> 8) & 0xff, (h >> 16) & 0xff], 24);
  return out;
}

function webpLossy(width: number, height: number) {
  const out = new Uint8Array(30);
  out.set([...text("RIFF"), 0, 0, 0, 0, ...text("WEBP"), ...text("VP8 ")]);
  out.set([0x9d, 0x01, 0x2a, width & 0xff, (width >> 8) & 0x3f, height & 0xff, (height >> 8) & 0x3f], 23);
  return out;
}

describe("sniffFileType", () => {
  it("recognises the four allowed types by their first bytes", () => {
    expect(sniffFileType(jpeg(10, 10))).toEqual({ ok: true, type: { ext: "jpg", kind: "jpeg", mime: "image/jpeg" } });
    expect(sniffFileType(png(1, 1))).toMatchObject({ ok: true, type: { kind: "png" } });
    expect(sniffFileType(webpVp8x(2, 2))).toMatchObject({ ok: true, type: { kind: "webp", mime: "image/webp" } });
    expect(sniffFileType(new Uint8Array(text("%PDF-1.7\n")))).toMatchObject({ ok: true, type: { ext: "pdf", kind: "pdf" } });
  });

  it("calls out HEIC so the member can be told what to do", () => {
    const heic = new Uint8Array([0, 0, 0, 0x18, ...text("ftypheic"), 0, 0, 0, 0]);
    expect(sniffFileType(heic)).toEqual({ ok: false, reason: "heic" });
    expect(sniffFileType(new Uint8Array([0, 0, 0, 0x18, ...text("ftypmif1")]))).toEqual({ ok: false, reason: "heic" });
  });

  it("rejects everything else, whatever the file name says", () => {
    expect(sniffFileType(new Uint8Array(text("GIF89a")))).toEqual({ ok: false, reason: "unsupported" });
    expect(sniffFileType(new Uint8Array(text("<svg xmlns")))).toEqual({ ok: false, reason: "unsupported" });
    expect(sniffFileType(new Uint8Array(text("PK\u0003\u0004")))).toEqual({ ok: false, reason: "unsupported" });
    expect(sniffFileType(new Uint8Array())).toEqual({ ok: false, reason: "empty" });
  });
});

describe("readImageSize", () => {
  it("reads width and height from PNG, JPEG and WebP headers", () => {
    expect(readImageSize("png", png(1600, 1200))).toEqual({ height: 1200, width: 1600 });
    expect(readImageSize("jpeg", jpeg(1200, 1600))).toEqual({ height: 1600, width: 1200 });
    expect(readImageSize("webp", webpVp8x(512, 512))).toEqual({ height: 512, width: 512 });
    expect(readImageSize("webp", webpLossy(1920, 1080))).toEqual({ height: 1080, width: 1920 });
  });

  it("returns null for PDFs and truncated headers", () => {
    expect(readImageSize("pdf", new Uint8Array(text("%PDF-1.4")))).toBeNull();
    expect(readImageSize("png", png(10, 10).subarray(0, 18))).toBeNull();
    expect(readImageSize("jpeg", bytes(0xff, 0xd8, 0xff, 0xd9))).toBeNull();
  });
});

describe("inspectBytes", () => {
  it("returns type, size, sha256 and dimensions", () => {
    const file = jpeg(800, 600);
    const result = inspectBytes(file);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file).toMatchObject({ dimensions: { height: 600, width: 800 }, ext: "jpg", mime: "image/jpeg", size: file.length });
    expect(result.file.sha256).toBe(sha256Hex(file));
    expect(result.file.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("enforces the 10 MB limit and the allowed kinds with Thai messages", () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    big.set(jpeg(1, 1));
    expect(inspectBytes(big)).toMatchObject({ message: "ไฟล์ใหญ่เกิน 10 MB", ok: false, problem: "too-large" });
    expect(inspectBytes(new Uint8Array(text("%PDF-1.4")), { allowed: ["jpeg", "png", "webp"] })).toMatchObject({ ok: false, problem: "unsupported" });
    const heic = inspectBytes(new Uint8Array([0, 0, 0, 0x18, ...text("ftypheic")]));
    expect(heic).toMatchObject({ ok: false, problem: "heic" });
    expect(heic.ok ? "" : heic.message).toContain("HEIC");
  });

  it("hashes like sha256sum", () => {
    expect(sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("buildObjectPath", () => {
  it("uses {category}/{yyyy}/{mm}/{uuid}.{ext} on the Bangkok calendar", () => {
    const id = "11111111-2222-3333-4444-555555555555";
    // 31 Dec 2026 20:00 UTC is already 1 Jan 2027 in Bangkok
    expect(buildObjectPath("event", "jpg", { id, now: new Date("2026-12-31T20:00:00Z") })).toBe(`event/2027/01/${id}.jpg`);
    expect(buildObjectPath("lesson_package", "PDF", { id, now: new Date("2026-11-23T03:00:00Z") })).toBe(`lesson_package/2026/11/${id}.pdf`);
    expect(buildObjectPath("../etc", "jp/g", { id, now: new Date("2026-05-01T00:00:00Z") })).toBe(`etc/2026/05/${id}.jpg`);
  });

  it("generates a fresh uuid per file", () => {
    const a = buildObjectPath("slip", "jpg");
    const b = buildObjectPath("slip", "jpg");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^slip\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(bangkokYearMonth(new Date("2026-01-31T17:00:00Z"))).toEqual({ month: "02", year: "2026" });
  });
});
