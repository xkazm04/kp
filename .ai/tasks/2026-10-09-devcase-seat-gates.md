# 2026-10-09 devcase seat gates (R4-api-devcase-1-8)

## Reconcile (base 553af380e)
All five POSTs called neither `requireOperator` nor `requireCapabilityCoded`, and all five sat in `ALLOWED` as "slice 2 candidate": `lifecycle/[id]/close`, `lifecycle/[id]/redesign`, `promote`, `feedback`, `lifecycle` (POST; GET untouched). None was already closed.

## Failing on base
`node scripts/run-unit-tests.mjs app/api/devcase/devcase-doors-capability.test.ts`: 10 failures. For each of the five doors, "refuses a viewer with FORBIDDEN_CAPABILITY (pipeline:write)" ("let a viewer through") and "answers 401 with no session at all" were `not ok`. The recruiter and owner cases passed, as expected. After the fix: 38/38 across this file and `route-capability-coverage.test.ts`.

## Fix
Each POST now starts with `requireOperator()` then `requireCapabilityCoded("pipeline:write", requireCapability)`, the shape of `approve/route.ts`. The five `ALLOWED` lines are replaced by a "judged and CLOSED" comment. Open mode is unchanged: the test file's header notes that without `KP_OPERATOR_PASSWORD` every caller folds to owner, and the helpers were not touched.

## Commit
Subject: `fix(devcase): five lifecycle/promote/feedback doors ask pipeline:write` (id c6ae7ae3a; the merge may rebase).

## UI report (not changed)
- `DevLifecycleRow.tsx:154` close, `DevLifecycleReviewPanel.tsx:106` redesign, `useDevSubmissionRow.ts:205` feedback and `:221` promote, `useDevTabActions.ts:71` start: none checks the seat, so a viewer still sees every control.
- Close, redesign and promote resolve the 403 `code` through `useErrorMessage()` to `errors.FORBIDDEN_CAPABILITY`, shown in the row's error line.
- Start goes through `runAction`, which also resolves the code into `actionError`.
- Feedback ignores the body: `setFeedback(r.ok ? "queued" : "error")`, so a viewer sees only the generic error state with no seat explanation.

## Not touched
Siblings R4-api-devcase-1-1..1-7, 1-9, 1-10 stay queued.

## Gates
typecheck pass, lint pass, test:unit pass, `scripts/kpi` pass, test:docs pass.

CHANGELOG.md was not updated because it is dirty in the shared checkout.
