# Candidate Profile & Job Matching — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Built-in archetypes' fairness shield is one unguarded PUT away
- **Severity**: High
- **Lens**: ambiguity
- **Category**: fairness-flag-editable
- **File**: `app/_lib/archetype-registry.ts:151`
- **Scenario**: A recruiter opens ArchetypeManager, clicks Edit on the built-in "Student" archetype, and unticks the fairness checkbox (`ArchetypeManager.tsx:437-442`) — or any API caller PUTs `{"fairnessProtected": false}` to `/api/archetypes/student`. The save succeeds with no warning, and every automated-rejection gate downstream (`isFairnessProtected`) now treats students as fair game.
- **Root cause**: The codebase treats archival as the dangerous operation — `setArchetypeArchived` refuses built-ins with the explicit reason "retiring them would strip the fairness shield" (`ProfileTypes.ts:33`, `archetype-registry.ts:175-181`) — but `updateArchetype` has no `BUILT_IN` guard, and `EDITABLE_FIELDS` (lines 60-68) includes both `fairnessProtected` and `scoringModel`. The edit path strips the exact shield the archive path protects.
- **Impact**: The compliance-critical guarantee DecisionRulesModal advertises ("early-career candidates are never auto-rejected") can be silently disabled by a single checkbox click or API call, with no confirmation, no audit trail, and no visual alarm beyond a small ShieldOff chip. Same for flipping `scoringModel` of "student" to `experienced`, which re-ranks students on a years-of-experience model.
- **Fix sketch**: In `updateArchetype`, reject changes to `fairnessProtected`/`scoringModel` for `BUILT_IN` ids with a structured error (mirroring `archive_builtin`), while still allowing label/badge/weight edits. In `EditPanel`, disable the fairness checkbox and scoring-model select for built-ins with an explanatory title. If flipping the flag on custom archetypes must stay possible, add a confirm dialog naming the consequence.

## 2. Hand-built profiles silently default to `software_engineering`, which is scored
- **Severity**: High
- **Lens**: ambiguity
- **Category**: default-role-family-bias
- **File**: `app/features/sub_profile/ProfileForm.ts:99`
- **Scenario**: A recruiter builds a nurse's profile by hand. The "Target field" select opens pre-set to Software (no neutral option), and if it is left untouched the profile persists `roleFamily: "software_engineering"` as a declared fact. Matching then credits SWE roles with the full family hit and penalizes nursing roles.
- **Root cause**: `hydrate()` seeds `roleFamily: payload?.roleFamily ?? "software_engineering"` and its comment claims the fallback "invents nothing and is not scored". That claim is false for matching: `pipeline/jobfit/matching.py:456` scores `family = 1.0 if candidate.role_family == job.role_family else 0.35` (and 1.0 vs 0.3 at line 565). Meanwhile the analysis path deliberately built `DEFAULT_ROLE_FAMILY = "general_professional"` with the motto "Never assume software" (`app/_lib/role-families.ts:52`, `match-candidate.ts:66`) — the editor path contradicts the policy the rest of the module family enforces.
- **Impact**: Every hand-built (and AI-drafted-then-unedited) non-tech profile is biased toward software roles and away from its true family — exactly the collapse the P0-1 taxonomy expansion was built to end. The stale comment also misleads future developers into believing the default is inert.
- **Fix sketch**: Seed the blank form (and `applyDraft` fallback) from `DEFAULT_ROLE_FAMILY` instead of `software_engineering`, or add a preselected neutral "General / Professional" option so an untouched select persists the honest neutral family. Update the `hydrate()` comment to state that roleFamily IS scored by the matcher.

## 3. Analysis-sourced matches drop the early-career signal set and mint "0 years"
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: thin-analysis-candidate-mapping
- **File**: `app/_lib/match-candidate.ts:55-82`
- **Scenario**: The same student is matched twice — once from their saved profile (`profileId`), once from their CV analysis (`analysisSlug`). The profile run carries `potentialScore`, `learningSignals`, `transferableSkills`, `aspirations` and `skillProvenance` (Python `transform.py:173-191` computes them); the analysis run gets none of them, so the PotentialBadge never renders, the career dimension scores without potential, and the "Explain fit" narrative loses its bridge/ramp-up grounding — silently, for the same human.
- **Root cause**: `resolveCandidate` hand-maps a thin subset of `payload.candidate` (skills/seniority/family/education/languages/years/traits/archetype/domainDistance) and never populates the five `CandidateInput` fields whose own comments insist they "MUST ride the cache key" because "the reasoning prompt consumes them" — for analysis-sourced candidates they are structurally always empty. It also maps `yearsExperience: (c.yearsExperience as number) ?? 0`, fabricating a real-looking "0 years" in the same function whose sibling fields use honest `"unknown"` sentinels ("Fail-open, don't assume", line 58).
- **Impact**: Ranking and reasoning quality quietly diverge by source for the exact candidates (students/switchers) the fairness machinery most protects; a recruiter comparing a profile-run against an analysis-run of the same person sees different scores and different narratives with no explanation. The `?? 0` years can additionally read as a genuine zero in the Python scorer.
- **Fix sketch**: Since the analysis payload carries the full `v2Profile`, route an analysis with a `v2Profile` through the `--profile-json` path (as `profileId` does in `match-input.ts`), letting `transform.py` recompute potential/transferables/provenance — one mapping instead of a drifting hand copy. At minimum, map the missing fields from `v2Profile` and pass `yearsExperience` as absent (not 0) when the analysis didn't capture it.

