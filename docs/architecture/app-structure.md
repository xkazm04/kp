# App structure — `app/features/**`

Status: **refactor complete and stable** (verified 2026-07-30 against the live
tree). Three rules apply to `app/features/**`:

1. **No `.tsx` over 200 lines.** Anything larger is split into modules.
2. **Every module in a feature folder starts with that feature's name** —
   `PipelineBoard.tsx`, `PipelineCandidateDrawer.tsx`, `pipelineBoardFilters.ts`
   — so a file's home is readable from its name alone and the folder sorts by
   role. PascalCase for `.tsx` components, camelCase for `.ts` helpers.
3. **The folder tree mirrors the app's menu** — `hiring/pipeline`,
   `insights/matrix`, `settings/billing`. A feature with internal structure
   nests further (`hiring/decisions/groupEval`).

Scope is `app/features/**` only. `app/_components/**` (shared UI), `app/_lib/**`
(business logic) and the public route pages keep their own homes — they have
no position in the menu, so rule 3 doesn't apply to them, and rule 1 has not
been extended to them.

## Live tree (confirmed on disk)

```
app/features/
  hiring/       channels, decisions (+groupEval), onboarding, pipeline, schedule
  library/      jds, jobs
  insights/     about, analytics, matrix
  settings/     billing, branding, models, organization, workspace
  tools/        analyze, devcases, interview, match, profile
  shell/        Workspace.tsx + nav/, simulation/, tasks/, setup/ (the frame
                the menu lives in — sidebar, command palette, keyboard chords,
                tab catalog, background tasks, simulation dock)
  shared/       cross-cutting types/logic with 2+ feature-group consumers
                (MatchPresentation, decisionsTypes, groupEvalTypes,
                matchTypes, pipelineTypes, profileTypes, renderTemplate, …)
```

This matches the refactor's target 1:1 (menu group → tab → folder). `shell/`
is not a menu entry.

## Why `shared/` exists

Before the refactor, three things made the tree impossible to split cleanly:

- `sub_match/MatchTypes` + `MatchShared` were imported by Hiring, Library and
  Insights;
- `app/_lib` imported *upward* into feature internals (`attention.ts` →
  `PipelineTypes`, `group-eval-run.ts` → `MatchTypes` + group-eval types,
  `candidate-timeline.ts` → `DecisionsTypes`, `archetype-registry.ts` →
  `ProfileTypes`, `templates-store.ts` → `render-template`, …);
- the shell (`simulation/`, `setup/`) reached into `sub_pipeline`,
  `sub_decisions` and `sub_organization`.

Anything with more than one feature-group consumer now lives in
`app/features/shared/`. Nothing in `shared/` may import from a feature group —
the dependency runs one way.

## Pinned filenames

These are imported by path from outside their owning directory (the shell or
a route page) — renaming them requires a coordinated cross-tree update, not a
local one: `hiring/pipeline/CommandBar.tsx`, `hiring/pipeline/SchedulerControl.tsx`,
`hiring/pipeline/PassPreviewModal.tsx`, `hiring/decisions/GroupEvalModal.tsx`.

Some tests read component source as *text* rather than importing it (path-
and-string assertions) — a rename or split must update these too:
`tools/devcases/DevTab.approve-error.test.ts`,
`insights/analytics/analyticsCalibrationFamilyApplyGate.test.ts`,
`tools/analyze/analyzeDropRouting.test.ts`,
`tools/analyze/analyzeFileIntakeGate.test.ts`,
`hiring/decisions/groupEval/groupEvalComparisonLeadCrown.test.ts`, plus
`app/api/jds/save/save-ingest-contract.test.ts` and `app/_lib/fit-thresholds.test.ts`
outside the features tree.
(The four `app/features/**` ones were themselves renamed by the refactor — the area prefix is part
of the new naming convention. `rg -l readFileSync --glob '**/*.test.ts*' app/`
lists all 109 source-reading tests if you need the full set.)

## Outcome, as landed

| Group | `.tsx` | `.ts` | LOC |
|---|---|---|---|
| hiring | 139 | 60 | 21832 |
| library | 55 | 41 | 9276 |
| tools | 81 | 55 | 13486 |
| insights | 51 | 14 | 6809 |
| settings | 25 | 16 | 3884 |
| shell | 50 | 43 | 9087 |
| shared | 2 | 13 | 2031 |

At landing: 403 `.tsx` files, none over 200 lines (largest exactly 200);
`tsc --noEmit` clean, 2401/2401 unit tests, i18n parity 4126 keys × 4 locales,
eslint byte-identical in count/breakdown to the pre-refactor baseline, dev-server
smoke of `/`, `/diagrams`, `/about`, `/?tab=analytics` all 200.

## Drift since landing (found 2026-07-30)

The 200-line cap has crept on 5 files as features grew — this is normal
maintenance drift, not a broken refactor, but worth a cleanup pass:

- `hiring/decisions/groupEval/GroupEvalComparisonTable.tsx` — 267 lines
- `tools/devcases/DevLifecycleRow.tsx` — 212 lines
- `hiring/channels/ChannelsCommsTable.tsx` — 203 lines
- `shell/WorkspaceCommandPalette.tsx` — 202 lines
- `hiring/decisions/groupEval/GroupEvalPerCandidateTabs.tsx` — 202 lines

None are large overruns (worst is +67 lines); splitting them the same way the
original refactor split larger files would restore the invariant.

## Known drift `context-map.json` should already reflect

The original refactor plan noted `context-map.json` would go stale
immediately after the move (it pinned 214 exact pre-refactor paths). The map
now shows the new `app/features/{hiring,insights,library,settings,shared,
shell,tools}/**` paths, so that regeneration has already happened — treat the
map as trustworthy for this area going forward, not as a hangover from the
refactor.

Historical artefacts (`docs/harness/**` scan reports, `uat/**`, `casesim/**`,
`.claude/commands/backlog/*.md`) may still cite pre-refactor paths
(`sub_pipeline/`, `sub_jobs/`, etc.) — these are records of what was true at
the time and are deliberately left alone.
