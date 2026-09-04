// The Decisions queue's read, folded to a MACHINE failure.
//
// the-decisions-queue-answers-codes — the queue's own load was the one banned
// chain left in this directory: `if (p.error) throw new Error(p.error)` and then
// `setError(e.message)`, painted verbatim by DecisionsTab. Every other failure
// here (the reinstate row, the Rules modal, the batch refusal) already resolves
// `errors.<CODE>` through useErrorMessage, so a Czech operator read three
// localized failures and one English sentence written for the server log.
//
// GET /api/pipeline answers a failure through safeJsonError (code
// PIPELINE_LIST_FAILED) and a gated seat through FORBIDDEN_CAPABILITY, so there
// is always a machine half to resolve. This module extracts ONLY that half —
// the hook owns the translator, exactly as decisionsRulesLoad.ts does — so no
// sentence can escape from here to the screen.
import type { Entry } from "@/app/features/shared/decisionsTypes";

/** Why a queue read produced no entries, in machine terms only. `status` is null
 *  for a read that never reached the server (offline, aborted, DNS). */
export interface QueueLoadFailure {
  code: string | null;
  capability: string | null;
  status: number | null;
}

export type QueueRead = { entries: Entry[]; failure: null } | { entries: null; failure: QueueLoadFailure };

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

/** Fold a 200 body into the entries or into why there are none.
 *
 *  A body carrying `error` is a failure EVEN with a 200: safeJsonError is not the
 *  only writer of that field, and an entries-less body is not an empty queue. An
 *  absent `entries` array with no error is treated the same way — the route always
 *  sends the array, so a body without one did not come from the route we asked. */
export function readQueueResponse(payload: unknown): QueueRead {
  const p = (payload ?? null) as { entries?: unknown; error?: unknown; code?: unknown; capability?: unknown } | null;
  // The `error` field is only ever INSPECTED here, never read onto the wire out of
  // this module — its whole purpose is to be replaced by the code beside it.
  const declaredFailure = p != null && p.error != null;
  if (p && !declaredFailure && Array.isArray(p.entries)) return { entries: p.entries as Entry[], failure: null };
  // A body that carried EITHER field came from the route, so 200 is a real status
  // to report; a body that carried neither did not, so nothing is claimed.
  const answered = p != null && (declaredFailure || p.entries !== undefined);
  return { entries: null, failure: { code: str(p?.code), capability: str(p?.capability), status: answered ? 200 : null } };
}

/** Fold a THROWN read into the same shape. sharedGetJson turns a non-OK response
 *  into `Error("HTTP <status>")` and never hands the body back, so the status is
 *  recovered from that one known message and the code stays null — the message
 *  itself is never a code and never reaches a screen. */
export function foldQueueLoadThrow(err: unknown): QueueLoadFailure {
  const m = err instanceof Error ? /^HTTP (\d{3})$/.exec(err.message) : null;
  return { code: null, capability: null, status: m ? Number(m[1]) : null };
}
