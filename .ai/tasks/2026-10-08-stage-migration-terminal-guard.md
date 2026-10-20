# Stage-migration terminal guard (candidate-pipeline-board full r1, craft C1 + robustness)

Must-address: "the 'terminal stage is outcome-bearing' invariant is enforced per caller, and the stage-migration door bypasses it" / "stage-migration moves entries onto the terminal (Hired) stage with no offer".

- `migratePipelineStages(migrations, toAxis, ws)` refuses any leg whose destination has the terminal role on `toAxis` (the axis moved INTO, required argument) with `TerminalMigrationTargetError`, before any write.
- POST /api/pipeline/stage-migration: 422 `PIPELINE_TERMINAL_NOT_MANUAL` `{fromStage, toStage}` for such a mapping, and `{stage}` for a re-role onto an occupied column (item 3, built in the route alone). Before the limiter, before any move, no axis written. No new strings.
- Parity with `setPipelineEntryStage`: approval cleared, `updated_at` stamped, arrival hook once per moved entry after commit.
- Stranded picker drops the terminal column (`kit/strandedTargets.ts`).
- Census: `app/_lib/db/pipeline-stage-writers.test.ts`.
- Touched outside the declared paths: `app/api/rate-limit-contract.test.ts` (pins the call text) and `app/_lib/db/pipeline-calibration-furthest.test.ts` (a caller of the new signature).
- Left open: `known-gap` rows in the census (policy/screening advance, schedule approve_event reach the terminal column on an axis with no interview/offer column). Those doors were out of scope.
