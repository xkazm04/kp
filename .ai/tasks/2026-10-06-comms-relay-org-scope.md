# The outbound comms relay belongs to the organization that saved it

Branch `autopilot/codebase-security-scan-6bbcf0e7`, cut from the `main` tip
`7a0274d2`. Two commits: the red proofs, then the fix.

**Naming.** This is the App Master's queue item **F-2**. It is *not* the F-2 of
`.ai/tasks/2026-10-06-security-scan-ats-mirror.md`, which is a different finding
(`decision.actor`) and is untouched here. What this closes is the exact shape of
that scan's **F-1** (§A1), one table over.

## The defect

`comms_relay_config` (`app/_lib/comms-relay-store.ts`) is a single deployment-wide
row — `CHECK (id = 1)`, no workspace column, no owner. `getCommsChannel()` →
`resolveRelay()` (`app/_lib/comms-relay.ts`) → `WebhookChannel.send`
(`app/_lib/comms.ts`) POSTs **every** candidate-facing message to whatever URL that
row holds: recipient, subject, the whole letter body, and the enriched `kp.comm.v1`
envelope naming the candidate, the role and the stage.

So in a deployment with more than one organization, org B's candidate messages went
to the endpoint org A saved. Same finding `17c2bbe9d` closed for `ats_config`, on a
hotter path — the ATS mirror carries an outcome *record*, this carries the *letter*.

## What changed

1. **Schema.** `owner_org_id TEXT`, nullable, no default, added through `addColumns()`
   (`app/_lib/db/add-columns.ts`). The existing swallow-all `ALTER … version` try/catch
   went with it — `addColumns` probes `PRAGMA table_info` and throws anything that is
   not a lost duplicate-column race, so `comms-relay-store.ts` leaves the `CEILING` map
   in `app/_lib/db/store-migrations-guard.test.ts` entirely (the ratchet tightens by one).

2. **Write side.** `POST /api/comms/relay` stamps
   `currentOrgId(await currentSession()) ?? DEFAULT_ORG_ID` — the **saver's** org, from
   the session, never from the body. An `ownerOrgId` in the request body is overwritten
   by the spread and has no effect. `setRelayConfig` re-stamps on every accepted write,
   so a re-save hands the relay over deliberately. `GET` exposes `ownerOrgId` (an id, not
   a secret) and still never returns the signing secret.

3. **Delivery side.** `ResolvedRelay` carries `ownerOrgId` and its existing `source`.
   `WebhookChannel.crossOrgRefusal` resolves the message's org — `getEntryWorkspace(msg.ref)`
   when there is a ref, else `msg.workspaceId`, then `orgIdForWorkspace(...)` — and a
   mismatch is REFUSED before the envelope is built (it enriches with the candidate's own
   data) and long before any fetch. A refusal is a **dead letter, not a silent return**:
   `alertDeadLetter` fires and the `failed` outbox row carries a `failureDetail` naming
   both org ids and nothing else, because "why did org B's letters stop arriving?" is a
   question an operator must be able to answer.

   Resolving from `ref` first is load-bearing: it is how `recordOutbox` /
   `outboxWorkspaceForRef` files the row, and scoping to `msg.workspaceId` instead would
   fold nearly every ordinary candidate comm to the DEFAULT team and quietly disarm the
   check (the same trap `comms-tenancy.test.ts` already pins for the envelope lookup).

4. **NULL on either side is `DEFAULT_ORG_ID`.** A row written before the column existed,
   and a workspace with no `org_id`, both fold to `org-default`. The single-tenant
   self-host — every shipped deployment today — is unchanged, and the boundary only bites
   where there really are two organizations.

5. **The env relay is NOT org-checked.** `COMMS_WEBHOOK_URL` is host-level configuration
   an operator put in the process environment to serve the whole deployment, not an
   integration one organization saved through the UI. The two are told apart by the
   resolver's `source`, never by the owner being null — a legacy stored row also has a
   null owner, and that one *is* checked. Stated in the code and in both docs.

6. **`POST /api/comms/relay/test` is unchanged.**

Also updated: the `comms_relay_config` comment in `app/_lib/tenancy.ts` (still exempt —
still one org-level row — but it now records its owner), the ATS owner paragraph's new
sibling in `docs/features/integrations/README.md`, and the channel-resolution table in
`docs/features/comms/README.md`.

## Proofs — `app/_lib/comms-relay-org-scope.test.ts`

Shown RED first (commit `d4e3bc7d`), green after the fix:

| | | before |
|---|---|---|
| (a) | org A's relay refuses org B's message: zero fetches, a `failed` row naming both orgs, no candidate data in the reason | **red** |
| (b) | org A's relay delivers org A's own team's message, exactly once | green (the control) |
| (c) | a legacy NULL-owner row still delivers for a default-org workspace | **red** |
| (d) | an env relay delivers for every org even while a differently-owned row is stored | green (the control) |
| (e) | `POST /api/comms/relay` stamps the session org and ignores `ownerOrgId` in the body | **red** |

The two that were already green are what make the red ones non-vacuous: "no POST
happened" is also what an unconfigured relay looks like, so (b) is the same send shape
delivering once when the orgs match.

Pipeline/org/workspace helpers are imported from their **slice** modules
(`./db/pipeline.ts`, `./db/organizations.ts`, `./db/workspaces.ts`), never the `db.ts`
barrel — `perf-budget.json` caps barrel importers, which is what bit F-1 in `f1ca35a2`.

## Gates

`typecheck`, `lint` (0 errors) and `test:unit` pass. `test:perf` and `test:docs` were
already red on the base commit for reasons that are not this change's (the static
import-graph budget, and an untracked `docs/design/app-contest-kit.md` in the operator's
checkout); both were re-run and neither got worse — `test:perf` reports the same 58
over-budget entries before and after.
