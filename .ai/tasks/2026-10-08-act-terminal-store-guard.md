# actOnPipelineEntry terminal guard (candidate-pipeline-board council rework, full r1 C1)

Closes the four `known-gap` census rows left by the stage-migration run (75f7e84a1): policy advance, screening advance + plan-gate ratify, schedule `approve_event`.

- `actOnPipelineEntry` (app/_lib/db/pipeline.ts): inside the tx, before any write, an `accept` / `screening_review` advance whose destination has the terminal role (by role) returns null + `console.warn` unless `opts.outcome === "offer_accepted"`. No UPDATE, event or arrival hook.
- `approve_event` never lands on terminal: it keeps the stage, clears the approval, records `scheduled` with toStage = current stage (the existing reschedule path). `screeningGateIndex` and pipeline-stages.ts untouched.
- `offer-finalize.ts` passes the opt-in (the one terminal-by-design caller).
- `withPolicyStageFacts`: `advanceTo` null when the next column has the terminal role. Python untouched. Counting: a store null on the policy path is `markStaleSkip` (skipped), screening advance returns `skipped_stage_changed`, plan-gate ratify falls through to `held_for_review`. None counts as advanced or error, so no counting fix was needed (the skip reason text still says "stage changed" - a cosmetic mislabel, rare now the policy no longer proposes it).
- Census: four rows -> `refuses-terminal` pinned to the store guard line; `known-gap` class REMOVED; actOnPipelineEntry SQL row repinned to the store guard.

Callers of actOnPipelineEntry: pipeline-entry-action.ts x2 refuses-terminal (request door, earlier); offer-finalize.ts terminal-by-design (opt-in); screen-wave.ts not-a-move (reject); automation-pass.ts, automation-run.ts x2, api/schedule/route.ts x2, api/schedule/[token]/route.ts: refuses-terminal (store guard).

Rejected alternative: make `validatePipelineStages` require an interview or offer column before the terminal one. A composed board with no offer column is a supported shape (pipeline-entry-action.ts:181, :448) and stored workspace axes would turn invalid.

Tests: app/_lib/db/pipeline-act-terminal.test.ts (6), automation-pass-stage-facts.test.ts (new null-before-terminal test + updated Offer expectation), pipeline-stage-writers.test.ts.
