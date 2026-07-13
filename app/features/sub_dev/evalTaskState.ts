// bug-ui-scan-2026-07-09 (dev-submissions-live-work-surface #3): pure decision logic
// for the SubmissionRow evaluate control, extracted from the .tsx so it is testable
// under `node --test` (which can't load JSX). SubmissionRow previously read only
// { status, full } from useTaskResult and modelled ONLY the happy path — a "failed"
// or "interrupted" task looked identical to "never ran": busy flipped false, no fresh
// result, and the panel rendered nothing. useTaskResult already surfaces `error` and
// `resultUnavailable`; this turns them into an explicit view state the row can render.
//
// Kept an import-free leaf (status typed locally, mirroring TasksProvider's TaskStatus)
// so it needs no alias loader to test — same pattern as DevHelpers.ts.
export type EvalStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "canceled"
  | "interrupted"
  | null;

export type EvalTaskView = {
  /** queued || running — an evaluation is in flight (show a pending affordance). */
  busy: boolean;
  /** The task ended WITHOUT a usable result — the row must show an error chip + Retry
   *  instead of silently reverting to "Evaluate" as if nothing happened. */
  failed: boolean;
  /** Human-readable cause for the error chip, or null when there is nothing to show. */
  message: string | null;
};

export function evalTaskView(input: {
  status: EvalStatus;
  error: string | null;
  resultUnavailable: boolean;
}): EvalTaskView {
  const { status, error, resultUnavailable } = input;
  const busy = status === "queued" || status === "running";
  // A user-initiated cancel is not a failure — don't nag with an error chip for it.
  const hardFailed = status === "failed" || status === "interrupted";
  // resultUnavailable: the task reached a terminal state (possibly 'succeeded') but the
  // hook exhausted its result fetches. The hook's own contract says consumers MUST
  // surface this instead of spinning — so it also counts as a shown error.
  const failed = hardFailed || resultUnavailable;

  let message: string | null = null;
  if (hardFailed) {
    const verb = status === "interrupted" ? "was interrupted" : "failed";
    const detail = typeof error === "string" ? error.trim() : "";
    message = detail ? `Evaluation ${verb}: ${detail}` : `Evaluation ${verb}.`;
  } else if (resultUnavailable) {
    message = "Evaluation finished but its result couldn't be loaded.";
  }

  return { busy, failed, message };
}
