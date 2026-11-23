// SlipOK adapter (https://slipok.com, API guide v1.13): reads the QR on a Thai bank slip and
// returns the transfer as the bank recorded it. Kept small and isolated so another provider
// (EasySlip, Checkslip) can replace it. Never throws: anything unexpected is "unavailable" and
// the payment simply waits for a person to check it.
//
//   POST https://api.slipok.com/api/line/apikey/{branchId}
//   header  x-authorization: {apiKey}
//   body    multipart `files` (JPG/PNG/WebP image of the slip)
//   200     { success: true, data: { transRef, amount, transTimestamp, receiver: {...}, ... } }
//   400     { code: 1007, message: "รูปภาพไม่มี QR Code", data?: {...} }

export type SlipOkConfig = { apiKey: string; branchId: string };

export function getSlipOkConfig(env: Record<string, string | undefined> = process.env): SlipOkConfig | null {
  const branchId = env.SLIPOK_BRANCH_ID?.trim();
  const apiKey = env.SLIPOK_API_KEY?.trim();
  return branchId && apiKey ? { apiKey, branchId } : null;
}

export type SlipParty = {
  account: string | null;
  bank: string | null;
  displayName: string | null;
  name: string | null;
  proxy: string | null;
  proxyType: string | null;
};

export type SlipOkSlip = {
  amount: number;
  receiver: SlipParty;
  ref1: string | null;
  sender: SlipParty;
  transRef: string;
  /** ISO instant of the transfer, when the bank gave one. */
  transferredAt: string | null;
};

export type SlipOkResult =
  | { kind: "ok"; slip: SlipOkSlip }
  /** SlipOK read the request but refused the slip (no QR, not a payment QR, expired …). */
  | { code: number; kind: "rejected"; message: string; slip: SlipOkSlip | null }
  /** Network down, timeout, bank delay, bad key or quota: try again later or check by hand. */
  | { code: number | null; kind: "unavailable"; message: string };

/** Codes that say nothing about the slip itself: SlipOK or the bank could not answer now. */
const unavailableCodes = new Set([1001, 1002, 1003, 1004, 1009, 1010, 1015]);

type Raw = Record<string, unknown>;

function text(value: unknown) {
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number") return String(value);
  return null;
}

function party(raw: unknown, bank: unknown): SlipParty {
  const value = (raw ?? {}) as Raw;
  const proxy = (value.proxy ?? {}) as Raw;
  const account = (value.account ?? {}) as Raw;
  return {
    account: text(account.value),
    bank: text(bank),
    displayName: text(value.displayName),
    name: text(value.name),
    proxy: text(proxy.value),
    proxyType: text(proxy.type),
  };
}

/** transDate "20260815" + transTime "10:15:07" (Bangkok) → ISO, when no transTimestamp is given. */
function transferInstant(data: Raw) {
  const stamp = text(data.transTimestamp);
  if (stamp && !Number.isNaN(new Date(stamp).getTime())) return new Date(stamp).toISOString();
  const date = text(data.transDate);
  const time = text(data.transTime);
  if (date && /^\d{8}$/.test(date)) {
    const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${time && /^\d{2}:\d{2}(:\d{2})?$/.test(time) ? time : "00:00"}+07:00`;
    const parsed = new Date(iso);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

export function parseSlipOkSlip(raw: unknown): SlipOkSlip | null {
  if (!raw || typeof raw !== "object") return null;
  const data = raw as Raw;
  const transRef = text(data.transRef);
  const amount = Number(data.amount);
  if (!transRef || !Number.isFinite(amount)) return null;
  return {
    amount,
    receiver: party(data.receiver, data.receivingBank),
    ref1: text(data.ref1),
    sender: party(data.sender, data.sendingBank),
    transRef,
    transferredAt: transferInstant(data),
  };
}

export async function checkSlipWithSlipOk(
  file: Blob,
  config: SlipOkConfig,
  { fetchImpl = fetch, fileName = "slip.jpg", timeoutMs = 12_000 }: { fetchImpl?: typeof fetch; fileName?: string; timeoutMs?: number } = {},
): Promise<SlipOkResult> {
  const body = new FormData();
  body.append("files", file, fileName);

  let response: Response;
  try {
    response = await fetchImpl(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(config.branchId)}`, {
      body,
      headers: { "x-authorization": config.apiKey },
      method: "POST",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { code: null, kind: "unavailable", message: timedOut ? "timeout" : "network" };
  }

  let payload: Raw = {};
  try {
    payload = ((await response.json()) ?? {}) as Raw;
  } catch {
    return { code: null, kind: "unavailable", message: `http-${response.status}` };
  }

  if (response.ok && payload.success === true) {
    const slip = parseSlipOkSlip(payload.data);
    return slip ? { kind: "ok", slip } : { code: null, kind: "unavailable", message: "unexpected-response" };
  }

  const code = Number(payload.code);
  const message = text(payload.message) ?? `http-${response.status}`;
  if (!Number.isFinite(code) || response.status >= 500 || response.status === 401 || unavailableCodes.has(code)) {
    return { code: Number.isFinite(code) ? code : null, kind: "unavailable", message };
  }
  return { code, kind: "rejected", message, slip: parseSlipOkSlip(payload.data) };
}

/** Thai reason for a slip SlipOK refused, for the admin. */
export function slipOkRejectionReason(code: number, message: string) {
  switch (code) {
    case 1005:
    case 1006:
      return "อ่านรูปสลิปไม่ได้";
    case 1007:
      return "ไม่พบ QR บนสลิป (อาจเป็นรูปที่ตัดขอบหรือไม่ใช่สลิปจากแอปธนาคาร)";
    case 1008:
      return "QR บนรูปไม่ใช่ QR ของสลิปโอนเงิน";
    case 1011:
      return "ธนาคารไม่พบรายการโอนนี้ หรือ QR หมดอายุ";
    case 1012:
      return "สลิปนี้เคยส่งตรวจแล้ว";
    case 1013:
      return "ยอดในสลิปไม่ตรงกับยอดที่ต้องชำระ";
    case 1014:
      return "บัญชีผู้รับไม่ตรงกับบัญชีของชมรม";
    default:
      return `SlipOK ตรวจไม่ผ่าน (${code}) ${message}`.trim();
  }
}
