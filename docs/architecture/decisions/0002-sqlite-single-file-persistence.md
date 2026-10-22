---
id: "0002"
title: A single SQLite file is the default persistence
status: accepted
date: 2026-08-26
supersedes: []
superseded-by: null
tags: [persistence, self-hosting]
sources:
  - app/_lib/db/core.ts
  - app/_lib/db/demo-seed.ts
  - app/_lib/tenancy.ts
  - deploy/helm/kp/Chart.yaml
  - docs/architecture/postgres-backend.md
  - docs/architecture/workspace-data.md
---

# A single SQLite file is the default persistence

## Context

The primary distribution shape is **self-hosting**: someone clones the repo or
pulls one container and runs a recruiting studio for their own company. The
thing that kills that shape is a dependency list — "first stand up Postgres,
then Redis, then run migrations".

The data is also small by nature. A recruiting workspace is thousands of rows,
not millions: jobs, candidates, analyses, pipeline entries, an outbox.

## Decision

`better-sqlite3` over one file at `data/kp.sqlite` (override with `KP_DB_PATH`),
accessed through repository-style modules in `app/_lib/db/*` — not an ORM. A
fresh database boots with the structural bootstrap only (schema, the default
workspace and org), and the first start asks whether to start empty or explore
with the demo corpus from `data/seed_*` (see the amendment below).

`better-sqlite3` specifically, and synchronously, because:

- Read→compute→write sequences (`actOnPipelineEntry` and friends) run inside
  **IMMEDIATE** transactions. A synchronous driver makes that a language-level
  guarantee instead of a promise-ordering argument.
- No connection pool, no async fan-out, no partially-applied write.

## Consequences

**Good.** Zero-dependency install. Backups are `cp`. `npm run db:dump` /
`db:load` move a whole workspace as text. Tests get a real database, not a mock.

**Bad, and accepted.** **One replica, forever.** Two pods cannot serve one
SQLite file, so the Helm chart pins `replicaCount: 1` with a `Recreate` strategy
and a ReadWriteOnce volume — it *enforces* the constraint rather than
documenting it. Horizontal HA needs the Postgres backend
(`docs/architecture/postgres-backend.md`), which is why `npm run db:pg-audit`
exists to keep the SQL portable.

The other cost is that tenancy has to be hand-proved. There is no ORM to
attach a global scope to, so `app/_lib/tenancy.ts` is a **fail-closed
manifest**: every workspace-scoped table is allowlisted and backed by a
colocated `*-tenancy.test.ts`, and any new persistent table is a reported gap
until it is scoped and listed. Adding a table to the exempt list without the
reasoning is how a cross-tenant leak gets introduced here.

## Amendment 2026-10-22: the demo no longer seeds by default

This record used to say a fresh database "self-seeds the demo corpus, so a first
run is a working app rather than an empty one". That half is **reversed**
(operator triage T1). A plain fresh install (`npm run dev`, `npm run up`, a
Docker volume) booted into a fictional bank's hiring pipeline it never asked for,
and an operator's first real role landed beside 105 demo ones.

Now a fresh database boots blank, exactly as `KP_EMPTY=1` did, and the first
visit to `/` asks "start empty, or explore with demo data?"
(`app/setup/FirstRunDataChoice.tsx`). The answer is stored in
`workspaces.demo_choice`, so it is asked once. "Explore with demo data" posts to
`POST /api/setup/first-run`, which calls `seedDemoCorpus()` in `app/_lib/db/core.ts`:
the same seeders in the same order as the boot path, then the same tenant backfill,
in one IMMEDIATE transaction. It refuses a workspace that already holds data and is
idempotent (`app/_lib/db/demo-seed.ts`, pinned by `demo-seed.test.ts`).

`KP_SEED_DEMO=1` is the explicit opt-in that keeps the old seed-at-boot behaviour
for machines (the Playwright webServer, `npm run up -- --demo`, the unit-test
harness). `KP_EMPTY=1` still forces a blank tenant and wins over it. A database
that already holds the seeded rows keeps them: nothing is wiped, and the one-shot
seeders are `seed_marks`-gated, so nothing is re-seeded either.

The persistence decision itself (one SQLite file) is unchanged.

## What would change our mind

A hosted deployment that must serve more than one replica, or a workspace whose
working set stops fitting comfortably in one file. Both lead to the Postgres
backend, not to an ORM in front of SQLite.
