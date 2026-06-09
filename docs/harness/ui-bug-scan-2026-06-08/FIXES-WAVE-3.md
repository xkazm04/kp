# UI+Bug Scan — Fix Wave 3: Identity-by-label / wrong-record

> 5 findings closed (2 High, 3 Medium) across 5 atomic commits.
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.
> One mental model: **resolve & key by a stable id — never by a display label or array index.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `1af4d09` | inline group-eval decide resolves by display label | High | GroupEvalModal.tsx, DecisionsTab.tsx |
| 2 | `d8ab61c` | group-eval count drift on duplicate candidateIds | High | group-eval-run.ts |
| 3 | `540b2c1` | matrix bulk add files a null/wrong match score | Medium | MatrixTab.tsx |
| 4 | `485c95d` | compare table mis-crowns / key-collides on dup labels | Medium | CompareTab.tsx |
| 5 | `37eeedb` | profile skill/evidence rows keyed by array index | Medium | ProfileTypes.ts, ProfileForm.ts, ProfileEvidenceColumn.tsx |

(Finding #1's fix spans two commits: `d8ab61c` threads `entryId` through the producer, `1af4d09` resolves by it in the modal + tab.)

## What was fixed (grouped by sub-pattern)

### Wrong-record on an irreversible action
1. **group-eval inline decide** mapped the eval candidate back to a live entry by `candidateLabel === label`. Labels aren't unique (two "Jan Novák" in one role) and `Array.find` returns the first — so an advance/reject (status flip + rejection email via expectedStage CAS) could land on the wrong person, and the label-keyed `decided` map flipped both same-named tabs. Identity now routes through `candIdentity` (entryId, label fallback): the modal keys decided/tabs/columns by it and passes it to `onDecide`; DecisionsTab resolves by `entry.id` first.

### Wrong-record on aggregation / persisted data
2. **group-eval count drift** — two entries for the same `candidateId` each consumed a `GROUP_EVAL_CAP` slot and emitted a duplicate comparison column while the id-keyed resolver collapsed them downstream (double-counted lead/order, evicted a real candidate). Input is now deduped by identity (candidateId, else entryId) before the cap.
3. **matrix bulk add** — the per-cell score was re-derived by index lookup with `?? null`, so a duplicate-id miss silently filed a candidate with a null match score. A null lookup now fails the add (stays selected for retry) instead of persisting bad data.

### Wrong-record on display / React reconciliation
4. **compare crown** — `winnerIndex = findIndex(label === bestLabel)` + label-keyed columns crowned the first same-named variant and risked duplicate-key mis-reconciliation. Winner is now resolved by max score index (earliest on tie, matching the producer's stable sort); columns key by index.
5. **profile rows** — skill/evidence lists rendered `key={i}` while mutating by index, so removing a middle row moved data under a React-stable DOM node (focus/selection/IME landed on the wrong row). Rows now carry a stable client-only `_id` (never persisted — `build()` maps fields explicitly) and key on it.

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 3 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

No regressions. The new `_id` on SkillRow/EvidenceRow is optional and stripped at persist, so the profile payload shape and the `ProfileForm` hydration tests are unchanged.

## Cumulative status (waves 1–3)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity (lost-updates & dropped writes) | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| | **Total** | **20** |

All 3 scan criticals + the 2 highest-value identity highs closed. **63 findings remain across 6 themes.**

## Patterns established (catalogue items 10–11)

10. **Identity by display label / array index → wrong record.** Resolving an entity for an action, a highlight, or a React key by a non-unique display label or a positional index hits the wrong record on a name collision or a mid-list remove. Carry a stable id; resolve/key by it; keep the label for display only. (Provide a label fallback when older persisted payloads lack the id.)
11. **Dedup downstream but not at the cap/iteration.** When a later stage dedups by id but an earlier cap/loop iterates the un-deduped list, duplicates consume slots, emit duplicate rows, and can evict real items past the cap. Dedup before the cap, mirroring the downstream key.

## What remains

63 findings across 6 themes (INDEX). Recommended next: **Wave 4 — Concurrency & idempotency** (outreach double-send, devcase resume dup-posting, voice hang-up terminal status, voice `reachedLiveRef`, promote double-guard, forced-tick double-advance) — ~6 fixes sharing "exactly-once: atomic guards + correct terminal-state handling."
