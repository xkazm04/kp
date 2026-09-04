import { createHash } from "node:crypto";

// Human-approval gate for the screening auto-reject wave (EU AI Act / GDPR Art. 22:
// no SOLELY-automated significant decision). The token is a stable signature of the
// EXACT set the wave would reject under a given policy, AT A GIVEN MOMENT. The
// dry-run preview returns it; a commit must echo it; the server recomputes it from
// the LIVE cohort and refuses the commit unless it matches and is still fresh. So a
// recruiter can only commit a reject set they actually reviewed, a cohort that
// drifted since the preview forces a fresh review rather than rubber-stamping a
// stale, now-different set — and a review made weeks ago can no longer stand in for
// a review made now.
//
// Pure + dependency-free (node:crypto only) so it unit-tests without dragging in the
// DB that screen-wave.ts imports, and so the client never needs it — the modal reads
// the token from the dry-run response, it never recomputes it.

/** How long an approval stays committable. Minutes, not hours: "a human reviewed
 *  this set" is the whole Art. 22 defence, and a review is of a MOMENT — of that
 *  cohort, those scores, that recruiter's attention. 15 minutes is long enough to
 *  read a long preview list, be interrupted, and still commit the set that was on
 *  screen; short enough that nothing meaningful (an interview, new evidence, a
 *  handover) can land inside the window unnoticed. A commit past it is not refused
 *  forever — it costs one re-preview, which is exactly the review being asserted. */
export const SCREEN_WAVE_APPROVAL_MAX_AGE_MS = 15 * 60 * 1000;

/** Stable, order-independent signature of the reject set under a policy, for one job,
 *  as of `issuedAt`. Shape: `<issuedAtEpochMs>.<hash>` — the issue time travels in
 *  cleartext so the server can age-check a token the client echoes back, and is ALSO
 *  inside the hash so it cannot be back-dated without invalidating the signature. */
export function screenWaveApprovalToken(
  jobId: string,
  policyVersion: string,
  rejectIds: string[],
  issuedAt: number = Date.now()
): string {
  const canonical = [...rejectIds]
    .map((s) => String(s).trim())
    .filter(Boolean)
    .sort()
    .join(",");
  const issued = Math.trunc(issuedAt);
  const hash = createHash("sha256").update(`${jobId}|${policyVersion}|${issued}|${canonical}`).digest("hex").slice(0, 32);
  return `${issued}.${hash}`;
}

/** The issue time carried by a token, or null when it isn't one of ours. */
export function screenWaveApprovalIssuedAt(token: string): number | null {
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const issued = Number(token.slice(0, dot));
  return Number.isSafeInteger(issued) && issued > 0 ? issued : null;
}

export type ScreenWaveApprovalCheck = { ok: true } | { ok: false; reason: "malformed" | "mismatch" | "expired" };

// --- SINGLE SPEND (an approval is a review of ONE commit, not a 15-minute licence) ---
//
// verifyScreenWaveApprovalToken proves the token still signs the live set and is fresh.
// It does NOT prove it has not already been committed — and the token is a pure function
// of (jobId, policy, set, issuedAt), so re-POSTing the same body inside the window
// re-derives the same signature and passes every check again. The second commit only
// failed because the first one had emptied the cohort, so the re-derived set no longer
// matched: an ACCIDENT of the wave's own side effect, asserted by nothing. Any commit
// that leaves part of its set standing (a mid-wave drift skip, a seal failure, a comms
// failure that keeps the row) leaves a token that still matches — and a double-click,
// a retried fetch, or a replayed request would run the adverse wave twice on the human
// review of one.
//
// So the token is SPENT on commit: the first commit records it, every later commit with
// the same token is refused with reason "spent" and the recruiter re-previews.
//
// IN-PROCESS, deliberately. The ledger is a Map keyed by the token, holding the token's
// OWN expiry (issuedAt + MAX_AGE) — a spent entry only has to outlive the window in
// which the token would otherwise still verify, so the map self-prunes and cannot grow.
// The honest limit: a multi-process deployment (several `next start` workers) has one
// ledger per worker, so a replay routed to a second worker is not caught there. That is
// a weaker guarantee than a `consumed_at` column, and it is the one we take for now —
// the DB-backed version needs a row keyed on the token beside the seal, which is a
// schema change to a chain table; recorded in docs/features/compliance/ai-act-conformity.md.
const spentApprovals = new Map<string, number>();

