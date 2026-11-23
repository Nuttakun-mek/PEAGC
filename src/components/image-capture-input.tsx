"use client";

import { AlertTriangle, Camera, FileText, RotateCcw, Upload, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

import { buttonClass, fieldHint, fieldLabel } from "@/components/ui/styles";
import { ImageCompressError, compressFailureMessages, compressImage } from "@/lib/images/compress";
import { type ImagePresetKey, formatBytes } from "@/lib/images/presets";

/**
 * Largest file sent without compression (PDF, or an image on a browser that cannot re-encode).
 * The server accepts 10 MB, but a Vercel function takes at most 4.5 MB per request, so anything
 * bigger would fail with a generic error after a long upload.
 */
export const UNCOMPRESSED_MAX_BYTES = 4 * 1024 * 1024;

const imageAccept = "image/jpeg,image/png,image/webp,image/heic,image/heif";

type Picked = { kind: "image" | "pdf"; name: string; note: string; previewUrl: string | null; size: number };

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

function isPdf(file: File) {
  return file.type === "application/pdf" || /\.pdf$/i.test(file.name);
}

/** Shows the upload state while the surrounding form is being sent. */
function SendingBar({ size }: { size: number | null }) {
  const { pending } = useFormStatus();
  if (!pending || size === null) return null;
  return <ProgressBar label={`กำลังส่งไฟล์ ${formatBytes(size)}…`} />;
}

function ProgressBar({ label }: { label: string }) {
  return (
    <div className="mt-2" role="status">
      <p className="text-xs font-medium text-ink-muted">{label}</p>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-brand-50">
        <div className="h-full w-1/3 animate-[upload-progress_1.2s_ease-in-out_infinite] rounded-full bg-brand-600 motion-reduce:w-full motion-reduce:animate-none" />
      </div>
      <style>{"@keyframes upload-progress{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}"}</style>
    </div>
  );
}

export type ImageCaptureInputProps = {
  /** Keep PDFs as they are (slips from internet banking). */
  allowPdf?: boolean;
  /** Show a "ถ่ายรูป" button that opens the rear camera. Defaults to true for slips and scorecards. */
  camera?: boolean;
  disabled?: boolean;
  hint?: string;
  label?: string;
  /** Form field name of the (compressed) file. */
  name: string;
  preset: ImagePresetKey;
  required?: boolean;
  /** eventPhoto preset: form field name for the 480px thumbnail copy. */
  thumbnailName?: string;
};

/**
 * File picker that re-encodes photos on the phone before they are sent (size per preset, EXIF and
 * GPS removed, rotated upright). The real `<input type="file" name=…>` stays in the form, so it
 * works inside any server-action form. Shows a preview, a progress bar while shrinking and while
 * the form is sending, and holds the file when the phone is offline so the member can press
 * "ส่งอีกครั้ง" instead of picking it again.
 */
export function ImageCaptureInput({
  allowPdf = false,
  camera,
  disabled,
  hint,
  label = "รูปภาพ",
  name,
  preset,
  required,
  thumbnailName,
}: ImageCaptureInputProps) {
  const id = useId();
  const mainRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const thumbRef = useRef<HTMLInputElement>(null);
  const pickButtonRef = useRef<HTMLButtonElement>(null);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [offline, setOffline] = useState(false);
  const busyRef = useRef(false);
  const previewRef = useRef<string | null>(null);
  const showCamera = camera ?? (preset === "slip" || preset === "scorecard");

  const showPreview = useCallback((next: Picked | null) => {
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    previewRef.current = next?.previewUrl ?? null;
    setPicked(next);
  }, []);

  const clear = useCallback(() => {
    showPreview(null);
    if (mainRef.current) mainRef.current.value = "";
    if (cameraRef.current) cameraRef.current.value = "";
    if (thumbRef.current) thumbRef.current.value = "";
  }, [showPreview]);

  async function handlePick(source: HTMLInputElement) {
    const file = source.files?.[0];
    setError("");
    setOffline(false);
    if (!file) {
      if (source === mainRef.current) clear();
      return;
    }

    if (isPdf(file)) {
      if (!allowPdf) {
        setError("เลือกได้เฉพาะรูปภาพ JPG, PNG หรือ WebP");
        clear();
        return;
      }
      if (file.size > UNCOMPRESSED_MAX_BYTES) {
        setError("ไฟล์ PDF ใหญ่เกิน 4 MB ถ่ายภาพหน้าจอแล้วส่งเป็นรูปแทน");
        clear();
        return;
      }
      if (source !== mainRef.current) setInputFiles(mainRef.current, [file]);
      showPreview({ kind: "pdf", name: file.name, note: formatBytes(file.size), previewUrl: null, size: file.size });
      return;
    }

    busyRef.current = true;
    setBusy(true);
    try {
      const result = await compressImage(file, preset);
      const files = [result.file];
      if (!setInputFiles(mainRef.current, files)) throw new ImageCompressError("encode");
      if (thumbnailName && result.thumbnail) setInputFiles(thumbRef.current, [result.thumbnail]);
      if (cameraRef.current) cameraRef.current.value = "";
      showPreview({
        kind: "image",
        name: result.file.name,
        note:
          result.file.size < file.size
            ? `${formatBytes(result.file.size)} · ย่อจาก ${formatBytes(file.size)}`
            : formatBytes(result.file.size),
        previewUrl: URL.createObjectURL(result.file),
        size: result.file.size,
      });
    } catch (caught) {
      // Browsers that cannot decode the photo (e.g. HEIC outside Safari) or re-encode at all:
      // send the original when it is a small JPEG/PNG/WebP, otherwise ask for another file.
      const reason = caught instanceof ImageCompressError ? caught.reason : "encode";
      const sendable = /^image\/(jpeg|png|webp)$/.test(file.type) && file.size <= UNCOMPRESSED_MAX_BYTES;
      if (sendable && (source === mainRef.current || setInputFiles(mainRef.current, [file]))) {
        showPreview({ kind: "image", name: file.name, note: formatBytes(file.size), previewUrl: URL.createObjectURL(file), size: file.size });
      } else {
        setError(compressFailureMessages[reason]);
        clear();
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  // Guard the surrounding form: wait for the photo to finish shrinking, keep the file when offline,
  // and say what is missing instead of the browser bubble on a hidden input.
  useEffect(() => {
    const form = mainRef.current?.form;
    if (!form) return;

    function onSubmit(event: SubmitEvent) {
      if (busyRef.current) {
        event.preventDefault();
        setError("รอย่อรูปเสร็จก่อน แล้วกดส่งอีกครั้ง");
        return;
      }
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        event.preventDefault();
        setOffline(true);
      }
    }
    function onInvalid(event: Event) {
      if (event.target !== mainRef.current) return;
      event.preventDefault();
      setError("กรุณาเลือกไฟล์");
      pickButtonRef.current?.focus();
    }
    function onReset() {
      clear();
      setOffline(false);
      setError("");
    }
    function onOnline() {
      setOffline(false);
    }

    form.addEventListener("submit", onSubmit);
    form.addEventListener("invalid", onInvalid, true);
    form.addEventListener("reset", onReset);
    window.addEventListener("online", onOnline);
    return () => {
      form.removeEventListener("submit", onSubmit);
      form.removeEventListener("invalid", onInvalid, true);
      form.removeEventListener("reset", onReset);
      window.removeEventListener("online", onOnline);
    };
  }, [clear]);

  useEffect(
    () => () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    },
    [],
  );

  const accept = allowPdf ? `${imageAccept},application/pdf` : imageAccept;
  const describedBy = [error ? `${id}-error` : null, `${id}-hint`].filter(Boolean).join(" ");

  return (
    <div aria-labelledby={`${id}-label`} className="min-w-0" role="group">
      <p className={fieldLabel} id={`${id}-label`}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-danger">
            {" "}*
          </span>
        ) : null}
      </p>

      <div className={`mt-1.5 rounded-lg border bg-white p-3 ${error ? "border-danger" : "border-line"}`}>
        {picked ? (
          <div className="mb-3 flex items-center gap-3">
            {picked.previewUrl ? (
              // A local object URL; next/image cannot optimise it.
              // eslint-disable-next-line @next/next/no-img-element
              <img alt="ตัวอย่างไฟล์ที่เลือก" className="size-16 shrink-0 rounded-md border border-line object-cover" src={picked.previewUrl} />
            ) : (
              <span className="flex size-16 shrink-0 items-center justify-center rounded-md border border-line bg-canvas">
                <FileText className="size-6 text-ink-subtle" aria-hidden="true" />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-ink">{picked.name}</p>
              <p className="text-xs text-ink-subtle tabular-nums">{picked.note}</p>
            </div>
            <button
              aria-label="เอาไฟล์นี้ออก"
              className={buttonClass("ghost", "sm")}
              disabled={disabled}
              onClick={() => {
                clear();
                setError("");
              }}
              type="button"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            aria-describedby={describedBy}
            className={`${buttonClass("secondary", "md")} flex-1 sm:flex-none`}
            disabled={disabled || busy}
            onClick={() => mainRef.current?.click()}
            ref={pickButtonRef}
            type="button"
          >
            <Upload className="size-4" aria-hidden="true" />
            {picked ? "เปลี่ยนไฟล์" : allowPdf ? "เลือกรูปหรือ PDF" : "เลือกรูป"}
          </button>
          {showCamera ? (
            <button
              className={`${buttonClass("secondary", "md")} flex-1 sm:flex-none`}
              disabled={disabled || busy}
              onClick={() => cameraRef.current?.click()}
              type="button"
            >
              <Camera className="size-4" aria-hidden="true" />
              ถ่ายรูป
            </button>
          ) : null}
        </div>

        <input
          accept={accept}
          aria-hidden="true"
          className="sr-only"
          disabled={disabled}
          name={name}
          onChange={(event) => void handlePick(event.currentTarget)}
          ref={mainRef}
          required={required}
          tabIndex={-1}
          type="file"
        />
        {showCamera ? (
          <input
            accept="image/*"
            aria-hidden="true"
            capture="environment"
            className="sr-only"
            disabled={disabled}
            onChange={(event) => void handlePick(event.currentTarget)}
            ref={cameraRef}
            tabIndex={-1}
            type="file"
          />
        ) : null}
        {thumbnailName ? <input aria-hidden="true" className="sr-only" name={thumbnailName} ref={thumbRef} tabIndex={-1} type="file" /> : null}

        {busy ? <ProgressBar label="กำลังย่อรูป…" /> : <SendingBar size={picked?.size ?? null} />}
      </div>

      {offline ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning" role="alert">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 font-medium">ไม่มีสัญญาณอินเทอร์เน็ต ไฟล์ยังอยู่ ต่อเน็ตแล้วกดส่งอีกครั้ง</span>
          <button
            className={buttonClass("secondary", "sm")}
            onClick={() => {
              setOffline(false);
              mainRef.current?.form?.requestSubmit();
            }}
            type="button"
          >
            <RotateCcw className="size-4" aria-hidden="true" />
            ส่งอีกครั้ง
          </button>
        </div>
      ) : null}

      {error ? (
        <p className="mt-1.5 flex items-start gap-1.5 text-xs font-medium text-danger" id={`${id}-error`} role="alert">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      ) : null}
      <span className={fieldHint} id={`${id}-hint`}>
        {hint ?? (allowPdf ? "รูปภาพ หรือ PDF ไม่เกิน 4 MB" : "รูปภาพ JPG, PNG หรือ WebP")}
      </span>
    </div>
  );
}
