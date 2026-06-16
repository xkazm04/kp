> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

## 1. Group-eval contract types (`Comparison`, `Fairness`, `FairnessScheme`) duplicated verbatim across server and client
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/group-eval-run.ts:30-52` (producer) and `app/features/sub_decisions/group-eval/types.ts:5-24` (consumer)
- **Evidence**: The server run module and the client modal type module each hand-declare the same three shapes:
  - `Comparison = { headline: string; keyPoints: string[]; recommendation?: string }` — `group-eval-run.ts:32` vs `types.ts:5`, identical.
  - `FairnessScheme = { skills: number; career: number; personal: number }` — `group-eval-run.ts:39` vs `types.ts:12`, identical.
  - `Fairness = { labels; candidateIds; schemes; matrix; own; mean; ranking; weightNotes; weightSource? }` — `group-eval-run.ts:40-52` vs `types.ts:13-24`, identical field-for-field (both even carry the same `weightSource?` comment).
  These are two ends of ONE wire contract: `runGroupEval` builds `payload.comparison`/`payload.fairness`, persists it (`saveGroupEval`), and the modal reads it back as `GroupEvalPayload`. They MUST stay in lockstep but are maintained as separate copies. Certainty: `Grep "Fairness|Comparison" app` shows the only two definition sites are these two files; `Grep "GroupEvalPayload|EvalCandidate|group-eval/types"` confirms `types.ts` is the sole shared payload home (imported by the modal subviews and `SimulationProvider.tsx:7`). Cross-layer type imports are already the established convention here: `group-eval-run.ts:12` imports `MatchResultView` from `@/app/features/sub_match/MatchTypes`, and `app/_lib/attention.ts:16` imports from `sub_pipeline/PipelineTypes` — so `_lib` importing pure-type shapes from `features/.../group-eval/types.ts` is sound (no React/runtime in that module).
- **Impact**: A field added to the fairness matrix or comparison narrative (e.g. a new `weightSource` value, an extra `keyPoints`-sibling) silently drifts: the server emits it, the client type doesn't know about it, and TypeScript can't catch the mismatch because the two copies are independent. Pure maintenance tax + correctness risk on a persisted contract.
- **Fix sketch**: Make `app/features/sub_decisions/group-eval/types.ts` the single source for `Comparison`, `FairnessScheme`, `Fairness`. In `group-eval-run.ts` delete the three local declarations (lines 30-52) and `import type { Comparison, Fairness, FairnessScheme } from "@/app/features/sub_decisions/group-eval/types"`. No runtime change; the `rankCandidates`/`runGroupCompare` signatures already use these names.

## 2. `ScoreDimension` and `Confidence` re-declared in `group-eval-run.ts` instead of imported from `MatchTypes`
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/group-eval-run.ts:56-57` (+ canonical home `app/features/sub_match/MatchTypes.ts:19-34`)
- **Evidence**: `group-eval-run.ts:56` declares `type ScoreDimension = { key; label; percent; weight; contribution }` — identical to `MatchTypes.ScoreDimension` (`MatchTypes.ts:19-25`). Line 57 declares `type Confidence = { low; high; level: string; drivers: string[] }` — the same shape as `MatchTypes.Confidence` (`MatchTypes.ts:29-34`), only loosening `level` from the `ConfidenceLevel` union to `string`. The file ALREADY imports `MatchResultView` from `MatchTypes` (line 12), and `MatchResultView` is itself a `Pick` over `MatchResult` that includes `scoreBreakdown?: ScoreDimension[]` and `confidence?: Confidence` — so these two locals are redundant copies of types reachable through the import the file already has. The module's own comment at line 55 even says it "mirrors app/features/sub_match/MatchTypes.ScoreDimension". Certainty: `MatchTypes.ts` exports both (`export type ScoreDimension`, `export type Confidence`); no other definition of these names feeds this module.
- **Impact**: Same drift surface as #1 but narrower — a re-shaped score breakdown or confidence band in `MatchTypes` won't propagate into the group-eval producer's local annotations. Low bundle impact (types only); the value is single-sourcing.
- **Fix sketch**: Replace lines 56-57 with `import type { ScoreDimension, Confidence } from "@/app/features/sub_match/MatchTypes"` (extend the existing line-12 import). If the looser `level: string` matters for the LLM/deterministic JSON parse, keep `Confidence` local but add a `// intentionally looser than MatchTypes.Confidence` note; otherwise import both. Verify `PerCandidate.confidence`/`scoreBreakdown` still type-check (they will — the canonical types are equal-or-stricter).

