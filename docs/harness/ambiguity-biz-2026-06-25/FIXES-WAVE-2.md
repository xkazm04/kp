# Ambiguity+Business Fix Wave 2 — Cross-tenant isolation (keystone)

> 1 commit, 2 findings closed (1 Critical + 1 High) + 2 Criticals mitigated (gated non-exploitable).
> Baseline preserved: tsc 0 · JS unit 1020 → 1028 · Python unchanged · 0 regressions.

The whole cross-tenant theme has ONE root: multi-workspace ships and works, but only `analyses`/`profiles` are verified workspace-scoped while ~50 tables hold per-tenant PII/billing — and the only thing standing between that and a breach was an env flag (`KP_MULTI_WORKSPACE`) the docs *invite* operators to flip, with zero check that scoping is complete. Rather than half-migrate ~50 tables under one wave (high regression risk, several background/automation read paths), this wave makes the **flag self-defending** — the milestone the auth audit itself calls "the one that turns the upsell on safely" — which neutralizes the *exploitability* of every blind read at once.

## Commit

| # | Commit | Findings | Sev | Files |
|---|---|---|---|---|
| 1 | `e0d3e5a` | self-defending `KP_MULTI_WORKSPACE` + machine-checked tenancy manifest | C+H | tenancy.ts (new), tenancy.test.ts (new), db/core.ts, workspace-lock.ts |

## What was fixed

**Self-defending tenancy flag (auth #1 C + #2 H).** New canonical `tenancy.ts`:
- `TENANCY_SCOPED_TABLES` — only tables whose read+write paths are *verified* workspace-scoped (each has a `*-tenancy.test.ts`): currently `analyses`, `profiles`. A table that merely carries the column but has a blind read (e.g. `pipeline_entries`) is **not** listed — it's an honest gap.
- `TENANCY_EXEMPT_TABLES` — a short allowlist of genuinely-global tables (the tenant registry, content-hash caches, deployment config, scheduler/system).
- `tenancyGaps()` — everything else is a gap **by default** (fail closed), so a newly-added table can't silently re-open a cross-tenant hole.
- `assertTenancyReady(tables, multiWorkspace)` — wired into `ensureDb()`: when `KP_MULTI_WORKSPACE` is on but any per-tenant table is unscoped, it **refuses to boot** with a loud, actionable error listing the gaps, instead of serving cross-tenant data. No-op in the default single-tenant lock.

The drifted free-text comment in `workspace-lock.ts` (which under-reported *and* over-promised the scoped set) now points at the manifest as the single source of truth.

### Why this closes the theme safely

With the flag gated, every still-blind read — the analytics aggregates (`pipelineAnalytics`/decision-log/spend over `pipeline_events`), `listPipeline()`, `/api/pipeline/[id]/timeline` — is **non-exploitable**: the app is either single-tenant (one workspace, nothing to leak) or it refused to start because scoping is incomplete. The blind reads change from an *active breach* into an *incomplete feature* that the manifest now tracks.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| JS unit (`node --test`) | 1020 | 1028 |
| Python | 694 OK / 4 skip | (untouched) |

## Patterns established (catalogue items 5–6)

5. **Gate the flag, don't half-migrate the tables.** When a dangerous capability is guarded only by an advisory env flag, the cheapest *safe* fix is to make the flag self-defending (refuse to enable into an unsafe state) — a regression-proof keystone that buys time to finish the real migration, vs. a risky partial migration that touches every read path at once.
6. **Fail-closed manifest over a prose checklist.** A free-text "which tables are scoped" comment drifts silently. Replace it with a machine-checked allowlist where *new = required-by-default*, plus a boot assertion, so the "are we ready to flip the flag?" question has one honest, enforced answer.

## What remains (tracked follow-up — the concrete read-scoping)

The per-table scoping that lets each table *graduate* into `TENANCY_SCOPED_TABLES` (and lift the gate):
- **`pipeline_entries`**: scope `listPipeline()` + `createPipelineEntry` to `currentWorkspace()` across ~7 read callers / ~4 write callers (several are background/automation paths needing an explicit workspaceId, not the request resolver). Column is already backfilled `NOT NULL DEFAULT 'workspace'`, so single-tenant is unaffected — but the caller surface makes it its own focused change.
- **Analytics aggregates (analytics #1 C)**: thread `currentWorkspace()` into `pipelineAnalytics`/`listPipelineEvents`/`countPipelineEvents`/`listChannelSpend`. Needs a `pipeline_events.workspace_id` column + backfill first (it has none today).
- **`/api/pipeline` + `/timeline` (pipeline-board #3 C)**: same `listPipeline` scoping; the unauth framing is mitigated by `proxy.ts` + the gate, the cross-tenant half by the above.

Each is a clean unit that adds a `*-tenancy.test.ts` and appends the table to the manifest — at which point `assertTenancyReady` enforces it forever.
