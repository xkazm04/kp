---
id: "0025"
title: A read-modify-write takes the write lock at BEGIN or re-checks its precondition in the UPDATE
status: accepted
date: 2026-10-16
supersedes: []
superseded-by: null
tags: [database, concurrency, sqlite]
sources:
  - app/_lib/db/pipeline.ts
  - app/_lib/db/pipeline-close-guard.test.ts
  - context-constraints.json
  - .claude/CLAUDE.md
---

# A read-modify-write takes the write lock at BEGIN or re-checks its precondition in the UPDATE

## Context

Several subsystems (offers, schedule, scheduler, sim, decision records, the
consent-expiry sweep) write `pipeline_entries` on their own `better-sqlite3`
connections, so "another connection commits between my SELECT and my UPDATE"
is the normal case, not a corner
([ADR 0002](0002-sqlite-single-file-persistence.md) states the IMMEDIATE rule
but not the alternative that lost). Two incidents set the rule:

- **A role close ran DEFERRED.** A publish on another connection committed
  before the close's first UPDATE. SQLite refused the write as
  `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` never retries, and the whole
  close rolled back.
- **Candidate erasure ran DEFERRED with two doors** (the consent-expiry sweep
  and the candidate's `/data/[token]` request). Both passed the read before
  either wrote, producing a mask on a mask, a second linked-PII scrub and a
  second consent event.

## Decision

A read -> compute -> write takes the write lock at BEGIN
(`db.transaction(...).immediate()`; reference: `actOnPipelineEntry`), or
re-checks its precondition in the `UPDATE ... WHERE` and skips on
`res.changes === 0`. Where the operation must not silently drop, it takes the
lock.

The two mechanisms are different guarantees. The re-assert turns a lost race
into a clean no-op, but does not make the write survive a concurrent commit:
under DEFERRED the snapshot abort happens before the UPDATE runs. Any DEFERRED
read-modify-write therefore carries a CAS guard. A nested call becomes a
SAVEPOINT and its inner mode is ignored, so the mode is chosen at the
outermost boundary.

## Alternatives considered

- **DEFERRED plus CAS everywhere.** Correct for idempotent no-ops, wrong where
  the write must land: the snapshot abort is not retried.
- **Retry on `SQLITE_BUSY_SNAPSHOT`.** Re-runs side effects in the compute
  step; the lock is simpler.
- **Application-level mutex.** Does not span the separate connections that
  write the table.

## Consequences

A concurrent commit becomes a short wait. The accepted cost is earlier writer
serialisation, so immediate transactions stay short and never contain LLM or
network calls. Known exceptions, tracked separately: `recordEntryConsent`
(`pipeline.ts`) and the remaining read-first DEFERRED sites. The rule is
otherwise enforced by prose (`context-constraints.json`, `.claude/CLAUDE.md`),
with `pipeline-close-guard.test.ts` pinning the close and reopen paths.

## What would change our mind

Moving off a single writable SQLite file
([ADR 0002](0002-sqlite-single-file-persistence.md)).
