import { describe, expect, it } from "vitest";

import { fitWithin, formatBytes, imagePresets, outputSize, renameForType, squareCrop } from "./presets";

describe("imagePresets (audit table)", () => {
  it("matches the agreed sizes, formats and qualities", () => {
    expect(imagePresets.avatar).toMatchObject({ maxEdge: 512, square: true, type: "image/webp" });
    expect(imagePresets.avatar.qualities[0]).toBe(0.8);
    expect(imagePresets.slip).toMatchObject({ maxEdge: 1600, type: "image/jpeg" });
    expect(imagePresets.slip.qualities[0]).toBe(0.85);
    expect(imagePresets.scorecard).toMatchObject({ maxEdge: 2000, type: "image/jpeg" });
    expect(imagePresets.scorecard.qualities[0]).toBe(0.85);
    expect(imagePresets.eventPhoto).toMatchObject({ maxEdge: 1920, thumbnailEdge: 480, type: "image/webp" });
    expect(imagePresets.eventPhoto.qualities[0]).toBe(0.75);
  });

  it("keeps fallback qualities descending and scorecards readable", () => {
    for (const preset of Object.values(imagePresets)) {
      expect([...preset.qualities].sort((a, b) => b - a)).toEqual(preset.qualities);
      expect(preset.maxOutputBytes).toBeGreaterThan(preset.expectedKB[1] * 1024);
    }
    expect(Math.min(...imagePresets.scorecard.qualities)).toBeGreaterThanOrEqual(0.75);
  });
});

describe("fitWithin", () => {
  it("scales a 12 MP phone photo to the slip size", () => {
    expect(fitWithin(4032, 3024, 1600)).toEqual({ height: 1200, width: 1600 });
    expect(fitWithin(3024, 4032, 1600)).toEqual({ height: 1600, width: 1200 });
  });

  it("scales scorecards and event photos to their edges", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ height: 1500, width: 2000 });
    expect(fitWithin(6000, 4000, 1920)).toEqual({ height: 1280, width: 1920 });
    expect(fitWithin(1920, 1280, 480)).toEqual({ height: 320, width: 480 });
  });

  it("never enlarges small images such as bank-app screenshots", () => {
    expect(fitWithin(1170, 2532, 1600)).toEqual({ height: 1600, width: 739 });
    expect(fitWithin(720, 1280, 1600)).toEqual({ height: 1280, width: 720 });
    expect(fitWithin(0, 100, 1600)).toEqual({ height: 0, width: 0 });
  });
});

describe("squareCrop and outputSize", () => {
  it("takes the centred square by default", () => {
    expect(squareCrop(4000, 3000)).toEqual({ height: 3000, width: 3000, x: 500, y: 0 });
  });

  it("zooms in and keeps the square inside the photo", () => {
    expect(squareCrop(4000, 3000, { zoom: 2 })).toEqual({ height: 1500, width: 1500, x: 1250, y: 750 });
    expect(squareCrop(4000, 3000, { centerX: 0, centerY: 1, zoom: 2 })).toEqual({ height: 1500, width: 1500, x: 0, y: 1500 });
    expect(squareCrop(4000, 3000, { centerX: 5, zoom: 1 })).toMatchObject({ x: 1000 });
  });

  it("outputs a 512 px square avatar, smaller only for tiny photos", () => {
    expect(outputSize(imagePresets.avatar, { height: 3000, width: 4000 })).toEqual({ height: 512, width: 512 });
    expect(outputSize(imagePresets.avatar, { height: 300, width: 400 })).toEqual({ height: 300, width: 300 });
    expect(outputSize(imagePresets.avatar, { height: 3000, width: 4000 }, squareCrop(4000, 3000, { zoom: 3 }))).toEqual({ height: 512, width: 512 });
    expect(outputSize(imagePresets.slip, { height: 4032, width: 3024 })).toEqual({ height: 1600, width: 1200 });
  });
});

describe("formatBytes / renameForType", () => {
  it("formats sizes in KB and MB", () => {
    expect(formatBytes(182 * 1024)).toBe("182 KB");
    expect(formatBytes(3.25 * 1024 * 1024)).toBe("3.3 MB");
    expect(formatBytes(10)).toBe("1 KB");
  });

  it("renames to the encoded type", () => {
    expect(renameForType("IMG_1234.HEIC", "image/jpeg")).toBe("IMG_1234.jpg");
    expect(renameForType("me.png", "image/webp")).toBe("me.webp");
    expect(renameForType("photo.jpeg", "image/webp", "-thumb")).toBe("photo-thumb.webp");
    expect(renameForType("", "image/jpeg")).toBe("image.jpg");
  });
});
