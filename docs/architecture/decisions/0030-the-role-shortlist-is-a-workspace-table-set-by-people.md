---
id: "0030"
title: The role shortlist is a workspace-scoped table, set only by a person
status: accepted
date: 2026-10-22
supersedes: []
superseded-by: null
tags: [decisions, tenancy, erasure, human-in-the-loop]
sources:
  - app/_lib/db/role-shortlist.ts
  - app/_lib/db/role-shortlist-tenancy.test.ts
  - app/api/decisions/shortlist/route.ts
  - app/features/hiring/decisions/docket/useRoleShortlist.ts
---

# The role shortlist is a workspace-scoped table, set only by a person

## Context

The "Everyone on this role" table (CX S46) kept its shortlist tick in client state.
A reload lost it and a teammate never saw it, so the ending of a hiring decision (who
was shortlisted, who was chosen) was not recorded anywhere.

## Decision

The shortlist moved from client state to a workspace-scoped table, at the operator's
direction (triage T14, 2026-10-22). `role_shortlist` holds one row per
(workspace_id, job_id, entry_id) with `state` (`shortlisted` or `chosen`), `set_by`
and `set_at`.

- Every statement in `db/role-shortlist.ts` binds `workspace_id`; the table is in the
  tenancy manifest.
- The candidate's rows are deleted with them by the erasure scrub in `db/pipeline.ts`.
- Human-set only. The sole writer is `POST /api/decisions/shortlist`, behind a signed-in
  operator with the `pipeline:write` seat; the actor comes from the session
  (`humanActor`), never from the body. `role-shortlist-tenancy.test.ts` fails if any
  other module (app, pipeline, edge, packages) writes the table or calls the setter.
- A mark is a record of a human choice, not an input to scoring or automation. Nothing
  reads it to move a candidate.

## Alternatives considered

- **Keep it in client state or local storage.** Not chosen: no teammate view, no record
  of who chose and when.
- **A column on `pipeline_entries`.** Not chosen: the mark is per role and per person
  acting, and the operator asked for no other table to change.

## Consequences

A new table that carries a candidate id, so erasure and the tenancy manifest must keep
naming it (both are ratcheted). Reopen if a mark ever needs to feed automation: that
would be a different decision with its own human gate.
