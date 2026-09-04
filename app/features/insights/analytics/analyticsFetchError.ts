// One rule, two export buttons: a failed fetch on this tab is reported from the
// server's machine CODE, in the reader's language — never from a raw HTTP status
// and never from the server's English `error` string (api-contracts.md §1.1).
//
// What both call sites did before: `if (!res.ok) throw new Error(String(res.status))`
// and `if (body.error) throw new Error(body.error)`, caught by a bare `catch` that
// painted one flat sentence. So `GET /api/analytics/decisions` answering
// TOO_MANY_REQUESTS (429 — the rate limiter; wait and retry) and the same route
// answering DECISION_LOG_LOAD_FAILED (500 — the read fell over) were the same red
// line: "the export failed". The number the throw carried never reached a reader at
// all, which is the tell that it was never a message in the first place.
//
// The shape: the resolver (`useErrorMessage`) is a hook, so it lives in the
// component; the async worker that fetches may be a layer away from the component
// that renders the failure. So the worker resolves the message where it has the
// resolver and throws it as a LOCALIZED failure, and the renderer unwraps it with a
// fallback for anything else that could have gone wrong (a network drop, a JSON
// parse, a bug) — a thrown Error's raw `.message` must never be painted.
import type { ApiErrorPayload } from "@/app/_lib/use-error-message";

/** An Error whose `message` has ALREADY been resolved through `useErrorMessage`.
 *  The marker class is the contract: anything else reaching the catch is an
 *  unlocalized accident and gets the caller's own fallback sentence. */
export class LocalizedFailure extends Error {
  readonly localized = true as const;
  constructor(message: string) {
    super(message);
    this.name = "LocalizedFailure";
  }
}

/** Unwrap a caught value into something safe to render. Anything that is not a
 *  LocalizedFailure — including an Error carrying a server string — resolves to
 *  `fallback`, which the caller has already localized. */
export function localizedFailureMessage(err: unknown, fallback: string): string {
  return err instanceof LocalizedFailure && err.message ? err.message : fallback;
}

/** The `{ error, code }` body of a failed response, for the resolver to read. A
 *  failing route may answer with no body at all (a proxy 502, an aborted stream),
 *  so a parse failure is an EMPTY payload rather than a second error: the caller's
 *  fallback then covers it, which is exactly the "no code, say the generic thing"
 *  branch the resolver already implements. */
export async function apiErrorPayload(res: Response): Promise<ApiErrorPayload> {
  try {
    const body = (await res.json()) as unknown;
    return body && typeof body === "object" ? (body as ApiErrorPayload) : {};
  } catch {
    // Best-effort: a body-less or non-JSON failure carries no code to resolve, and
    // the caller's localized fallback is the honest answer for it.
    return {};
  }
}
