---
id: "0014"
title: A singleton integration config records the organization that saved it; only that organization may change it
status: accepted
date: 2026-10-06
supersedes: []
superseded-by: null
tags: [integrations, tenancy, security]
sources:
  - app/_lib/ats-config-store.ts
  - app/_lib/comms-relay-store.ts
  - app/_lib/edge-config.ts
  - app/_lib/edge-drain.ts
  - app/_lib/comms-receipt.ts
  - app/_lib/db/add-columns.ts
  - app/_lib/tenancy.ts
  - app/_lib/edge-org-scope.test.ts
  - app/_lib/comms-relay-org-scope.test.ts
---

## Context

Three integration tables in this repo are literal singletons — `CHECK (id = 1)`,
one row per install, no `workspace_id` and no `org_id`:

| Table | What it points at | Commit that stamped its owner |
| --- | --- | --- |
| `ats_config` | the customer's ATS webhook: every hiring outcome, mirrored | `17c2bbe9d` (F-1) |
| `comms_relay_config` | outbound candidate mail: the whole letter | `189bb1e4e` (F-2) |
| `edge_config` | the always-on edge: this install's inbound transport | this change (F-3) |

All three are classified **exempt** in `app/_lib/tenancy.ts` for a defensible
reason — they are org- or install-level configuration, not per-team data. The
exemption answered "which team?" and was never asked "which **organization**?",
and `KP_MULTI_ORG` makes that a different question: `org:manage` is held per
organization, and every one of these rows is reachable through a door gated on
exactly that capability.

So the security scan of 2026-10-06 found the same defect three times. Org B's
hiring outcomes were mirrored to the endpoint org A saved (F-1). Org B's
candidate letters — recipient, subject, body, and an envelope naming the
candidate, the role and the stage — were POSTed to the relay org A saved (F-2).
And any `org:manage` holder of any organization could re-point, unpair or re-key
the edge pairing the whole install's inbound depends on, while a delivery receipt
drained from a UI-saved edge filed a `bounced` outbox row into whichever
organization the receipt's `ref` happened to name (F-3).

Three findings, one shape, and the third one does not fit the first two: the edge
is install-level *by design*. `ensureEdgeKeypair` mints one sealing keypair and
never rotates it (rotating orphans every event already sealed to the old key),
there is one drain cursor, and one URL. There is no per-organization edge to scope
to without making it a different thing.

## Decision

**A singleton integration config records the organization that saved it, and only
that organization may change it. Where the config is also the install's shared
transport, the boundary goes on the DOORS and on ref-addressed effects — never on
per-event delivery.**

### 1. The rule, identical across all three

- **`owner_org_id TEXT`, nullable, no default**, added through `addColumns()`
  (`app/_lib/db/add-columns.ts`) — which probes `PRAGMA table_info` and throws
  anything that is not a lost duplicate-column race, so the swallow-all `catch`
  these stores used to wrap their ALTERs in goes with it. A backfilled org id
  would be a guess; NULL is the honest value and is read, not rewritten.
- **Stamped from the SESSION on every accepted write, never from the body.** The
  route computes `currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID` and
  spreads it over the parsed body, so an `ownerOrgId` a caller sends has no
  effect. Re-stamping on every write is deliberate: a re-save is how an install
  hands the integration from one organization to another, as a decision somebody
  with the capability made.
- **NULL means the default org**, on either side — a row written before the column
  existed, and a workspace with no `org_id`, both fold to `org-default`. Every
  shipped single-org deployment is therefore unchanged, and the boundary only
  bites where there really are two organizations.
- **Env-sourced config is host-level and exempt.** `COMMS_WEBHOOK_URL`,
  `KP_EDGE_URL`/`KP_EDGE_SECRET` are configuration an operator put in the process
  environment to serve the whole deployment, not something one organization saved
  through the UI. They are told apart from a stored row by the resolver's
  **`source`**, never by the owner being null — a legacy stored row also has a
  null owner and that one *is* checked. Getting this wrong in either direction is
  a real failure: by `source` a host relay serves everyone, by null-owner it would
  stop serving the moment one org saved a row.
- **A refusal is recorded, never silent.** F-1 ends the ledger row terminally with
  a reason; F-2 dead-letters with a `failed` outbox row plus the alert; F-3
  answers **403 `EDGE_OWNED_BY_OTHER_ORG`** at the door and logs the skip at the
  receipt. Every reason names two org ids and nothing else — operator vocabulary,
  no candidate data — because "why did org B's letters stop arriving?" has to be
  answerable.

### 2. The variant: a shared transport is bounded at its doors

For `ats_config` and `comms_relay_config` the config IS the destination, so the
check belongs on each delivery. For `edge_config` it is the install's single
**inbound transport**, and the same placement would be wrong:

