import QRCode from "qrcode";

/**
 * Server-rendered QR code as inline SVG (no client JS). Used for PromptPay payment QR and
 * lesson check-in QR. `label` is read by screen readers.
 */
export async function QrCode({ className, label, size = 220, value }: { className?: string; label: string; size?: number; value: string }) {
  const svg = await QRCode.toString(value, {
    color: { dark: "#1f2937", light: "#ffffff" },
    errorCorrectionLevel: "M",
    margin: 2,
    type: "svg",
    width: size,
  });

  return (
    <div
      aria-label={label}
      className={`inline-block rounded-lg bg-white p-2 ring-1 ring-line [&>svg]:block [&>svg]:h-auto [&>svg]:w-full ${className ?? ""}`}
      dangerouslySetInnerHTML={{ __html: svg }}
      role="img"
      style={{ width: size }}
    />
  );
}
