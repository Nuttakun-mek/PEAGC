import { describe, expect, it, vi } from "vitest";

import { checkSlipWithSlipOk, getSlipOkConfig, parseSlipOkSlip, slipOkRejectionReason } from "./slipok";

const config = { apiKey: "key-123", branchId: "77" };

// Example response from the SlipOK API guide v1.13 ("Correct QR Verification").
const slipData = {
  amount: 2200,
  countryCode: "TH",
  language: "TH",
  message: "✅",
  paidLocalAmount: 2200,
  paidLocalCurrency: "764",
  receiver: { account: { type: "BANKAC", value: "xxx-x-x3109-x" }, displayName: "ชมรมกอล์ฟ กฟภ", name: "PEA GOLF CLUB", proxy: { type: "", value: "" } },
  receivingBank: "006",
  ref1: "",
  ref2: "",
  ref3: "",
  rqUID: "783_20191108_v4UIS1K2Mobile",
  sender: { account: { type: "BANKAC", value: "xxx-x-x0209-x" }, displayName: "นาย ธนาคาร ก", name: "Mr. Thanakarn K", proxy: { type: null, value: null } },
  sendingBank: "004",
  success: true,
  toMerchantId: "",
  transDate: "20261120",
  transFeeAmount: 0,
  transRef: "010092101507665143",
  transTime: "10:15:07",
};

function respond(status: number, body: unknown) {
  return vi.fn(async () => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" }, status }));
}

describe("getSlipOkConfig", () => {
  it("needs both the branch ID and the API key", () => {
    expect(getSlipOkConfig({})).toBeNull();
    expect(getSlipOkConfig({ SLIPOK_BRANCH_ID: "77" })).toBeNull();
    expect(getSlipOkConfig({ SLIPOK_API_KEY: " k ", SLIPOK_BRANCH_ID: " 77 " })).toEqual({ apiKey: "k", branchId: "77" });
  });
});

describe("checkSlipWithSlipOk", () => {
  it("posts the slip as multipart `files` with the x-authorization header", async () => {
    const fetchImpl = respond(200, { data: slipData, success: true });
    const result = await checkSlipWithSlipOk(new Blob(["jpeg"], { type: "image/jpeg" }), config, { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.slipok.com/api/line/apikey/77");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["x-authorization"]).toBe("key-123");
    expect((init.body as FormData).get("files")).toBeInstanceOf(Blob);

    expect(result).toEqual({
      kind: "ok",
      slip: {
        amount: 2200,
        receiver: { account: "xxx-x-x3109-x", bank: "006", displayName: "ชมรมกอล์ฟ กฟภ", name: "PEA GOLF CLUB", proxy: null, proxyType: null },
        ref1: null,
        sender: { account: "xxx-x-x0209-x", bank: "004", displayName: "นาย ธนาคาร ก", name: "Mr. Thanakarn K", proxy: null, proxyType: null },
        transRef: "010092101507665143",
        // 10:15:07 Bangkok = 03:15:07 UTC
        transferredAt: "2026-11-20T03:15:07.000Z",
      },
    });
  });

  it("prefers transTimestamp when the API sends it", () => {
    expect(parseSlipOkSlip({ ...slipData, transTimestamp: "2026-11-20T03:16:00.000Z" })?.transferredAt).toBe("2026-11-20T03:16:00.000Z");
    expect(parseSlipOkSlip({ amount: 1 })).toBeNull();
  });

  it("returns slip refusals with the slip data SlipOK attaches", async () => {
    const noQr = await checkSlipWithSlipOk(new Blob(["x"]), config, { fetchImpl: respond(400, { code: 1007, message: "รูปภาพไม่มี QR Code" }) });
    expect(noQr).toEqual({ code: 1007, kind: "rejected", message: "รูปภาพไม่มี QR Code", slip: null });

    const wrongAmount = await checkSlipWithSlipOk(new Blob(["x"]), config, {
      fetchImpl: respond(400, { code: 1013, data: slipData, message: "ยอดที่ส่งมาไม่ตรงกับยอดสลิป" }),
    });
    expect(wrongAmount.kind).toBe("rejected");
    expect(wrongAmount.kind === "rejected" ? wrongAmount.slip?.transRef : null).toBe("010092101507665143");
  });

  it("treats outages, bank delays, bad keys and quota as unavailable (never blocks the upload)", async () => {
    for (const [status, body] of [
      [400, { code: 1009, message: "ธนาคารขัดข้อง" }],
      [400, { code: 1010, data: { delay: 8 }, message: "กรุณารอ 8 นาที" }],
      [401, { code: 1002, message: "Authorization Header ไม่ถูกต้อง" }],
      [400, { code: 1004, message: "เกินโควต้า" }],
      [502, { message: "bad gateway" }],
    ] as const) {
      const result = await checkSlipWithSlipOk(new Blob(["x"]), config, { fetchImpl: respond(status, body) });
      expect(result.kind).toBe("unavailable");
    }

    const htmlError = vi.fn(async () => new Response("<html>oops</html>", { status: 500 }));
    expect(await checkSlipWithSlipOk(new Blob(["x"]), config, { fetchImpl: htmlError })).toEqual({ code: null, kind: "unavailable", message: "http-500" });

    const offline = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    expect(await checkSlipWithSlipOk(new Blob(["x"]), config, { fetchImpl: offline })).toEqual({ code: null, kind: "unavailable", message: "network" });
  });

  it("gives up after the timeout", async () => {
    const hang = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    const result = await checkSlipWithSlipOk(new Blob(["x"]), config, { fetchImpl: hang as unknown as typeof fetch, timeoutMs: 20 });
    expect(result).toEqual({ code: null, kind: "unavailable", message: "timeout" });
  });
});

describe("slipOkRejectionReason", () => {
  it("explains the common refusals in Thai", () => {
    expect(slipOkRejectionReason(1007, "")).toContain("ไม่พบ QR");
    expect(slipOkRejectionReason(1014, "")).toBe("บัญชีผู้รับไม่ตรงกับบัญชีของชมรม");
    expect(slipOkRejectionReason(1099, "x")).toBe("SlipOK ตรวจไม่ผ่าน (1099) x");
  });
});
