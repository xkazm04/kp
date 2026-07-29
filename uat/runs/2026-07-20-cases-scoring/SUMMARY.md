# SUMMARY — /uat run `2026-07-20-cases-scoring`

**Level:** L1 (theoretical, code-grounded). No browser. L2 deferred — `env.md`'s
candidate-token fixture question is still open, which would make the candidate-side
journeys `unreachable` rather than genuinely failing.

**Scope:** 13 `character × journey` passes · 126 raw findings → **117 consolidated**
(7 blocker · 57 major · 36 minor · 17 polish) in `findings.json`, sorted by impact rank.

**Run questions:**
- **Q1 (Cases)** — can the job/case design discover a candidate's mentality even when they use LLM tools?
- **Q2 (Scoring)** — did we choose the best candidate, or the best-presenting candidate?

---

## Q1 — Yes, the case design discovers mentality. The discovery is never allowed to count.

The premise is stated in code as a *constraint*, not an aspiration
(`pipeline/jobfit/devcase/design.py:70-74,255-262`):

> ASSUME the candidate's code will be 100% LLM-generated… NOTHING in the artifact
> proves authorship. The case's real instrument is AMBIGUITY.

Backing it: 2–4 covert probes each carrying a `decisionSpace` of 2–3 genuinely
defensible options (not one right answer plus distractors), so a submission cannot
avoid encoding a choice; an unforgeable server-fired mid-flight requirement change
that makes one-shot generation structurally impossible
(`app/api/devcase/session/[id]/route.ts:86-102`); planted canaries with known ground
truth plus a frozen naive-LLM baseline solved per case at publish; and `mint_followups`
demoting every score to "a HYPOTHESIS, not a verdict"
(`pipeline/jobfit/devcase/evaluate.py:330-341`).

AI use is **measured as a skill, and that is enforced rather than promised** — the build
fails if AI-verifying candidates score >2 points below non-verifiers, or if an
over-reliance flag lands on an AI user whose behaviour-matched non-AI peer was unflagged
(`submission_eval.py:283-291`). Penalties are authorship-shaped, never tool-shaped.

**Why it doesn't count.** The instrument is default-off in the JD flow
(`JdBuilder.tsx:99`), rendered with `probes`/`decisionSpace`/`midFlightUpdate` stripped
from the ledger type (`LibrarySavedJdsLedger.tsx:974-981`), and unattachable to a posting.
And the decisive synthesis finding — **the only bridge into the scoring engine is closed**:
`mintObservedFromCaseInterview` returns early unless `isEarlyCareer`
(`app/_lib/devcase-run.ts:341`), and `observed` provenance is weight-identical to
`professional` (both 1.0, `taxonomy.py:378-383`), with `has_observed` read only inside
the early-career branch (`matching.py:738-745`).

Separately, the evaluation *surface* under-delivers what the pipeline computes: which
canary propagated, how the candidate drove the model, baseline distance and the tamper
verdict are all computed and then dropped before the screen — `observedChecks` is absent
from `EvalBundle` (`DevTypes.ts:193`) so no component *could* render it, and the integrity
verdict survives only inside a `title=` tooltip (`EvalPanel.tsx:82`).

## Q2 — Best-presenting. By wiring, not by carelessness.

For BAU (non-early-career) candidates the total is skills `.50` / career `.35` /
personal `.15`:

- **`personal`** is a whole-word count of the candidate's own tokens appearing in the ad
  text, over an **ad-derived** denominator with no candidate-side normalisation
  (`matching.py:525-537`) — 40 JD-echoing skills saturate at 1.0 while a five-skill
  specialist caps at 0.6.
- **`skills`** is surface-form matching, credited at an **unearned `professional` 1.0**.
- Only **`career`** (role family + seniority proximity) is articulacy-independent.

A failed skill claim routes to `unproven` rather than `missing` (`matching.py:436-447`),
so over-claiming has no cost. `work_links` and `experience_highlights` are read by **no**
`score_*` function. GitHub evidence is genuinely fetched — real READMEs, commit subjects,
file listings — but **no argument on the scoring CLI can carry it** (`cli.py:24-48`), and
`github_present: false` is a hardcoded literal (`analyze-run.ts:144`), a fossil of a slot
never wired.

Consequence, in Eva's words: a strong-artifacts/plain-CV engineer and a
polished-CV/nothing-behind-it candidate are **not merely mis-ranked — they are
indistinguishable to this surface.**

