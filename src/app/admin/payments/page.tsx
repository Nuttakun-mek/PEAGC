import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  CalendarDays,
  CircleDollarSign,
  Clock,
  Filter,
  ReceiptText,
  Search,
  UserRound,
} from "lucide-react";

import { resolveAccess } from "@/lib/auth/access";
import { createClient } from "@/lib/supabase/server";

import { updatePaymentReview } from "./actions";

type AdminPaymentsPageProps = {
  searchParams: Promise<{
    bypass?: string;
    event?: string;
    q?: string;
    registration?: string;
    status?: string;
  }>;
};

type PaymentRecord = {
  amount: number;
  id: string;
  note: string | null;
  status: string;
  transferred_at: string | null;
};

type RegistrationRow = {
  created_at: string;
  event_id: string;
  events: {
    event_date: string;
    member_price: number;
    name: string;
    tee_off_time: string | null;
    venue: string | null;
  } | null;
  guest_name: string | null;
  id: string;
  members: {
    email: string | null;
    full_name: string;
    member_code: string | null;
    phone: string | null;
  } | null;
  payment_records: PaymentRecord[] | null;
  registration_type: string;
  status: string;
};

type EventOption = {
  id: string;
  name: string;
};

const sampleRegistrations: RegistrationRow[] = [
  {
    created_at: "2026-07-09T09:00:00.000Z",
    event_id: "sample-event-1",
    events: {
      event_date: "2026-08-15",
      member_price: 2200,
      name: "PEAGC Monthly Round",
      tee_off_time: "11:30",
      venue: "Royal Golf Club",
    },
    guest_name: null,
    id: "sample-registration-1",
    members: {
      email: "member@example.com",
      full_name: "Demo Member",
      member_code: "PEA001",
      phone: "0812345678",
    },
    payment_records: [
      {
        amount: 2200,
        id: "sample-payment-1",
        note: "Waiting for slip review",
        status: "review",
        transferred_at: "2026-07-09T08:45:00.000Z",
      },
    ],
    registration_type: "single",
    status: "payment_review",
  },
  {
    created_at: "2026-07-09T10:30:00.000Z",
    event_id: "sample-event-1",
    events: {
      event_date: "2026-08-15",
      member_price: 2200,
      name: "PEAGC Monthly Round",
      tee_off_time: "11:30",
      venue: "Royal Golf Club",
    },
    guest_name: null,
    id: "sample-registration-2",
    members: {
      email: "new.member@example.com",
      full_name: "Pending Member",
      member_code: "PEA002",
      phone: "0898765432",
    },
    payment_records: null,
    registration_type: "single",
    status: "pending_payment",
  },
];

const statusLabels: Record<string, string> = {
  checked_in: "Checked in",
  paid: "Paid",
  payment_review: "Review",
  pending_payment: "Pending payment",
  registered: "Registered",
  waitlist: "Waitlist",
};

const paymentStatusLabels: Record<string, string> = {
  approved: "Approved",
  pending: "Pending",
  refunded: "Refunded",
  rejected: "Rejected",
  review: "Review",
};

const statusMessages: Record<string, string> = {
  "invalid-status": "Payment status is invalid.",
  "missing-registration": "Registration was not found.",
  "payment-update-failed": "Payment review could not be saved.",
  "payment-updated": "Payment review saved.",
  "registration-update-failed": "Payment saved, but registration status could not be updated.",
};

function getLatestPayment(registration: RegistrationRow) {
  return registration.payment_records?.[0] ?? null;
}

function getPaymentStatus(registration: RegistrationRow) {
  return getLatestPayment(registration)?.status ?? "pending";
}

function getStatusClass(status: string) {
  if (status === "paid" || status === "approved") {
    return "bg-[#f8edf4] text-[#722257]";
  }

  if (status === "payment_review" || status === "review") {
    return "bg-[#fff5d8] text-[#805300]";
  }

  if (status === "rejected") {
    return "bg-[#fdecec] text-[#9f1d1d]";
  }

  return "bg-[#f1f3ef] text-[#6b6475]";
}

