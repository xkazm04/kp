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
