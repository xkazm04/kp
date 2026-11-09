# Goal 3 reading: a gate commit continues the run (2026-10-23)

Second `--live --seed` reading; raw JSON beside this note
(`2026-10-23-goal3-reading-commit-continues.json`). Compare
`2026-10-23-goal3-reading-live-seed.md` (interventionsOutsideAllowed 3).

```
KP_OFFLINE=1 KP_ROLE_RUN_LLM=0 node --import ./scripts/test-alias-loader.mjs \
  --experimental-transform-types --disable-warning=ExperimentalWarning \
  scripts/kpi/role-demo-run.mjs --live --seed --approve-gates --sim-interviews 0 --json
```

- Head sha: `62c6f9f11aa38e294636f09fbb1b62f7b65e2ba3` (tree the script ran on; the change under test was uncommitted at that point).
- Change: the stand-in commits through `commitRoleRunStageGateAndContinue`, which takes one live pass after a successful commit.
- Interventions: 3 = gate_commit 3, simulated_interview 0, **retrigger 0**, other 0.
  **interventionsOutsideAllowed = 0** (was 3, all retriggers).
- Same outcome as before otherwise: job `job-001`, 4 passes, run `running`, furthest stage `offer_draft` for `pe-011`, autonomous coverage 4/18.

How the count stays honest: a pass is counted a retrigger only when the harness itself starts one
after a gate commit. With `--sim-interviews` above 0, the `interview_invite` approval is committed
WITHOUT its own pass (the simulated interview must be sealed before S5 runs), so the pass the harness
then starts is counted as a retrigger. This reading plays no interview (cap 0), so nothing was held.