**And nobody can tell.** Calibration pairs the score against a label the score itself
causes: the outcome is negative when `status='rejected'` (`db/pipeline.ts:339`), and the
screening wave *produces* that rejection by testing the score against a floor
(`screen-wave.ts:254-257`). The predictor causes its own label. A perfectly biased
screener favouring polished CVs would draw a near-perfect reliability diagram.

---

## Dominant theme — the corrective signal is computed, then discarded before the decision

**Verified across 13/13 passes · 18 named instances.** This is not absent machinery. In
every case the right signal is computed, then dropped before it can affect an outcome:

| Corrective | Computed at | Discarded before |
|---|---|---|
| Evidence/provenance-weighted total | `pipeline.py:930-931` | the dial (`JobFitTab.tsx:41`) |
| Fairness mean-rank (de-biasing order) | `matching.py:885-886` | crown/rank/seal (`group-eval-run.ts:613`) |
| Confidence band + drivers | `matching.py:723-767` | `ScreenDecision`, group-eval sort, interview verdict (**0** occurrences in `InterviewTranscriptModal`) |
| Authenticity/integrity verdict | `devcase-run.ts:617-630` | the Python eval prompt |
| Observed-process evidence | `process_events.py:138-156` | `EvalBundle` (`DevTypes.ts:193`) |
| Hesitation/talk-ratio telemetry | `interview-run.ts:463` | the scorer, which ran at `:447` |
| Claimed-but-unproven bucket | `matching.py:431-447` | the shortlist and group eval |
| Score provenance/date/scorer version | `screen-wave.ts:201-203` | the sealed record (`:357-368`) |
| `dev_outcomes.performance` | `dev-outcomes.ts:23-26` | real applicants (`ds-` sim guard at `:186`) |

## Reconciliation sweep (cross-surface — no single pass produces these)

- **RECON-01 — `isEarlyCareer` is a two-tier product, apparently by accretion.** Gated on
  it: BARS rubric anchors, the coachability hint, hint-uptake telemetry, the
  `self_declared` provenance discount (`transform.py:182`), the embedding path, and the
  `observed` bridge (`devcase-run.ts:341`). Juniors get the mentality instrument and the
  honest discount; experienced candidates get unanchored axes and unearned full credit.
- **RECON-02 — a `PROFESSIONAL` badge is rendered for verification never performed**
  (`RecruiterCandidates.tsx:471,563`). Every other item here is an omission; this is an
  affirmative claim. **Highest trust-erosion single item in the run.**
- **RECON-03 — the `professional` default is reached by three routes**, not one
  (`taxonomy.py:394` default · `transform.py:182` early-career-only discount ·
  `candidate-pool.ts:47-73` emits no provenance). No single call-site edit closes it.
- **RECON-04 — disclosure vs behaviour.** The AI disclosure promises assessment of
  "skills, experience and suitability" and a right to human review; 15% of the score is
  verbatim ad-keyword overlap, and the Art. 22(3) right has **no implementation**.

## Contradictions adjudicated

- **Dev-case vs scoring passes are NOT contradictory.** Verified architecturally disjoint
  (`score_job` appears in `devcase/` only for sourcing/corpus). Different subsystems,
  both correct. The sting is that the bridge between them is closed (`devcase-run.ts:341`).
- **REFUTED — the "one line before it could matter" framing** in `CS-L1-03` /
  `EVA-CVJF-L1-03`. The discarded total is scored against a *synthesized* all-must-have
  JD (`pipeline.py:925-931`), so the real fix must use the saved JD's structured
  requirements. The defect is real; the one-line framing is not.
- **CORRECTED — RECON-03** above supersedes single-call-site fix claims.
- **REFUTED — euphemistic reason codes.** Hypothesised and not found: the sealed rationale
  reads "bottom 30% of 41 → 12 (rank 4) and match 38 < 45 threshold", and the closed
  reason-code set contains no soft code anywhere in the path (`screen-wave.ts:63-72,312`).

## Impact-ranked backlog

`[W]` = wiring (machinery exists, point it at the right place) · `[M]` = missing
machinery · `¹` = one/few-line change. **15 of 21 are wiring; 9 are one-line.**

