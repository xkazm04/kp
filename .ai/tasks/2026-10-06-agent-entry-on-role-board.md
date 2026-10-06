---
kind: task
status: done
opened: 2026-10-06
charter: accepted-idea-delivery
branch: autopilot/accepted-idea-delivery-8e8bd5f6
idea: 4af5284b-f362-4665-8044-b14a13ba3659
gate: npm run test:unit -- app/_lib/agent-hire/*.test.ts app/_lib/db/role-slate.test.ts app/_lib/db/agents-store.test.ts app/api/agents/agents-bridge.test.ts
measurable: non-test createPipelineEntry callers passing population 'agent' on the agent-fit path. Before: 0. After: 1 (persistAgentFit).
---

# The agent-fit transform files the agent on the role board

Reconcile: on main 06ea70da no non-test `createPipelineEntry` call passed
`population: 'agent'` on the agent-fit path, so nothing was already shipped.

## What changed

`app/_lib/agent-hire/transform-run.ts` gains an exported `persistAgentFit(jobId,
envelope, workspaceId)`. In one `ensureDb()` transaction it calls `saveAgentFitSpec`
as before, then `createPipelineEntry` with `population: 'agent'`, candidate id
`agent-fit-<jobId>` (one entry per job; re-transform lands on it), label = spec name
or job title, `sourceChannel: 'agent-fit'`, `actor: 'auto:agent-fit'`, default
screened stage, and `rubricVersion` only when `getRoleRubric(...).frozenAt` is set.
`runAgentFit` calls it and returns `entryId` beside the record. Nothing changed in
`db/**`, `lifecycle.ts` or any route.

Tests: `app/_lib/agent-hire/agent-board-entry.test.ts` (5 tests: one active agent
entry listed by `readRoleSlate` beside a human; idempotent per job; rubric version
frozen / draft / absent; ws-b isolation; `auto:agent-fit` on the 'added' event).
Red before (no `persistAgentFit` export), green after.

## For the dispatch increment (not done here)

`placeAgentOnBoard` (`lifecycle.ts:87`) mints `agent-<hiredAgentId>` and files it
with no population, so today it counts as human. It must instead land on the
`agent-fit-<jobId>` entry (same candidate id) and pass `population: 'agent'`.

## Perf (`node scripts/perf/check-budget.mjs --json`, `perf-budget.json` untouched)

Findings: 63 before, 63 after (same set of failing targets; routes grew only).
Module added to the route graphs of everything importing `transform-run.ts`:
`app/_lib/db/role-rubrics.ts` (+1 module, ~11 KB). `db/pipeline.ts` and `db/core.ts`
were already in those graphs.

| Route | Before | After |
| --- | --- | --- |
| `app/api/tasks/[id]/route.ts` | 265 modules / 3590 KB | 266 modules / 3602 KB |
| `app/api/jobs/[id]/agent-fit/route.ts` | 265 modules / 3593 KB | 266 modules / 3606 KB |

Every other route in `tasks.ts`'s graph (tasks, tasks/history, tasks/[id]/retry, and
the other task-kind starters) moves by the same +1 module. The routes listed as
"new" by a message diff are existing over-ceiling findings whose numbers moved.
