---
id: "0032"
title: The import-graph budget counts eager edges; a dynamic import() is deferred
status: accepted
date: 2026-10-28
supersedes: []
superseded-by: null
tags: [performance, gates]
sources:
  - scripts/perf/check-budget.mjs
  - scripts/perf/__tests__/check-budget.test.mjs
  - perf-budget.json
  - docs/development/performance-budget.md
---

# The import-graph budget counts eager edges; a dynamic import() is deferred

## Context

`scripts/perf/check-budget.mjs` walked static and dynamic imports as one union. `app/page.tsx`
reached 1989 modules / 12009 KB against ceilings of 1984 / 12000, which blocked CI and the
held pushes. Most of that graph hangs off `next/dynamic` tab loaders: the code is split into
chunks that load on demand, so it is not what an operator waits on when the page loads.

## Decision

`walkGraph` follows static imports and re-exports only. An `import('x')` (what `next/dynamic`
and `React.lazy` compile to) is a deferred edge: it is not followed, so a module reachable only
through one is not counted. A module that is also reached by a static edge still counts. The
union stays available as `walkGraph(entry, root, { deferred: true })`.

**This changes what the gate measures, not its ceilings.** No ceiling in `perf-budget.json` was
raised, lowered or edited (ADR 0007: a gate is repaired by fixing, and a changed gate is a
deliberate, reviewed edit; this is that edit). Under the new measure `app/page.tsx` is 255
modules / 1975 KB, and the route groups drop by a few modules each. Fixtures in
`scripts/perf/__tests__/check-budget.test.mjs` pin both halves: a dynamic edge is excluded, a
static edge still counts.

## Alternatives considered

- **B. Raise the `app/page.tsx` ceilings.** It makes the gate green by loosening it, the
  pattern ADR 0007 exists to prevent, and the next addition would need another raise.
- **C. Trim the graph until it fits.** Tried in run dacc4a5d: it cut 1 module / 4 KB, nowhere
  near the 5 modules / 9 KB over, and any gain is eaten by ordinary growth.

## Consequences

The page entry no longer ratchets lazy-loaded code, so a heavy tab moved behind `next/dynamic`
now shows as a real saving, which is the incentive we want. The cost: the number is no longer
the full compile graph, and a graph that is lazy only by accident of one `import()` looks cheap.
The route-group ceilings keep their old numbers over a smaller measurement, so they have slack
that `--tighten` can take back.

## What would change our mind

A regression where an eager-looking page got slow because of code behind a dynamic edge (dev
compile cost, which compiles the union): then add a second ceiling on the union rather than
reverting to it as the only number.
