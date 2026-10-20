// Natural-language pipeline command bar (#7) — the PURE, tested parse layer (the
// only genuinely new capability; the actions it maps to already exist, with
// fairness backstops + supervised mode). A deterministic intent matcher over a
// small, safe command set; every MUTATING intent is preview-then-confirm at the
// route, so nothing executes without the recruiter seeing the affected set first.
// An LLM fallback for free-form phrasing can wrap this (parse here first, defer to
// a model only on `unknown`) — kept out of the core so it stays import-free/tested.

import { compareByMatchScoreDesc } from "./match-score";
import { DEFAULT_STAGE_AXIS, stageHasRole, type StageDef } from "./pipeline-stages";
import type { PipelineEntry } from "./db/core";

export type ParsedCommand =
  | { kind: "reject_below"; threshold: number; jobQuery: string | null }
  | { kind: "advance_top"; count: number }
  | { kind: "run_policy" }
  | { kind: "help" }
  | { kind: "unknown"; text: string };

// Bounds so a parsed command can never request something absurd (a 0% reject that
// matches everyone, or "advance top 9999"). The route re-clamps defensively too.
const MAX_ADVANCE = 50;

function clampThreshold(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(100, Math.max(1, Math.round(n)));
}

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_ADVANCE, Math.max(1, Math.round(n)));
}

/** Parse a recruiter's typed command into one of the known intents, or `unknown`
 *  (which the UI shows as "didn't catch that" + examples). Deterministic and
 *  order-sensitive: the most specific patterns are tried first. Never throws. */
export function parseCommand(input: string): ParsedCommand {
  const text = (input ?? "").trim();
  if (!text) return { kind: "unknown", text: "" };
  const lower = text.toLowerCase();

  if (lower === "help" || lower === "?" || lower === "commands") return { kind: "help" };

  // "reject everyone/all/candidates below 60%[ on backend]" — the % is optional.
  const reject = lower.match(/reject\b.*?\bbelow\s+(\d{1,3})\s*%?/);
  if (reject) {
    const threshold = clampThreshold(Number(reject[1]));
    // Optional "on <role/job query>" tail scopes it to a matching job title.
    const onMatch = text.match(/\bon\s+(.{1,60})$/i);
    const jobQuery = onMatch ? onMatch[1].trim() : null;
    return { kind: "reject_below", threshold, jobQuery };
  }

  // "advance the top 3" / "advance top 5 candidates"
  const advance = lower.match(/advance\b.*?\btop\s+(\d{1,3})/);
  if (advance) return { kind: "advance_top", count: clampCount(Number(advance[1])) };

  // "run the policy pass" / "run automation"
  if (/\brun\b.*\b(policy|automation)\b/.test(lower)) return { kind: "run_policy" };

  return { kind: "unknown", text };
}

/** A short, human-readable echo of what a parsed command will do — shown above the
 *  preview so the recruiter confirms intent, not just a candidate count. */
export function describeCommand(cmd: ParsedCommand): string {
  switch (cmd.kind) {
    case "reject_below":
      // "and notify" is load-bearing copy, not flourish: the execute path now
      // queues a rejection comm per candidate (UAT M3), so the preview must tell
      // the operator these candidates will be contacted, not silently dropped.
      return cmd.jobQuery
        ? `Reject and notify active candidates scoring below ${cmd.threshold}% on roles matching "${cmd.jobQuery}".`
        : `Reject and notify active candidates scoring below ${cmd.threshold}%.`;
    case "advance_top":
      // "up to Offer" is load-bearing copy: the execute path holds Offer-stage
      // targets instead of bare-advancing them to Hired (a hire happens only when
      // the candidate accepts an extended offer), so the preview must say so.
      return `Advance the top ${cmd.count} active candidate${cmd.count === 1 ? "" : "s"} by match score (up to Offer — candidates at Offer await the offer flow).`;
    case "run_policy":
      return "Run the deterministic automation policy pass now.";
    case "help":
      return "Commands you can type.";
    case "unknown":
      return "Didn't catch that.";
  }
}

/** Whether an intent mutates state (so the route requires an explicit confirm). */
export function isMutating(cmd: ParsedCommand): boolean {
  return cmd.kind === "reject_below" || cmd.kind === "advance_top" || cmd.kind === "run_policy";
}

/** The candidate set a mutating command would touch (the preview), resolved over a
 *  GIVEN entry list. PURE + read-only — never mutates. TENANCY: the caller passes
 *  `listPipeline(workspaceId)`, so the scope is the CALLER's workspace; because the
 *  execute path acts ONLY on what this returns, scoping the input list is what keeps
 *  the NL command bar inside one tenant (it previously read the default workspace).
 *  Empty for run_policy — it has no candidate preview (it runs the whole
 *  deterministic pass with its own fairness backstops). */
