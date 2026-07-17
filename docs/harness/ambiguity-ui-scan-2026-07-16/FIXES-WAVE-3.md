# Fix Wave 3 — Silent wrong-outcome / swallowed failures

> 6 findings closed in 6 atomic commits (all High). Theme: the system silently produces a wrong/incomplete result and reports success.
> Baseline preserved: tsc 0 → 0 errors; node unit suite 2345 → 2352 pass, 0 fail, 0 regressions.
> Branch: `vibeman/ambiguity-ui-wave1` (continues Waves 1–2). All targets chosen from files OUTSIDE the user's devcase/core/messages WIP.

## Commits

| # | Commit | Finding closed | Files |
|---|---|---|---|
| 1 | `cbdc4e4` | ats-egress ships the wrong offer's comp in candidate.hired | `ats-egress.ts` (+behavioral test) |
| 2 | `a1894bb` | a cancelled onboarding run is resurrected by any mutator | `onboarding-store.ts` (+test) |
| 3 | `c4a3ce9` | approve route silently drops off-gate reviewer edits | `devcase/lifecycle/[id]/approve/route.ts` (+source-guard) |
| 4 | `9b50202` | a silent-mic call is scored as a "completed" interview | `voice/finalize-status.ts`, `VoiceInterview.tsx`, `interview/complete/route.ts` (+test) |
| 5 | `b7252fc` | the Fit Matrix silently caps the pool at 200 | `db/profiles.ts`, `matrix/route.ts`, `MatrixTab.tsx` (+test) |
| 6 | `c5642dd` | DevTab approve() swallows failures (dead button) | `sub_dev/DevTab.tsx` (+source-guard) |

## What was fixed

1. **ats-egress wrong offer** — `getOpenOfferForEntry(entryId) ?? listOffersForEntry(entryId)[0]` took the OLDEST offer (created_at ASC) once the accepted one was no longer `extended`, so a re-extended entry's `candidate.hired` shipped the first offer's salary and a contradictory `declined` status. Now selects the most-recent accepted, then open, then newest.
2. **Onboarding tombstone** — `cancelRun` is a revoke/erase tombstone, but `setTaskDone`/`saveIntake`/`requestSignature`/`markSigned` keyed only on run existence and `setTaskDone` rewrote status back to active from progress; one accidental checkbox click on a cancelled run (which renders like an active one) voided the guarantee and let the token resolve again. A shared `mutableRunWorkspace` guard makes `cancelled` terminal across all mutators.
3. **Approve silent no-op** — the approve block was `if (isAtReviewGate(lc.stage))` with no else, so an off-gate approve-with-edits skipped the edits/probe-gate/audit but still returned `{ ok: true }` — the reviewer's corrections vanished with a false success. Now 409s (mirroring the redesign route) when off-gate edits arrive; an editless resume still works.
4. **Silent-mic interview** — `hadRealConversation = reachedLive && turnCount > 0` counted turns of any role, and the AI always opens, so a silent-mic call finalized "completed" (candidate locked out, minutes billed, scorecard from zero candidate words). Now requires `candidateTurnCount > 0`, threaded from the client, with a server-side defense-in-depth in `/api/interview/complete` (client-supplied status downgraded to failed when no candidate turns).
5. **Matrix silent truncation** — scored only the first 200 candidates (bare magic number) and the count line showed the capped 200 as the total. Extracted `MATRIX_POOL_CAP`, added `countMatrixProfiles`, returns `poolTotal`/`poolCap` on every response, and MatrixTab shows a truncation banner (reusing `ofCount` to avoid touching the WIP message files).
6. **DevTab dead button** — `approve()` was a bare fetch acting only `if (r.ok)`, so a probe-gate block spun then did nothing. Routed through the shared `runAction` error surface so the server's message shows.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| node unit suite | 2345 pass / 0 fail | 2352 pass / 0 fail |

Behavioral regressions that fail pre-fix: ats-egress offer selection, onboarding tombstone, voice silent-mic, matrix cap/count. Route-level fixes (approve 409, DevTab approve) carry source-guards.

## Patterns established (catalogue items 10–13)

10. **Fallback picks by insertion order, not by state** — `list(...)[0]` / `.at(0)` as a fallback silently selects the oldest row when the intended one has changed state. Make the selection explicitly state-aware (prefer the terminal/accepted state) and comment which record the contract requires.
11. **Tombstone that isn't terminal** — a "cancelled/revoked" status that mutators don't check, so a later write derives a fresh status and overwrites the tombstone. Route every mutator through one guard that treats the tombstone as missing.
12. **Silent conditional instead of a guard** — `if (precondition) { do the work }` with no else, then a success response regardless. If skipping the work changes the outcome the caller believes happened, the else must be an error (409), not a fall-through.
13. **"any-role" count stands in for "the actor did X"** — counting events of any kind (turns, rows, items) to infer a specific party acted. The AI/interviewer/system contributes to the count too; require the specific actor's count. Defense-in-depth on any client-supplied status/count that gates billing or scoring.

## What remains (deferred, with cause)

- **DevTab "approve anyway" override** — the API supports `overrideProbeAudit:true`, but exposing an audited override affordance in the UI is a larger addition; the swallow itself is fixed (blocked is now visible). Flagged in commit `c5642dd`.
- **Matrix localized banner** — reuses `ofCount`; a fully-worded localized string needs a new i18n key in `messages/*.json`, which are under the user's separate WIP. Deferred to avoid the collision.
- **data-store-persistence #1** (`seedCandidates` INSERT OR REPLACE reboot wipe) and the **dev-submissions LiveWorkSurface** data-loss findings remain in the user's devcase/core WIP and were left untouched.
