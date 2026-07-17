# Hiring Automation & Scheduler — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 4 medium, 0 low)

## 1. screen/scorecard prompts are localized but their cache keys ignore the locale — two "which tasks key on lang" authorities have drifted
- **Severity**: High
- **Lens**: ambiguity
- **Category**: cache-axis-drift
- **File**: `app/_lib/automation-cache-key.ts:25`
- **Scenario**: An org switches its app language (or a recruiter with a different UI locale hits Regenerate) after a screening rationale or interview scorecard was generated. The Python prompt receives the new `--lang` (automation-run.ts:228 pushes `uiLang` for `UI_LANG_TASKS = {prep, screen, scorecard}`), but `computeAutomationCacheKey` only folds `lang` for `LANG_KEYED_TASKS = {prep, outreach, rejection, offer}` — so screen and scorecard hit the old-language cache entry and serve the wrong-language narrative for up to the 168h TTL.
- **Root cause**: Two sets that must mirror each other drifted: `UI_LANG_TASKS` (automation-run.ts:66, whose comment explicitly claims "It is also a cache axis so a locale change can't serve a cached wrong-language narrative") vs `LANG_KEYED_TASKS` (automation-cache-key.ts:25, missing screen/scorecard). The pinning test (automation-cache-key.test.ts:147-153) asserts screen ignores lang with the rationale "screen's verdict is language-free" — stale since `language_directive(lang)` was added to the screen prompt (automation.py:353) and the scorecard prompt (automation.py:781); neither `SCREENING_PROMPT_VERSION` ("screening-v1") nor the lang sets were updated.
- **Impact**: Exactly the defect the comments claim is fixed: a locale change serves a cached wrong-language screening rationale / scorecard summary in Decisions for up to 7 days. Worse, the GITHUB_EVIDENCE_TASKS pattern proves the codebase knows how to keep "prompt input" and "cache axis" in one set — this pair silently violates that pattern.
- **Fix sketch**: Add `screen` and `scorecard` to `LANG_KEYED_TASKS` (or better: export one `LANG_TASKS` union consumed by both automation-run's `--lang` gating and the key, the GITHUB_EVIDENCE_TASKS pattern), bump `screening-v1`→`screening-v2` and the scorecard version so pre-fix cached entries self-invalidate, and update the stale test assertion to `notEqual` for screen/scorecard.

## 2. Dry-run preview summary contradicts what a commit actually does: previewed "rejected" become committed "held/queued", and alert counts ignore the per-day dedup
- **Severity**: High
- **Lens**: ambiguity
- **Category**: preview-commit-divergence
- **File**: `app/_lib/automation-pass.ts:238`
- **Scenario**: An operator clicks the dry-run preview (AUTO3, `{"dryRun": true}` on /api/automation/run) and reads "rejected: 3, held: 5, alerts: 8". They commit, and the committed run reports "rejected: 0, held: 8" — because since AUTO1 was retired, the commit loop never applies a reject: every fairness-cleared reject is downgraded to a queued `rejection_review` and counted in `summary.held` (lines 300-312), while the dry-run branch still counts it in `summary.rejected` (line 238). Alerts diverge too: the preview counts every alert on every decision (line 243), the commit only counts alerts not already recorded today (`hasEventToday`, lines 318-323).
- **Root cause**: The "preview must match commit" guarantee (the block comment at lines 27-35, pinned to docs/AUTOMATION_SPEC.md §risks) was faithfully wired for the fairness verdict via the shared `applyFairnessVerdict`, but the later AUTO1-retirement (queue-instead-of-apply) and the alert dedup were only implemented in the commit loop; the dry-run loop still models the pre-retirement semantics.
- **Impact**: The one surface built to let a human "look before commit" forecasts an outcome the system can no longer produce ("N candidates will be rejected") — the operator either panics ("automation is about to email 3 rejections!") or, once they learn the preview lies, stops trusting it. Preview decisions also lack the `outcome`/"Queued for approval" annotation, so the per-decision rows diverge from committed rows in the run log.
- **Fix sketch**: In the dry-run branch, mirror the commit semantics: a fairness-cleared reject sets `d.outcome = "queued"`, prefixes the reason ("Would be queued for approval: …"), and bumps `summary.held` — leaving `summary.rejected` permanently 0, matching the commit invariant. Apply the same `hasEventToday` gate (read-only) when counting preview alerts, or rename the preview field to `alertsRaw` so the two numbers can't be read as the same metric.

## 3. Offer fallback salary bands are CZK-calibrated constants but get labeled in whatever ACTIVE_MARKET's currency is
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: currency-magnitude-mismatch
- **File**: `pipeline/jobfit/automation.py:912`
- **Scenario**: A deployment re-homes the market config (the code explicitly supports this — `_system_prompt` and `currency = ACTIVE_MARKET.currency` were de-Czech'd for it). A job with no `salary_band` triggers the `_SENIORITY_DEFAULT_BAND` fallback: a "senior" gets an offer of ~95,000–140,000 — drafted, rationalized, and mailed as "95,000 EUR gross monthly" because line 933 stamps `ACTIVE_MARKET.currency` onto numbers that are koruna magnitudes (the comment at line 911 says so: "Fallback bands (CZK/month gross)").
- **Root cause**: The currency *label* was made market-aware (automation.py:930-933) but the fallback *magnitudes* stayed hardcoded Czech-market constants; nothing ties `_SENIORITY_DEFAULT_BAND` to the market config the label comes from.
- **Impact**: A wrong-by-25x compensation figure in a candidate-facing offer letter — the single most expensive kind of automation error (candidate accepts, or screenshots it). The eval's `_check_offer` only verifies `lo <= rec <= hi`, so it structurally cannot catch this.
- **Fix sketch**: Move the seniority fallback bands into `MarketConfig` (beside `currency`/`home_lang`) so a re-homed market must state its own bands; or fail safe — when a job has no salary_band and `ACTIVE_MARKET` is not the Czech default, return a draft with `recommended: null` and a "no band configured" rationale that routes to the human offer_review gate instead of inventing a number.

## 4. The commit loop's own comments still describe the retired unattended "auto" reject mode as live
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: stale-mode-narrative
- **File**: `app/_lib/automation-pass.ts:288`
- **Scenario**: A developer reading the reject branch hits "in supervised 'approve' mode (the default) the fairness-cleared reject is QUEUED for a human click instead of applied; only 'auto' mode applies + emails it unattended" (lines 287-289) and goes hunting for the mode switch — which no longer exists: the AUTO1-RETIRED comment 35 lines earlier (lines 250-253) says the opt-in `auto` mode "is gone", and scheduler-store.ts:59-66 keeps `reject_mode` only as a never-read column.
- **Root cause**: The AUTO1 retirement rewrote the behavior and the header comment but left the older mode-aware comment inside the reject branch (and the ROI ledger still prices the now-unproducible `auto_rejected` event at automation-roi.ts:22).
- **Impact**: The comment asserts the exact opposite of a GDPR-Art.22-motivated invariant ("nothing adverse is decided automatically"). A future dev could reasonably re-wire an "auto" path believing it's a supported, merely-non-default mode — silently breaking the candidate disclosure the retirement exists to keep true.
- **Fix sketch**: Delete/rewrite the lines 286-289 comment to state the unconditional rule ("every fairness-cleared reject is queued; there is no unattended mode"). Annotate `MINUTES_SAVED_PER_KIND.auto_rejected` as historical-events-only, and add a one-line pointer on the `reject_mode` column to the retirement note so all three artifacts tell the same story.

## 5. The auto-score sweep's bare `"ds-"` prefix filter is undocumented at its one load-bearing site — and a zero-score dev-case entry deadlocks on a promise the sweep will never keep
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-prefix-edge-case
- **File**: `app/_lib/automation-pass.ts:136`
- **Scenario**: `scoreUnscoredEntries` excludes `e.candidateId.startsWith("ds-")` with zero explanation (every other "ds-" site — dev-outcomes.ts:176, student-interview.test.ts:107 — documents that it marks promoted dev-case submissions with no CV-pool profile). Meanwhile promotion sets `matchScore: sub.transferScore ?? Number(transfer.transferScore ?? 0)` (devcase-run.ts:628,648) — so a submission whose transfer score is 0 lands in Screened with score 0, which `evaluate_entry` deliberately reads as *unscored* ("screened without a match score; awaiting match", automation.py:299-302), and the sweep that exists to break exactly this deadlock is forbidden from touching it.
- **Root cause**: Two independent, individually-sound conventions collide: "score 0 means unscored, hold for matching" (automation.py:258-259) and "ds- entries can't be pool-scored, skip them" — with no comment at automation-pass.ts:136 stating the second, and no path that ever resolves the first for a ds- entry.
- **Impact**: A zero-transfer-score dev-case candidate is held every pass, forever, with a reason ("awaiting match") that promises a matching step which structurally cannot run — invisible success-theater in the run log, and a magic prefix the next maintainer has to reverse-engineer.
- **Fix sketch**: Document the filter in place ("ds- = promoted dev-case submission; no pool profile to rank — see devcase-run.promoteSubmission"). For the deadlock, make evaluate_entry (or the sweep) treat a ds- entry's score 0 as a genuine floor value rather than "unscored" — e.g. promote with `matchScore: Math.max(1, score)` or route score-0 ds- entries to the human Decisions gate with an honest "no automatable score" reason.

## 6. Scorecard "not assessed" is encoded as a genuine mid rating of 3, indistinguishable in the numbers downstream consumers aggregate
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: sentinel-value-conflation
- **File**: `pipeline/jobfit/automation.py:754`
- **Scenario**: The scorecard prompt instructs "If the transcript does not cover a competency… rate it 3 (not assessed)", and the coercer fills every unmatched rubric axis with `rating: 3, evidence: "Not assessed."` (automation.py:817-825; the full deterministic fallback emits a straight-3s card). A recruiter — or the compare grid averaging cohort ratings — sees a 3, the same number as a genuinely evidenced "meets bar" rating; only a prose string in `evidence` distinguishes them.
- **Root cause**: The 1-5 scale has no out-of-band value for "no signal", so the neutral midpoint was overloaded as the sentinel. The `_scorecard_confidence` band (automation.py:652-668) partially compensates at the whole-card level, but per-axis the conflation survives into `ratings[]`, which is exactly what gets compared across candidates.
- **Impact**: A thin transcript silently converges every candidate toward a uniform 3.0 average — a nervous candidate with two strong evidenced 5s and four not-assessed axes scores the same mean as a mediocre fully-assessed one. Cross-candidate comparability (the stated point of the fixed rubric) quietly degrades, and nothing in `_check_scorecard` can notice.
- **Fix sketch**: Emit `rating: null` (or an explicit `assessed: false` flag) for uncovered axes and teach consumers to exclude them from means, rendering "n/a" chrome instead; keep 3 only for genuinely evidenced middle ratings. If the payload shape is pinned, add `assessedCount`/`notAssessed: [competency]` beside `ratings` so aggregators can subtract the sentinels without string-matching `"Not assessed"`.
