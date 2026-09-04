// The dev-case lifecycle's stage machine, written down once.
//
// `dev_lifecycle.stage` is a closed vocabulary of ten values that the orchestrator,
// the approve/redesign/close routes and the control room all read — but nothing
// ever said which MOVES between them are legal. `updateLifecycle` was an
// unconditional `UPDATE ... WHERE id = ?`: any caller could write any stage over
// any other, and a resumed background run could re-write a stage a human had moved
// past while it was inside a minutes-long LLM step. The walk is monotonic by
// construction (see MAX_LIFECYCLE_STEPS in devcase-orchestrator.ts) — that property
// was asserted in a comment and enforced nowhere.
//
// Shape: the repo's literal-array + derived-union + runtime-guard pattern (tabs.ts,
// i18n/locales.ts). The array is the order the walk visits; the table is the edges.

export const LIFECYCLE_STAGES = [
  "intake",
  "analyzed",
  "designed",
  "awaiting_approval",
  "approved",
  "published",
  "collecting",
  "ranked",
  "promoted",
  "closed",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

const STAGE_SET = new Set<string>(LIFECYCLE_STAGES);

/** Runtime guard — a stage string read back out of SQLite is `string`, not the union. */
export function isLifecycleStage(value: unknown): value is LifecycleStage {
  return typeof value === "string" && STAGE_SET.has(value);
}

// The edges, excluding `closed` (handled below — closing is legal from anywhere).
//
//   intake            → analyzed              runNeedAnalysis
//   analyzed          → designed              runDesignArtifacts
//   designed          → awaiting_approval     the human gate…
//                     → approved              …or the auto-approve path (approveLifecycleCase)
//   awaiting_approval → approved              a human approves
//                     → designed              a human asks for a redesign
//   approved          → published | collecting  publish mints the token; the same step
//                                              lands the walk on `collecting`, so BOTH
//                                              are legal targets (the orchestrator writes
//                                              `collecting` directly, a future
//                                              publish-only writer may stop at `published`)
//   published         → collecting
//   collecting        → ranked                the drain finished with at least one submission
//   ranked            → promoted
//   promoted          → (closed only)
const EDGES: Record<LifecycleStage, readonly LifecycleStage[]> = {
  intake: ["analyzed"],
  analyzed: ["designed"],
  designed: ["awaiting_approval", "approved"],
  awaiting_approval: ["approved", "designed"],
  approved: ["published", "collecting"],
  published: ["collecting"],
  collecting: ["ranked"],
  ranked: ["promoted"],
  promoted: [],
  closed: [],
};

/** Closing is a HUMAN decision available at every live stage (the close route's own
 *  `claimLifecycleClose` compare-and-set is the writer), so it is an edge out of every
 *  stage but `closed` itself rather than a row in the table above. `closed` is terminal:
 *  nothing legally leaves it, which is exactly what makes the close claim idempotent. */
export function canTransition(from: string, to: string): boolean {
  if (!isLifecycleStage(from) || !isLifecycleStage(to)) return false;
  if (to === "closed") return from !== "closed";
  return EDGES[from].includes(to);
}

/** The refusal code an illegal move answers with. Kept as a literal here rather than
 *  imported from api-response.ts: that module is the ROUTE vocabulary and pulls in
 *  next/server, while this one is read by the store layer. `devcase-transitions.test.ts`
 *  pins the two spellings together so they cannot drift. */
export const LIFECYCLE_TRANSITION_ERROR = "DEVCASE_LIFECYCLE_TRANSITION_ILLEGAL";

/** Thrown by `updateLifecycle` when a caller that declared the stage it read
 *  (`expectedStage`) asks for a move the table above does not allow. It carries a
 *  `code` so a route answers `{ error, code }` — the reader localizes off the code —
 *  and the two stages as DATA so the panel can say where the lifecycle actually is. */
export class IllegalLifecycleTransition extends Error {
  readonly code = LIFECYCLE_TRANSITION_ERROR;
  readonly from: string;
  readonly to: string;
  constructor(from: string, to: string) {
    super(`illegal dev-case lifecycle transition '${from}' → '${to}'`);
    this.name = "IllegalLifecycleTransition";
    this.from = from;
    this.to = to;
  }
}