## 3. Dead exports in `DecisionsTypes.ts`: `NextStage` component, `Reasoning` type, and `DAYS`/`TIMES` constants
- **Severity**: Low
- **Category**: dead-code
- **File**: `app/features/sub_decisions/DecisionsShared.tsx:14-25` (`NextStage`); `app/features/sub_decisions/DecisionsTypes.ts:22` (`Reasoning`), `:37` (`DAYS`), `:38` (`TIMES`)
- **Evidence**: Four exported symbols with ZERO live consumers:
  - `NextStage` (`DecisionsShared.tsx:14`): `Grep "<NextStage|NextStage\b"` over the whole repo returns ONLY the definition line — never imported, never rendered. (Its siblings `CandidateHead`, `MiniList`, `RecBadge` are all used by `AiReviewCard.tsx:6`, so this is a single orphaned export, not a dead file.)
  - `Reasoning` type (`DecisionsTypes.ts:22`): `Grep "\bReasoning\b" app/features/sub_decisions` matches only the definition; `Grep "import.*Reasoning.*DecisionsTypes"` is empty. The live `Reasoning` type used by the match UI lives in `MatchTypes.ts:117`; this is a duplicate copy no one imports.
  - `DAYS`/`TIMES` (`DecisionsTypes.ts:37-38`): `Grep "\bDAYS\b|\bTIMES\b" app` shows the decisions copies are referenced only at their own definition lines. The schedule calendar uses its OWN `DAYS`/`TIMES` from `ScheduleTypes.ts` (different values), and `schedule-slots.ts` has an unrelated local `TIMES`. The decisions copies are leftovers from a scheduling concept that was never wired into the Decisions tab.
- **Impact**: Cosmetic — small dead surface that misleads readers into thinking Decisions renders a stage-transition widget / a weekly grid. `Reasoning` adds a third competing definition of a name that already exists twice (`MatchTypes`, `group-eval-run`).
- **Fix sketch**: Delete `NextStage` (`DecisionsShared.tsx:14-25`, plus the now-unused `ChevronRight` import on line 1 if nothing else uses it — `useEnumLabel`/`STAGES` stay, they're used by `RecBadge`/`CandidateHead`). Delete `Reasoning` (`DecisionsTypes.ts:22`), `DAYS` and `TIMES` (`:37-38`). No callers to update. Run `tsc` to confirm `STAGES`/`InterviewRecommendation` imports in the file are still needed (they are).

## 4. Per-candidate AI-reasoning union (`Reasoning`) hand-copied in three places
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/group-eval-run.ts:29`, `app/features/sub_decisions/DecisionsTypes.ts:22`, `app/features/sub_match/MatchTypes.ts:117`
- **Evidence**: The `{ verdict, strengths, gaps, interviewProbes }` reasoning shape appears three times:
  - `MatchTypes.ts:117` — `Reasoning = { verdict: string; strengths: string[]; gaps: string[]; interviewProbes: string[] }` (the canonical, exported, widely consumed via `ReasoningState`).
  - `DecisionsTypes.ts:22` — byte-identical copy (dead, see finding #3).
  - `group-eval-run.ts:29` — `type Reasoning = { verdict?: ...; strengths?: ...; gaps?: ...; interviewProbes?: ... }` (the all-optional variant, because it's parsed from `runReasoning`'s loosely-typed output before defaulting at lines 353-356).
  Certainty: `Grep "type Reasoning|Reasoning ="` across `app` shows exactly these three (plus `ReasoningState` which composes the canonical one). The group-eval consumer of the result is `runReasoning` from `reasoning-run.ts`, whose output is `Record<string, unknown>`-ish — so the local optional shape is a real, if narrow, adapter.
- **Impact**: A new reasoning field (say `redFlags` on the verdict) has to be added in up to three spots; the `MatchTypes` and `group-eval-run` copies will diverge unnoticed because nothing links them.
- **Fix sketch**: Remove the dead `DecisionsTypes.ts:22` copy (covered by #3). For `group-eval-run.ts:29`, replace the standalone declaration with `type Reasoning = Partial<import("@/app/features/sub_match/MatchTypes").Reasoning>` (or import `Reasoning` and use `Partial<Reasoning>`), so the optional adapter is provably the same field set as the canonical type, minus optionality. This is the only one of the three that needs to stay local-ish; the other two collapse.
