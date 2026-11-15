import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

/**
 * Redirect at the end of a Server Action (success or failure).
 *
 * Invalidates every route first: the destination re-renders with the change in the same
 * response, and pages the user revisits through the menu or the Back button no longer show
 * the pre-save data. Without this, admins had to reload to see what they had just saved.
 */
export function redirectAfterAction(path: string): never {
  revalidatePath("/", "layout");
  redirect(path);
}