function pruneSpentApprovals(now: number): void {
  if (spentApprovals.size === 0) return;
  for (const [token, expiresAt] of spentApprovals) {
    if (expiresAt <= now) spentApprovals.delete(token);
  }
}

/** Spend an approval token. `true` when THIS call consumed it (the commit may proceed);
 *  `false` when it was already spent (a replay). Call it only once every other refusal
 *  has passed — a commit refused for a missing approver must not burn the review. */
export function consumeScreenWaveApprovalToken(token: string, now: number = Date.now()): boolean {
  pruneSpentApprovals(now);
  if (spentApprovals.has(token)) return false;
  const issuedAt = screenWaveApprovalIssuedAt(token);
  // A token with no readable issue time never reaches here (verify refuses it first);
  // fall back to a full window from now so an unexpected shape still cannot be replayed.
  spentApprovals.set(token, (issuedAt ?? now) + SCREEN_WAVE_APPROVAL_MAX_AGE_MS);
  return true;
}

/** Whether a token has already been spent — a read that consumes nothing (tests, and any
 *  future surface that wants to grey out a commit button it can already see is dead). */
export function isScreenWaveApprovalSpent(token: string, now: number = Date.now()): boolean {
  pruneSpentApprovals(now);
  return spentApprovals.has(token);
}

/** Test seam: node --test isolates each FILE in its own process, but not each test inside
 *  it, and the ledger is module state. Reset it between scenarios that reuse a token. */
export function resetScreenWaveApprovalSpendForTests(): void {
  spentApprovals.clear();
}

/** The commit gate: the echoed token must be well-formed, must still sign the LIVE
 *  reject set under the LIVE policy (re-derived with the token's own issue time), and
 *  must not be older than SCREEN_WAVE_APPROVAL_MAX_AGE_MS. A token issued in the
 *  future is treated as malformed rather than fresh — clock skew must not extend the
 *  window. Callers map every failure to the same 409 (re-preview and re-approve). */
export function verifyScreenWaveApprovalToken(
  token: string,
  jobId: string,
  policyVersion: string,
  rejectIds: string[],
  now: number = Date.now()
): ScreenWaveApprovalCheck {
  const issuedAt = screenWaveApprovalIssuedAt(token);
  if (issuedAt === null) return { ok: false, reason: "malformed" };
  if (token !== screenWaveApprovalToken(jobId, policyVersion, rejectIds, issuedAt)) return { ok: false, reason: "mismatch" };
  const age = now - issuedAt;
  if (age < 0) return { ok: false, reason: "malformed" };
  if (age > SCREEN_WAVE_APPROVAL_MAX_AGE_MS) return { ok: false, reason: "expired" };
  return { ok: true };
}

/** WHY a commit was refused at the approval gate. The message is the human sentence;
 *  this is the machine-readable half, so the 409 body says which of the five very
 *  different refusals happened (a spent token is not a changed cohort, and a client
 *  that cannot tell them apart tells the recruiter to re-review a set that did not
 *  move). Closed vocabulary — literal array + derived union + runtime guard. */
export const SCREEN_WAVE_REFUSAL_REASONS = ["required", "expired", "mismatch", "spent", "unattributed"] as const;
export type ScreenWaveRefusalReason = (typeof SCREEN_WAVE_REFUSAL_REASONS)[number];
export function isScreenWaveRefusalReason(value: unknown): value is ScreenWaveRefusalReason {
  return typeof value === "string" && (SCREEN_WAVE_REFUSAL_REASONS as readonly string[]).includes(value);
}

/** Thrown when a commit lacks human approval, its token no longer matches the live
 *  set, the approval has gone stale, it was already spent, or its approver cannot be
 *  named. The route maps it to 409 so the client re-previews and re-approves. */
export class ScreenWaveApprovalError extends Error {
  /** Which refusal this is (see SCREEN_WAVE_REFUSAL_REASONS). Defaults to "mismatch",
   *  the historical catch-all, so an older thrower keeps the pre-existing meaning. */
  readonly reason: ScreenWaveRefusalReason;
  constructor(message: string, reason: ScreenWaveRefusalReason = "mismatch") {
    super(message);
    this.name = "ScreenWaveApprovalError";
    this.reason = reason;
  }
}
