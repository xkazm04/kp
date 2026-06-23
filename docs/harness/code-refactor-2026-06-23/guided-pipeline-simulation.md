> Total: 5 findings (0c critical, 0h high, 1m medium, 4l low)

The "Guided Pipeline Simulation" context is unusually clean: no `console.log`/`debug`, no `TODO`/`FIXME`/`HACK`, no commented-out code, and every component/route/export I checked has a live consumer (all six Sim* components + the provider are mounted in `app/features/Workspace.tsx`; all five `/api/sim/*` routes are fetched by `SimulationProvider.run()`; `SIM_SCREEN_POLICY`, `SIM_ROLE.languages`, `applyCompanyTemplate`, the `bau` archetype lookup, and every `screenWave` field all resolve to real consumers — grep evidence below). Findings are mostly hygiene-grade. (Note: `.claude/worktrees/*` are git-worktree copies of the same files and were excluded from "is it used" counts.)

## 1. `/api/sim/screen-draft` sets a `screening_review` approval that the demo never uses, then bypasses it
- **Severity**: Medium
- **Category**: dead-code
- **File**: app/features/simulation/SimulationProvider.tsx:492-498 ; app/api/sim/screen-draft/route.ts:1-29
- **Scenario**: In the `screen` step the walk does, in order: `await advance(targetId)` (Screened→Interview), `await fetch("/api/sim/screen-draft", …)` (sets `approvalKind="screening_review"` per route.ts:24), then `await fetch("/api/pipeline/${targetId}", {action:"accept"})`, then `waitEntry(… e.stage === "Interview" || e.approvalKind === "calendar" …)`. The route's own header (route.ts:7-9) states its purpose: *"Sets the screening_review approval so a real card appears in the Decisions queue for the driver to click 'Advance' on (the genuine human-decision gate)."* But the screen step is on the `analytics` tab (constants.ts:80 / step `tab: "analytics"`), never navigates to Decisions, and never `clickEl`s a screening card — it just calls `accept` over the API. The `advance` immediately before already satisfies the `waitEntry` (`stage === "Interview"`), so the screen-draft write + the manual accept are both effectively no-op theater for the demo's visible flow. Confirmed `screening_review` consumers exist (DecisionsTab.tsx:123, automation-run.ts, devcase-run.ts) but none is reached by the sim. grep: `grep -rn "/api/sim/screen-draft"` → only SimulationProvider.tsx:494; `grep -rn '\[data-sim-click="advance"\]'` → none.
- **Root cause**: The screen step was likely refactored from a "click the real screening card" flow to an automated `advance`+`accept`, leaving the `screen-draft` call (and the route it feeds) as an orphaned remnant whose product purpose (a clickable Decisions card) no longer happens.
- **Impact**: Dead intent that masks understanding: a reader assumes the demo surfaces a screening-review card (the route says so), but it doesn't. The route, its DB write, and an extra round-trip persist with no observable effect, and the redundant `accept` on an entry already advanced to Interview is a confusing extra mutation.
- **Fix sketch**: Either (a) make the screen step actually mirror the screening gate — nav to `decisions`, `clickEl` the `screening_review` card — and keep `screen-draft`; or (b) drop the `screen-draft` + redundant `accept` calls (and delete `app/api/sim/screen-draft/route.ts`, which has no other caller) and let the single `advance(targetId)` carry Screened→Interview. Pick one; today it's half of each.

## 2. `applyCompanyTemplate`'s `about` (and effectively `seniority`) optional params are never supplied
- **Severity**: Low
- **Category**: dead-code
- **File**: app/features/simulation/company-template.ts:8 (`about?`)
- **Scenario**: `applyCompanyTemplate` has exactly one caller — `SIM_JD_MARKDOWN` in constants.ts:26-35 (grep: `grep -rn "applyCompanyTemplate" app` → company-template.ts:4 def + constants.ts:5,26 only). That call passes `title, company, seniority, responsibilities, mustHaves, niceToHaves, salaryBand, currency` but never `about`, so the `opts.about ?? "<company> builds technology…"` fallback (line 23) is the only branch ever taken. `about` is a permanently-dead parameter for the in-tree usage.
- **Root cause**: The function header calls itself "Phase 1, minimal" with a fuller template a "follow-up"; the `about` knob was added speculatively for that future CRUD feature that doesn't exist yet.
- **Impact**: Minor API surface bloat — a parameter that can never change behavior in the only call site, plus a dead `??` branch.
- **Fix sketch**: Drop the `about` param (and inline the default string), or leave it with a one-line note that it's reserved for the not-yet-built template-management feature. Low urgency; the function is tiny and single-purpose.

