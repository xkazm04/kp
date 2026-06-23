> Total: 6 findings (0c critical, 2h high, 2m medium, 2l low)

## 1. Divergent stage-list copy: `PipelineTypes.STAGES` shadows the canonical `PIPELINE_STAGES`
- **Severity**: High
- **Category**: duplication
- **File**: app/features/sub_pipeline/PipelineTypes.ts:71 (consumers: PipelineBoard.tsx:9, PipelineTab.tsx:25, app/features/simulation/SimulationProvider.tsx:10) vs the canonical app/_lib/pipeline-stages.ts:12
- **Scenario**: `PipelineTypes.STAGES = ["Accepted","Screened","Interview","Offer","Hired"]` is a hand-maintained, untyped (`string[]`, not `as const`) literal copy of the canonical `PIPELINE_STAGES` (`pipeline-stages.ts`, re-exported through db.ts). Within the SAME feature the two sources are both live: `CandidateDrawer.tsx:19` imports the canonical `PIPELINE_STAGES`, while `PipelineBoard`/`PipelineTab` import the loose `STAGES` copy. `grep -rn '"Accepted", "Screened", "Interview", "Offer", "Hired"'` shows four literal copies of this exact array (PipelineTypes, DecisionsTypes, pipeline-stages, + a test assertion). Sync is enforced only by the comment "mirrors db.ts PIPELINE_STAGES" (PipelineTypes.ts:67).
- **Root cause**: The board's client-only `PipelineTypes` predates / sits parallel to the pure `pipeline-stages` module; the drawer was later wired to the canonical source, leaving two stage axes in one feature.
- **Impact**: A stage rename/reorder must be applied in two places by hand; the drawer's move dropdown (`PIPELINE_STAGES`) and the board's columns (`STAGES`) can silently disagree. The loose `string[]` typing also loses the `PipelineStage` literal union the canonical const provides.
- **Fix sketch**: Replace `PipelineTypes.STAGES` with a re-export: `export { PIPELINE_STAGES as STAGES } from "@/app/_lib/pipeline-stages"` (or import + `export const STAGES = PIPELINE_STAGES`). `pipeline-stages.ts` is DB-free, so it's safe in the client bundle (CandidateDrawer already imports it). Verify `STAGES.includes(...)` / `.map(...)` call sites still typecheck against the `as const` tuple.

## 2. `PipelineShared` over-exports the event taxonomy (only `EVENT_CATALOG` need leave the file)
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/sub_pipeline/PipelineShared.tsx:29 (`EVENT_KINDS`), :48 (`EventKind`), :87 (`isEventKind`)
- **Scenario**: `EVENT_KINDS`, `EventKind`, and `isEventKind` are `export`ed but consumed only inside PipelineShared (by `EventDot` and `useEventVerb`). `grep -rn "EVENT_KINDS\|EventKind\b\|isEventKind\|EVENT_CATALOG" app` returns no importers outside this file — the only external matches are unrelated symbols (`MOMENTUM_EVENT_KINDS`, `ProcessEventKind`, `ConsentEventKind`). `EVENT_CATALOG` is likewise export-only-used-internally. So the public surface is wider than the actual usage.
- **Root cause**: Symbols exported defensively ("might be reused") when the taxonomy was promoted to a typed union; no consumer ever materialized.
- **Impact**: Low maintenance, but the broad export surface implies these are shared API and discourages refactoring/renaming. Minor false-signal for "what's reusable here".
- **Fix sketch**: Drop `export` from `EVENT_KINDS`, `EventKind`, `isEventKind`, and `EVENT_CATALOG` (keep them module-local). If a future cross-file consumer appears, re-export then. No call-site changes needed today.