export function affected(
  cmd: ParsedCommand,
  entries: PipelineEntry[],
  // The caller's board. Defaults to the shipped axis so this stays a pure module
  // its existing callers can use unchanged.
  axis: readonly StageDef[] = DEFAULT_STAGE_AXIS
): PipelineEntry[] {
  const active = entries.filter((e) => e.status === "active");
  if (cmd.kind === "reject_below") {
    const q = cmd.jobQuery?.toLowerCase() ?? null;
    return active.filter(
      (e) =>
        e.matchScore != null &&
        e.matchScore < cmd.threshold &&
        (!q || (e.jobTitle ?? "").toLowerCase().includes(q))
    );
  }
  if (cmd.kind === "advance_top") {
    // "Top N" is meaningful only over measured candidates: the filter excludes
    // unscored entries (fail closed — same null-score policy as the screen wave),
    // and the shared comparator ranks without ever fabricating a 0.
    return [...active]
      .filter((e) => e.matchScore != null && !stageHasRole(e.stage, "terminal", axis))
      .sort(compareByMatchScoreDesc)
      .slice(0, cmd.count);
  }
  return [];
}

/** Bind a `reject_below` confirm to the exact cohort the recruiter reviewed
 *  (bug-ui pipeline #3). Preview and execute each independently query LIVE DB
 *  state, so between the two POSTs a newly-scored applicant can slip below the
 *  threshold and be rejected + emailed WITHOUT ever appearing in the preview the
 *  operator vetted — a TOCTOU on the pipeline's most destructive, irreversible
 *  action. The confirm therefore carries the previewed id set, and the execute
 *  acts ONLY on ids that were BOTH previewed AND still match now:
 *    - act:        previewed ∩ still-matching — reject exactly what was shown.
 *    - droppedOut: previewed − still-matching — shown, but advanced/rejected/no
 *                  longer below the line in the gap; skipped and reported.
 *  Ids that newly match but were never previewed are silently excluded — that is
 *  the whole contract: a confirm can only ever reject a SUBSET of what was shown,
 *  never a candidate the recruiter never saw. `act` preserves previewed order and
 *  is de-duplicated defensively. */
export function resolveRejectTargets(
  previewedIds: readonly string[],
  stillMatchingIds: readonly string[]
): { act: string[]; droppedOut: string[] } {
  const matching = new Set(stillMatchingIds);
  const seen = new Set<string>();
  const act: string[] = [];
  const droppedOut: string[] = [];
  for (const id of previewedIds) {
    if (seen.has(id)) continue;
    seen.add(id);
    (matching.has(id) ? act : droppedOut).push(id);
  }
  return { act, droppedOut };
}

// ---- Undo a command-bar reject wave (challenge-r05 pipeline-actions-commands/B) ----
//
// A typed `reject below 40%` closes out (and emails) a whole cohort in one confirm.
// The undo restores the wave's still-untouched members to the stage they stood on.
// "Still untouched" is read off the record, not guessed: the candidate is still
// rejected AND the newest decision on their timeline is THIS wave's reject. The only
// events allowed to sit on top of it are the rejection letter's own trail — the
// letter going out (or failing to) is a consequence of the wave, not a later decision.

/** The detail every command-bar reject writes to its `rejected` event. ONE literal,
 *  shared by the writer (execute.ts) and the matcher (planWaveReversal), so the undo
 *  can never drift from what the wave recorded. */
export function commandRejectDetail(threshold: number | undefined): string {
  return `Command bar: below ${threshold}%`;
}

/** Events a rejection writes AFTER itself without a new decision being taken. */
const REJECTION_TRAIL_KINDS: ReadonlySet<string> = new Set(["rejection_sent", "rejection_comms_failed"]);

export type WaveReversalEvent = { kind: string; detail?: string | null; toStage?: string | null };
export type WaveReversalSnapshot = { status: string; eventsNewestFirst: readonly WaveReversalEvent[] };
export type WaveReversalPlan =
  | { restorable: true; notified: boolean }
  | { restorable: false; reason: "not_rejected" | "not_this_wave" };

/** The newest event on the timeline that is a DECISION rather than the rejection
 *  letter's trail — the one an undo must find to be this wave's reject. */
export function newestDecisionEvent(eventsNewestFirst: readonly WaveReversalEvent[]): WaveReversalEvent | null {
  return eventsNewestFirst.find((e) => !REJECTION_TRAIL_KINDS.has(e.kind)) ?? null;
}

/** Whether ONE entry can be restored by undoing the wave rejected at `threshold`.
 *  PURE. The store re-runs it inside its write lock over a fresh read.
 *  - status must still be `rejected` (someone who reinstated, advanced or erased the
 *    candidate since has already made the call) -> otherwise `not_rejected`;
 *  - the newest decision must be a HUMAN `rejected` carrying this wave's exact
 *    detail — a hand reject, another threshold's wave or a machine rejection is never
 *    undone by this door -> otherwise `not_this_wave`;
 *  - `notified` = a `rejection_sent` sits after that reject: the letter went out, and
 *    no outbox state can recall it, so the undo reports it instead of implying it
 *    was never sent. */
export function planWaveReversal(snapshot: WaveReversalSnapshot, threshold: number): WaveReversalPlan {
  if (snapshot.status !== "rejected") return { restorable: false, reason: "not_rejected" };
  const decision = newestDecisionEvent(snapshot.eventsNewestFirst);
  if (!decision || decision.kind !== "rejected" || decision.detail !== commandRejectDetail(threshold)) {
    return { restorable: false, reason: "not_this_wave" };
  }
  const i = snapshot.eventsNewestFirst.indexOf(decision);
  const notified = snapshot.eventsNewestFirst.slice(0, i).some((e) => e.kind === "rejection_sent");
  return { restorable: true, notified };
}
