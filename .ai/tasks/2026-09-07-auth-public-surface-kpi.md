# KPI: Public API surface (Authentication & Access Control)

**Wake 7** of the "Project KPI and coverage stewardship" charter, branch
`autopilot/project-kpi-and-coverage-stewardship-7`, 2026-09-07.

## What this closes

The **Authentication & Access Control** context group (`7ba33618-644e-4341-9a6f-1abb58067d28`)
carried **zero** KPIs (active or proposed) — one of ~17 bare groups of the 25 in
the Personas project DB. Its whole reason to exist is the fail-closed auth gate in
`proxy.ts`, whose public allow-list (`app/_lib/auth/public-routes.ts`) is exactly
the deployment's unauthenticated-at-proxy attack surface. Nothing was watching that
surface's size across the portfolio.

## The KPI

- **Name:** Public API surface (unauthenticated-at-proxy route count)
- **Group:** Authentication & Access Control
- **measure_kind:** `codebase` · **unit:** routes · **direction:** `down` (a ratchet — hold, never widen unreviewed)
- **baseline / current:** **30** · **target:** **30** (ceiling; any increase is a widening that must be justified the way the existing 30 are)
- **env:** `production` — the auth surface is byte-identical to `origin/main`
  (`git diff origin/main -- app/_lib/auth/public-routes.ts 'app/api/**/route.ts' proxy.ts docs/architecture/api-reference.md` is empty), so this branch's tree == main's tree for the measured files.

### Reproducible measurement (runs from repo root, keyless, node-only)

```
npm run api:check >/dev/null 2>&1 && grep -cE '^\|.*\| public \|$' docs/architecture/api-reference.md
# -> 30   (exit 0)
```

`docs/architecture/api-reference.md` is **generated from the tree** and kept in
lockstep by the `api:check` CI gate, whose Auth column is *computed by calling the
same `isPublicPath()` predicate `proxy.ts` uses* — not a second hand-maintained
list. Running `api:check` first asserts doc == tree, so the count is the tree's,
not a stale doc's. `api:check` confirmed all **207** routes and their posture in
sync (exit 0).

### The measured surface, 2026-09-07 @ `66ee5f0d` (auth files == `origin/main` `0a7936c7`)

- **207** total `app/api/**/route.ts` routes: **30 public**, **177 gated**.
- All 30 public routes are legitimate doors that carry their own credential:
  capability tokens (`/api/schedule/[token]`, `/api/offer/[token]`,
  `/api/status/[token]`, `/api/data/[token]`, `/api/invite/[token]`,
  `/api/agents/report/[token]`, `/api/skill-profile/[token]/verify`), machine
  webhooks with a shared secret (`/api/billing/webhook`, `/api/comms/callback`,
  `/api/devcase/inbound`, `/api/channels/inbound/[token]`), and the genuinely-open
  entry surface (`/api/health`, `/api/demo`, `/api/extract-text`, `/api/auth/*`,
  `/api/apply/*`).

### Why a KPI and not just the gate

`api:check` catches **drift** (doc vs tree) but not a **deliberate** widening: a
correctly-regenerated new `public` row passes CI, relying on a human reviewer to
notice it. The KPI's `current_value` rising is the portfolio-side signal that the
unauthenticated surface grew — independent of whether the doc was regenerated. See
the filed backlog item for the contract-test ratchet that would make widening a
deliberate, asserted change.

## Defense-in-depth cross-check (recorded so the next wake need not re-alarm)

A first narrow grep (`requireOperator|isOperator|requireSession|requireWorkspace`)
suggested "72 gated routes with no in-handler check" — **that was a false alarm and
was NOT filed.** The auth layer uses a rich vocabulary
(`requireCapability(Coded)`, `requireOrgCapability`, `requireWorkspaceCapability`,
`requireBillingAuthority`, `currentWorkspace(Id)`, `currentUser(Id)`,
`callerCapabilities`, `isOperator`…). Recounting honestly over that vocabulary:

- **177 gated routes; 175 (98.9%) reference the session/workspace layer in-handler;
  117 (66.1%) call an explicit authorizing helper.**
- Only **2** gated routes reference no session helper at all, and **both are
  intentional and documented**: `/api/me/capabilities` (a principal reading its own
  capability set via `callerCapabilities()` — "learns nothing they did not already
  have") and `/api/benchmarks/salary` (aggregate-only, min-cohort-guarded,
  PII-free deployment-wide reference corpus, no workspace scope by design).

So the in-handler defense-in-depth posture is sound; there is no gap to file there.

## Revert / rebind

- KPI created through the Personas bridge `POST /dev-tools/kpis` (no dedup — checked
  first: group had 0 KPIs, no auth/route/public-named KPI existed anywhere in the
  project). To undo: retire the KPI via a human `kpi-decision` (workers may only
  propose/activate). The reading is in `dev_kpi_measurements`.
- This file + the KPI are the only artifacts; no source was changed.