## 3. `Position.family` is computed and plumbed but never read
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/sub_pipeline/PipelineTypes.ts:43 (type), app/features/sub_pipeline/PipelineTab.tsx:67 (set in `groupPositions`)
- **Scenario**: `Position` declares `family: string`, and `groupPositions` populates it (`family: e.roleFamily ?? ""`), but `PipelineBoard` reads only `pos.id`, `pos.title`, `pos.count` (PipelineBoard.tsx:254-271). `grep -rn "\.family" app/features/sub_pipeline` shows the field is only ever written, never read; `roleFamily` itself is used nowhere else in the feature except this one assignment.
- **Root cause**: A lane was originally going to show its role family; the UI shipped without it but the data plumbing stayed.
- **Impact**: Dead field on a shared producer/consumer type, plus an unnecessary `roleFamily` dependency in `groupPositions`. Reads as "this is used" when triaging the type.
- **Fix sketch**: Remove `family` from `Position` and drop it from the `groupPositions` object literal. If role-family display is still desired, that's a feature task, not retained dead plumbing.

## 4. `NOTE_MAX` (drawer) and `MAX_NOTES_LENGTH` (route) are an uncoordinated magic-number pair
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_pipeline/CandidateDrawer.tsx:44 (`NOTE_MAX = 4000`), app/api/pipeline/[id]/route.ts:17 (`MAX_NOTES_LENGTH = 4000`)
- **Scenario**: The drawer caps the note textarea at `NOTE_MAX = 4000` "to mirror MAX_NOTES_LENGTH" (comment, CandidateDrawer.tsx:42-43); the route independently rejects `> MAX_NOTES_LENGTH = 4000`. Two literals kept equal by a comment. Confirmed via `grep -rn "NOTE_MAX\|MAX_NOTES_LENGTH\|4000"`.
- **Root cause**: Client and server bound declared separately; no shared constant exists for the note length.
- **Impact**: If one value changes the other won't — the textarea could let a recruiter type a note the route then 400s, or vice-versa. Low blast radius (single field).
- **Fix sketch**: Export one constant (e.g. `PIPELINE_NOTE_MAX_LENGTH`) from a pure shared module the client can import (the existing `pipeline-stages.ts` style, or a small `pipeline-limits.ts`) and reference it in both the route's check and the textarea's `maxLength`.

## 5. `affected(cmd)` runs `listPipeline()` + filter twice per command preview
- **Severity**: Low
- **Category**: duplication
- **File**: app/api/pipeline/command/route.ts:63-64
- **Scenario**: In the preview branch, `affected(cmd)` is called once for `rows` (line 63) and again for `total` (line 64). Each call re-runs `listPipeline()` (a full DB read of all active entries) and re-applies the score/job filter. So every non-`run_policy` preview does the same scan twice.
- **Root cause**: Convenience inline calls; the result wasn't hoisted.
- **Impact**: Doubles the DB read + filter work on each command preview keystroke-confirm. Functionally harmless, mild waste; trivially avoidable.
- **Fix sketch**: Hoist once: `const hits = affected(cmd);` then `const rows = hits.slice(0, PREVIEW_CAP).map(toRow);` and `const total = cmd.kind === "run_policy" ? null : hits.length;`.

## 6. `CandidateRow` aging tooltip uses default SLAs, ignoring the per-board overrides the board styled with
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_pipeline/PipelineShared.tsx:202 (`slaForStage(entry.stage)`) vs app/features/sub_pipeline/PipelineTab.tsx:287/307 (`slaForStage(e.stage, slaOverrides)`)
- **Scenario**: The board decides "is this card stale?" with the recruiter's per-stage overrides (`isStale` and the `aging` quick-filter both pass `slaOverrides` to `slaForStage`). But the row's own tooltip recomputes the threshold WITHOUT overrides — `slaForStage(entry.stage)` (PipelineShared.tsx:202) — because `CandidateRow` isn't given the overrides. So a card flagged stale at a custom 3-day Offer SLA shows the default "X days" in its hover text. The staleness logic is effectively duplicated (board with overrides, row with defaults) instead of sourced once.
- **Root cause**: `slaOverrides` lives in `PipelineTab` and is threaded into `isStale` but not down through `PipelineBoard` → `StageCell` → `CandidateRow`, so the row falls back to the no-override call.
- **Impact**: A cosmetic copy-mismatch (tooltip days disagree with why the card is amber) and a second, drifting place that "knows" the SLA. Low severity — display only.
- **Fix sketch**: Either pass the already-computed stale-day number down to `CandidateRow` (the board already calls `isStale(e)`), or thread `slaOverrides` through the board props so the row's tooltip uses the same threshold the styling did — removing the parallel default-only computation.
