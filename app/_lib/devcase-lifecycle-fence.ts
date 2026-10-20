// The lifecycle fence: the rules a lifecycle's two drivers (the autonomous runner and the
// human close door) consult at the moment they act, so neither acts on a candidate the
// other has already decided about. Pure, no imports: the orchestrator and the close route
// feed it what they just read.
//
// preparation-is-the-staleness-window: the runner computes for minutes (LLM chains, an
// evaluation batch) and then writes to the board, mails a candidate or mints a live
// apply token. The stage it READ at the start of the step is stale by then. A human
// close lands in that window, so the fence re-reads the authoritative stage as the last
// statement before each irreversible effect.

/** Why the runner stops before its next effect. `moved` carries where the lifecycle is now
 *  ("missing" when the row itself is gone). */
export type StopVerdict =
  | { stop: false }
  | { stop: true; reason: "canceled" }
  | { stop: true; reason: "moved"; to: string }
  | { stop: true; reason: "paused" };

export type StopInput = {
  /** The task's AbortSignal fired. */
  aborted: boolean;
  /** The kill switch as read now (`dev_control`). */
  autonomy: string;
  /** The stage this step read when it began. */
  stageRead: string;
  /** The stage re-read from the store just now; null when the row is gone. */
  stageNow: string | null;
};

/** THE per-item stop decision. A cancel wins (the task owner said stop); then a moved
 *  stage (someone else now owns the lifecycle, so nothing this step computed may land);
 *  then the kill switch. */
export function stopVerdict(input: StopInput): StopVerdict {
  if (input.aborted) return { stop: true, reason: "canceled" };
  if (input.stageNow !== input.stageRead) return { stop: true, reason: "moved", to: input.stageNow ?? "missing" };
  if (input.autonomy === "paused") return { stop: true, reason: "paused" };
  return { stop: false };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type WrapUpCandidate = {
  id: string;
  status?: string | null;
  contact?: string | null;
  candidateRef?: string | null;
};

/** THE rule for who is owed a close note: every submitter the board does not already hold,
 *  once per address. A submission with a linked pipeline entry (`hasOutcome`) was promoted,
 *  and from promotion on the pipeline owns that candidate's comms (they may already hold
 *  the "Next step" letter). Only an email-shaped contact is an address; an email-shaped
 *  candidateRef is the fallback for older submissions with no contact field. Order is
 *  preserved, so the first submission for an address is the one written to. */
export function wrapUpRecipients<S extends WrapUpCandidate>(
  submissions: readonly S[],
  hasOutcome: (submission: S) => boolean
): Array<{ to: string; submission: S }> {
  const seen = new Set<string>();
  const out: Array<{ to: string; submission: S }> = [];
  for (const submission of submissions) {
    if (submission.status === "promoted" || hasOutcome(submission)) continue;
    const to = [submission.contact, submission.candidateRef]
      .map((value) => value?.trim())
      .find((value): value is string => !!value && EMAIL_RE.test(value));
    if (!to || seen.has(to)) continue;
    seen.add(to);
    out.push({ to, submission });
  }
  return out;
}
