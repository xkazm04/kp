# Code Refactor — Fix Wave 3: Contract-type single-sourcing

> 9 atomic commits, 10 findings closed (Theme C). Hand-copied wire/contract types replaced with imports of one canonical declaration.
> Baseline preserved: tsc 0 → 0 · unit 849 → 849. 0 false positives, 0 skips. All server→client type pulls used `import type` (no bundle impact).

## Commits

| # | Commit | Finding(s) | What |
|---|---|---|---|
| 1 | `2b0c797` | decisions #1 + #2 | `Comparison`/`Fairness`/`FairnessScheme` → client `group-eval/types.ts`; `ScoreDimension`/`Confidence` → `MatchTypes` (both edit one import block in `group-eval-run.ts`) |
| 2 | `8fb8006` | demo-sim #1 (**High**) | `WaveDecision` → canonical `ScreenDecision`; dropped `reasonCode`/`reasonParams` now flow to the sim modal |
| 3 | `a5771b4` | profile #3 | `ArchetypeChecklistItem` → client-safe `ProfileTypes`; kept the intentional `node:fs` `ArchetypeDef` split |
| 4 | `4069f95` | jd-library #2 | `RoleSpec` exported from `jd-build-run.ts`, imported by `ingest-job.ts`; left distinct `DevTypes.RoleSpec` alone |
| 5 | `5133136` | job-catalog #4 | `Rediscovered` imported from `rediscover.ts` |
| 6 | `1ba39d3` | pipeline-board #4 | `Position` moved to `PipelineTypes.ts`, imported by `PipelineTab`/`PipelineBoard` |
| 7 | `a3d39e5` | scheduling #3 | lossy 17-field `Invite` → `ScheduleInvite` |
| 8 | `3070626` | interview-prep #4 | local `Prep` recomposed from `RunOfShow`+`InterviewPrepProgress`+`Scorecard` |
| 9 | `352bd3b` | llm-settings #1 | named/exported `ProviderKeyMeta`, used on server return type + `KeysPanel` |

## What was fixed

Ten contract types that were hand-copied across a server/client boundary or between sibling modules — each a silent drift channel where a field added on one side never reaches the other. The standout was the **`WaveDecision` drift bug** (High): the sim's local copy had dropped DEC4's `reasonCode`/`reasonParams`, so the demo screening modal showed English-only rationales while the real Decisions modal localized them. Importing the canonical `ScreenDecision` reunites the shape and delivers the localization fields to the component.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 (re-run after every finding) |
| unit (node --test) | 849 | 849 / 0 fail |

## Patterns established (catalogue item 4)

4. **A duplicated wire type is a drift bug waiting to happen** — the `WaveDecision`/`ScreenDecision` case proves it had already bitten (localization silently lost on one branch). Single-source the producer's type and `import type` it on the consumer; the compiler then enforces the contract on every future field change.

## Follow-up

- **`WaveDecision` localization wiring** (deferred): the fields now reach `SimDecisionWave.tsx`, but that component is entirely hardcoded English (no `useTranslations`). Localizing just the rationale would mean introducing i18n into the whole component while surrounding strings stay English — a non-trivial UI change beyond a type-dedup wave. Ready to take up when desired.

## What remains

Waves 4–9 per INDEX.md.
