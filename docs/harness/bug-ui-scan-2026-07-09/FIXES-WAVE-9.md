# Fix Wave 9 — Dev-case pipeline & Python CLI/LLM robustness (7 Highs)

> 3 commits (`463c24d`, `124d992`, `79f660d`), **7 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1500 → **1504** · python 860 → **878** OK · i18n 3239×4 · `next build` ✓.

Two clusters: the dev-case calibration/authoring pipeline (a pilot destroying the frozen
corpus, a stale resume cache, mutable published seeds, injected JSON winning scoring), and
Python robustness (one bad row aborting a whole batch, oversized files reaching the LLM, an
unbounded retry budget).

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `463c24d` | pipeline-clis #1, cv-extraction #5, llm-provider #2 | Skip-and-log a malformed corpus row; size-gate before Gemini upload; one overall retry deadline that flushes the ledger before aborting. |
| `124d992` | dev-case-pipeline #1, #2, #3 | `calibrate` reuses the frozen corpus (`CorpusFrozenError` fail-safe); resume keyed on (id, model, prompt-version); `expected_keys` at every devcase scoring call site. |
| `79f660d` | dev-case-authoring #1 | Write-once CAS seed freeze at publish; a resume can't mutate a live case's seed. |

## Highlights

**A pilot destroyed the blessed corpus.** `calibrate --count 12` unconditionally rewrote the
frozen 100-JD `jobs.json` — the canonical corpus `--freeze` blessed. Now it reuses the frozen
file by default and refuses to shrink one (`CorpusFrozenError`, override `--force`).

**A stale resume certified the wrong model.** `--resume` was keyed by positional id only, so
re-calibrating on a new model returned old cached cases and the gate certified a model that
never generated them. Now keyed on (id, model, prompt-version) — a mismatch regenerates.

**Injected JSON won scoring.** No devcase caller passed `expected_keys`, so a trailing
prompt-injected object won `_extract_json` (pre-fix it scored a deterministic 61 vs the genuine
12). Wired at all six devcase scoring sites; the shared `expected_keys` param plumbing landed in
the robustness commit that precedes it.

**Published seeds were mutable.** A case's seed was materialized after the token went live and
re-materialized on resume, so two candidates on one case could get different seeds. Now frozen
write-once at publish (`saveDevCaseSeedIfAbsent`), gated on the live token.

**One bad row aborted the batch.** A single malformed job in a `--jobs-json` override 500'd the
whole Match/Fit-Matrix run — asymmetric with the per-candidate isolation the CLI already had. Now
skip-and-log with a `missingJobs` output; the other N-1 score.

**Oversized files reached Gemini** because `_extract_pre_pass` swallowed the 25 MB rejection —
now a hard gate before `read_bytes()`.

**The retry budget was per-attempt** (~3× wall-clock, lost ledger on SIGKILL) — now one overall
deadline that emits the metering error before raising.

## Concurrent-edit note

Both Python agents edited `pipeline/jobfit/llm/base.py` (the devcase `expected_keys` param and the
robustness overall-deadline). They reconciled cleanly — both features present, 878 tests pass —
because each re-read before editing. The commit split orders the robustness commit first so it
carries the shared file with the (inert) `expected_keys` param, and the devcase commit wires the
call sites; `#3`'s param and call sites thus span two commits, noted in both.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| node unit | 1500 | **1504** |
| python | 860 OK | **878 OK** |
| i18n | 3239 × 4 | 3239 × 4 |

Every fix non-vacuous by revert-run-restore, several with concrete before/after values.

## What remains

Highs: **55 of 66 closed**, 11 open — the final cluster: candidate flows (apply-draft prefill,
onboarding hand-off gates, analysis error surfacing), one shared-UI keyboard bug, and the UI/a11y
group (mobile nav, contrast, choropleth, the four [STILL-OPEN] presentational items).
