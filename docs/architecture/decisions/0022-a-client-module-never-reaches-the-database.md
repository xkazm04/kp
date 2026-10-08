---
id: "0022"
title: A client module never reaches the database
status: accepted
date: 2026-10-08
supersedes: []
superseded-by: null
tags: [build, client-bundle, database, testing]
sources:
  - app/_lib/testing/client-bundle-boundary.test.ts
  - app/_lib/slate-population.ts
  - app/_lib/ats-record.ts
  - app/_lib/db/core.ts
  - app/features/settings/integrations/IntegrationsWebhookPanel.tsx
  - .ai/tasks/2026-10-08-release-build-client-boundary.md
---

## Context

A client bundle that reaches `better-sqlite3` or `fs` fails `next build` with
`Can't resolve 'fs'`. That is a bundling boundary, not a type error, so
`npm run typecheck`, `npm run lint` and `npm run test:unit` all stay green over
it.

That is how it reached `main`. `b9f45b1aa` ("the ATS record refuses an AI agent
instead of exporting it as a person") made `app/_lib/ats-record.ts` import
`isAgentPopulation` from `./db/core.ts`. `ats-record.ts` was written as
"Pure + dependency-free ... can't drag better-sqlite3 into a bundle" (its header),
but the `"use client"` `IntegrationsWebhookPanel.tsx` imports `ATS_SCHEMA_VERSION`
from it (line 12), so the chain was panel -> `ats-record.ts` -> `db/core.ts` ->
better-sqlite3 / `node:fs`. It was found on 2026-10-08 while running the keyless
e2e subset (`.ai/tasks/2026-10-08-e2e-keyless-subset-check.md`), not by a gate;
that record notes typecheck, lint and unit tests were green with the break in
place.

The fix (`f3e94940b`) moved the pure block (`SLATE_POPULATIONS`,
`SlatePopulation`, `coerceSlatePopulation`, `isAgentPopulation`, `notAgentSql`)
verbatim into `app/_lib/slate-population.ts`, which has no imports.
`db/core.ts` imports what it uses and re-exports the same names, so no importer
changed. `ats-record.ts` imports the pure module.

## Decision

**The value-import closure of every `"use client"` file may not reach
`better-sqlite3`, `fs`, `child_process` (with or without the `node:` prefix) or
any file under `app/_lib/db/`.**

- A pure helper that client-reachable code needs lives outside `db/`. `db/`
  re-exports it, so server importers do not change (the shape of
  `slate-population.ts` and `db/core.ts`).
- Type-only imports from `db/` stay allowed: they are elided and never reach a
  bundle.
- The gate is `app/_lib/testing/client-bundle-boundary.test.ts`, which runs in
  `npm run test:unit`. It starts from every `app/` file whose first statement is
  `"use client"`, follows emitted value imports (TypeScript `transpileModule`,
  so type-only imports are elided), `export ... from` and `import()`, resolves
  the `@/` alias and index files, and stops at a `"use server"` file, for which a
  client bundle receives a reference stub. It fails with the shortest chain from
  the client file to the forbidden module. It asserts it found more than 50
  client files, so a broken prefilter cannot pass it vacuously. There is no
  allowlist. The task record measured it at about 15 s, and shows it failing on
  the pre-fix import with the chain above.

## Alternatives that lost

- **An allowlist of known breaches.** Refused: the test has none, and passes on
  the fixed tree without one.
- **A regex or lint rule on import lines.** It cannot see a transitive chain
  (the break was three hops deep and the offending line was in a file that is
  not itself a client file), nor the elision of type-only imports. The guard
  walks the graph instead. No lint rule was written or measured in the evidence.
- **Running `next build` as the check.** The task record measured an unpatched
  build at 164 s after a 63 s `npm ci`, against about 15 s for the guard.
  `ci.yml` does run `npm run build` (in `node-quality` and the e2e job) and the
  `pre-push` hook runs it for pushes to `main`; the break was nevertheless on
  `main` from the commit of 2026-10-07 until the fix. The gates a change is
  checked against while being built (typecheck, lint, test:unit) do not run it.
  The guard puts the rule in the fast set.
- **The `server-only` package, or other ways of marking `db/` as server code.**
  Not evaluated.

## Consequences

- A helper moved out of `db/` for this reason should say so where it lives, as
  `slate-population.ts` does.
- The guard sees `"use client"` roots under `app/`. A client bundle entered some
  other way is not covered.
- The guard walks `app/` TypeScript only: a forbidden module reached through a
  package outside `app/` is not seen.

## What would change our mind

- A merge path that runs `next build` on every change cheaply enough to replace
  the walk.
- `db/` ceasing to depend on `better-sqlite3`, which would make the directory
  rule unnecessary (the `fs` / `child_process` rule would stay).
- A client bundle that the walk cannot see but `next build` breaks on, which
  would show the walk's model of the bundler is wrong.
