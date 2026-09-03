// The ad-ingest panel's run settlement, as a pure decision (lot JW, wave 22).
//
// JobsIngestAdPanel drives one AbortController for two DIFFERENT events, and
// telling them apart is the whole protocol:
//
//   user "Cancel run"  → a terminal OUTCOME. The panel is alive: keep the rows
//                        that landed, clear busy, say how far the run got, and
//                        refresh the corpus if anything was actually created.
//   unmount teardown   → NOT an outcome. The component is gone; every state
//                        write is a write into a dead tree, so write nothing.
//
// That distinction lived only as two inline `if (controller.signal.aborted)`
// branches reading a ref, with no test anywhere referencing the panel — revert
// the ref and the run simply becomes uncancellable, silently. Extracted here so
// the rule is unit-testable (a hook can't be rendered by `node --test`) and so
// the panel reads as "settle the run, then apply the settlement".
//
// It also owns the paste rule: a run that created nothing KEEPS the textarea.
// The paste is the only copy of that text, and clearing it after "3 already in
// catalog · 2 couldn't parse" left the recruiter with nothing to fix and re-run.

export type RowStatus = "added" | "exists" | "failed";
export type IngestRow = { title: string; status: RowStatus };

/** The two facts that decide a settlement: did the controller abort, and was the
 *  abort the recruiter's cancel (as opposed to the panel unmounting)? */
export type RunSignals = { aborted: boolean; cancelled: boolean };

export type BulkSettlement =
  // Unmount: the caller must not touch state — not the rows, not busy, not a note.
  | { kind: "teardown" }
  // Cancel: partial rows stand, with a "cancelled after {done} of {total}" note.
  | { kind: "cancelled"; results: IngestRow[]; done: number; total: number; refresh: boolean }
  // Ran to the end: the per-status counts the summary note is built from.
  | { kind: "done"; added: number; exists: number; failed: number; clearPaste: boolean; refresh: boolean };

const createdAny = (rows: readonly IngestRow[]) => rows.some((r) => r.status === "added");

export function settleBulkRun({
  aborted,
  cancelled,
  rows,
  total,
}: RunSignals & { rows: readonly IngestRow[]; total: number }): BulkSettlement {
  if (aborted) {
    if (!cancelled) return { kind: "teardown" };
    return { kind: "cancelled", results: [...rows], done: rows.length, total, refresh: createdAny(rows) };
  }
  const added = rows.filter((r) => r.status === "added").length;
  const exists = rows.filter((r) => r.status === "exists").length;
  const failed = rows.filter((r) => r.status === "failed").length;
  // clearPaste and refresh are the SAME condition on purpose: the paste is only
  // safe to drop once something new exists in the corpus to account for it.
  return { kind: "done", added, exists, failed, clearPaste: added > 0, refresh: added > 0 };
}

export type SingleSettlement =
  | { kind: "teardown" } // unmount — silent
  | { kind: "cancelled" } // the recruiter stopped it; the paste is kept
  | { kind: "settled" }; // ran to a normal end (success or a reported failure)

export function settleSingleRun({ aborted, cancelled }: RunSignals): SingleSettlement {
  if (!aborted) return { kind: "settled" };
  return cancelled ? { kind: "cancelled" } : { kind: "teardown" };
}

/** Whether the `finally` may clear the busy/progress flags. False only for an
 *  unmount teardown, where any write lands in a dead component. */
export function releasesBusy({ aborted, cancelled }: RunSignals): boolean {
  return !aborted || cancelled;
}
