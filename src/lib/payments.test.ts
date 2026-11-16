import { describe, expect, it } from "vitest";

import { needsNoSlipReason, paymentStage } from "./payments";

const slip = (status: string) => ({ slip_file_id: "file-1", status });
const noSlip = (status: string) => ({ slip_file_id: null, status });

describe("paymentStage", () => {
  it("separates waiting for payment from waiting for slip review", () => {
    expect(paymentStage({ payment: null, price: 500, registrationStatus: "pending_payment" })).toBe("awaiting_payment");
    expect(paymentStage({ payment: noSlip("review"), price: 500, registrationStatus: "pending_payment" })).toBe("awaiting_payment");
    expect(paymentStage({ payment: slip("review"), price: 500, registrationStatus: "payment_review" })).toBe("awaiting_review");
    expect(paymentStage({ payment: slip("pending"), price: 500, registrationStatus: "payment_review" })).toBe("awaiting_review");
  });

  it("reports settled, rejected and refunded money", () => {
    expect(paymentStage({ payment: slip("approved"), price: 500, registrationStatus: "paid" })).toBe("approved");
    expect(paymentStage({ payment: null, price: 500, registrationStatus: "paid" })).toBe("approved");
    expect(paymentStage({ payment: slip("rejected"), price: 500, registrationStatus: "pending_payment" })).toBe("rejected");
    expect(paymentStage({ payment: slip("refunded"), price: 500, registrationStatus: "cancelled" })).toBe("refunded");
  });

  it("does not ask free events or waitlisted players for money", () => {
    expect(paymentStage({ payment: null, price: 0, registrationStatus: "registered" })).toBe("not_required");
    expect(paymentStage({ payment: null, price: 500, registrationStatus: "waitlist" })).toBe("waitlist");
    expect(paymentStage({ payment: slip("approved"), price: 500, registrationStatus: "waitlist" })).toBe("approved");
  });
});

describe("needsNoSlipReason", () => {
  it("requires a reason only when approving without a slip", () => {
    expect(needsNoSlipReason({ hasSlip: false, note: "", status: "approved" })).toBe(true);
    expect(needsNoSlipReason({ hasSlip: false, note: "ok", status: "approved" })).toBe(true);
    expect(needsNoSlipReason({ hasSlip: false, note: "รับเงินสดหน้างาน", status: "approved" })).toBe(false);
    expect(needsNoSlipReason({ hasSlip: true, note: "", status: "approved" })).toBe(false);
    expect(needsNoSlipReason({ hasSlip: false, note: "", status: "rejected" })).toBe(false);
  });
});
