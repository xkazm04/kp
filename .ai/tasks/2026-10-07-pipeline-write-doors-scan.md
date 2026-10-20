# Pipeline write-doors security scan

Date: 2026-10-07 · Charter: codebase-security-scan · Branch: `autopilot/codebase-security-scan-d15f6fd0`
· Base: main `73d802b9c` · Idea: `d6f86aa9`

Report: [`docs/security/2026-10-07-pipeline-write-doors-scan.md`](../../docs/security/2026-10-07-pipeline-write-doors-scan.md)

## Result: three fixes committed, three findings reported

| Commit | Change | Test that is red on the unchanged source |
| --- | --- | --- |
| `8f5603f4d` | POST /api/pipeline limiter, `pipeline-add:<ws>:<ip>` 600/10min, placed before the seal | contract row + `app/api/pipeline/add-rate-limit.test.ts` |
| `28aac8adb` | Limiter on confirmed command-bar waves, `pipeline-command-exec:<ip>` 20/10min (idea d6f86aa9) | contract row + `app/api/pipeline/command/execute-rate-limit.test.ts` |
| `e33923da7` | Per-card move/decide limiter, `pipeline-entry-move:<ip>` 300/10min | contract row + `app/api/pipeline/[id]/move-rate-limit.test.ts` |

To prove each test is red, I put the base version of each route back temporarily, ran the tests and saw them fail, then restored the fix. Each fix commit also updates `docs/features/pipeline/README.md`.

## Deviations from the brief

1. **KNOWN 1 is reported, not built.** No server-side match result exists to check the score against: `/api/match` stores nothing, and a recruiter weight override changes the total. A recompute in the add door would also spawn Python on every add. The sound fix needs three things: a persisted match result with a `matchRunId` (under `app/_lib/db/`), a change to `/api/match`, and a change to the Match client. None of those are in this task's paths. The fix shape is in report §1.
2. **The add limiter's key carries the workspace as well as the IP.** The brief said "per IP like the other doors". The demo session can reach this door, and with no trusted proxy every IP resolves to one shared bucket. A per-IP key alone would let a demo visitor lock real teams out of adding.
3. **I added a limiter to the per-card door ([id]).** The brief did not name it. The scan found it, and the fix stays inside the declared paths.

## Left for an owner

- Gating POST /api/pipeline with `requireOperator` and `pipeline:write` means editing `route-capability-coverage.test.ts` and `write-capability-gate.test.ts`. Both are outside this task's paths. `authz-parity.test.ts` also names this as debt owned by the re-add delivery. The owner also needs to decide whether the demo sandbox keeps its Match add.
- Open-mode doors with no limiter outside the scope are listed in report §"Outside the scope".

## Gates

- `npm run typecheck`: pass.
- `npm run lint`: pass, with 0 errors and 49 warnings. The warnings were already there.
- `npm run test:unit -- "app/_lib/**/*.test.ts" "app/api/**/*.test.ts"`: 8465 of 8465 pass.
- `scripts/kpi/**`: 85 of 85 pass.
