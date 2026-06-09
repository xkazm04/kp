"use client";

import { useTranslations } from "next-intl";

// Maps an API failure to a localized, candidate-safe message. The API routes
// return a stable machine `code` (see STORE_ERRORS / safeJsonError in
// api-response.ts) alongside the English `error`; on the client we prefer the
// code — localized via the `errors` catalog namespace — and fall back to a
// caller-supplied (already-localized) message when the response carries no code
// we recognise. The raw English `error` string is never shown.
export function useErrorMessage(): (payload: { code?: string | null } | null | undefined, fallback: string) => string {
  const t = useTranslations("errors");
  type ErrorKey = Parameters<typeof t>[0];
  return (payload, fallback) => {
    const code = payload?.code;
    // `t.has`/`t` are typed to known keys; the code is a runtime string, so cast
    // at the boundary after the existence check guards against an unknown code.
    if (code && t.has(code as ErrorKey)) return t(code as ErrorKey);
    return fallback;
  };
}
