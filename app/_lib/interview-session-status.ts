// The interview-session status machine, written down once.
//
// `interview_sessions.status` is a five-state machine that /connect, /complete, the
// revoke door and the recruiter surfaces all read — but nothing said which MOVES
// between the states are legal. Every UPDATE in db/interviews.ts hand-wrote its own
// guard (four spellings in one file), and three of them treated `revoked` as live: a
// connect reopened a revoked link, a completion overwrote a revoke that landed after
// its read, and the post-connect writes let credentials reach the browser across a
// revoke. The table below is the one statement of the moves; every status write in
// the store renders its WHERE from it (`statusFromGuard` / `finalizeFromGuard`), and
// `db/interview-session-transitions.test.ts` fails a hand-written guard.
//
// Shape: the repo's literal-array + derived-union + runtime-guard pattern (tabs.ts,
// devcase-transitions.ts). Import-free, so the store and the routes can both read it.

export const INTERVIEW_SESSION_STATUSES = ["created", "in_progress", "failed", "completed", "revoked"] as const;

export type InterviewSessionStatus = (typeof INTERVIEW_SESSION_STATUSES)[number];

const STATUS_SET = new Set<string>(INTERVIEW_SESSION_STATUSES);

/** Runtime guard — a status read back out of SQLite is `string`, not the union. */
export function isInterviewSessionStatus(value: unknown): value is InterviewSessionStatus {
  return typeof value === "string" && STATUS_SET.has(value);
}

/** The status a call is live in. The post-connect writes (agenda, failover provider,
 *  recording consent) require it: the row left it means the link was revoked or the
 *  call was finalized while /connect was still building, and nothing more may land. */
export const LIVE_INTERVIEW_STATUS: InterviewSessionStatus = "in_progress";

// The edges.
//
//   created     → in_progress   the first connect (markInterviewStarted)
//               → failed | completed   a finalize on a link that never went live
//               → revoked       the recruiter pulls the link / a reissue kills it
//   in_progress → in_progress   a reconnect on a live link (a reload; attempts counts it)
//               → failed        a dropped call — reconnectable BY DESIGN
//               → completed     the call finished
//               → revoked       a revoke during the call
//   failed      → in_progress   the retry a dropped call is owed
//               → failed        a second dropped finalize
//               → completed     a successful retry upgrades it
//               → revoked
//   completed   → (nothing)     the transcript is evidence; single-use link
//   revoked     → (nothing)     the recruiter's control over a live, paid credential
//
// `revoked` is terminal for STATUS, but a finalize that arrives after it still
// persists what was said (the browser holds a direct provider connection a revoke
// cannot hang up; the transcript is evidence). That is not a status move — the
// completion write keeps the status with a CASE — so it is `finalizeFromGuard`
// below rather than an edge here, which also keeps a re-revoke a no-op.
const EDGES: Record<InterviewSessionStatus, readonly InterviewSessionStatus[]> = {
  created: ["in_progress", "failed", "completed", "revoked"],
  in_progress: ["in_progress", "failed", "completed", "revoked"],
  failed: ["in_progress", "failed", "completed", "revoked"],
  completed: [],
  revoked: [],
};

export function canInterviewTransition(from: string, to: string): boolean {
  if (!isInterviewSessionStatus(from) || !isInterviewSessionStatus(to)) return false;
  return EDGES[from].includes(to);
}

/** Every status a write targeting `target` may legally start from, in declaration order. */
export function fromStatesFor(target: InterviewSessionStatus): readonly InterviewSessionStatus[] {
  if (!isInterviewSessionStatus(target)) throw new Error(`unknown interview session status '${String(target)}'`);
  return INTERVIEW_SESSION_STATUSES.filter((from) => EDGES[from].includes(target));
}

function inList(states: readonly InterviewSessionStatus[]): string {
  return `status IN (${states.map((s) => `'${s}'`).join(",")})`;
}

/** The WHERE predicate of a status write to `target`, rendered from the table. The
 *  values are the closed vocabulary above (never caller input), so inlining them into
 *  a prepared statement's text is safe. */
export function statusFromGuard(target: InterviewSessionStatus): string {
  const from = fromStatesFor(target);
  if (from.length === 0) throw new Error(`no legal move reaches interview session status '${target}'`);
  return inList(from);
}

/** The WHERE predicate of the COMPLETION write: the from-set of its target plus
 *  `revoked`, whose status that write keeps (see the note above the edges). */
export function finalizeFromGuard(target: InterviewSessionStatus): string {
  const from = fromStatesFor(target);
  return inList(from.includes("revoked") ? from : [...from, "revoked"]);
}
