# Feature structure refactor

Three rules, applied to `app/features/**`:

1. **No `.tsx` over 200 lines.** Anything larger is split into modules.
2. **Every module in a feature folder starts with that feature's name** — `PipelineBoard.tsx`,
   `PipelineCandidateDrawer.tsx`, `pipelineBoardFilters.ts` — so a file's home is
   readable from its name alone and the folder sorts by role.
   PascalCase for `.tsx` components, camelCase for `.ts` helpers.
3. **The folder tree mirrors the app's menu** — `hiring/pipeline`, `insights/matrix`,
   `settings/billing`. A feature with internal structure nests further
   (`hiring/decisions/groupEval`).

Scope is `app/features/**` only. `app/_components/**` (shared UI), `app/_lib/**`
(business logic) and the public route pages keep their current homes — they have
no position in the menu, so rule 3 cannot apply to them, and rule 1 is not being
extended to them in this pass.

## Target tree

| Menu group | Tab | Old | New |
|---|---|---|---|
| Hiring | Pipeline | `sub_pipeline/` | `hiring/pipeline/` |
| | Channels | `sub_channels/` | `hiring/channels/` |
| | Decisions | `sub_decisions/` | `hiring/decisions/` (+ `groupEval/`) |
| | Schedule | `sub_schedule/` | `hiring/schedule/` |
| | Onboarding | `sub_onboarding/` | `hiring/onboarding/` |
| Library | Jobs | `sub_jobs/` | `library/jobs/` |
| | Job descriptions | `sub_library/` | `library/jds/` |
| Tools | Profile | `sub_profile/` | `tools/profile/` |
| | Match | `sub_match/` | `tools/match/` |
| | Analyze | `sub_analyze/` | `tools/analyze/` |
| | (Analyze history) | `sub_history/` | `tools/analyze/history/` |
| | Interview sim | `sub_interview/` | `tools/interview/` |
| | Dev cases | `sub_dev/` | `tools/devcases/` |
| Insights | Analytics | `sub_analytics/` | `insights/analytics/` |
| | Matrix | `sub_matrix/` | `insights/matrix/` |
| | About | `sub_about/` | `insights/about/` |
| Settings | Organization | `sub_organization/` | `settings/organization/` |
| | Branding | `sub_branding/` | `settings/branding/` |
| | Billing | `sub_billing/` | `settings/billing/` |
| | Models | `sub_models/` | `settings/models/` |
| | Workspace | `sub_workspace/` | `settings/workspace/` |
| Layout (shell) | the menu itself, theme/language, control centre | `Workspace.tsx`, `nav/`, `simulation/`, `tasks/`, `setup/`, root modules | `shell/`, `shell/nav/`, `shell/simulation/`, `shell/tasks/`, `shell/setup/` |
| — | cross-cutting | (scattered) | `shared/` |

`shell/` is not a menu entry; it is the frame the menu lives in (sidebar, command
palette, keyboard chords, tab catalog, background tasks, simulation dock).

## `shared/` — why it exists

Before this refactor, three things made the tree impossible to split cleanly:

- `sub_match/MatchTypes` + `MatchShared` were imported by Hiring, Library and Insights;
- `app/_lib` imported *upward* into feature internals (`attention.ts` → `PipelineTypes`,
  `group-eval-run.ts` → `MatchTypes` + group-eval types, `candidate-timeline.ts` →
  `DecisionsTypes`, `archetype-registry.ts` → `ProfileTypes`, `templates-store.ts` →
  `render-template`, …);
- the shell (`simulation/`, `setup/`) reached into `sub_pipeline`, `sub_decisions`
  and `sub_organization`.

Anything with more than one feature-group consumer now lives in
`app/features/shared/`. Nothing in `shared/` may import from a feature group —
the dependency runs one way.

## Execution

