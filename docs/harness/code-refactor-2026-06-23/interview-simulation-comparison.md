> Total: 5 findings (0c critical, 0h high, 3m medium, 2l low)

## 1. Mode → {runOfShow, durationMin} mapping duplicated client (preview) vs server (authoritative)
- **Severity**: Medium
- **Category**: duplication
- **File**: app/features/sub_interview/InterviewSimTab.tsx:155-158 (and 13-19 imports); app/api/interview/simulate/route.ts:42-57
- **Scenario**: Both files independently translate the `SimMode` ("student" | "student-case" | "regular") into a run-of-show array and a duration. Client (InterviewSimTab) computes them from `studentRunOfShow()` / `scenarioRunOfShow(DEMO_CASE_SCENARIO)` / `REGULAR_DEMO_RUN_OF_SHOW` and `STUDENT_SCRIPT_MIN` / `DEMO_CASE_SCENARIO.durationMin` / `QUICK_SCREEN_MIN`. The server route computes the SAME three-way mapping (lines 42-57) for the session it stores. I confirmed via `grep` that `VoiceInterviewClient` does NOT receive `runOfShow`/`durationMin` (no such props in app/_components/voice/VoiceInterviewClient.tsx), so the client mapping feeds ONLY the pre-start preview `InterviewSidebar` (line 246) while the server mapping is the authoritative copy persisted in `createInterviewSession`. They are parallel branches over the identical mode keys.
- **Root cause**: The simulator needs a sidebar preview before a session exists (no server round-trip yet), so the same per-mode config was hand-written on both sides instead of being a single shared resolver.
- **Impact**: Drift risk: change a phase's minutes, the regular run-of-show, or add a 4th mode on one side and the preview sidebar silently misrepresents what the agent will actually run. Two places to keep in lockstep with no test pinning the equality.
- **Fix sketch**: Add one pure resolver to `student-interview.ts`, e.g. `simModeConfig(mode): { runOfShow: string[]; durationMin: number }` covering all three modes (defaulting "regular" to `REGULAR_DEMO_RUN_OF_SHOW` / `QUICK_SCREEN_MIN`). Call it from both InterviewSimTab (lines 155-158) and route.ts (lines 43-57). Keeps the candidateLabel/jobTitle/instructions selection server-only.

## 2. `SimMode` union literal redefined in two files
- **Severity**: Medium
- **Category**: duplication
- **File**: app/api/interview/simulate/route.ts:18; app/features/sub_interview/InterviewSimTab.tsx:29
- **Scenario**: `type SimMode = "student" | "student-case" | "regular";` is declared verbatim in both the API route and the component (confirmed via `grep -rn "type SimMode"` — exactly these two hits, no shared definition). The route also re-validates the literals inline at line 35 (`body.mode === "student" || body.mode === "student-case"`).
- **Root cause**: Client and server each needed the union but no shared module owned it, so it was copied.
- **Impact**: Adding/renaming a mode requires editing both declarations plus the route's inline guard; easy to update one and leave the other, producing a type that accepts a mode the server silently coerces to "regular".
- **Fix sketch**: Export `SimMode` (and ideally a `SIM_MODES` const array + an `isSimMode` guard) from `student-interview.ts` — the module already owns the demo scenario and run-of-shows — and import it in both files. The route's line-35 validation collapses to `isSimMode(body.mode) ? body.mode : "regular"`.

## 3. Exported `SCREEN_ROUTES` array and `ScreenRoute` type have no external consumers
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/_lib/interview-recommendation.ts:71-72
- **Scenario**: `export const SCREEN_ROUTES` and `export type ScreenRoute` are part of the module's public surface but nothing imports them outside the module and its test. `grep -rn "SCREEN_ROUTES"` finds only: the definition, the test (`interview-recommendation.test.ts`), and a prose mention in a comment (`pipeline-stages.ts:49`). `grep -rn "\bScreenRoute\b"` finds only the three in-module uses (the type def + `coerceScreenRoute`'s signature/cast). The actually-consumed export is `coerceScreenRoute` (used in `automation-run.ts`). `SCREEN_ROUTES` is referenced internally only by `ROUTE_SET` (line 74) and `ScreenRoute` only as `coerceScreenRoute`'s return type.
- **Root cause**: Built as a "complete contract surface" mirroring the broader `INTERVIEW_RECOMMENDATIONS`/`ScreenRoute` family; the array/type were exported for symmetry but the gate only ever needed the coercer.
- **Impact**: Low maintenance cost — widens the public API and the test surface for symbols no caller uses. Note this module is deliberately positioned as the "single TS source of truth," so keeping the exports for documentation value is a defensible choice; flagging as a candidate, not a mandate.
- **Fix sketch**: Either downgrade `SCREEN_ROUTES`/`ScreenRoute` to module-private (drop `export`; the test then asserts the subset via `coerceScreenRoute` behavior, which it already does at lines 63-71), OR leave them and accept the symmetry. Do NOT touch `coerceScreenRoute` — it is live.

## 4. `inline submissionIdFromCandidateId` re-implemented in dev-outcomes.ts
- **Severity**: Low
- **Category**: duplication
- **File**: app/_lib/dev-outcomes.ts:156-167 (mirrors app/_lib/student-interview.ts:225-227)
- **Scenario**: `dev-outcomes.ts:recordPipelineOutcome` re-derives the `"ds-"` submission-id prefix inline (`cid.startsWith("ds-") ... cid.slice(3)`) instead of calling the exported `submissionIdFromCandidateId`. This is the same `"ds-"` contract. The duplication is EXPLICITLY documented at lines 156-160 ("kept inline here because importing it would pull student-interview's db.ts dependency into this deliberately self-contained store").
- **Root cause**: A deliberate decoupling decision — `student-interview.ts` transitively imports `db.ts` (via the JSON/run-of-show types), and `dev-outcomes.ts` wants to stay dependency-light.
- **Impact**: Minimal and consciously accepted; the only risk is the `"ds-"` literal drifting between the two. Given the documented rationale this is borderline not-a-finding; recorded for completeness.
- **Fix sketch**: Leave as-is unless the prefix constant is ever extracted. If consolidation is wanted later, move the bare prefix string `"ds-"` to a tiny dependency-free constants module both can import; do NOT import the function (it would defeat the documented decoupling).

## 5. `StudentScriptPhase` exported but only used internally; `ScenarioPhase` likewise
- **Severity**: Low
- **Category**: dead-code
- **File**: app/_lib/student-interview.ts:21 (`StudentScriptPhase`), :195 (`ScenarioPhase`)
- **Scenario**: `grep -rn "StudentScriptPhase"` and `"ScenarioPhase"` show every reference is inside `student-interview.ts` itself (the type defs and internal helper signatures / `CaseInterviewScenario.phases`). No other file imports either type. By contrast `CaseInterviewScenario` IS imported externally (`interview-run.ts:20`), so that export is justified.
- **Root cause**: Types exported by default alongside the value/type cluster; only `CaseInterviewScenario` ended up needed by callers.
- **Impact**: Negligible — just unused public type surface. They are legitimate documentation of the script shape and the test file references the equivalent raw shape, so removing the `export` is optional.
- **Fix sketch**: Optionally drop `export` on `StudentScriptPhase` and `ScenarioPhase` to make them module-private (no callers break — verified by grep). Keep `CaseInterviewScenario` exported. Skip if the team prefers exporting the full type vocabulary for the documented "single source of truth" module.
