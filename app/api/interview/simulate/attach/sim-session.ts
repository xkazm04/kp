// Pure predicate for /api/interview/simulate/attach — extracted so it is
// unit-testable under `node --test` without a DB or next/server.
//
// bug-ui-scan-2026-07-09 (interview-simulation-comparison #3): the sim/real
// boundary used to be the single overloaded condition `entryId == null`, so the
// route accepted an interview-lab mode:"test" session OR a `created` session
// that was never actually run as a "practice run" — stamping a `sim_attached`
// audit event that references an interview that never happened. A sim minted by
// /api/interview/simulate is uniquely identified by THREE real signals, not one:
// it is mode "candidate" (so both voice providers get the scripted brief), it
// has NO linked pipeline entry, and — to be attachable — it must have actually
// been conducted to completion (endedAt set). Gating on all three refuses:
//   (a) a real, entry-linked candidate session (already on a record, not a sim),
//   (b) an interview-lab mode:"test" session (never a candidate-facing sim),
//   (c) a sim that was created but never run (no transcript to attach).
export type AttachableSession = {
  entryId: string | null;
  mode: "test" | "candidate";
  endedAt: string | null;
} | null;

/** True iff `session` is an attachable practice (simulator) run — a completed,
 *  entry-less, candidate-mode session. See the file header for the rationale. */
export function isAttachableSimSession(session: AttachableSession): boolean {
  return (
    !!session &&
    session.entryId == null &&
    session.mode === "candidate" &&
    session.endedAt != null
  );
}

// ---------------------------------------------------------------------------
// Idempotency key for the annotation (wave 18b).
//
// `recordSimTranscriptAttached` de-duplicates on the EVENT DETAIL string, which
// used to be `jobTitle · completed` — a value that is IDENTICAL for every
// practice run of the same sim mode. That made the dedup both too strong and too
// weak at once: a recruiter who ran two different practice interviews and
// attached both to the same candidate silently got ONE drawer line (the second
// attach was swallowed as a duplicate), while a client-side latch was the only
// thing stopping a re-POST of the same session from being counted twice — a
// latch that a reload, a second tab, or a retried fetch does not survive.
//
// Appending a short, stable, opaque reference derived from the session ID makes
// the detail unique PER SESSION, so the existing detail-keyed dedup becomes
// exactly "idempotent per (session, entry)": the same run re-POSTed collapses
// onto the annotation already there, two different runs stay two lines.
//
// Derived by hash, not sliced from the id: the id is an internal identifier and
// the detail is recruiter-visible drawer prose. The token — the candidate's
// actual credential — never goes near this string, which is the rule the
// original comment set and this keeps.
import { createHash } from "node:crypto";

export type AttachDetailSession = {
  id: string;
  jobTitle: string | null;
  status: string;
  endedAt: string | null;
};

/** Six hex chars of sha256(session id) — stable across POSTs, opaque, and not
 *  reversible to the session id or its token. */
export function simRunRef(sessionId: string): string {
  return createHash("sha256").update(`sim-attach:${sessionId}`).digest("hex").slice(0, 6);
}

/** The drawer line for an attached practice run, and (because the store keys its
 *  dedup on this string) the idempotency key of the attach itself. */
export function simAttachDetail(session: AttachDetailSession): string {
  return [session.jobTitle, session.endedAt ? "completed" : session.status, `run ${simRunRef(session.id)}`]
    .filter(Boolean)
    .join(" · ");
}
