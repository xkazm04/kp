# UI+Bug Scan — Fix Wave 10: polish tail + correction of 4 missed Highs

> 13 findings closed (4 **High**, 6 Medium, 3 Low) across 13 atomic commits.
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean (1 pre-existing InterviewPrepModal hydration lint error, untouched).

## ⚠️ Correction to the campaign record

A finding-by-finding re-audit before this wave found that the waves 1–9 close-out **miscounted**: 4 Highs had been deferred without being tracked as Highs, so "all 27 Highs closed" was wrong. The accurate post-wave-9 state was **65 closed / 18 open, of which 4 were Highs**. This wave fixes those 4 Highs first, then the Med/Low tail.

## The 4 missed Highs (now closed)

| Commit | Finding | Files |
|---|---|---|
| `20ff159` | profile deep-link editor open self-aborts its own fetch | ProfileTab.tsx |
| `db66f6d` | ingested ads born `published`, skip draft→source (never sourced) | jobs/ingest/route.ts |
| `7680a4c` | saved-JD submit runs JD-blind **+** Cancel leaves the GitHub run going (button stuck) | useAnalyzeJdLibrary/useAnalyzeForm/AnalyzeForm |

- **profile** — the `?edit=` deep-link effect was keyed on `params` and cleared the param via `router.replace`, which changed `params`, re-ran the effect, and fired the first run's cleanup before its fetch resolved → editor never opened. Now runs once at mount.
- **jobs ingest** — `insertJob` defaults to `published`; the route omitted the arg, so a pasted ad was live but never sourced (it skipped the publish step that sources). Now ingests as `draft`.
- **cv-analysis (two Highs, one commit — shared file)** — a saved-JD pick recorded the slug synchronously but filled the textarea after an async fetch while Analyze was already enabled, so a quick submit ran JD-blind (now blocked by a `jdLoading` flag); and Cancel only halted the main poll, leaving the AbortController-less GitHub deep-dive running with `githubStatus` stuck "loading" (Analyze disabled) — `cancel()` now supersedes the GitHub run like `reset()`.

## Med/Low closed (9)

| Commit | Finding | Severity |
|---|---|---|
| `6b227df` | interview_prep dropped ctx.signal → cancel was a no-op | Medium |
| `fe3f6ed` | saved-JD picker gave no loading feedback | Medium |
| `47eb7ca` | voice transcript empty-state copy ignored phase | Low |
| `8010f7f` | cached group-eval load failure showed "No evaluation yet" | Medium |
| `c97060f` | interview-prep coverage counter could exceed the total | Low |
| `6e7560e` | reschedule into a fully-booked horizon showed a blank list | Medium |
| `b708794` | DecisionRulesModal kept the typed value, not the clamped one | Low |
| `fa07c23` | dev-case fit chip vs rank disagreed during the eval→reload gap | Medium |
| `9251eff` | sim eval/wave Modal covered the SimBar's Stop control | Medium |

## Deferred (5) — genuinely involved / edge, for a future small follow-up

- **data-layer #2** (Med) — unbounded pasted JD/company text shoved into one argv element can trip the OS command-line limit (`E2BIG`) on Windows; needs an intake length cap or temp-file/stdin transport.
- **demo-sim #1** (Med) — reset mid-run can re-orphan rows it just deleted; needs stop-flag checkpoints threaded through the sim orchestration's in-flight mutations.
- **conversational-apply #4** (Med) — focus isn't moved to the first control of each newly-rendered ko/choice/file step; needs per-step-type focus refs.
- **jd-library #4** (Low) — template manager flashes an empty list with no loading/empty distinction; needs a nullable `templates` sentinel threaded through its usages.
- **workspace #4** (Low) — the minimal Markdown parser drops nested bold/italic; needs a parser change (regression-sensitive).

## Verification (before / after)

| Gate | Baseline | After Wave 10 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean (1 PRE-EXISTING InterviewPrepModal hydration error, untouched) |

## Campaign status — corrected

| | Count |
|---|---|
| Findings | 83 |
| **Closed (waves 1–10)** | **78** |
| Open | 5 (3 Medium, 2 Low — the deferred tail above) |

**All 3 Criticals and all 27 Highs are now closed.** The 5 open are involved/edge Medium/Low items. Baseline preserved across all 10 waves. 21-item pattern catalogue in FIXES-WAVE-1..9; this wave's lesson: **track every finding's severity through the whole campaign — a deferred item silently dropped from the count became 4 unclosed Highs.**