- **The doors are checked.** `POST /api/edge` refuses a non-owner inside
  `setEdgeConfig`'s own IMMEDIATE transaction — not as a read before it, because a
  concurrent save landing in between would hand the pairing to an org the call
  never authorized. `POST /api/edge/pair` is checked *before* `ensureEdgeKeypair`
  and before any fetch, since the key it publishes is never rotated. Unpairing
  (`url: ""`) **clears** the owner along with the cursor, so an unpaired install is
  claimable by whoever pairs it next — otherwise an organization that walks away
  takes the transport with it, unrecoverably.
- **Ref-addressed effects are checked.** A delivery receipt carries only
  `(ref, kind, outcome)`, and `ref` alone decides whose outbox gets a `bounced`
  row (`comms-receipt.ts` `receiptWorkspace`). The drain resolves the ref's
  organization the way the relay does — entry → team → org — and **skips** a
  mismatch. Skipped, never *held*: a hold wedges the queue behind bytes the edge
  will hand back forever.
- **Per-event lead/mail delivery is NOT checked.** A drained lead is routed by its
  **receiver token**, a workspace capability, so the tenancy is already carried per
  event by the thing that authenticates it. Refusing another organization's leads
  on the one install edge would cut inbound candidates for every organization but
  one — a worse failure than the one being fixed. The lead branch of `applyEvent`
  says so in a comment, because the asymmetry with the receipt branch two lines up
  is exactly what a later reader would "fix".

### 3. Where the rule does not reach

`ats_delivery` (the mirror ledger) carries no tenant column at all, so its retry
sweep re-derives the entry's organization per row rather than reading one. That is
the same check, not an exception to it. `llm_usage` is deployment-wide on purpose
and is not an integration endpoint; it has no owner and wants none.

## Alternatives considered

**A. Make the tables genuinely workspace- or org-scoped (drop the singleton).**
The structurally clean answer, and the right one eventually for the ATS and relay
configs. Rejected as the fix for these findings because it is a schema migration
with a UI, a backup-portability story (`ORG_CONFIG_NOT_PORTABLE`) and a "which of
your two endpoints did you mean?" question per table, while the exposure was
live. For `edge_config` it is not merely bigger — a per-org edge means a keypair
and a cursor per organization, i.e. the row stops being a singleton and the Worker
protocol changes with it.

**B. Refuse every cross-org read at the store, not at the delivery/door.** Would
catch callers this change does not enumerate. Rejected: these stores are read by
capability checks, cards and health probes that legitimately have no session (the
clock's drain runs what the clock runs), and a store that throws for them turns an
exposure into an outage.

**C. Backfill `owner_org_id` to the default org.** Tempting, and it would let the
column be `NOT NULL`. Rejected: on a multi-org install the backfill is a guess
that *grants* ownership, and reading NULL as the default org costs one `??` and
asserts nothing untrue.

**D. For the edge, check the owner on every drained event.** Rejected for the
reason in §2: it would make one organization's pairing a filter on every other
organization's inbound mail and webhooks.

## Consequences

- **A `KP_MULTI_ORG` install shares one edge and one relay owner.** The second
  organization on such an install gets inbound through the first's pairing and has
  no UI-saved relay of its own until the install hands it over. That is a real
  limitation, stated rather than hidden: the alternative (A) is a per-org keypair
  and cursor, which is out of scope here.
- **An operator can lock themselves out of a door by handing over an org.** If the
  owning organization is deleted or its last `org:manage` seat moves, the pairing
  must be unpaired (by someone who can still pass the check) before another
  organization can claim it. The release-on-unpair rule exists for exactly this,
  and it is the only recovery path.
- **The three tables stay `tenancy.ts`-exempt**, and their comments now have to say
  *why they are exempt AND whose they are* — two different facts that read as one.
  A fourth singleton integration config owes the same column and the same
  paragraph.
- **A new door onto one of these rows inherits nothing.** The check lives in the
  store's write transaction (relay, edge) or the delivery path (ATS, receipts), so
  a new *reader* is safe by default and a new *writer* must pass the caller's org
  or it will stamp NULL — which silently means "the default org". That is the
  sharpest edge this design has.

## What would change our mind

- **If a customer runs two organizations that each need their own edge.** Then (A)
  for `edge_config` stops being out of scope: per-org keypair, per-org cursor, and
  the Worker addressing pairings rather than installs. This ADR becomes its
  first half, and §2's variant goes away.
- **If a NULL owner is observed granting access it should not.** The fold to
  `org-default` is what keeps every shipped install working; if a multi-org
  install is found where an unstamped row let the wrong organization write, the
  answer is a one-time migration that stamps the row at upgrade time from the only
  org present, and refuses when there is more than one.
- **If a door is found writing one of these rows without a session org.** Then the
  stamp should stop defaulting and start refusing — `ownerOrgId` becomes required
  at the store boundary, and the server-internal writers (tests, fixtures) pass
  `DEFAULT_ORG_ID` explicitly instead of inheriting it by omission.
