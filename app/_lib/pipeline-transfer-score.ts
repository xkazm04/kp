// ONE THREAD (gap 2) — the server side of "a transfer score is not a match score".
//
// A candidate promoted from an assignment used to arrive on the board carrying the
// work-sample TRANSFER score in `pipeline_entries.match_score`, `?? 0` when the
// evaluation had none — so an unmeasured person was rankable, auto-rejectable and
// indistinguishable from someone a real match run had scored. `match_score` now
// means "match" again and stays NULL for a promote, which leaves the transfer score
// where it has always actually lived: `dev_submissions.transfer_score`.
//
// This module is the read path back to it, and it is deliberately the same SHAPE as
// match-score-resolve.ts: one batched query for a whole page of entries, stamped
// onto the payload as an extra field, with the pure display/precedence rules living
// in match-score.ts (displayScoreOf). It resolves the submission through
// devcase-identity.submissionIdForEntry — column first, legacy "ds-" prefix second —
// so entries written BEFORE the link column existed resolve too.
//
// What it does NOT do: feed any ranking. `canonicalScoreOf` stays match-only for
// exactly that reason (see the score-kind block in match-score.ts).

import { transferScoresBySubmissionIds } from "./db/devcase";
import { submissionIdForEntry, type IdentityCarrier } from "./devcase-identity";

export type TransferScoreFields = {
  /** The work-sample transfer score behind this entry, or null when the entry did
   *  not come from an assignment (the overwhelmingly common case) or its submission
   *  has not been evaluated yet. Never 0-for-absent. */
  transferScore: number | null;
};

/** Stamp `transferScore` onto pipeline entries: one batched `dev_submissions` read
 *  for every entry that names a submission, skipped entirely when none does — so a
 *  board with no assignment candidates costs nothing beyond the resolver walk. */
export function withTransferScores<T extends IdentityCarrier>(
  entries: T[],
  workspaceId?: string
): (T & TransferScoreFields)[] {
  const bySubmission = new Map<T, string>();
  for (const e of entries) {
    const submissionId = submissionIdForEntry(e);
    if (submissionId) bySubmission.set(e, submissionId);
  }
  if (bySubmission.size === 0) return entries.map((e) => ({ ...e, transferScore: null }));
  const scores = transferScoresBySubmissionIds([...bySubmission.values()], workspaceId);
  return entries.map((e) => {
    const submissionId = bySubmission.get(e);
    return { ...e, transferScore: (submissionId ? scores.get(submissionId) : undefined) ?? null };
  });
}