## 3. `SimDecisionWave` re-implements the real `ScreenWaveModal`'s results list (justified double, divergence risk)
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/simulation/SimDecisionWave.tsx:10-68 vs app/features/sub_decisions/ScreenWaveModal.tsx
- **Scenario**: Both render the same `ScreenDecision[]` (keep/reject + matchScore + rationale) inside the shared `Modal`. `SimDecisionWave` is a passive read-only display; `ScreenWaveModal` is the interactive recruiter control (sliders, dry-run preview/commit, approval token, `next-intl` i18n, fairness note). They legitimately differ — the sim can't reuse the interactive commit modal — so this is an intentional demo double, NOT avoidable copy-paste. But the row shape (label/score/action/rationale) is duplicated by hand, and unlike `SimGroupEval` (which reuses the real `GroupEvalModal`) the screening result has no shared presentational sub-component to lean on. grep: `grep -rln 'role="meter"'` → only SimDecisionWave.tsx (its score-bar markup is unique to the sim).
- **Root cause**: `ScreenWaveModal` couples its result rows to its interactive/i18n shell, leaving no extractable read-only "decisions list" the sim could share.
- **Impact**: Low — two places render screening decisions; a change to the row format (e.g. new `commsFailed` badge already in ScreenWaveModal:163 but absent in SimDecisionWave) silently drifts between the real UI and the demo.
- **Fix sketch**: Optional — extract a small presentational `<ScreenDecisionList decisions={…}/>` from ScreenWaveModal and consume it from both. Only worth it if the row format keeps changing; otherwise leave as a documented demo double (mirror the `SimGroupEval` reuse note).

## 4. `JSON_HEADERS` / `sleep` micro-helpers re-declared locally instead of shared
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/simulation/SimulationProvider.tsx:76-77
- **Scenario**: `const JSON_HEADERS = { "Content-Type": "application/json" }` and `const sleep = (ms) => new Promise(...)` are defined inside this module. The same `{ "Content-Type": "application/json" }` literal recurs across the real app's fetch sites (e.g. ScreenWaveModal.tsx:71,104 inline it too), and a `sleep` helper is a common util. This is trivial duplication, not a bug.
- **Root cause**: No shared `app/_lib` fetch/util module for these one-liners, so each module rolls its own.
- **Impact**: Negligible. Noted only for completeness; the local copies are self-documenting and isolated.
- **Fix sketch**: Skip unless a shared `_lib/http.ts` already exists — not worth a new util module just for two one-liners.

## 5. `SimulationProvider.tsx` is a 706-line god-file mixing engine, DOM driver, network, and React wiring
- **Severity**: Low
- **Category**: structure
- **File**: app/features/simulation/SimulationProvider.tsx:1-707
- **Scenario**: At 706 lines (the next-largest sim file is 187), this single component holds: state types + idle/clear constants, the pacing engine (`beat`/`gate`/`sleep`), the observation/real-click driver (`getEntries`/`entriesFor`/`topScreened`/`waitDom`/`waitEntry`/`clickEl`/`advance`/`advanceTo`), the network helpers (`runGroupEval`), the full seven-step `run()` walk (~270 lines, 360-627), and all the public control callbacks. `wc -l` confirms it dwarfs every sibling.
- **Root cause**: Organic growth — the engine, the click driver, and the scripted walk all accreted into the provider rather than being split into `sim-engine.ts` (pure pacing/DOM helpers) + a `useSimRun` hook or a `steps.ts` walk definition.
- **Impact**: Low but real maintainability drag: the file is hard to scan, and the pure helpers (`advanceTo`, `entriesFor`, `topScreened`, `beat`/`gate` logic, `MAX_STAGE_ADVANCES` derivation) are untestable in isolation while embedded as `useCallback`s.
- **Fix sketch**: Optional, not a "big reorg": lift the non-React helpers (`sleep`, `MAX_STAGE_ADVANCES`, the `IDLE_STATE`/`CLEAR_OVERLAYS` constants, and the DOM/network helpers that don't need component state) into a `sim-engine.ts`, and consider moving the `step({...})` array into a data-driven `steps.ts`. Defer unless this file is actively churned.
