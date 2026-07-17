# Fix Wave 2 — Workspace/tenancy scoping bypass

> 6 findings closed in 6 atomic commits (all High). Single shared fix shape: thread the caller's `workspaceId`.
> Baseline preserved: tsc 0 → 0 errors; node unit suite 2336 → 2345 pass, 0 fail, 0 regressions.
> Branch: `vibeman/ambiguity-ui-wave1` (continues Wave 1).

## Commits

| # | Commit | Finding closed | Files |
|---|---|---|---|
| 1 | `379f251` | screen-wave reads config from default workspace | `screen-wave.ts` (+tenancy test) |
| 2 | `de13789` | JD generate/retry resolve template without workspace | `jds/generate`, `jds/[slug]/retry-analysis` (+test) |
| 3 | `0e74fa5` | job close route withdraws entries on default workspace | `jobs/[id]/close/route.ts` (+test) |
| 4 | `1608267` | offer accept/decline hard-code default workspace | `offers-store.ts`, `offer-finalize.ts` (+behavioral test) |
| 5 | `1ab0093` | onboarding list/create route ignores workspace | `api/onboarding/route.ts` (+test) |
| 6 | `c684afd` | rediscovery Refresh sweeps the default tenant | `rediscover.ts`, `rediscovery/alerts/route.ts` (+test) |

## The shared root cause

Every finding is the same shape: a store/DB function has a **defaulted** `workspaceId` parameter (`= DEFAULT_WORKSPACE_ID`), so a call site that forgets to pass it type-checks fine and silently operates on the default tenant. The auth layer itself is sound — the bug is unthreaded calls at the seams:

- **screen-wave** — `getDecisionConfig("screening")` was the one read in the wave that omitted `workspaceId`; a team's saved `familyFloors` (never in the modal override) came from the wrong tenant, and the sealed record attested to a floor they never set.
- **JD templates** — `getTemplate(templateId)` bare read the default team's templates: a non-default team's private choice was silently dropped (AI-default layout), and a default-team *private* template leaked cross-tenant by id. Also now 400s an unresolved id instead of silently falling back.
- **job close** — `closeEntriesByJobId(id)` bare withdrew none of a non-default team's in-flight candidates (close reported `withdrawn:0`).
- **offers** — `rowToOffer` never mapped `workspace_id`, so accept/decline fell to the default: on a non-default team an accept said "accepted" but produced no Hired entry/onboarding, and a decline was dropped — with misdiagnosed audit events.
- **onboarding routes** — GET's `listRuns()/listTemplates()/listPipeline()` and POST's `createTemplate()` all defaulted; a team's runs were invisible to their own recruiters and template names leaked cross-tenant.
- **rediscovery Refresh** — the user-triggered sweep called `sweepRediscoveryAlerts({ signal })` with no workspace, ranking the default tenant's catalog while returning the session tenant's feed (counts contradicted the feed).

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| node unit suite | 2336 pass / 0 fail | 2345 pass / 0 fail |

Two fixes carry behavioral regressions that fail pre-fix (screen-wave familyFloors, offer accept→Hired / decline→closed); the four route-level fixes carry source-guards (the routes can't be driven behaviorally — `currentWorkspace()` reads cookies).

## Patterns established (catalogue items 7–9)

7. **Defaulted-workspace parameter footgun** — a DB/store function with `workspaceId: string = DEFAULT_WORKSPACE_ID` lets every call site silently fall to the default tenant and still type-check. Grep every caller of such a function; consider removing the default so the compiler forces each call site to decide (the finding suggested this for `getTemplate`).
8. **Half-wired tenancy (writes scoped, reads defaulted)** — a table gets `workspace_id` and the WRITE path stamps it (often via a related entity), but the READ path or a terminal transition still defaults. Check both directions per table; the write being correct hides the read bug in green tests that only exercise the default workspace.
9. **Row-mapper drops the tenant column** — a `rowToX` that omits `workspace_id` makes downstream code literally unable to pass the right tenant even when it wants to. When a table has `workspace_id`, its row mapper must surface it.

## What remains (deferred, with cause)

- **guided-pipeline-simulation #1 (High — public `/api/demo` PII exposure).** Still deferred: it's a half-built-tenancy architectural change (the `demoSessionAllowed()` flag vs. ~28 unscoped tables), not a `thread-workspaceId` fix.
- **billing `getBillingState` per-team vs shared-org ledger (High)** and **app-shell attention-badges default workspace (High)** — same theme, but they involve a per-org-vs-per-team ledger *policy* decision (billing) and a UI read; folded into a possible Wave 3.
- **job close ownership check** — flagged in Wave 2's close commit as needing a product decision on shared NULL-workspace seeded jobs (publish has the same gap).
