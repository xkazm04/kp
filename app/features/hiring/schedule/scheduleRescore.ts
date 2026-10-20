// The one re-score call both callers make (the interviewed list's Re-score control and the
// transcript modal's). Pure over `fetch` and a bound errors resolver, so each caller's
// handling is a test and neither renders the server's English `error` string.

import type { ErrorMessageResolver } from "@/app/_lib/use-error-message";

export type RescoreOutcome = { ok: true } | { ok: false; message: string };

/** POST the re-score. A non-OK reply (the 409 INTERVIEW_SCORECARD_UNGROUNDED refusal, a
 *  429, a 500) becomes the localized sentence for its code; a reply with no usable code,
 *  or a network failure, becomes the generic re-score failure. */
export async function rescoreSession(
  sessionId: string,
  resolve: ErrorMessageResolver,
  doFetch: typeof fetch = fetch
): Promise<RescoreOutcome> {
  const generic = resolve({ code: "INTERVIEW_RESCORE_FAILED" }, "");
  try {
    const res = await doFetch(`/api/interview/sessions/${encodeURIComponent(sessionId)}/rescore`, { method: "POST" });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => null)) as { code?: string | null; error?: string | null } | null;
    return { ok: false, message: resolve(body, generic) };
  } catch {
    return { ok: false, message: generic };
  }
}
