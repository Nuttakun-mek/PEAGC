import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const allowedRoles = ["platform_owner", "club_admin", "finance_officer", "auditor"];

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
  const { data: file } = await admin
    .from("files")
    .select("bucket, object_path")
    .eq("id", fileId)
    .eq("club_id", role.club_id)
    .eq("category", "event_payment_proof")
    .maybeSingle();

  if (!file) {
    return new NextResponse("ไม่พบไฟล์", { status: 404 });
  }

  const { data, error } = await admin.storage
    .from(file.bucket)
    .createSignedUrl(file.object_path, 300);

  if (error || !data?.signedUrl) {
    return new NextResponse("ไม่สามารถเปิดไฟล์ได้", { status: 500 });
  }

  return NextResponse.redirect(data.signedUrl);
}
