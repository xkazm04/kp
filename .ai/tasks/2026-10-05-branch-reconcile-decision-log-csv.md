# Branch reconcile: decision-log CSV export (a2312c5ac) onto main

Date: 2026-10-05 · Charter: accepted-idea-delivery · Branch: `autopilot/accepted-idea-delivery-70823f91`

## Result: ported in one commit, not superseded

Source `autopilot/export-decision-log-to-csv-from-the-decisions-ta` (`a2312c5ac`, 2026-09-21).

**Reconcile first.** Main already had the CSV, but only on Insights → Analytics
(`app/features/insights/analytics/sections/DecisionLogTable.tsx`: `exportCsv` for the page,
`exportTrail` for the whole trail, local time + ISO + the scope and filters stamped in the file).
Its columns, clock and filter stamping matched the branch's extraction line for line. The branch's
claim was the entry point, and that was still missing: `git grep -n -i "decision-log\|exportTrail\|decisionLogCsv"`
over `app/features/hiring/` found nothing. `DecisionsHeader.tsx` no longer exists; the Decisions
tab's tools row now lives in `app/features/hiring/decisions/docket/DocketHead.tsx`.

**What was ported.** The branch's code, tests and docs applied cleanly with `git apply`, minus the
header edit and the four message catalogs:

- `decisionLogCsv.ts` (pure builder, `decisionLogUrl`, `collectDecisionTrail`) and
  `useDecisionLogExport.ts` (wiring), lifted out of `DecisionLogTable.tsx` because both surfaces need them.
- The source guards in `auditRow.test.ts` and `analyticsFetchError.test.ts` follow the code to the new
  modules; the `\b` regex repair in the latter is kept.
- The catalogs were edited by hand at main's line numbers (`decisions.exportLog`, `exportLogTitle`,
  `analytics.log.scopeTrailCapped`), in all four locales.

## Deviations from a2312c5ac

1. **The control goes in `DocketHead.tsx`**, beside Rules and the reconsider chip.
2. **The control is the kit `Button`** (`loading` + `loadingLabel`), not `AnalyticsExportButton`, which
   hand-rolls its classes. It still fires `track("analytics_export", ...)` with the same artifact name.
3. **The failure line uses `NOTICE("critical")` + `text-meta`.** The branch's raw `text-sm text-red-700`
   would have added two undeclared entries to the style ratchet.
4. **One added test** in `decisionLogCsv.test.ts`: the header's query and the table's default query are
   the same URL, and a trail collected through either path serializes to identical rows.

## Verification

- `npx tsc --noEmit` exit 0; `npm run lint` 0 errors; `npm run i18n:check` and `npm run design:check` OK.
- `npm run test:unit -- "app/features/insights/analytics/**/*.test.ts"`: 227/227.
- Inherited, not from this change: `style-debt.test.ts` is red on main with many undeclared/grown files
  (none of them in this change's files), and the api gate shows the four `app/api/interview/*` failures
  recorded in `2026-10-05-branch-reconcile-session-revocation.md`.
