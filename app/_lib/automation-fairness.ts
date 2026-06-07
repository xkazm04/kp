// Defense-in-depth re-assertion of the auto-reject fairness invariant at the TS
// APPLY boundary. The policy pass (pipeline/jobfit/automation.py `evaluate_entry`)
// decides which active entries get auto-rejected, and automation-pass.ts applies
// those decisions. Until this module existed, the TS layer applied a Python
// `action:"reject"` VERBATIM — so any Python regression that emitted a reject for
// an early-career candidate, an unscored entry, or a score at/above the reject
// floor would be auto-applied, silently violating the fairness guarantee the
// DecisionRulesModal advertises and the spec pins (docs/AUTOMATION_SPEC.md §risks).
//
// THE INVARIANT. `evaluate_entry` only ever returns `action:"reject"` on a single
// path: stage == "Screened", NOT fairness-protected (BAU), a GENUINE match score
// (score > 0, not an unscored data gap), AND that score < bau_reject_score. This
// function re-derives exactly that gate from the entry snapshot the pass already
// holds, so an unfair auto-reject is structurally refused here even if upstream
// rule logic regresses or the entries/decisions contract drifts. A refused reject
// is downgraded to `hold` + an alert (never silently applied) — `hold` routes the
// candidate to the human Decisions gate, which is where a contested reject belongs.
//
// The archetype half reuses the shared fail-closed gate in ./archetypes
// (isFairnessProtected → true for early-career AND any unknown/renamed archetype),
// the same helper screen-wave.ts guards its auto-reject with.

import { isFairnessProtected, isKnownArchetype } from "./archetypes";

// Mirror of Python `POLICY["bau_reject_score"]` (pipeline/jobfit/automation.py):
// the only score below which a BAU candidate is auto-rejected. This is a backstop
// CEILING — a reject at/above it is refused — so it must stay >= the Python floor.
// Both are 40 today; if the Python floor ever rises, raise this with it or this
// backstop will spuriously downgrade legitimate Python rejects. Pinned on the TS
// side by automation-fairness.test.ts, on the Python side by test_automation.py.
export const BAU_REJECT_SCORE = 40;

/** The minimal entry snapshot the fairness re-check reads. AutomationEntry /
 *  PipelineEntry satisfy this structurally. */
export type RejectCheckEntry = { archetype: string | null; matchScore: number | null };

export type AutoRejectVerdict = { allowed: true } | { allowed: false; reason: string };

/** Re-assert the auto-reject fairness invariant for one entry. Returns
 *  `{allowed:true}` only when the policy pass's reject is legitimate — i.e. it
 *  matches the SOLE reject path in `evaluate_entry`: a known, non-protected (BAU)
 *  archetype with a genuine match score strictly below {@link BAU_REJECT_SCORE}.
 *  Anything else returns `{allowed:false, reason}` so the caller can downgrade the
 *  reject to a hold + alert. Fails CLOSED: a missing entry (a decision for an id we
 *  never sent) is never auto-rejected. */
export function assertAutoRejectFair(entry: RejectCheckEntry | null | undefined): AutoRejectVerdict {
  if (!entry) {
    return { allowed: false, reason: "entry not found for fairness re-check — auto-reject refused (fail closed)" };
  }
  if (isFairnessProtected(entry.archetype)) {
    const why = isKnownArchetype(entry.archetype)
      ? `early-career archetype "${entry.archetype}" is shielded from automated rejection`
      : `unknown archetype "${entry.archetype ?? "(null)"}" is shielded from automated rejection (fail closed)`;
    return { allowed: false, reason: why };
  }
  const score = entry.matchScore;
  // An absent / null / 0 score means matching has not produced a genuine result
  // (an unscored data gap, not a real low match) — `evaluate_entry` holds it for
  // matching rather than reading it as 0 and rejecting, so we must too.
  if (score === null || score <= 0) {
    return { allowed: false, reason: "unscored entry (no genuine match score) — must hold for matching, never auto-reject" };
  }
  if (score >= BAU_REJECT_SCORE) {
    return { allowed: false, reason: `match score ${score} is at/above the ${BAU_REJECT_SCORE} reject floor — not an auto-reject` };
  }
  return { allowed: true };
}