**Phase A (serial, orchestrator).** Create the tree, `git mv` whole directories,
hoist the cross-cutting modules into `shared/`, rewrite every import path in the
repo (features, `_lib`, `_components`, route pages, API routes, tests), update the
`eslint.config.mjs` feature globs. No file is renamed and no file is split in this
phase — it is a pure move, so it is verifiable by `tsc` + the test suite alone.

**Phase B (parallel, one agent per first-level module).** Inside its own tree each
agent applies rules 1 and 2: rename files to the feature prefix, split every `.tsx`
over 200 lines. Agents own disjoint directories.

**Phase C (serial, orchestrator).** Integration: the tab catalog, the shell's
dynamic imports, outside importers, then the full gate (typecheck, unit tests,
lint, i18n parity, dev-server smoke).

## Rules for the Phase B agents

- Stay inside your directory. The only files outside it you may edit are ones that
  *import a file you renamed* — and every such edit must be reported.
- **Pinned filenames** (the shell or a route page imports them by path and another
  agent owns that importer — do not rename these; the orchestrator handles them):
  `hiring/pipeline/CommandBar.tsx`, `hiring/pipeline/SchedulerControl.tsx`,
  `hiring/pipeline/PassPreviewModal.tsx`, `hiring/decisions/GroupEvalModal.tsx`.
- Splitting is not rewriting. Move code, keep behaviour. No prop renames, no
  restyling, no data-layer changes, no i18n key changes.
- A split file keeps the feature prefix: `PipelineTab.tsx` →
  `PipelineTab.tsx` + `PipelineHeader.tsx` + `PipelineFilters.tsx` + …
- Some tests read component source as *text* (`DevTab.approve-error.test.ts`,
  `calibration-family-apply-gate.test.ts`, `dropRouting.test.ts`,
  `file-intake-gate.test.ts`, `comparison-lead-crown.test.ts`,
  `save-ingest-contract.test.ts`, `fit-thresholds.test.ts`). If you rename or split
  a file one of these reads, update the test's path/assertion — a stale one fails
  loudly, which is the point.
- Verify with `npx tsc --noEmit` (ignore errors outside your tree — other agents are
  working) and `npx eslint` on what you changed.

## Outcome

| Group | `.tsx` | `.ts` | LOC |
|---|---|---|---|
| hiring | 139 | 60 | 21832 |
| library | 55 | 41 | 9276 |
| tools | 81 | 55 | 13486 |
| insights | 51 | 14 | 6809 |
| settings | 25 | 16 | 3884 |
| shell | 50 | 43 | 9087 |
| shared | 2 | 13 | 2031 |

403 `.tsx` files, **none over 200 lines** (largest: `DevLifecycleRow.tsx` at exactly
200). Was 199 `.tsx` with ~70 over the cap, the largest 1745.

Verified at the end of the refactor: `tsc --noEmit` clean · 2401/2401 unit tests ·
i18n parity 4126 keys × 4 locales · eslint 44 errors, byte-identical in count and
rule breakdown to the pre-refactor baseline (38 `i18next/no-literal-string`,
5 `react-hooks/set-state-in-effect`, 1 `react-hooks/immutability` — all
pre-existing) · dev-server smoke test of `/`, `/diagrams`, `/about`,
`/?tab=analytics` all 200 with no compile or runtime errors.

Two regressions the split introduced were caught and fixed rather than shipped:
16 `no-explicit-any` translator props (now the named `PipelineTranslator` /
`PipelineTabTranslator` / `SchedulerTranslator` types in
`hiring/pipeline/pipelineTranslator.ts`), and 45 `react-hooks/refs` errors from the
drawer reading state off one hook-returned object during render (now destructured).

## Known drift this creates

`context-map.json` pins 214 exact `app/features/**` paths and is generated by
Vibeman, not hand-edited. Every path in it is stale after Phase A. Regenerate it
from Vibeman after the refactor lands; its `audit` block will report the drift
until then. Historical artefacts (`docs/harness/**` scan reports, `uat/**`,
`casesim/**`, `.claude/commands/backlog/*.md`) also cite old paths and are
deliberately left alone — they are records of what was true at the time.
