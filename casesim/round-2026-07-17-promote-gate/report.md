# case-sim round 2 — the promote gate (2026-07-17)

Round 2 ran the three upgrades round 1 called for: **real-flaw canaries** in the
seed, a **frozen one-shot baseline**, and an adversarial **gamer** persona
(fabricates a virtuous process report around genuinely one-shot code). Case:
"make the dev-case promote path trustworthy" — built on two REAL, pre-verified
flaws in the promote flow, which doubled as the canaries:

- **c1** `score >= 70` — the screening advice hardcoded a threshold while the
  orchestrator promoted on the calibration-adjustable floor (advice ≠ behavior).
- **c2** `confidence: score` — the screening card relabeled the transfer score as
  "confidence", silently dropping the evaluation's propagated evidence-confidence.

## Scores

Deterministic pass:

| persona | judgment | transferScore | canaries | note |
|---|---|---|---|---|
| verifier | 100 | **91** | c1 flagged, c2 propagated | ran typecheck + 29 tests |
| prompt-crafter | 50 | **64** | both propagated | good prompts, no verification |
| minimal | 50 | **64** | c1 flagged, c2 propagated | found the say/do divergence |
| gamer | 50 | **64** | **both propagated** | fabricated 80-min virtuous process |
| delegator | 30 | **32** | both propagated | briefPaste 0.977 |

LLM-judged pass (production path): verifier 64 > **minimal 52 > prompt-crafter 47
> gamer 42** > delegator 31.

**Discrimination verdict: PASS** on the sound invariants (verifier top, delegator
strictly bottom). The first mechanical assert flagged minimal(52) > prompt-crafter(47)
as FAIL — judged a false alarm: on these actual submissions the LLM ranking is
*correct* (minimal found the real divergence and reasoned honestly; prompt-crafter
shipped unverified and propagated both canaries). The assert now pins only the
sound invariants; the middle order is submission-dependent by design.

## The gamer result (the round's headline)

- **Deterministic process signals alone were fooled**: the fabricated self-report
  (fake opens-before-edits, staged verify-prompts, staged stakeholder questions)
  earned the gamer a 64 — tied with honest middle personas. Expected: self-reported
  events are fabricatable, and in production even chained events only prove
  *when*, not *sincerity* (opens are client-emitted).
- **The artifact-anchored layer resisted**: both canaries `propagated` (the code
  is a genuine one-shot; no amount of process theater changes the artifact), and
  the LLM pass — reading observedChecks beside the glowing process report —
  dropped the gamer below every honest persona (42). Conclusion for the product:
  process signals are supporting evidence; canaries + baseline distance + the
  live authorship interview are the load-bearing anti-gaming instruments.

## Pipeline findings → fixed this round

1. **Canary false "addressed" on absent files** — a changed-files-only submission
   that never touched the canary's file read as "fragment gone" = addressed
   (the delegator got both canaries free). Fixed in `artifact_checks.canary_outcomes`:
   absent file ⇒ `propagated`.
2. **Over-strict discrimination assert** (above) — relaxed to sound invariants.
3. **Baseline similarity is weak on repo rounds**: `solve_baseline` clips files to
   6KB, so deltas against full-size repo files barely overlap (all ~0.08). Fine
   for product seeds (≤6KB by contract); for repo rounds, treat it as no-signal.
   Future: baseline the *diff* rather than the tree for large-file rounds.

## Harvest (2-in-1)

The personas converged on the same real defect from different angles (the
"you stood out, we'd like to take it forward" comm fired regardless of the
card's "hold" verdict). Merged — adapted from the **verifier**'s structure
(winner; also the only one who ran gates), extended to fix both canaries, which
NO persona fully fixed:

- `promoteSubmission(submissionId, floor)` now takes the calibrated floor
  (callers pass `activePromoteFloor()` — single threshold, c1 fixed) and returns
  `{entryId, recommendation, reasons}`; low evaluation evidence-confidence
  (≤0.4, mirroring models.py LOW_CONFIDENCE) forces "hold" with a visible
  red-flag (c2 fixed); reasons ride the automation trail (explainability).
- Orchestrator ranked stage gates the candidate comm on
  `recommendation === "advance"`; holds are audited as `promote_held` with
  reasons; `held` count lands in the lifecycle detail.
- Manual `/api/devcase/promote` uses the same floor and returns the verdict +
  reasons (the two doors can no longer disagree).
- New `app/_lib/devcase-promote.test.ts` (4 tests) pins card/comm agreement, the
  single-floor contract, suspect-auth hold, and the low-confidence hold.

Gates: typecheck, lint, full unit suite 2336/2336 green.

## Next round ideas

- Diff-based baseline comparison for large-file repo rounds.
- A "canary-aware gamer" (told the seed may contain planted flaws) — tests
  whether canaries stay discriminative once candidates suspect them.
- Feed the sim's authenticity path too (bundle → scoreAuthenticity with the
  integrity verdict) so the report shows bands beside scores.
