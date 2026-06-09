# UI+Bug Scan — Fix Wave 2: Data integrity (lost-updates & dropped writes)

> 7 findings closed (1 Critical, 5 High, 1 Medium) across 7 atomic commits + 1 ref-sync follow-up.
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638.
> One mental model: **a write must be atomic and acknowledged — never lose the user's input.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `483693b` | interview-prep Regenerate destroys saved scorecard/progress | **Critical** | app/_lib/interview-prep-run.ts |
| 2 | `9948ded` | scorecard/progress lost-update race | High | app/_lib/interview-prep.ts |
| 3 | `3129bea` | debounced autosave dropped on close | High | app/features/sub_schedule/InterviewPrepModal.tsx |
| 4 | `9dc8190` | `runOne` leaks phantom 'running' task | High | app/_lib/tasks.ts |
| 5 | `0f4d21f` | dev-case submission lost on failed POST | High | app/features/sub_dev/SubmissionForm.tsx |
| 6 | `8febd00` | JD editor saves stale title/company body | High | app/features/sub_library/JdBuilderResult.tsx |
| 7 | `b91c912` | CV dedupe race admits a duplicate variant | Medium | app/features/sub_analyze/useAnalyzeForm.ts |
| — | `(follow-up)` | sync new tracking refs in an effect (React 19 react-hooks/refs) | — | InterviewPrepModal.tsx, useAnalyzeForm.ts |

## What was fixed (grouped by sub-pattern)

### Full-payload writes that destroy sibling state (the critical)
1. **interview-prep Regenerate** — `runInterviewPrep` rebuilt the payload from scratch and `saveInterviewPrep` full-upserts, so Regenerate silently wiped a previously-saved human scorecard (PREP1), checklist progress (PREP2), and assigned interviewer (PREP5) on the same row, with no confirm — permanent loss of hand-entered ratings/evidence/verdict. Now reads the existing artifact and carries the reserved `humanScorecard` / `userProgress` / `interviewer` keys forward.

### Non-atomic / non-acknowledged writes (lost updates & dropped writes)
2. **scorecard vs progress race** — the PUT (progress) and POST (scorecard) paths did read→spread→UPDATE on disjoint keys of the same `payload_json`; across kp's fork-churned connections one could read-then-clobber the other. Each merge now runs in a `BEGIN IMMEDIATE` transaction that re-reads inside the txn.
3. **autosave dropped on close** — the 600ms debounce timer was cleared on unmount, so closing the modal right after typing a final note lost it. An unmount effect now flushes the latest values (held in a ref) with `keepalive:true`.
4. **phantom 'running' task** — `runOne`'s catch called `finishTask` on the same contended connection that just failed `markTaskRunning`; a second throw escaped `void runOne(id)` as an unhandled rejection and left the row `running` forever. The recovery write is now guarded; `interruptStaleTasks` reclaims the row.
5. **dropped submission** — `SubmissionForm.send()` cleared inputs + `onDone()` without checking `r.ok`, so any non-2xx silently vanished a candidate submission. Now clears only on success, keeps inputs and surfaces the error inline on failure.
6. **stale JD body** — `JdBuilderResult` seeded `markdown` only at mount and is keyed by `templateId`, so a post-generation Title/Company edit recomputed the parent body but never reached the editor — publishing a stale body. An effect re-seeds on `result.markdown` change, skipped once hand-edited.
7. **CV dedupe race** — `addCvFile` awaited the async content-hash against a stale closure of `cvFiles`, so two rapid identical drops both appended. Intake is now serialized through a promise chain and dedupes against a ref advanced synchronously on append.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 2 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean except 1 PRE-EXISTING `set-state-in-effect` in InterviewPrepModal's hydration effect (lines 64-67, NOT touched by this wave) |

No regressions. The follow-up commit moved two newly-added tracking refs from render-time assignment into effects (React 19 `react-hooks/refs`); behavior is unchanged.

## Cumulative status (waves 1–2)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity (lost-updates & dropped writes) | 7 |
| | **Total** | **15** |

**All 3 scan criticals closed** (devcase inbound auth, repo-ref traversal, interview-prep Regenerate). 68 findings remain across 7 themes.

## Patterns established (catalogue items 5–9)

5. **Full-payload upsert destroys sibling keys.** When several writers persist disjoint keys into one row/JSON blob, a regeneration path that rebuilds from scratch silently wipes the others. Read-merge reserved keys forward (or confirm before overwrite).
6. **Non-atomic read-modify-write on a shared row loses updates.** read→spread→UPDATE across connections/processes is last-write-wins. Wrap in `BEGIN IMMEDIATE` re-reading inside the txn, or merge in SQL (`json_set`).
7. **Debounced/deferred writes are dropped on unmount/navigation.** A timer cleared in effect cleanup loses the last edit. Flush on unmount with `keepalive`/`sendBeacon`.
8. **Fetch success assumed without `r.ok`.** Clearing inputs / calling `onDone()` before checking `r.ok` turns a non-2xx into silent data loss. Gate state changes on `r.ok`, keep the input, surface the error.
9. **Async client dedupe against a stale closure.** Concurrent async intake (hash-then-append) both read the pre-update list and both append. Serialize the intake and check against a synchronously-advanced ref (or inside the functional updater).

Extra catalogue note: **do not mutate a ref during render** (React 19 `react-hooks/refs`) — sync tracking refs in a post-commit effect.

## What remains

68 findings across 7 themes (INDEX). Recommended next: **Wave 3 — Identity-by-label / wrong-record** (group-eval decide-by-id, count-drift, bulk-add target, compare crown/key, profile rows keyed by id) — ~5 fixes that all share "resolve & key by stable id, never by display label / array index."
