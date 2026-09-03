// What a background task kind COSTS when it runs, and therefore how many of them
// one caller may start.
//
// POST /api/tasks is ONE door in front of every kind in `HANDLERS`, and it carried
// ONE bucket: 120 starts per 10 minutes per IP. That number was calibrated for the
// cheapest thing that comes through it — the Decisions queue firing one POST per
// accepted screening review, so a 50-card bulk accept is a legitimate 50-request
// burst. The same 120 admitted 120 `repo_scan`s (each a git clone plus minutes of
// agent work), 120 `lifecycle` runs (a whole dev-case orchestration), 120
// `group_eval`s (per-candidate reasoning across a cohort) and 120 `batch_screen`s
// (one LLM call per active entry on the board — fan-out with no fixed size).
//
// So the budget is per CLASS, and the classes are about the shape of the spend:
//
//   cheap    one short model call, or none, over text already in hand — and the
//            kinds a legitimate UI burst fires many of. Keeps the historical 120.
//   metered  one model call plus a Python spawn per run, over a document or a
//            role. Fewer, and capped per WORKSPACE too, because the IP bucket is
//            the wrong unit when a team shares an office NAT or sits behind one
//            reverse proxy (clientIpFrom returns SHARED_CLIENT_KEY with no trusted
//            proxy configured, collapsing the whole deployment into one bucket).
//   agent    minutes of work and unbounded fan-out: a repo clone, a cohort, a
//            whole board. A handful per window is far above any human pace.
//
// The per-workspace cap is the half that actually bounds spend: it survives an IP
// rotation, and it is the tenant whose LLM allowance is being drawn down.
//
// PURE and dependency-free (no better-sqlite3, no handler graph) so the route, the
// contract test and the exhaustiveness test can all read the same table.

export const TASK_BUDGET_CLASSES = ["cheap", "metered", "agent"] as const;
export type TaskBudgetClass = (typeof TASK_BUDGET_CLASSES)[number];

export type TaskBudget = {
  /** Per client IP, on top of the route's overall `tasks-start:` bucket. */
  ip: { limit: number; windowMs: number };
  /** Per WORKSPACE, over a longer window. null = the IP bucket is the whole bound. */
  workspace: { limit: number; windowMs: number } | null;
};

const TEN_MIN = 10 * 60_000;
const HOUR = 60 * 60_000;

export const TASK_BUDGETS: Record<TaskBudgetClass, TaskBudget> = {
  // The historical number, kept deliberately: useDecisionsQueue fires one POST per
  // accepted review, so a 50-card bulk accept must not be throttled into silently
  // dropping interview-prep artifacts.
  cheap: { ip: { limit: 120, windowMs: TEN_MIN }, workspace: null },
  metered: { ip: { limit: 30, windowMs: TEN_MIN }, workspace: { limit: 90, windowMs: HOUR } },
  agent: { ip: { limit: 6, windowMs: TEN_MIN }, workspace: { limit: 15, windowMs: HOUR } },
};

/** Every kind in `HANDLERS` (app/_lib/tasks.ts), classified. `task-budget.test.ts`
 *  parses that registry and fails on a kind missing from here, so a new task kind
 *  cannot inherit a budget by accident. */
export const TASK_BUDGET_CLASS: Record<string, TaskBudgetClass> = {
  // ── cheap ──
  // One entry, one automation call — and the Decisions bulk-accept burst path.
  automation: "cheap",
  // One reasoning spawn for one candidate, cached by prompt hash.
  reasoning: "cheap",
  // One prep pack for one candidate; fired once per accepted review.
  interview_prep: "cheap",
  // One short draft over notes the operator just typed.
  profile_draft: "cheap",
  // One assistant call that files a message into a thread.
  companion_digest: "cheap",

  // ── metered ──
  // A CV (or several variants) through the Python pipeline + a paid multimodal call.
  analyze: "metered",
  // A multi-step JD build: role spec, salary, optional case.
  jd_build: "metered",
  need_analysis: "metered",
  design_artifacts: "metered",
  // A full submission evaluation: reflection, tooling, scoring, follow-ups.
  evaluate_submission: "metered",
  campaign: "metered",
  agent_fit: "metered",
  // Fan-out, but over a cohort the caller explicitly selected on the board.
  batch_outreach: "metered",

  // ── agent ──
  // A git clone plus minutes of in-repo agent work (docs/features/app-master).
  repo_scan: "agent",
  // The whole dev-case orchestration: several model steps in sequence.
  lifecycle: "agent",
  // Per-candidate reasoning across a cohort, then a comparison call.
  group_eval: "agent",
  // One LLM call per ACTIVE ENTRY on the board — the one kind whose cost is set by
  // the board's size rather than by the request.
  batch_screen: "agent",
};

/** The class a kind is budgeted under. An unknown kind (one added to HANDLERS and
 *  not classified here, which the test forbids) falls to the TIGHTEST class, never
 *  the loosest: a budget omission must cost throughput, not money. */
export function taskBudgetClass(kind: string): TaskBudgetClass {
  return TASK_BUDGET_CLASS[kind] ?? "agent";
}

/** The budget for a kind — `TASK_BUDGETS[taskBudgetClass(kind)]`. */
export function taskBudget(kind: string): TaskBudget {
  return TASK_BUDGETS[taskBudgetClass(kind)];
}
