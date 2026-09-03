// Pure outcome fold for the reconsider queue's reinstate action — the safety
// valve over irreversible auto-rejection.
//
// Why this exists: the mutation used to be `if (r.ok) { … }` with no else and no
// catch, fired as `void reinstate(item)`. A 409 (already reinstated) removed
// nothing and said nothing; a network failure rejected an unhandled promise while
// the button spun, re-enabled, and left the row exactly where it was — the one
// screen in the product whose whole job is to reverse an automated rejection
// silently failing to reverse it. The fold below is the whole decision, kept
// separate from React so it can be tested without a DOM: every path ends in a
// removal or in a `{ code, status }` the row can render through useErrorMessage.
//
// The `code` half is what the UI localizes (never the server's English `error`);
// `status` is kept because the two failures a recruiter must tell apart —
// "already reinstated / no longer reinstatable" (409) and "the request never
// landed" (no response at all) — are otherwise indistinguishable.

/** What the row shows when a reinstate did not land. `code` is the machine code
 *  from the API envelope (null when the request never produced one — a network
 *  drop, or a body that was not JSON); `status` is the HTTP status, null for the
 *  same reason. */
export interface ReinstateFailure {
  code: string | null;
  status: number | null;
}

export type ReinstateOutcome =
  | { ok: true; id: string }
  | { ok: false; id: string; failure: ReinstateFailure };

/** The response half of the fold. A `null` response means the fetch itself
 *  rejected (offline, aborted, DNS) — there is no status to report. */
export function foldReinstateResponse(
  id: string,
  response: { ok: boolean; status: number } | null,
  body: unknown
): ReinstateOutcome {
  if (!response) return { ok: false, id, failure: { code: null, status: null } };
  if (response.ok) return { ok: true, id };
  const code =
    body && typeof body === "object" && typeof (body as { code?: unknown }).code === "string"
      ? ((body as { code: string }).code)
      : null;
  return { ok: false, id, failure: { code, status: response.status } };
}

/** Apply an outcome to the queue's session state. Returns the next rows and the
 *  next failure map — success drops the row AND clears any stale failure line for
 *  it, failure keeps the row and records why. Pure: no dates, no identity reuse,
 *  so a component can compare by reference to skip a render. */
export function applyReinstateOutcome<T extends { id: string }>(
  rows: readonly T[],
  failures: Readonly<Record<string, ReinstateFailure>>,
  outcome: ReinstateOutcome
): { rows: T[]; failures: Record<string, ReinstateFailure> } {
  const next = { ...failures };
  if (outcome.ok) {
    delete next[outcome.id];
    return { rows: rows.filter((r) => r.id !== outcome.id), failures: next };
  }
  next[outcome.id] = outcome.failure;
  return { rows: [...rows], failures: next };
}
