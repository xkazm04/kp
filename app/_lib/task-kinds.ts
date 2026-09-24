// The closed vocabulary of background-task kinds — literal array, derived union,
// runtime guard (the house shape for a closed vocabulary: tabs.ts, i18n/locales.ts).
//
// Every per-kind table is keyed `Record<TaskKind, …>` by this array: the handler
// registry (HANDLERS in tasks.ts), the budget class (task-budget.ts), the dedupe
// identity (task-dedupe.ts) and the outcome decision (task-outcome-summary.ts). So
// adding a kind is ONE entry here, and tsc then names every table that has not
// decided what the new kind does — no test has to parse source text to find out.
//
// No imports, on purpose: the client (TasksProvider's `startTask`) and the node:test
// runner both read this module, and neither can afford tasks.ts's handler graph
// (better-sqlite3, Python spawns).
//
// NOT here: `intake_round` and any other runner registered only on the late-bound
// seam (task-external-runners.ts) without a queue spec. A kind is something
// POST /api/tasks can enqueue, not something a handler can delegate to.
export const TASK_KINDS = [
  "automation",
  "reasoning",
  "batch_screen",
  "batch_outreach",
  "analyze",
  "need_analysis",
  "design_artifacts",
  "evaluate_submission",
  "lifecycle",
  "group_eval",
  "jd_build",
  "interview_prep",
  "agent_fit",
  "interview_kit",
  "interview_letter",
  "repo_scan",
  "campaign",
  "profile_draft",
  "companion_digest",
  "jobseeker_scan",
  "gig_scan",
] as const;

export type TaskKind = (typeof TASK_KINDS)[number];

const KNOWN: ReadonlySet<string> = new Set(TASK_KINDS);

/** The runtime half, for what the compiler cannot see: a request body, a task row
 *  written by an older build. A Set lookup, never `k in table` — that walks the
 *  prototype chain and admitted `"constructor"` as a kind. */
export function isTaskKind(value: unknown): value is TaskKind {
  return typeof value === "string" && KNOWN.has(value);
}
