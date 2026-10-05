# Branch reconcile: compliance regime (2026-10-05)

Charter `accepted-idea-delivery`, run 9dc691ca, base `main` @ e3eb8a36d.

## Idea 82f587c9 — role->slate, `pipeline_entries.population`

Already on main. `app/_lib/db/core.ts` declares `population TEXT NOT NULL DEFAULT 'human'`
(CREATE TABLE, line 608) and the matching `ALTER TABLE pipeline_entries ADD COLUMN population ...`
(line 1875); `app/_lib/db/role-slate.ts` exists. Carrier: **0c6993773**
("feat(slate): put people and AI agents on one board under the frozen role rubric"). Nothing missing.

## Idea aebdffef — main cannot build (14 files import `@/app/_components/kit/scene`)

Already on main. `app/_components/kit/scene/` exists (index.ts, Halos, LevelFrame, ...).
Carrier: **84fa0c95e**. `npm run typecheck` passes at this base (exit 0). Note: `origin/main`
(541617fc3) does NOT have it until the operator pushes; pushing was not this run's job.

## Port: autopilot/the-compliance-regime-is-resolved-by-a-client-fe

Cherry-picked 55c7ab846 (clean, no conflicts) as ff82ed7c5. Touches only
`app/_lib/decision-config-store.ts` (JSDoc), `docs/features/compliance/README.md`,
`docs/features/compliance/ai-act-conformity.md`. Re-checked each claim against main:
`disclosureComplianceFor` is called by 7 public surfaces (apply, apply/quick, devcase apply,
interview, offer, schedule, status); `GET /api/compliance` is absent from `public-routes.ts` and
read only by session callers. One correction instead of a verbatim port: the README row said
"Operator only", but the route has no `requireOperator` — it is gated by the proxy's
any-valid-session check — so it now says "Signed-in session only". Comments/docs only; no behaviour change.

## Superseded branch

`autopilot/implement-the-jd-to-offer-pipeline-with-approval-3` is superseded on main by
a660083b0 / f6be0f24b (`role-run-engine.ts`, `role-run-gates.ts`, `role-run-stages.ts`) and needs no port.
