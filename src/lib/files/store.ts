import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { logDbError } from "@/lib/supabase/errors";

import { type InspectedFile, buildObjectPath } from "./inspect";

export type StoredFile = { fileId: string; objectPath: string };

/**
 * Uploads an inspected file to a storage bucket and records it in `files` (size, sha256 in
 * `checksum`, width/height). Use the service-role client: members have no insert policy on
 * `files`, and the caller has already checked who may upload what.
 * The storage object is removed again when the `files` insert fails, so nothing is orphaned.
 */
export async function storeInspectedFile(
  admin: SupabaseClient,
  file: InspectedFile,
  { bucket, category, clubId, pathCategory, userId }: { bucket: string; category: string; clubId: string; pathCategory?: string; userId: string | null },
): Promise<{ ok: true; stored: StoredFile } | { ok: false; error: "upload-failed" | "db-failed" }> {
  const objectPath = buildObjectPath(pathCategory ?? category, file.ext);
  const { error: uploadError } = await admin.storage
    .from(bucket)
    .upload(objectPath, file.bytes, { cacheControl: "3600", contentType: file.mime, upsert: false });

  if (uploadError) {
    console.error(`[files] upload ${bucket}:`, uploadError.message);
    return { error: "upload-failed", ok: false };
  }

  const row = {
    bucket,
    category,
    checksum: file.sha256,
    club_id: clubId,
    created_by: userId,
    mime_type: file.mime,
    object_path: objectPath,
    size_bytes: file.size,
  };
  const withSize = file.dimensions ? { ...row, height: file.dimensions.height, width: file.dimensions.width } : row;
  let insert = await admin.from("files").insert(withSize).select("id").single();
  // width/height arrive with the payments migration; older databases still get the file row.
  if (insert.error && withSize !== row && /width|height/.test(insert.error.message ?? "")) {
    insert = await admin.from("files").insert(row).select("id").single();
  }

  if (insert.error || !insert.data) {
    logDbError(`files.insert ${category}`, insert.error);
    await admin.storage.from(bucket).remove([objectPath]);
    return { error: "db-failed", ok: false };
  }

  return { ok: true, stored: { fileId: insert.data.id as string, objectPath } };
}

/** Removes a stored file that nothing points at yet (e.g. its payment row could not be saved). */
export async function discardStoredFile(admin: SupabaseClient, bucket: string, stored: StoredFile) {
  await admin.storage.from(bucket).remove([stored.objectPath]);
  await admin.from("files").delete().eq("id", stored.fileId);
}
