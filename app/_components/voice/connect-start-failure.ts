import type { ApiErrorPayload, ErrorMessageResolver } from "@/app/_lib/use-error-message";

// /connect answers coded refusals (INTERVIEW_ALREADY_LIVE, EXPIRED, INACTIVE,
// ALREADY_COMPLETED). start() used to wrap them in `new Error(errMsg(data))`
// and the catch discarded e.message for t("errStartCall"), so the candidate
// always read the generic start failure. Map the body HERE, then setError and
// return — do not rethrow into that catch.

export type ConnectFailureBody = ApiErrorPayload & {
  retryAfterMin?: unknown;
};

export function connectStartFailureMessage(
  data: ConnectFailureBody | null | undefined,
  resolve: ErrorMessageResolver,
  fallback: string,
  retryAfterMinutes: (minutes: number) => string,
): string {
  const base = resolve(data, fallback);
  if (data?.code !== "INTERVIEW_ALREADY_LIVE") return base;
  const minutes = data.retryAfterMin;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return base;
  return `${base} ${retryAfterMinutes(minutes)}`;
}
