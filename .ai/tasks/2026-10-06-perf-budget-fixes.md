# Perf budget fixes A and B (2026-10-06)

Executes Fix A and Fix B of `.ai/tasks/2026-10-06-perf-budget-attribution.md`.
No ceiling was edited; `perf-budget.json` is settled in a later run, after the
sibling agent-fit delivery merges.

- Fix A (`9dee0c619`): `scorecardGateOpen` moved to the leaf `app/_lib/interview-scorecard-gate.ts`;
  `automation-run.ts` imports it there; `interview-scorecard-commit.ts` re-exports it.
- Fix B: `BUILT_IN_ARCHETYPE_IDS` moved to `app/_lib/archetypes.ts`; `archetype-registry.ts`
  imports it from `./archetypes`. Client side: option (i), `profileTypes.ts` re-exports it.
  Option (ii) was not built: (i) leaves `app/page.tsx` at 1802 modules / 11004 KB, so (ii)
  cannot beat it and no client copy is needed.

## Measurements (`node scripts/perf/check-budget.mjs --json`, modules / KB)

| Target | Base | After A | After B |
| --- | --- | --- | --- |
| findings | 63 | 63 | 63 |
| `app/page.tsx` | 1802 / 11004 | 1802 / 11004 | 1802 / 11004 |
| `app/api/tasks/[id]/route.ts` | 265 / 3590 | 241 / 3310 | 239 / 3302 |
| `app/api/agents/hire-from-need/route.ts` | 274 / 3659 | 252 / 3408 | 250 / 3399 |
| `app/_lib/llm-config.ts` | 18 / 361 | 18 / 361 | 18 / 361 |
| `app/_lib/job-ingest.ts` | 29 / 458 | 29 / 458 | 29 / 458 |

Finding count cleared: 0, as predicted. Fix A's 265 -> 241 matches the report; Fix B removes 2 more modules.
The gate stays red until the later settle.
