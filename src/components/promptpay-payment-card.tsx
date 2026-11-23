import { AlertTriangle } from "lucide-react";

import { QrCode } from "@/components/ui/qr-code";
import { formatBaht } from "@/lib/display";
import { promptPayCardData } from "@/lib/payments/promptpay-card";
import type { PaymentSettings } from "@/lib/payments/settings";

/**
 * Where to send the money: a PromptPay QR with the exact amount (any Thai bank app fills in the
 * receiver and amount), the account name to check before confirming, and the bank account as a
 * fallback. Server component; the QR is inline SVG.
 */
export async function PromptPayPaymentCard({
  amount,
  className = "",
  description,
  settings,
}: {
  amount: number;
  className?: string;
  description: string;
  settings: PaymentSettings | null;
}) {
  const data = promptPayCardData(amount, description, settings);

  if (data.kind === "missing") {
    return (
      <p className={`flex items-start gap-2 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2.5 text-sm font-medium text-warning ${className}`}>
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {data.message}
      </p>
    );
  }

  const rows: Array<[string, string]> = [];
  if (data.accountName) rows.push(["ชื่อบัญชี", data.accountName]);
  if (data.promptPayId) rows.push(["พร้อมเพย์", data.promptPayId]);
  if (data.bankAccountNo) rows.push([data.bankName ?? "เลขบัญชี", data.bankAccountNo]);

  return (
    <div className={`grid gap-4 rounded-xl border border-line bg-white p-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center ${className}`}>
      {data.qrPayload ? (
        <div className="justify-self-center">
          <QrCode label={`คิวอาร์พร้อมเพย์ ยอด ${formatBaht(data.amount)}`} size={184} value={data.qrPayload} />
        </div>
      ) : null}
      <div className="min-w-0">
        <p className="text-sm font-medium text-ink-muted">{data.description}</p>
        <p className="mt-0.5 text-h2 font-semibold tabular-nums text-ink">{data.amount ? formatBaht(data.amount) : "ตามยอดที่แจ้ง"}</p>
        <dl className="mt-2 grid gap-1 text-sm">
          {rows.map(([label, value]) => (
            <div className="flex flex-wrap gap-x-2" key={label}>
              <dt className="text-ink-muted">{label}</dt>
              <dd className="font-semibold tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-sm text-ink-muted">
          {data.qrPayload
            ? "สแกนด้วยแอปธนาคาร ยอดจะขึ้นให้เอง ตรวจชื่อบัญชีก่อนกดยืนยัน หรือแคปหน้าจอแล้วเปิดรูปในแอปธนาคาร"
            : "โอนเข้าบัญชีนี้ให้ตรงยอด ตรวจชื่อบัญชีก่อนกดยืนยัน"}
        </p>
        {data.note ? <p className="mt-1 text-sm text-ink-muted">{data.note}</p> : null}
      </div>
    </div>
  );
}
