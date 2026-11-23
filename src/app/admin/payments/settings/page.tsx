import Link from "next/link";

import { PaymentSettingsSection } from "@/components/payments-settings-section";
import { StatusBanner } from "@/components/status-banner";
import { PageHeader } from "@/components/ui/page-header";
import { buttonSecondary } from "@/components/ui/styles";
import { resolveAccess } from "@/lib/auth/access";
import { requireAdminArea } from "@/lib/auth/admin-area";

type PageProps = {
  searchParams: Promise<{ bypass?: string; status?: string }>;
};

/** Payment account settings inside the payments area, so finance officers can reach them. */
export default async function PaymentSettingsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const access = await resolveAccess({
    allowBypassRole: "admin",
    nextPath: "/admin/payments/settings",
    requiredRole: "admin",
    searchParams: params,
  });
  await requireAdminArea("payments", access);

  return (
    <main className="min-h-screen px-4 py-6 text-ink">
      <section className="mx-auto grid w-full max-w-5xl gap-5">
        <PageHeader
          actions={
            <Link className={buttonSecondary} href={`/admin/payments${access.isBypass ? "?bypass=admin" : ""}`}>
              กลับไปตรวจสลิป
            </Link>
          }
          description="คิวอาร์พร้อมเพย์ ชื่อบัญชี การตรวจสลิปอัตโนมัติ และระยะเวลาเก็บสลิป"
          title="บัญชีรับเงิน"
        />
        {access.isBypass ? <StatusBanner tone="warning">โหมดทดลอง: แสดงข้อมูลตัวอย่าง กดบันทึกไม่ได้</StatusBanner> : null}
        <PaymentSettingsSection clubId={access.clubId} isBypass={access.isBypass} returnTo="/admin/payments/settings" status={params.status} />
      </section>
    </main>
  );
}
