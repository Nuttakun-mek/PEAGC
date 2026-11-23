import { NextResponse } from "next/server";

import { paymentProofCategories } from "@/lib/payments/slip-upload";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = ["platform_owner", "club_admin", "finance_officer", "auditor"];

/** Slips show names and part of an account number: links live for two minutes only. */
const SIGNED_URL_SECONDS = 120;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ fileId: string }> },
) {
  const { fileId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/admin/payments", request.url));
  }

  const { data: role } = await supabase
    .from("user_roles")
    .select("club_id")
    .eq("user_id", user.id)
    .in("role_key", allowedRoles)
    .limit(1)
    .maybeSingle();

  if (!role) {
    return new NextResponse("ไม่มีสิทธิ์เข้าถึง", { status: 403 });
  }

  const admin = createAdminClient();
  // `*` so databases without the newer `deleted_at` column still answer.
  const { data: file } = await admin
    .from("files")
    .select("*")
    .eq("id", fileId)
    .eq("club_id", role.club_id)
    .in("category", paymentProofCategories)
    .maybeSingle();

  if (!file) {
    return new NextResponse("ไม่พบไฟล์", { status: 404 });
  }
  if ((file as { deleted_at?: string | null }).deleted_at) {
    return new NextResponse("ลบสลิปนี้แล้วตามระยะเวลาเก็บข้อมูลของชมรม", { status: 410 });
  }

  const { data, error } = await admin.storage
    .from(file.bucket)
    .createSignedUrl(file.object_path, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    return new NextResponse("ไม่สามารถเปิดไฟล์ได้", { status: 500 });
  }

  const response = NextResponse.redirect(data.signedUrl);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
