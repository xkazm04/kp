# R3-api-pipeline-1: a reject on a closed pipeline entry ran again

## Reconcile (base 553af380e)
- (a) HELD: `pipeline-entry-action.ts:565` guarded only `action === "accept"` against a terminal status.
- (b) HELD: the reject branch of `actOnPipelineEntry` ran `UPDATE ... SET status='rejected'` with no status predicate; the comment called reject idempotent.

## Failing on base (6 of the new tests)
```
not ok 7  - reject on a 'rejected' entry returns null: no event, status unchanged
not ok 8  - reject on a 'declined' entry returns null: ...
not ok 9  - reject on a 'rematched' entry returns null: ...
not ok 10 - reject on a 'role_closed' entry returns null: ...
not ok 29 - closed reject (i): rejecting twice seals, mails, mirrors and logs once; the repeat is a 409
not ok 30 - closed reject (ii): a reject on a 'declined' entry is a 409 and the candidate's decline stands
# pass 24  # fail 6
```
(7-10 failed with the store returning the entry instead of null.) After the fix: pass 30, fail 0; the ACTIVE rejection_review ratify test passed on base and after.

## Fix
- `pipeline-entry-action.ts`: guard before the seal is `if (isTerminalEntryStatus(live.status)) return staleResponse(live);`, comment updated.
- `db/pipeline.ts` `actOnPipelineEntry`: accept AND reject on a terminal status warn and return null before any write; the "idempotent" comment is corrected. The comment block is kept at its old line count on purpose: `pipeline-stage-writers.test.ts` pins the next guard (`G_STORE_ACT`) by line 3544.

## Commit
Subject: `fix(pipeline): a reject on a closed entry is refused before the seal and in the store` (id in result.json; the merge may rebase).

## Caller audit (`actOnPipelineEntry(..., "reject", ...)`)
- `pipeline-entry-action.ts` (the reject branch ~:618): null falls to the `!updated` path, which answers 409 via staleResponse. Correct.
- `screen-wave.ts:583`: null is treated as "no change" (no letter, no status flip), `continue`. Behaviour correct, but a terminal row would be reported as "Skipped — stage changed mid-wave (was <stage>)" (:586). Wording would be imprecise for a terminal row; not changed (outside paths). The wave selects active rows, so this is reachable only through a race.
- The batch and command routes reach reject through `runPipelineEntryAction`, so they inherit the 409.

## Gates (worktree)
- typecheck: pass. lint: 0 errors (49 pre-existing warnings). test:unit: 13027 pass / 0 fail. scripts/kpi tests: 0 fail. test:docs: 0 fail.
- Generated files rewritten by typecheck (`*.generated.ts`) were restored.

CHANGELOG.md was not updated because it is dirty in the shared checkout.