function formatDateTime(value: string | null) {
  if (!value) {
    return "-";
  }

  return new Intl.DateTimeFormat("th-TH", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function PaymentReviewForm({
  disabled,
  registration,
}: {
  disabled?: boolean;
  registration: RegistrationRow;
}) {
  const payment = getLatestPayment(registration);
  const defaultAmount = payment?.amount ?? registration.events?.member_price ?? 0;

  return (
    <form action={updatePaymentReview} className="grid gap-4 rounded-lg border border-[#e6e2ee] bg-white/70 p-4">
      <input name="registrationId" type="hidden" value={registration.id} />
      {payment ? <input name="paymentId" type="hidden" value={payment.id} /> : null}

      <div className="grid gap-4 md:grid-cols-[160px_180px_1fr]">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">Amount</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={defaultAmount}
            disabled={disabled}
            min="0"
            name="amount"
            step="0.01"
            type="number"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">Transferred at</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={payment?.transferred_at?.slice(0, 16) ?? ""}
            disabled={disabled}
            name="transferredAt"
            type="datetime-local"
          />
        </label>
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">Review note</span>
          <input
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={payment?.note ?? ""}
            disabled={disabled}
            name="note"
            placeholder="Slip checked, amount matched, or reason for rejection"
          />
        </label>
      </div>

      <div className="grid gap-3 md:grid-cols-[220px_1fr] md:items-end">
        <label className="block">
          <span className="text-sm font-semibold text-[#3f3a48]">Payment status</span>
          <select
            className="mt-2 h-11 w-full rounded-md border border-[#d9d3e6] bg-white px-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
            defaultValue={payment?.status ?? "review"}
            disabled={disabled}
            name="paymentStatus"
          >
            <option value="pending">Pending</option>
            <option value="review">Review</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="refunded">Refunded</option>
          </select>
        </label>
        <button
          className="flex h-11 w-full items-center justify-center gap-2 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white transition enabled:hover:bg-[#8b2d6b] disabled:cursor-not-allowed disabled:bg-[#9a94a6] md:w-fit"
          disabled={disabled}
          type="submit"
        >
          <BadgeCheck className="size-4" aria-hidden="true" />
          Save review
        </button>
      </div>
    </form>
  );
}

export default async function AdminPaymentsPage({ searchParams }: AdminPaymentsPageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/payments",
    requiredRole: "admin",
    searchParams: params,
  });
  const q = params.q?.trim() ?? "";
  const selectedStatus = params.status ?? "all";
  const selectedEvent = params.event ?? "all";
  let registrations = sampleRegistrations;
  let events: EventOption[] = [{ id: "sample-event-1", name: "PEAGC Monthly Round" }];

  if (!access.isBypass && access.clubId) {
    const supabase = await createClient();
    const [{ data: registrationData }, { data: eventData }] = await Promise.all([
      supabase
        .from("event_registrations")
        .select(
          "id, event_id, guest_name, registration_type, status, created_at, members(full_name, member_code, phone, email), events(name, venue, event_date, tee_off_time, member_price), payment_records(id, amount, status, transferred_at, note)",
        )
        .eq("club_id", access.clubId)
        .not("status", "in", "(cancelled,no_show)")
        .order("created_at", { ascending: false })
        .limit(120),
      supabase
        .from("events")
        .select("id, name")
        .eq("club_id", access.clubId)
        .is("archived_at", null)
        .order("event_date", { ascending: false })
        .limit(80),
    ]);

    registrations = (registrationData ?? []) as unknown as RegistrationRow[];
    events = (eventData ?? []) as EventOption[];
  }

  registrations = registrations.filter((registration) => {
    const paymentStatus = getPaymentStatus(registration);
    const matchesStatus =
      selectedStatus === "all" ||
      registration.status === selectedStatus ||
      paymentStatus === selectedStatus;
    const matchesEvent = selectedEvent === "all" || registration.event_id === selectedEvent;
    const haystack = [
      registration.events?.name,
      registration.events?.venue,
      registration.members?.full_name,
      registration.members?.member_code,
      registration.members?.phone,
      registration.members?.email,
      registration.guest_name,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    const matchesSearch = !q || haystack.includes(q.toLowerCase());

    return matchesStatus && matchesEvent && matchesSearch;
  });

  const reviewCount = registrations.filter((item) => getPaymentStatus(item) === "review" || item.status === "payment_review").length;
  const paidCount = registrations.filter((item) => item.status === "paid" || getPaymentStatus(item) === "approved").length;
  const pendingCount = registrations.filter((item) => item.status === "pending_payment").length;
  const statusMessage = params.status ? statusMessages[params.status] : null;
  const bypassQuery = access.isBypass ? "?bypass=admin" : "";

  return (
    <main className="min-h-screen bg-transparent px-4 py-6 text-[#2f3137]">
      <section className="mx-auto w-full max-w-7xl">
        <div className="flex flex-col gap-4 border-b border-[#e6e2ee] pb-5 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <p className="text-sm font-semibold text-[#8b5b7a]">Admin Portal</p>
            <h1 className="mt-1 text-3xl font-semibold text-[#722257]">Payment Review</h1>
            <p className="mt-2 text-sm text-[#6b6475]">
              Review event registration payments, update payment status, and keep the registration queue ready for pairing.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              className="flex h-11 items-center gap-2 rounded-md border border-[#d9d3e6] bg-white px-4 text-sm font-semibold text-[#722257]"
              href={`/admin${bypassQuery}`}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Admin
            </Link>
            <Link
              className="flex h-11 items-center rounded-md bg-[#722257] px-4 text-sm font-semibold text-white"
              href={`/admin/events${bypassQuery}`}
            >
              Event Management
            </Link>
          </div>
        </div>

        {statusMessage ? (
          <div className="mt-5 rounded-md bg-[#f8edf4] px-4 py-3 text-sm font-medium text-[#722257]">
            {statusMessage}
          </div>
        ) : null}

        {access.isBypass ? (
          <div className="mt-5 rounded-md bg-[#fff5d8] px-4 py-3 text-sm text-[#805300]">
            Admin demo mode: sample payment data is shown and saving is disabled.
          </div>
        ) : null}

        <div className="mt-6 grid gap-4 md:grid-cols-4">
          {[
            { label: "Registrations", value: registrations.length },
            { label: "Pending", value: pendingCount },
            { label: "In review", value: reviewCount },
            { label: "Paid", value: paidCount },
          ].map((item) => (
            <article className="rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur p-5 shadow-[0_18px_45px_rgba(114,34,87,0.08)]" key={item.label}>
              <p className="text-sm font-semibold text-[#6b6475]">{item.label}</p>
              <p className="mt-2 text-3xl font-semibold text-[#722257]">{item.value}</p>
            </article>
          ))}
        </div>

        <section className="mt-6 rounded-lg border border-[#e6e2ee] bg-white/95 backdrop-blur shadow-[0_18px_45px_rgba(114,34,87,0.08)]">
          <div className="border-b border-[#e6e2ee] p-5">
            <form className="grid gap-3 lg:grid-cols-[1fr_220px_180px_110px]">
              {access.isBypass ? <input name="bypass" type="hidden" value="admin" /> : null}
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]" aria-hidden="true" />
                <input
                  className="h-11 w-full rounded-md border border-[#d9d3e6] pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={q}
                  name="q"
                  placeholder="Search member, code, phone, event, or venue"
                />
              </label>
              <label className="relative block">
                <CalendarDays className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]" aria-hidden="true" />
                <select
                  className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={selectedEvent}
                  name="event"
                >
                  <option value="all">All events</option>
                  {events.map((event) => (
                    <option key={event.id} value={event.id}>
                      {event.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="relative block">
                <Filter className="pointer-events-none absolute left-3 top-3.5 size-4 text-[#6b6475]" aria-hidden="true" />
                <select
                  className="h-11 w-full rounded-md border border-[#d9d3e6] bg-white pl-10 pr-3 outline-none focus:border-[#722257] focus:ring-4 focus:ring-[#722257]/10"
                  defaultValue={selectedStatus}
                  name="status"
                >
                  <option value="all">All statuses</option>
                  <option value="pending_payment">Pending payment</option>
                  <option value="review">Review</option>
                  <option value="approved">Approved</option>
                  <option value="paid">Paid</option>
                  <option value="rejected">Rejected</option>
                </select>
              </label>
              <button className="h-11 rounded-md bg-[#722257] px-4 text-sm font-semibold text-white" type="submit">
                Search
              </button>
            </form>
          </div>

          <div className="divide-y divide-[#e6e2ee]">
            {registrations.length ? (
              registrations.map((registration) => {
                const payment = getLatestPayment(registration);
                const paymentStatus = getPaymentStatus(registration);
                const memberName = registration.members?.full_name ?? registration.guest_name ?? "Guest";

                return (
                  <details className="group px-5 py-4" key={registration.id} open={params.registration === registration.id}>
                    <summary className="grid cursor-pointer list-none gap-4 lg:grid-cols-[44px_1fr_0.9fr_0.7fr_104px] lg:items-center">
                      <div className="flex size-11 items-center justify-center rounded-md bg-[#f8edf4] text-[#722257]">
                        <ReceiptText className="size-5" aria-hidden="true" />
                      </div>
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-[#722257]">{memberName}</p>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(registration.status)}`}>
                            {statusLabels[registration.status] ?? registration.status}
                          </span>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${getStatusClass(paymentStatus)}`}>
                            {paymentStatusLabels[paymentStatus] ?? paymentStatus}
                          </span>
                        </div>
                        <p className="mt-1 text-sm text-[#6b6475]">
                          {registration.members?.member_code ?? registration.registration_type} · {registration.members?.phone ?? registration.members?.email ?? "-"}
                        </p>
                      </div>
                      <div className="text-sm text-[#3f3a48]">
                        <p>{registration.events?.name ?? "-"}</p>
                        <p className="mt-1 text-[#6b6475]">{registration.events?.venue ?? "-"}</p>
                      </div>
                      <div className="text-sm text-[#3f3a48]">
                        <p>{(payment?.amount ?? registration.events?.member_price ?? 0).toLocaleString()} baht</p>
                        <p className="mt-1 text-[#6b6475]">{formatDateTime(payment?.transferred_at ?? null)}</p>
                      </div>
                      <span className="w-fit rounded-md border border-[#d9d3e6] px-3 py-2 text-sm font-semibold text-[#722257] group-open:bg-white/70">
                        Review
                      </span>
                    </summary>

                    <div className="mt-5 grid gap-4">
                      <div className="grid gap-3 rounded-md bg-white/70 p-4 text-sm text-[#3f3a48] md:grid-cols-3">
                        <div className="flex items-start gap-2">
                          <UserRound className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                          <div>
                            <p className="font-semibold text-[#6b6475]">Participant</p>
                            <p className="mt-1 text-[#722257]">{memberName}</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <CircleDollarSign className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                          <div>
                            <p className="font-semibold text-[#6b6475]">Expected amount</p>
                            <p className="mt-1 text-[#722257]">{(registration.events?.member_price ?? 0).toLocaleString()} baht</p>
                          </div>
                        </div>
                        <div className="flex items-start gap-2">
                          <Clock className="mt-0.5 size-4 text-[#722257]" aria-hidden="true" />
                          <div>
                            <p className="font-semibold text-[#6b6475]">Registered at</p>
                            <p className="mt-1 text-[#722257]">{formatDateTime(registration.created_at)}</p>
                          </div>
                        </div>
                      </div>

                      <PaymentReviewForm disabled={access.isBypass} registration={registration} />
                    </div>
                  </details>
                );
              })
            ) : (
              <div className="px-5 py-10 text-center text-sm text-[#6b6475]">
                No payment registrations match the current filters.
              </div>
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
