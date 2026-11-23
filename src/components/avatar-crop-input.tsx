"use client";

import { AlertTriangle, Check, Minus, Plus, Upload, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { buttonClass, fieldHint, fieldLabel } from "@/components/ui/styles";
import { ImageCompressError, compressFailureMessages, compressImage, decodeImage } from "@/lib/images/compress";
import { formatBytes, squareCrop } from "@/lib/images/presets";

/** Crop window size on screen (fits a 390px phone with the page padding). */
const VIEW = 240;
const MAX_ZOOM = 4;

type Source = { file: File; height: number; url: string; width: number };
type Framing = { centerX: number; centerY: number; zoom: number };

const startFraming: Framing = { centerX: 0.5, centerY: 0.5, zoom: 1 };

function setInputFiles(input: HTMLInputElement | null, files: File[]) {
  if (!input) return false;
  try {
    const transfer = new DataTransfer();
    for (const file of files) transfer.items.add(file);
    input.files = transfer.files;
    return true;
  } catch {
    return false;
  }
}

/**
 * Profile photo picker with a square crop: drag the photo (or use the arrow keys) to position it,
 * zoom with the slider, then "ใช้รูปนี้" turns the square into a 512px WebP (EXIF/GPS removed)
 * placed in the `name` file field of the surrounding form. Nothing is uploaded until the form
 * is saved.
 */
export function AvatarCropInput({ disabled, name = "avatar" }: { disabled?: boolean; name?: string }) {
  const id = useId();
  const pickerRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  const drag = useRef<{ x: number; y: number; framing: Framing } | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [framing, setFraming] = useState<Framing>(startFraming);
  const [result, setResult] = useState<{ size: number; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Object URLs are released when replaced and on unmount.
  useEffect(() => () => {
    if (source) URL.revokeObjectURL(source.url);
  }, [source]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);

  // A saved form resets its fields; drop the preview with it.
  useEffect(() => {
    const form = fieldRef.current?.form;
    if (!form) return;
    const onReset = () => {
      setResult(null);
      setSource(null);
    };
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, []);

  async function pick(file: File | undefined) {
    setError("");
    if (!file) return;
    setBusy(true);
    try {
      const bitmap = await decodeImage(file);
      const next = { file, height: bitmap.height, url: URL.createObjectURL(file), width: bitmap.width };
      bitmap.close();
      setFraming(startFraming);
      setSource(next);
    } catch (caught) {
      setError(compressFailureMessages[caught instanceof ImageCompressError ? caught.reason : "decode"]);
    } finally {
      setBusy(false);
      if (pickerRef.current) pickerRef.current.value = "";
    }
  }

  const rect = source ? squareCrop(source.width, source.height, framing) : null;
  const scale = rect ? VIEW / rect.width : 1;

  /** Moves the crop square by (dx, dy) screen pixels, kept inside the photo. */
  function move(from: Framing, dx: number, dy: number) {
    if (!source) return from;
    const moved = { ...from, centerX: from.centerX - dx / scale / source.width, centerY: from.centerY - dy / scale / source.height };
    const box = squareCrop(source.width, source.height, moved);
    return { ...moved, centerX: (box.x + box.width / 2) / source.width, centerY: (box.y + box.height / 2) / source.height };
  }

  function zoomTo(zoom: number) {
    setFraming((current) => {
      if (!source) return current;
      const next = { ...current, zoom: Math.min(MAX_ZOOM, Math.max(1, zoom)) };
      const box = squareCrop(source.width, source.height, next);
      return { ...next, centerX: (box.x + box.width / 2) / source.width, centerY: (box.y + box.height / 2) / source.height };
    });
  }

  async function confirm() {
    if (!source || !rect) return;
    setBusy(true);
    setError("");
    try {
      const compressed = await compressImage(source.file, "avatar", { crop: rect });
      if (!setInputFiles(fieldRef.current, [compressed.file])) throw new ImageCompressError("encode");
      setResult({ size: compressed.file.size, url: URL.createObjectURL(compressed.file) });
      setSource(null);
    } catch (caught) {
      setError(compressFailureMessages[caught instanceof ImageCompressError ? caught.reason : "encode"]);
    } finally {
      setBusy(false);
    }
  }

  function clear() {
    setResult(null);
    setSource(null);
    setError("");
    if (fieldRef.current) fieldRef.current.value = "";
  }

  return (
    <div aria-labelledby={`${id}-label`} className="min-w-0" role="group">
      <p className={fieldLabel} id={`${id}-label`}>
        รูปโปรไฟล์
      </p>

      {source && rect ? (
        <div className="mt-1.5 grid justify-items-center gap-3 rounded-lg border border-line bg-white p-4 sm:justify-items-start">
          <div
            aria-label="กรอบตัดรูป ลากเพื่อเลื่อนรูป หรือใช้ปุ่มลูกศร"
            className="relative cursor-grab touch-none select-none overflow-hidden rounded-lg bg-canvas outline-none focus-visible:ring-4 focus-visible:ring-brand-600/20 active:cursor-grabbing"
            onKeyDown={(event) => {
              const step = event.shiftKey ? 40 : 10;
              const delta = { ArrowDown: [0, step], ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step] }[event.key];
              if (!delta) return;
              event.preventDefault();
              setFraming((current) => move(current, delta[0], delta[1]));
            }}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { framing, x: event.clientX, y: event.clientY };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (!start) return;
              setFraming(move(start.framing, event.clientX - start.x, event.clientY - start.y));
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
            role="application"
            style={{ height: VIEW, width: VIEW }}
            tabIndex={0}
          >
            {/* Local object URL of the picked photo; next/image cannot handle it. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt=""
              className="pointer-events-none absolute left-0 top-0 max-w-none"
              draggable={false}
              src={source.url}
              style={{
                height: source.height * scale,
                transform: `translate(${-rect.x * scale}px, ${-rect.y * scale}px)`,
                width: source.width * scale,
              }}
            />
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(15,23,42,0.45)]" />
          </div>

          <div className="flex w-full max-w-[240px] items-center gap-2">
            <button aria-label="ย่อ" className={buttonClass("ghost", "sm")} onClick={() => zoomTo(framing.zoom - 0.25)} type="button">
              <Minus className="size-4" aria-hidden="true" />
            </button>
            <label className="min-w-0 flex-1">
              <span className="sr-only">ซูม</span>
              <input
                className="w-full accent-brand-600"
                max={MAX_ZOOM}
                min={1}
                onChange={(event) => zoomTo(Number(event.currentTarget.value))}
                step={0.01}
                type="range"
                value={framing.zoom}
              />
            </label>
            <button aria-label="ขยาย" className={buttonClass("ghost", "sm")} onClick={() => zoomTo(framing.zoom + 0.25)} type="button">
              <Plus className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            <button className={buttonClass("primary", "md")} disabled={busy} onClick={() => void confirm()} type="button">
              <Check className="size-4" aria-hidden="true" />
              {busy ? "กำลังย่อรูป…" : "ใช้รูปนี้"}
            </button>
            <button className={buttonClass("secondary", "md")} disabled={busy} onClick={clear} type="button">
              ยกเลิก
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {result ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img alt="รูปโปรไฟล์ใหม่" className="size-16 rounded-full border border-line object-cover" src={result.url} />
              <span className="text-sm text-ink-muted">
                รูปใหม่ <span className="tabular-nums">{formatBytes(result.size)}</span> บันทึกเมื่อกดบันทึกด้านล่าง
              </span>
              <button aria-label="ไม่ใช้รูปใหม่" className={buttonClass("ghost", "sm")} onClick={clear} type="button">
                <X className="size-4" aria-hidden="true" />
              </button>
            </>
          ) : null}
          <button
            className={buttonClass("secondary", "md")}
            disabled={disabled || busy}
            onClick={() => pickerRef.current?.click()}
            type="button"
          >
            <Upload className="size-4" aria-hidden="true" />
            {result ? "เลือกรูปอื่น" : "เลือกรูป"}
          </button>
        </div>
      )}

      <input
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
        aria-hidden="true"
        className="sr-only"
        disabled={disabled}
        onChange={(event) => void pick(event.currentTarget.files?.[0])}
        ref={pickerRef}
        tabIndex={-1}
        type="file"
      />
      <input aria-hidden="true" className="sr-only" disabled={disabled} name={name} ref={fieldRef} tabIndex={-1} type="file" />

      {error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger" role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : (
        <span className={fieldHint}>ลากรูปให้หน้าอยู่กลางวงกลม ตัดเป็นสี่เหลี่ยมจัตุรัส 512 px</span>
      )}
    </div>
  );
}
