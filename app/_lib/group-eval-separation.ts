// Lead separation for the group evaluation (UAT 2026-07-20, L1-TOM-GEF-01).
//
// matching.py already computes an honest confidence BAND per candidate — the
// spread widens with every source of evidence thinness (early-career, <3 skills,
// unknown education, no languages, missing must-haves) and each widening records
// a recruiter-readable driver. group-eval-run carries that band through to the UI
// on every candidate... and then ranks, crowns and SEALS on the bare point
// estimate alone. So a 2-point gap between two wide, evidence-thin bands is
// presented with exactly the same confidence as a 20-point gap between two tight
// ones, and the sealed record asserts a "recommended lead" either way.
//
// This module answers one question — is the lead genuinely separated from the
// runner-up, or is the gap inside the noise? — using data already in hand.
//
// Deliberately NOT a re-ranking. Reordering candidates by band would be a
// different (and much larger) product decision; the honest score order stays
// exactly as it was. What changes is that the crown, the deterministic summary and
// the sealed record can now STATE the separation rather than implying one. That
// follows this codebase's established line: a build's trust lives in naming its
// own seams (cf. the null-score policy, which reports "unscored" instead of
// fabricating a 0, and the robustness status, which reports "not_varied" instead
// of claiming a check that never ran).
//
// Pure and dependency-free so both the server run path and client components can
// import it under bare `node --test`.

/** The band as carried on a MatchResult (matching.py `Confidence`). Only the
 *  numeric edges matter here; `level`/`drivers` are the UI's to render. */
export type Band = { low: number; high: number };

/** The minimum shape this module needs from an eval candidate. Structural, so an
 *  `EvalCandidate` satisfies it without importing the group-eval types. */
export type BandedCandidate = {
  score: number | null;
  confidence?: Band | null;
};

/** - `separated`  — the lead's band floor clears the runner-up's band ceiling:
 *                   the gap survives both candidates' uncertainty.
 *  - `overlapping` — the bands intersect: the point-estimate gap is inside the
 *                   noise, so "recommended lead" overstates what was measured.
 *  - `unknown`    — no band on one side, no runner-up, or an unscored candidate.
 *                   Absence of evidence is never rendered as a claim either way. */
export type SeparationVerdict = "separated" | "overlapping" | "unknown";

/** Is the lead statistically separated from the runner-up?
 *
 *  Returns `unknown` rather than guessing whenever the inputs can't support a
 *  verdict — an eval saved before bands existed, a job-less role where the ranker
 *  never ran, or an unscored candidate. The boundary is INCLUSIVE: bands that
 *  merely touch (`lead.low === runner.high`) are `overlapping`, because a
 *  zero-width gap is not a separation and this call should never flatter the
 *  crown. */
export function leadSeparation(
  lead: BandedCandidate | null | undefined,
  runnerUp: BandedCandidate | null | undefined
): SeparationVerdict {
  if (!lead || !runnerUp) return "unknown";
  if (lead.score == null || runnerUp.score == null) return "unknown";
  const a = lead.confidence;
  const b = runnerUp.confidence;
  if (!a || !b) return "unknown";
  if (!Number.isFinite(a.low) || !Number.isFinite(b.high)) return "unknown";
  return a.low > b.high ? "separated" : "overlapping";
}

/** The audit/summary sentence for a verdict, in the same English register as the
 *  rest of the sealed group-eval rationale (the persisted audit string is English
 *  by design; the UI localizes its own chrome).
 *
 *  Empty string for `separated` and `unknown` — the caveat is only worth words
 *  when it changes how the crown should be read. A separated lead needs no
 *  hedge, and an unknown separation must not be reported as either. */
export function separationNote(verdict: SeparationVerdict, leadLabel: string, runnerUpLabel: string): string {
  if (verdict !== "overlapping") return "";
  return `Confidence caveat: ${leadLabel} is not separated from ${runnerUpLabel} — their score bands overlap, so this ordering is within the measurement's own uncertainty. Treat the top two as a tie on the evidence available.`;
}
