---
kind: task
status: kpi-wired
opened: 2026-09-07
run: kpi-stewardship-11
registry_subject: software-engineering/api-design/error-handling/information-disclosure
registry_technique: ratchet-owned-by-a-metric
size: KPI + meter script (this change); the fix backlog is 5 handlers, ~3-6 lines net each plus 4 catalogue entries per code
gate: node scripts/kpi/analytics-error-hygiene.mjs ; npm run test:unit (error-response-contract.test.ts)
measurable: handlers in the Analytics & Reporting group's API surface that hand a RAW thrown error's message to the client. Today 5; the target is 0.
---

# Give the Analytics & Reporting group a KPI that owns its raw-error-leak descent

## Why this group, this cycle

Coverage read (personas.db `dev_*`, project a9a1ef97): **25 groups, 12 bare** (no
active or proposed KPI); only **7 of 285 contexts** carry an active context-bound KPI.
**Analytics & Reporting** (15 contexts, feature domain, the operator-facing
insights/matching/profile surface) was bare. It is the second-largest *feature* gap and
the largest whose own files carry a deterministic, keyless, movable number.

## The number, measured

`node scripts/kpi/analytics-error-hygiene.mjs` → **5**:

```
Analytics & Reporting API error-response debt = 5 across 5 route file(s)
  - analytics/route.ts (1)                              LEAK
  - analytics/calibration/route.ts (1)                 FORWARD
  - analytics/calibration/band/route.ts (1)            FORWARD
  - analytics/calibration/threshold-history/route.ts (1) FORWARD
  - profile/draft/route.ts (1)                         FORWARD
```

Source of truth is the `LEAK_CEILING` + `FORWARD_CEILING` maps in
`app/api/error-response-contract.test.ts` (byte-identical to origin/main), intersected
with the 16 API routes the Analytics & Reporting group owns in the context map. The meter
prints ONLY the integer to stdout (parse `regex:([0-9.]+)`); the breakdown goes to stderr.

Offenders verified **current, not stale ceilings**:
- `app/api/analytics/route.ts:55-56` — `const message = error instanceof Error ? error.message : "…"; return NextResponse.json({ error: message }, { status: 500 })`.
- `app/api/analytics/calibration/route.ts:163` — `return jsonError(error, "Failed to compute calibration.")`.

A leaked `.message` can carry `SQLITE_*` codes, a `UNIQUE constraint failed: …` string,
the absolute db path, or a Python traceback (`docs/architecture/api-contracts.md §1.1`),
and the client cannot localize it.

## Why a KPI and not just the gate

`error-response-contract.test.ts` is a **ratchet**: it stops the count from GROWING past
each file's ceiling and notes a file that dropped below, but it never drives the number to
0 and it is repo-wide, so no bare group had a number owning its own descent. This KPI is
the group's slice, target 0.

## Personas write-back (this run)

- KPI **`d0aabb73-2f5c-4761-8f64-37792d4ba833`** "Analytics API raw-error leak count"
  (group `c877b467…`, context `pipeline-analytics`, `measure_kind=codebase`,
  `direction=down`, baseline=5, target=0, **active**). Reading `f88dbae0` value=5 (env
  production) rolled `current_value`.
- Backlog **`798bb9c6…`** "Close the Analytics API raw-error leaks (KPI d0aabb73: 5 → 0)"
  — names all 5 offenders and the per-handler fix (`safeJsonError(error, "api:<route>",
  "<CODE>")` + `STORE_ERRORS` code + 4 catalogue entries + delete the ceiling row).

## Back-measure (charter requires a prior claim re-checked)

Billing KPI **`eae57d2f…`** "Allowance over-grant anchors" re-measured this run:
`node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --test app/_lib/billing/period-anchor.test.ts`
→ 3/3 pass, **9 of 10 anchors** still over-grant. Reading `c82cf230` value=9 (production).
The re-keying fix has not landed, so the number legitimately has not moved — stability
recorded, not movement.

## Revert / hand-off

- New source file: `scripts/kpi/analytics-error-hygiene.mjs` (additive; no package.json
  edit — the KPI's `measure_config.cmd` points at the script path directly). To retire the
  KPI, set `d0aabb73` status via the bridge and delete the script.
- The meter must reach `main` for the evaluator to auto-run it; until then the reading was
  supplied by hand (the value is a property of the contract file, which is on main).
