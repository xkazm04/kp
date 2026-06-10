# Feature Scout #2 — Fix Wave 1: "Light up the dormant engine" (Theme A core)

> 6 commits, 6 findings closed (3 High / 2 Medium / 1 Low).
> Baseline preserved: tsc 0 → 0 · next build ✓ · unit 638 → **642** (+4 new) · python 500 OK → 500 OK · eslint clean on all 21 changed files.

One mental model throughout: the engine already computes it — find the drop point, thread it
through the boundary, render it with a backward-compat fallback. No feature in this wave
invented new analysis; every one surfaced analysis that was being thrown away.

## Commits

| # | Commit | Finding | Value | Files |
|---|---|---|---|---|
| 1 | `17c9440` | SCOR2 — analysis quality flags (sanityChecks) | High | 9 (+217/−7) |
| 2 | `3e42989` | SCOR1 — soft-signal panel (antipatterns + hidden strengths) | High | 8 (+286/−48) |
| 3 | `4a6326f` | SCOR3 — explainable potential score | High | 11 (+191/−4) |
| 4 | `40820ca` | MAT2 — named KO blockers on blocked matrix cells | Medium | 6 (+48/−7) |
| 5 | `6271ceb` | JOB4 — not-eligible cohort disclosure with KO reasons | Low | 3 (+42/−1) |
| 6 | `fe8809a` | DEVP6 — dev-case process-trace strip | Low | 2 (+36/−1) |

## What was fixed

1. **SCOR2 — the trust ledger is visible.** The pipeline's per-analysis `sanityChecks`
   (repairs, degradations, self-contradictions) shipped in every payload and zod schema with
   zero renderers — a degraded analysis was visually identical to a clean one. New pure
   classifier `app/_lib/sanity-checks.ts` (warn markers cover every engine emitter, pinned by
   a vocabulary-lockstep test); `QualityStrip` above the result tabs (amber `role=status`
   callout for warns, quiet collapsed line for clean runs); warn count stamped onto a new
   `analyses.review_flags` column at save (RES5's idempotent-ALTER pattern) so the History
   list shows a "⚠ N" pill off the summary SELECT.

2. **SCOR1 — the headline dark capability.** `soft_signals.py` — a complete, unit-tested
   module of antipattern/hidden-strength hypotheses, each with source, confidence and a
   suggested interview probe — had zero production callers. The model classes moved into
   `models.py` (re-exported) to dissolve the import cycle that would have forced an untyped
   dict, so `AnalysisResult.soft_signals` gets a typed zod schema from codegen for free.
   Built in `analyze_cv` under its own `_softly` umbrella. The Interview tab gains a
   "Confirm in interview" section (renders even with no LLM interview kit) with a one-click
   copy-checklist mirroring `to_interview_checklist`'s format.

3. **SCOR3 — potential is auditable.** The explanations behind `potentialScore`
   (learning signals, professional-grade transferable credits, the adjacent/moderate/far
   bridge grade) fed the score math and the LLM prompt but never left Python. `match()` and
   `rank_candidates_for_job` now return them; a shared `PotentialBadge` (expandable popover)
   replaces the bare pills on RecruiterCandidates, the Match results header (which never
   showed potential at all) and GroupEvalModal (via group-eval-run passthrough). Old
   persisted evals degrade to the plain pill.

4. **MAT2 — blocked cells name their gate.** `matrix_cli` computed every blocked cell's
   categorized KO reasons and discarded them; the recruiter saw an undifferentiated dash.
   Blocked cells now carry `koKeys` (stable `KoReason.key` categories), localized client-side
   through `matrix.ko.*` (en+cs) in the cell title/tooltip/aria — "blocked: language" vs
   "blocked: seniority gap" demand opposite recruiter actions.

5. **JOB4 — thin sourcing results explain themselves.** The ranker ships per-candidate
   `koReasons` the UI reduced to a count. A collapsed "Not eligible (N) — see why"
   disclosure lists the cohort, near-misses (single KO reason) first with a badge — the
   candidates a relaxed must-have might rescue. Zero server change.

6. **DEVP6 — the decisions-log contract is checkable.** `processTrace` (commit count,
   cadence, `decisionsLogPresent`) was persisted on every eval bundle "so the contract is
   checkable later" — and rendered nowhere. EvalPanel now shows a kept/missing badge (coral
   when missing), "N commits over X h", and a neutrally-framed "single sitting" chip.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 638 | **642** (+4: sanity-classifier vocabulary tests) |
| `npm run test:python` | 500 OK (4 skip) | 500 OK (4 skip) |
| eslint (changed files) | clean | clean |

## Patterns established (catalogue items 1–4)

1. **Dormant-output surfacing is a three-layer fix with a backward-compat story per layer.**
   Emit at the boundary (CLI dict / model field) → type at the seam (zod/TS) → render with an
   old-data fallback. Every Wave-1 item needed the fallback: pre-change cached grids (MAT2),
   pre-field persisted evals (SCOR3), pre-column rows (SCOR2), pre-trace bundles (DEVP6).
   Skipping the fallback turns a surfacing feature into a regression for existing data.
2. **Pure model classes can move to models.py to dissolve an import cycle; detectors stay
   put and re-export.** soft_signals' classes only needed `_Base` — the cycle was in the
   *functions'* imports. This is the difference between a typed schema for free and another
   untyped `dict` like `v2_profile`.
3. **Localize by stable key, never by engine prose.** `KoReason.key` was minted at birth for
   exactly this; the bilingual UI maps keys through the message catalog and shows engine
   sentences only verbatim-labeled (QualityStrip, soft-signal text). Matching on engine
   English is safe only when documented as deliberately unlocalized (sanity-checks classifier).
4. **Denormalize a derived count at save time for list surfaces.** `review_flags` follows
   RES5's disposition-column pattern: a pure TS classifier runs once at persist, the
   200-row list never scans payload blobs. NULL on old rows = no pill, honestly absent.

## What remains (per the INDEX 10-wave plan)

Wave 1 is complete. The scoring-engine report still holds SCOR4 (real per-stage analyze
progress — also closes the bug-hunt CV#7 deferral) and SCOR5 (probe briefs → dev-case
designer, pairs with DEVP2) as Mediums for later waves. Next recommended: **Wave 2 —
GitHub becomes a first-class signal** (GH1+RES1 merged persistence, GH2 pipeline attach,
GH3 GitHub-only run, GH4 dev-case submitter assessment, GH5 cache+re-run).
