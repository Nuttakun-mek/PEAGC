import type { Instrumentation } from "next";

/**
 * One structured log line per server error (Server Components, Route Handlers, Server Actions,
 * proxy). Vercel keeps these logs; search for `"event":"request_error"` and match the `digest`
 * shown on the error page to the line. No request headers, cookies or form data are logged.
 */
export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const message = error instanceof Error ? error.message : String(error);
  const digest =
    typeof error === "object" && error !== null && "digest" in error ? String((error as { digest?: unknown }).digest) : undefined;
  // Drop the query string: it can carry search terms (names, phone numbers) of members.
  const path = request.path.split("?")[0];

  console.error(
    JSON.stringify({
      appEnv: process.env.NEXT_PUBLIC_APP_ENV || undefined,
      digest,
      event: "request_error",
      message: message.slice(0, 500),
      method: request.method,
      name: error instanceof Error ? error.name : undefined,
      path,
      route: context.routePath,
      routeType: context.routeType,
      time: new Date().toISOString(),
    }),
  );
};
