// Pure view-layer decisions for the Background-tasks UI (bug-ui-scan-2026-07-09
// #4 + #5). Kept out of the React components so node --test can pin them (a .tsx
// can't be loaded by the node test runner) and both decisions have ONE source.

// ── #4 poll-churn signature ────────────────────────────────────────────────
// The 2s live poll re-parses a fresh array every tick, so setTasks(next) always
// committed a new reference even when nothing changed — cascading a re-render
// through every useTasks() consumer (the always-mounted sidebar indicator, the
// whole Tasks tab, every card/row) for the entire lifetime of any running task.
// TasksProvider commits the new list ONLY when this cheap signature differs, so an
// unchanged poll is a no-op.

/** The fields the tasks UI actually renders — the only things whose change should
 *  force a re-render. Kept structural (not the whole Task) so params/result blobs
 *  (always null on the polled list anyway) can never enter the signature. */
export type TaskSignatureRow = {
  id: string;
  status: string;
  progressDone: number;
  progressTotal: number;
  progressMsg: string | null;
  label: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  /** Read/unread ack — in the signature so a mark-seen actually clears the
   *  indicator badge on the next poll (an unchanged-signature poll is a no-op). */
  seenAt: string | null;
};

/** A cheap order-sensitive fingerprint of the rendered task state. Equal strings
 *  ⇒ the UI would paint identically ⇒ skip the commit. Length changes (added /
 *  removed tasks) change the string, so appearance/disappearance still commits. */
export function tasksSignature(tasks: readonly TaskSignatureRow[]): string {
  return tasks
    .map(
      (t) =>
        `${t.id}${t.status}${t.progressDone}${t.progressTotal}${t.progressMsg ?? ""}${t.label ?? ""}${t.error ?? ""}${t.startedAt ?? ""}${t.finishedAt ?? ""}${t.seenAt ?? ""}`
    )
    .join("");
}

// ── #5 progress affordance ─────────────────────────────────────────────────
// A running task with no progressTotal — the common case for LLM kinds like
// analyze/reasoning — used to render a static ~8% determinate bar that never
// moved for the whole multi-minute run, reading as a job frozen at 8%. The bar is
// genuinely INDETERMINATE work and must be shown as such (an animated/idle
// treatment), never as a fake percentage.

export type ProgressDisplay =
  | { mode: "determinate"; pct: number } // real, bounded progress → % fill
  | { mode: "indeterminate" } // running, unknown total → animated "working"
  | { mode: "idle" }; // queued / not yet started → muted, no fake motion

/** How an active task's progress bar should render. `progressTotal > 0` is the
 *  ONLY determinate case; a running task without a total is indeterminate (never
 *  a constant percentage); anything else (queued) is idle. Pure. */
export function progressDisplay(t: { status: string; progressDone: number; progressTotal: number }): ProgressDisplay {
  if (t.progressTotal > 0) {
    const raw = Math.round((t.progressDone / t.progressTotal) * 100);
    const pct = Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
    return { mode: "determinate", pct };
  }
  if (t.status === "running") return { mode: "indeterminate" };
  return { mode: "idle" };
}
