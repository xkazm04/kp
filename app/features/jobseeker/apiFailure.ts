// What kind of failure the seeker surfaces just met — the one decision every /me
// reader makes before it can say a true sentence about a failed fetch.
//
// The trap this closes: `body?.code ?? null` collapses THREE different failures into
// one `code: null`, which the catalog cannot resolve, so all three painted the
// surface's generic fallback ("The feed could not be loaded."). A dev server that is
// not running answers an HTML 404, a proxy answers an empty body, a network drop
// throws before there is a response at all — and none of those is a refusal the
// server decided. They are a TRANSPORT fault, and the sentence a reader needs for one
// ("check that the app is running") is not the sentence for the other two.
//
// Pure, so `node --test` pins it (apiFailure.test.ts); no React, no fetch.

export type ApiFailureKind =
  /** No usable response: the fetch threw, or the body was not JSON (an HTML 404, an
   *  empty body, a proxy page). The server never got to decide anything. */
  | "transport"
  /** The server decided: a coded refusal (`JOBSEEKER_SOURCE_REFUSED`, `TOO_MANY_REQUESTS`). */
  | "refusal"
  /** The server broke: a coded store fault (`*_FAILED`), or a JSON answer that does
   *  not match the route's contract. */
  | "store";

export type ClassifiedFailure = { kind: ApiFailureKind; code: string | null };

/** The failure a thrown fetch leaves behind: there is no response to classify. */
export const TRANSPORT_FAILURE: ClassifiedFailure = { kind: "transport", code: null };

/** The `*_FAILED` suffix is the house convention for a STORE_ERRORS code
 *  (api-response.ts): an accident whose real message is hidden. Every other code in
 *  the registry is a REFUSAL — a decision whose code carries the information. The
 *  registry itself lives in a server module (it imports `next/server`), so the
 *  convention, not the object, is what a browser bundle can read. */
function kindForCode(code: string): ApiFailureKind {
  return code.endsWith("_FAILED") ? "store" : "refusal";
}

/**
 * Classify a failed API read.
 *
 * @param res   the response, or `null` when `fetch` itself threw.
 * @param body  the parsed JSON body, or `null` when the body was absent or not JSON.
 */
export function classifyApiFailure(res: { ok: boolean; status: number } | null, body: { code?: unknown } | null): ClassifiedFailure {
  if (!res || body === null) return TRANSPORT_FAILURE;
  const code = typeof body.code === "string" && body.code ? body.code : null;
  if (!code) return { kind: "store", code: null };
  return { kind: kindForCode(code), code };
}
