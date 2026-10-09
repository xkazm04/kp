# resend-dedup flake: 'a REF'D dead letter keeps its existing semantics'

Base `dfecc020f`. Fix commit: `test(comms-resend): wait out the millisecond before resending, so the dedup's strict > sees a newer recovery` = `8956d043f` (the merge may rebase; match by subject).

## Reconcile
Nothing had changed. `app/api/comms/[id]/resend/route.ts:124` still compares `m.createdAt > original.createdAt` with a strict `>`. The test still exists. `recordOutbox` (`app/_lib/db/devcase.ts:590`) stamps `new Date().toISOString()`, which has millisecond precision.

## Reproduce (before the fix)
Runner: `node scripts/run-unit-tests.mjs "app/api/comms/*/resend/resend-dedup.test.ts"`. One run takes about 1.9 s.

| Loop | Runs | Failures |
| --- | --- | --- |
| Idle, sequential | 200 | **21** |
| Loaded, 8 parallel x 25 | 200 | 0 |

Every idle failure was the same assertion. Test 2, "a REF'D dead letter keeps its existing semantics", failed on `assert.equal(second.status, 409)` with `expected: 409, actual: 200` (resend-dedup.test.ts, the second-resend check). No other test ever failed. Test 1 (the refless case) never failed. Its first `resend()` pays the dynamic `import("./route.ts")`, which puts several milliseconds between the dead letter and the recovery. By test 2 the module is cached, so the gap is sub-millisecond.

The failure did not reproduce under 8-way load (0/200). The 2026-10-08 report was "under load", so load is not what makes it likelier. Observed here, the idle rate was about 10%, and the loaded sample showed none.

## Probe
A temporary test, deleted before the commit, ran in-process: write a dead letter, resend, read both rows, then resend again.

| Setting | Iterations | Equal-ms pairs | Second resend answered 200 |
| --- | --- | --- | --- |
| Idle | 1000 | 10 | 10 |
| Loaded, 8 copies | 8 x 1000 | 7, 9, 9, 9, 11, 11, 12, 16 | identical to the equal-ms count in every copy |

About 1% of back-to-back pairs share a millisecond. Every equal-ms pair gave a second resend that answered 200, and no other cause produced a 200.

## Verdict
**CONFIRMED.** A recovery stamped in the same millisecond as its original is not "newer" under the strict `>` at `route.ts:124`. The dedup misses it, and the second resend answers 200 instead of 409 `COMM_ALREADY_RESENT`. This is a test mechanism, because a test fires both calls within microseconds of each other.

## Fix
`resend-dedup.test.ts` gets one helper, `awaitNextTick(original)`. It spins until `Date.now() > Date.parse(original.createdAt)`, a deterministic tick wait with no fixed sleep, and its comment names `route.ts:124`. It is applied in the two tests that resend the same row twice (REFLESS and REF'D). The other tests in the file never create a recovery. They are the 404, the 422 and the suppressed 409, so a same-ms pair cannot change their outcome and they were left alone. `resend-closed-invite.test.ts` resends each row once and never asserts a dedup, so it has no such shape and is untouched. No assertion was weakened.

## After
| Loop | Runs | Failures |
| --- | --- | --- |
| Idle | 200 | 0 (was 21) |
| Loaded, 8 x 25 | 200 | 0 (was 0, so there is no loaded baseline to compare) |

## Product edge (not changed; for the operator's decision)
- **Can it happen in production?** Rarely. A dead letter comes from a failed send (`sendComm` records `failed`). The recovery comes from a human click at `route.ts` (the POST handler) or from an automation re-fire. Both come much later than the dead letter (seconds to hours), so a same-ms pair needs a send that fails and a re-dispatch of the same row within one millisecond. The realistic variant is two near-simultaneous clicks or an automation racing a click. The in-process `resendInFlight` Set (`route.ts`, near the in-flight check) covers concurrent requests in one process, but not a recovery that lands in the same ms as a recovery already written by another path.
- **Cost.** A duplicate delivery of the same rejection or offer to the candidate. In that case the first recovery is the sole row in that ms and the second request fails to see it.
- **Proposed fix.** Make the "already recovered" test not depend on timestamp resolution. Either compare with `>=` while still excluding `original.id` (the recovery row is already excluded by `m.id !== original.id`, and any non-failed row for `(ref, kind)` other than the original means the message was re-sent, so the `createdAt` clause could be dropped or relaxed to `>=`), or order by insertion (`rowid`) instead of by timestamp. `route.ts:124` is the one line. Dropping the time clause entirely changes semantics for an older delivery with the same ref and kind, so that is the owner's call.

## Gates (worktree, base dfecc020f plus the fix)
- `npm run typecheck`: pass (it rewrote the three `*.generated.ts` files, restored).
- `npm run lint`: pass (0 errors, 49 pre-existing warnings).
- `npm run test:unit`: pass, 13014/13014.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: pass, 85/85.
- `npm run test:docs`: pass, 6/6.
