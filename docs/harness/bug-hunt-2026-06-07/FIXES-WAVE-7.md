# Bug Hunt Fix Wave 7 — Status & uniqueness guards

> 5 commits, 6 findings closed (2 high, 2 medium, 2 low).
> Baseline preserved: tsc 0→0 · `next build` ✓ · unit 585→585 · python 474→474. No regressions.

## Commits

| # | Commit | Finding | Severity | File |
|---|---|---|---|---|
| 1 | `fbc9ebd` | automation #2 | High | `automation-run.ts` |
| 2 | `4171e49` | scheduling #2 | High | `schedule/[token]/route.ts`, `db.ts` |
| 3 | `7a67ad9` | data-layer #3 + #4 | Medium ×2 | `db.ts` |
| 4 | `1899746` | data-layer #6 | Low | `db.ts` |
| 5 | `d9d0c1f` | data-layer #5 | Low | `codegen.py` |

## What was fixed

2 (automation). **Single-task screen applied its stage move without the expectedStage CAS.** The hardening was applied only to the batch policy pass; the single-task / background path (`runAutomationTask`, used by `/api/automation/[task]`, the `automation` runner, `batch_screen`) called `actOnPipelineEntry("accept")` blind to the entry's current stage despite the same read→Python/LLM-hop→apply gap — so a screen decided against an Accepted entry could apply after a recruiter/concurrent pass moved it to Interview/Offer. Now passes `expectedStage = entry.stage`; a stale (null) result skips the move AND the dependent `screening_review` approval/event.

2 (scheduling). **A still-valid token booked an interview for a terminal entry.** A candidate rejected/declined after the link was minted could still confirm a slot: the POST didn't check entry status and `approve_event` didn't guard `row.status`, so it re-set the approval, moved the stage to Interview, and emailed a "You're booked" confirmation on a closed-out candidate. The POST now returns 409 when the linked entry isn't active, and `approve_event` no-ops on a terminal entry (defense-in-depth; Hired stays `active`).

3 + 4 (data-layer). **Task dedup was advisory; terminal tasks could be mutated.** `dedupe_key` had only a non-UNIQUE index, so two writers on separate connections could both pass the active-by-dedupe check and INSERT a duplicate run — added a partial UNIQUE index on active rows (guarded) + a `createTask` collision catch that returns the existing active row. And `markTaskRunning`/`setTaskProgress` UPDATEd by id with no status predicate, letting a late progress callback or recovery re-enqueue resurrect/restamp a canceled/finished task — both now guard `AND status IN ('queued','running')`.

6 (data-layer). **Unbounded opportunistic cache prune on the hot path.** The 2%-of-writes prune ran an unbounded `DELETE … WHERE expires_at < now`, which on a large expired backlog holds the WAL write lock for seconds (SQLITE_BUSY for concurrent writers). Capped at 500 rows/pass via a rowid subselect; the boot prune stays unbounded off the hot path.

5 (data-layer). **`codegen --check` crashed on a corrupt generated file.** A non-UTF-8/locked `*.generated.ts` raised an unhandled `UnicodeDecodeError` (opaque traceback) instead of the actionable "out of date" message. Any read failure is now treated as stale.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 585 | 585 |
| `npm run test:python` | 474 (4 skipped) | 474 (4 skipped) |

Plus: `npm run schemas:check` still exits 0 (up-to-date) after the codegen change.

## Patterns established (catalogue items 20–22)

20. **Apply a concurrency/CAS guard to EVERY path with the read→act gap, not just the first.** The `expectedStage` CAS hardened the batch pass but the single-task path had the identical gap. When you add such a guard, grep every caller with the same read-then-act shape.
21. **A capability token is not proof the linked entity is still valid.** A still-valid token (a schedule link) must re-check the linked entity's *current* status at the action boundary — the token authenticates the link, it doesn't authorize the current state.
22. **Enforce uniqueness / lifecycle invariants at the storage layer, not just in app code.** An app-level read-then-write dedup is advisory across connections; a partial UNIQUE index + status-predicated UPDATEs make "one active run per key" and "terminal is final" hard guarantees.

## Cumulative status (waves 1–7)

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |
| 3 | Analyze run lifecycle & task cancellation | 5 (Data#1 fully closed later) |
| 4 | Voice interview end-of-call & connection timing | 6 |
| 5 | Dev Case provenance & fallback honesty | 6 (of 7; #2 deferred) |
| 6 | Silent failures & batch-abort recovery | 4 |
| 7 | Status & uniqueness guards | 6 |

Pattern catalogue: 22 items. **39 / 51 findings closed.** No criticals remain.

## What remains

W8 board/form UI (11 — M/L) and the deferred DevCase#2 (coordinate-with-WIP) — 12 findings open per `INDEX.md`.
