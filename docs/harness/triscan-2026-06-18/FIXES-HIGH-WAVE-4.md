# Tri-Lens Fix — High Wave 4: Decision / pipeline integrity

> Continues critical Wave 4. 1 atomic fix commit (2 findings), 1 finding verified non-applicable.
> Baseline preserved: tsc 0 → 0 · TS unit tests 963 → 963 · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `4d523cc` | screening #2 (reinstate not sealed) + pipeline-board (move-to-Hired) | High ×2 | api/pipeline/[id]/route.ts |

## What was fixed

1. **Reinstate is sealed into the decision chain (screening #2).** `screen-wave` seals every auto-reject into the tamper-evident decision hash chain, but the reversal — `reinstatePipelineEntry` — only recorded a pipeline *event*. The chain therefore showed a rejection with no record it had been overturned: an incomplete, misleading audit trail (the exact thing a tamper-evident log exists to prevent). The reinstate branch now also `sealDecisionSafe({ kind: "reinstated", actor: "human:recruiter", … })`, best-effort (the seal never throws / never fails the reinstate). Reject **and** its reversal are now both in the chain.

2. **Hired can't be reached by a manual stage move (pipeline-board).** The recruiter `set_stage` override accepted any known stage, including the terminal **Hired** — bypassing the offer→accept flow (`/api/offer/[token]`) that records the offer, the candidate's acceptance, and fires onboarding. A jump straight to Hired was a "hire" with no offer record and no onboarding. `set_stage` now rejects `toStage="Hired"` (422) and points the recruiter at the offer flow; the offer-accept path that legitimately sets Hired is untouched.

## Verified NON-issue (not a silent skip)

**Drawer `set_notes` "stale-snapshot CAS" — not applicable in this architecture.** The finding assumes two concurrent writers clobbering each other. But (a) the app is **single-operator** (one `KP_OPERATOR_PASSWORD`), so there is no second concurrent recruiter; (b) the route header documents `set_notes` as deliberately *last-write-wins* — "recruiter-owned prose, not AI-attached evidence"; (c) `setEntryNotes` writes only the `notes` column (+`updated_at`), so it cannot clobber sibling columns written by a concurrent AI action (and better-sqlite3 serializes writes anyway). A CAS here would 409 the autosaving scratchpad for a concurrency scenario that doesn't exist and would contradict the intentional design. **No change — documented rather than silently skipped.** (Mirrors the Wave-2 single-tenant decision.)

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 963 | 963 |

(No new unit tests: both fixes live in the Next route handler, outside the codebase's pure-lib test boundary; verified by tsc + the full suite. The move-to-Hired guard is a one-line transition check.)

## Cumulative this session

30/30 criticals + **15 Highs** closed across 12 waves, 0 regressions throughout. TS 935→963, Python 626→634.

## Decision/pipeline theme — remaining

- Drawer save-conflict surfacing *if* real multi-tenancy ever lands (today: non-issue, above).
- Board optimistic-update rollback on a 409 (UX) and the `set_stage` backward-move audit note (Med). Non-critical.