## 4. Candidate matrix shows the same person twice after "Build from analysis"
- **Severity**: Medium
- **Lens**: ui
- **Category**: duplicate-candidate-rows
- **File**: `app/api/profile/candidates/route.ts:56`
- **Scenario**: A recruiter promotes an analyzed CV into a profile via the matrix's "Build from analysis" button. On the next load the matrix shows TWO rows for that person — the analysis cell (with its CV score) and the new profile cell (em-dash) — potentially in two different archetype columns if the recruiter re-routed during the build. The candidate count and the per-archetype grouping now overstate the pool.
- **Root cause**: The route unions both stores (`[...profileRows, ...analysisRows]`) with no lineage-aware dedupe, even though the build flow exists precisely to stamp `sourceAnalysisSlug` lineage onto the profile (used elsewhere for staleness). The union comment documents the two sources but not the double-count trade-off.
- **Impact**: The matrix — pitched as "one candidate population, two projections" — double-counts every promoted candidate; recruiters read 8 cells as 8 people when it is 5, and the same human can sit under two conflicting archetype columns with no visual link between the rows.
- **Fix sketch**: Use the profile lineage (`source_analysis_slug`) to either collapse the source analysis row into its promoted profile row (keeping the analysis score with its provenance chip), or badge the analysis cell "promoted" with a link to the profile so the pair reads as one person. Keep un-promoted analyses exactly as today.

## 5. Editor "Back" silently discards a fully-typed intake
- **Severity**: Medium
- **Lens**: ui
- **Category**: unsaved-changes-guard
- **File**: `app/features/sub_profile/ProfileEditor.tsx:294`
- **Scenario**: A recruiter spends ten minutes typing a candidate intake (or pastes notes and runs the paid AI draft), then clicks the "Back" arrow at the top of the editor — perhaps to check something on the roster. All form state, including the applied AI draft, is destroyed with no confirmation and no way back.
- **Root cause**: The Back button calls `onCancel` unconditionally, which unmounts `ProfileEditor` (`ProfileTab.tsx:177`) and all its `useState`. There is no dirty-check, in a tab that elsewhere goes out of its way to avoid destructive surprises (the rebuild flow's "Never a silent clobber" divergence modal, `ProfileTab.tsx:54-58`).
- **Impact**: Real data loss of recruiter work product (and a wasted paid Gemini draft call) from a single misclick — the most expensive-to-retype form in the app has the weakest exit guard.
- **Fix sketch**: Track dirtiness (any field differing from `hydrate(initialPayload)`, or simply "any edit since mount") and, when dirty, intercept Back with the existing Modal primitive: "Discard this intake? / Keep editing". A lightweight alternative is `onbeforeunload`-style confirm just for the Back button; no autosave machinery needed.

## 6. WeightsPanel invents a 10–60% slider range when the server omits bounds
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: magic-fallback-bounds
- **File**: `app/features/sub_match/WeightsPanel.tsx:88`
- **Scenario**: A dimension missing from `candidate.weightBounds` (older cached response shape, or a future renamed dimension key) silently gets `[lo, hi] = [0.1, 0.6]`. The recruiter drags within a range the archetype may not actually allow; the server then clamps/renormalizes to different numbers than the slider promised.
- **Root cause**: `bounds[d] ?? [0.1, 0.6]` is an undocumented constant pair with no comment explaining where 10%/60% comes from or why it is a safe stand-in for every archetype (early-career bounds differ from BAU by design — that is the whole MAT1 premise).
- **Impact**: Papercut: the panel can display a draggable range that disagrees with the enforcement bounds, so "Apply re-rank" snaps values in a way the UI never foreshadowed. Also a comprehension trap for the next developer ("is 0.1–0.6 the real floor/ceiling?").
- **Fix sketch**: Either hide the slider for a dimension without server bounds (render the value read-only), or source the fallback from a named, commented constant that states it mirrors the Python default bounds — and log/flag when the fallback fires so a payload-shape drift is noticed rather than absorbed.
