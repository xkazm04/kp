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
fresh database self-seeds the demo corpus from `data/seed_*`, so a first run is
a working app rather than an empty one.

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

## What would change our mind

A hosted deployment that must serve more than one replica, or a workspace whose
working set stops fitting comfortably in one file. Both lead to the Postgres
backend, not to an ORM in front of SQLite.
