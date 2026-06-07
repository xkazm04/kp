# Bug Hunt Fix Wave 8 — Board/form UI state-desync & display edges

> 5 commits, **8 of 11 findings closed** (8 medium/low). 3 deferred (see below).
> Baseline preserved: tsc 0→0 · `next build` ✓ · unit 585→585 · python 474. No regressions.

## Commits

| # | Commit | Findings | Severity | File(s) |
|---|---|---|---|---|
| 1 | `8bf2c9b` | cv #5 + #6 | Medium ×2 | `useAnalyzeJdLibrary.ts`, `AnalyzeForm.tsx` |
| 2 | `92002bb` | pipeline #3 + #4 | Medium ×2 | `PipelineBoard.tsx` |
| 3 | `2b733e9` | pipeline #5 | Low | `PipelineTab.tsx` |
| 4 | `7025f98` | pipeline #6 + #7 | Low ×2 | `SchedulerControl.tsx` |
| 5 | `552ce02` | scheduling #6 | Low | `offer-finalize.ts` |

## What was fixed

- **CV#5 / CV#6 — saved-JD crash + wrong-JD race.** The `?jd=` auto-load set the textarea to an unguarded `jd.body` (a non-string white-screened the tab from a shareable URL); the picker had no request sequencing (a slow earlier pick last-write-won, leaving the textarea on JD A while the dropdown showed B). Type-guard the body; sequence picks with a monotonic ref.
- **Pipeline#3 / #4 — counted-but-invisible candidates.** A no-job entry counted under `"?"` but the lane filter's 2-way fallback never placed it; an unknown-stage entry matched no column. Aligned the lane key with the position key (3-way) and fold unknown-stage entries into the first column.
- **Pipeline#5 — drawer state bleed.** `CandidateDrawer` had no `key`, so switching candidates could show the previous one's result/notes/tokens. `key={drawerEntry.id}` remounts it.
- **Pipeline#6 / #7 — scheduler control races.** `update()` was gated only by a `busy` boolean (concurrent clicks raced); the 30s poll's mirror overwrote the interval field mid-typing. Added an in-flight ref (single-flight) and a focus guard on the mirror.
- **Scheduling#6 — wrong offer outcome on CAS loss.** A lost response CAS with a null re-read defaulted to `"declined"` (could tell an accepter they declined). Re-read the offer for the authoritative status.

## Deferred (3 findings) — with rationale

- **Scheduling#3 (Medium) — recruiter calendar slot format never matches the candidate token format.** The recruiter Schedule tab confirms display strings like `"Tue 14:00"` (no date, no ISO `slot_at`) while the canonical candidate slot is `"Tue 14 Jun · 14:00"` + ISO. Reconciling the two slot vocabularies is a real design change (the recruiter calendar offers an arbitrary day/time grid, not the canonical 10:00/14:00 `proposeSlots` times) that touches the WIP-adjacent scheduling subsystem — **coordinate with the scheduling owner** rather than bolt on a partial mapping.
- **Scheduling#4 (Medium) — `offeredSlotFor`/`proposeSlots` use server-local wall-clock (DST / UTC-server edges).** A correct fix means generating AND validating slots in the business timezone (DST-correct via `Intl`, like the W1 `hasEventToday` fix) — but the WIP-modified `schedule-slots.test.ts` asserts the current server-local behavior, so this needs a coordinated rework of the slot machinery + its tests, not a risky in-place tweak.
- **CV#7 (Low) — analyze stage strip walks on a fixed timer, decoupled from real progress.** Decorative: the strip has 6 stages but the server emits a single `done/total` progress (variant count), not per-stage signals — there's no truthful data to drive it. A real fix needs server-emitted per-stage progress; not worth synthesizing a fake mapping.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 585 | 585 |
| `npm run test:python` | 474 (4 skipped) | 474 (unaffected) |

## Patterns established (catalogue items 23–24)

23. **Two key derivations for the same entity must be byte-identical.** A position counted under a 3-way key but placed under a 2-way key creates a phantom lane and an unreachable row — derive membership from one shared helper, never re-spell the fallback.
24. **A background-poll render mirror must yield to active user input.** Don't let a 30s poll overwrite an editable field the operator is mid-typing — guard the mirror on focus/dirty state. (CV#6 reuses the monotonic stale-response sequence guard; Scheduling#6 reuses "re-read the authoritative state on a lost CAS".)

## Cumulative status (waves 1–8) — scan complete

| Wave | Theme | Closed |
|---|---|---|
| 1 | Duplicate side-effects & double-firing | 6 |
| 2 | Python numeric & LLM-boundary safety | 6 |
| 3 | Analyze run lifecycle & task cancellation | 5 (+ Data#1 fully closed) |
| 4 | Voice interview end-of-call & connection timing | 6 |
| 5 | Dev Case provenance & fallback honesty | 6 (of 7; #2 deferred) |
| 6 | Silent failures & batch-abort recovery | 4 |
| 7 | Status & uniqueness guards | 6 |
| 8 | Board/form UI state-desync & display edges | 8 (of 11; #3/#4/CV#7 deferred) |

Pattern catalogue: 24 items. **47 / 51 findings closed.** All 3 criticals + 16/17 highs closed.

## What remains (4 findings, all with recorded rationale)

- DevCase#2 (High) — coordinate with the canonical-score-contract WIP.
- Scheduling#3 (Medium) — recruiter/candidate slot-vocabulary reconciliation.
- Scheduling#4 (Medium) — business-timezone rework of slot generation + validation (and its tests).
- CV#7 (Low) — needs server-emitted per-stage progress to drive the strip truthfully.
