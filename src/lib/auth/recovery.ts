import "server-only";

/** Set by /auth/confirm after a password-reset link is verified; lets /account/password skip the old password. */
export const RECOVERY_COOKIE = "peagc_recovery";
export const RECOVERY_COOKIE_MAX_AGE = 15 * 60;
export const RESET_PASSWORD_PATH = "/account/password";

/**
 * Public origin for links sent by e-mail. Production uses the Vercel production domain so a
 * forged Host header can never end up in a reset link.
 */
export function publicOrigin(requestHost?: string | null, requestProto?: string | null) {
  if (process.env.VERCEL_ENV === "production" && process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "");
  if (configured) {
    return configured;
  }
  if (requestHost) {
    return `${requestProto ?? "https"}://${requestHost}`;
  }
  return "http://127.0.0.1:3555";
}
