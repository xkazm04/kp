# Goal 3 reading: live runners on the seed (2026-10-23)

First reading taken with `--live --seed`; raw JSON beside this note
(`2026-10-23-goal3-reading-live-seed.json`). Delivery 1 of
`docs/architecture/reviews/2026-10-23-role-run-end-to-end.md` section 5.

```
KP_OFFLINE=1 KP_ROLE_RUN_LLM=0 node --import ./scripts/test-alias-loader.mjs \
  --experimental-transform-types --disable-warning=ExperimentalWarning \
  scripts/kpi/role-demo-run.mjs --live --seed --approve-gates --sim-interviews 0 --json
```

- Runner set: **live** (`liveRoleRunRunners()`; with the LLM off each producer takes its keyless floor).
- Head sha: `ad53194253c3acdf3ec52fc26abe40f3b353a82f` (tree the script was run on, before this change was committed).
- Source: seed, built from an empty temp file under `KP_SEED_DEMO=1`; the operator's database was not opened. No network, no key.
- Job `job-001`, 4 passes, run status `running`, goal 1 `not met`.
- Interventions: 6 = gate_commit 3, simulated_interview 0, retrigger 3, other 0.
  **interventionsOutsideAllowed = 3**, all re-triggers (one after each gate commit). That is the
  figure the "zero manual edits" goal will have to drive to 0; `humanStepsOutsideGates` stays 0 and could not see it.
- Reached `offer_draft` for `pe-011` only (offer declined: no interview session, `--sim-interviews 0`);
  8 other branches left parked at the rejection gate (score below floor). Autonomous coverage 4/18.

## Finding: the seed denominator is 9 branches, not 4

The review expected 4 entries on `job-001` (pe-003, pe-011, pe-018, pe-027). The seeded board
also carries `m-cand-*-job-001` entries, so the slate held 9 branches (8 parked at rejection plus
`pe-011`). Only the four `pe-*` are in `data/seed_pipeline/pipeline.json`, which is what the
simulated interview's seed proof accepts. No app change was needed for the live runners to run.
