// One fold for "decode a fetch response into something a surface can render"
// (lot JW, wave 22).
//
// The house shape for a fetch in this app is `await r.json().catch(() => null)`
// — a response body is not guaranteed to be JSON, and a proxy's HTML 502 or a
// dev-server restart makes `r.json()` throw a SyntaxError whose raw English
// message then reaches the recruiter. Two call sites in the jobs workspace still
// awaited the bare form while their own siblings guarded, so this makes the
// guarded decode a named, tested step instead of a convention re-typed per site.
//
// Three outcomes, deliberately distinct:
//   failed    — the STATUS says no. Keep the parsed body (it may carry `code`)
//               so the caller resolves errors.<code> in the reader's language.
//   malformed — the status said yes but there is nothing to render: an
//               unparseable body, or one missing the field this surface needs.
//               It gets its own localized line; it is NOT a coded refusal.
//   ok        — the payload, narrowed by the caller's own validity predicate.
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

export type JsonFold<T> =
  | { kind: "ok"; data: T }
  | { kind: "malformed" }
  | { kind: "failed"; payload: ApiErrorPayload | null; status: number };

/** `res` is only read for `ok`/`status`, so a plain object stands in for a
 *  Response in tests. `payload` is the ALREADY-guarded decode
 *  (`await r.json().catch(() => null)`), never a live promise. */
export function foldJsonResponse<T>(
  res: { ok: boolean; status: number },
  payload: unknown,
  isValid: (payload: object) => boolean
): JsonFold<T> {
  const body = typeof payload === "object" && payload !== null ? payload : null;
  // Status first: an HTML 502 is "the request failed (502)", not "odd body".
  if (!res.ok) return { kind: "failed", payload: body as ApiErrorPayload | null, status: res.status };
  if (!body || !isValid(body)) return { kind: "malformed" };
  return { kind: "ok", data: body as T };
}