| # | Item | Kind |
|---|---|---|
| 1 | Thread confidence band into `ScreenDecision`, group-eval sort/crown/seal, interview verdict | **[W]** |
| 2 | `DEFAULT_PROVENANCE` at `taxonomy.py:394` — but see RECON-03, all three routes | **[W]¹** |
| 3 | Calibration holdout + real outcome loop | **[M]** |
| 4 | Implement the Art. 22(3) human-review right the disclosure already promises | **[M-small]** |
| 5 | Ungate `observed` provenance from `isEarlyCareer` (`devcase-run.ts:341`) | **[W]¹** |
| 6 | Carry GitHub evidence into the scorer (CLI arg + `AnalyzeParams` + cache key) | **[W]** |
| 7 | Clickable reject row (stack the existing `AnalysisSummaryModal`) + per-row spare folded into the approval token | **[W]** |
| 8 | `notes[:4000]` double-truncation at `automation.py:743` | **[W]¹** |

Also flagged for a product decision rather than a patch: the candidate's name is sent
un-redacted to the LLM that tunes that candidate's own scoring weights
(`weight_proposal.py:40-52`); the buzzword authenticity check is English-wordlist-only, so
a Czech CV cannot trip it (`authenticity.py:25-31`).

## Value ledger — promise vs live

| Journey | Time saved (est.) | Grounding |
|---|---|---|
| dev-case-hire (Eva) | 195 min | 15/21 · what reaches Eva's screen **4/9** |
| dev-case-hire (Sam) | 120 min | 6/9 |
| analytics-calibration | 300 min | 4/10 as selection-quality validation |
| screening-decisions (Lucie) | 135 min | 4/10 |
| screening-decisions (Marek) | 110 min | 4/10 |
| group-eval-fairness (Lucie) | 105 min | fairness evidence **2/6** |
| jd-to-shortlist (Jana) | 45 min | **2/8** |
| group-eval-fairness (Tomáš) | 38 min | 7/14 |
| voice-interview (Petra) | 35 min | journey **6/16** |
| voice-interview (Tereza) | 50 min | 8/15 |
| cv-analysis-jobfit (Eva) | 40 min | 6/9 |
| jd-to-shortlist (Petra) | 22 min | 3/9 |
| **cv-analysis-jobfit (Petra)** | **8 min** | 5/9 — adoption-level finding in its own right |

## Strengths worth protecting — do not touch

- **The falsifiable AI-fairness build gate** (`submission_eval.py:283-291`) — a runnable
  invariant, not a promise. Genuinely unusual.
- **Mechanistically honest reason codes** — add evidence *beside* them; never soften them.
- **Fail-closed human-in-the-loop**: signed approval token over the exact reject set,
  409 + re-preview on drift, client-asserted approver ignored, dry-run mutation-free.
- **The hallucinated-skill gate** — removes withheld skills *and* names what it withheld.
  (Ceiling: it gates the MODEL against the CV, not the CANDIDATE against reality.)
- **The "artifact proves nothing" case-design premise** — the strongest idea in the codebase.
- **Honesty gating that refuses to claim untested robustness** ("netestováno", not "passed"),
  and calibration copy that says "actual advance rate" rather than "accuracy".
- **`priorDepthBoost`** (`rediscovery-rank.ts:38`) — the one place verified evidence moves
  real order, band-limited and disclosed. **This is the template for fixing the base scorer.**

## Honest ceilings — true even after every fix above

- The holdout makes only **post-holdout** candidates measurable; the historical corpus
  stays contaminated by label leakage.
- The **false-negative rate** — the candidate rejected here who thrived elsewhere — remains
  structurally unmeasurable without an external signal the product does not have.
- Provenance stays **LLM-assigned from CV prose** (`profile.py:95`), so "verified" remains a
  model's reading of a self-authored document unless an artifact channel is wired.
- **Articulacy bias remains invisible to every shipped check**: the fairness matrix varies
  weights, not inputs, so it cannot see it by construction.

## Panel verdict

> **"Adopt it as a reader. Refuse it as a judge. Someone here knows how to build the
> judge — they just haven't connected it."**

## L2 priority list (when the token fixture lands)

1. A/B the core question: plain-CV + strong repos vs polished-CV + no repos, one JD — does B outrank A?
2. Author a real ČS role; count must-haves Petra rewrites by hand; tick case design and confirm the attach dead-end.
3. Plant a CV-only exaggeration absent from the JD; confirm it surfaces nowhere.
4. Drive Sam's token end-to-end; assert the eval cites HIS observed events, and that submit acknowledges.
5. Open the wave, move the threshold, confirm nothing mutates until commit; reconsider one reject.
6. Read a live report as a rejection email; record what evidence is actually quotable.
