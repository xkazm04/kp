# Candidate Onboarding Hand-off — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (1 critical, 2 high, 3 medium, 0 low)

## 1. Recruiter questionnaire blur-autosave wholesale-overwrites (and can blank) the candidate's submitted intake
- **Severity**: Critical
- **Lens**: ambiguity
- **Category**: last-write-wins-data-loss
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:475`
- **Scenario**: A recruiter opens a run detail while the candidate's questionnaire is still empty (`answers` initialized to `{}` at mount, line 383). The candidate then submits their pre-boarding answers via the token page. The recruiter later clicks into any questionnaire field and tabs away — `onBlur` fires `patch({ action: "intake", answers })` with the stale mount-time snapshot, and `saveIntake` (onboarding-store.ts:461-463) replaces `answers_json` wholesale. The candidate's emergency contact, license number, etc. are silently destroyed.
- **Root cause**: Whole-object last-write-wins persistence driven by an unconditional blur handler (blur fires even with zero edits), with no dirty check, no per-field merge, and no re-read of the server copy before write. Worse, the recruiter path has none of the guards the candidate path grew: `submitCandidateIntake` refuses an all-blank submit and filters to template keys via `cleanIntakeAnswers`, but the recruiter route (`app/api/onboarding/[id]/route.ts:42-43`) passes raw `answers` straight to `saveIntake`, which happily persists `{}`.
- **Impact**: Silent loss of candidate-entered PII, plus an empty intake row that flips `intakeSubmitted` to true on the run card and permanently suppresses the one-shot pre-boarding reminder (`duePreboardingReminders` excludes any run with an intake row) — the exact failure mode the candidate path was patched for (offers-onboarding #2), still open one route over.
- **Fix sketch**: Only send changed keys (track a dirty set; skip the PATCH when nothing changed) and have `saveIntake` merge into the existing `answers_json` instead of replacing it, or send the full object only on an explicit Save button. Apply the same empty-guard as the candidate path in the recruiter route (`Object.keys(clean).length === 0` → 400, no row), and filter recruiter answers to the template's questionnaire keys with the existing `cleanIntakeAnswers`.

## 2. A revoked (cancelled) run is silently resurrected by any checklist toggle
- **Severity**: High
- **Lens**: ambiguity
- **Category**: revoke-not-terminal
- **File**: `app/_lib/onboarding-store.ts:438`
- **Scenario**: An operator cancels a run to revoke a withdrawn hire's onboarding link and purge their PII (`cancelRun`, the documented tombstone whose whole point is "startRun can never re-provision and the token bridge never resolves"). A recruiter still has the run open — or clicks it from the list, where a cancelled run renders indistinguishably from an active one (no `cancelled` badge; only `complete` gets a chip, OnboardingTab.tsx:151) — and ticks a checkbox. `setTaskDone` unconditionally rewrites `status` to `'active'`/`'complete'`, erasing the tombstone.
- **Root cause**: Neither the PATCH route (`app/api/onboarding/[id]/route.ts:40-57` gates no action on run status) nor the store mutators (`setTaskDone`, `saveIntake`, `requestSignature`, `markSigned` — all keyed only on run existence) check `status === 'cancelled'`. `setTaskDone` then derives a fresh status from progress and writes it, so the tombstone value is not merely bypassed but overwritten — after which `runForToken`'s `existing.status === "cancelled"` refusal (onboarding-candidate.ts:34) no longer holds for a still-Hired entry.
- **Impact**: The revoke/erase guarantee documented in `cancelRun` (bug-ui §candidate-onboarding #2) is one accidental click from void: the candidate token resolves again and the run re-accretes PII into tables that were just purged.
- **Fix sketch**: Make `cancelled` terminal: every mutator (`setTaskDone`, `saveIntake`, `requestSignature`, `markSigned`) returns null when the run's status is `cancelled`, and `setTaskDone` only flips between `active`/`complete`, never off a tombstone. In the tab list, render a `cancelled` badge and make the row read-only (or hide cancelled runs behind a filter).

## 3. Onboarding API routes ignore the caller's workspace — tenancy scoping exists in the store but is never wired
- **Severity**: High
- **Lens**: ambiguity
- **Category**: tenancy-default-fallback
- **File**: `app/api/onboarding/route.ts:12`
- **Scenario**: A recruiter in a non-default workspace hires a candidate and starts onboarding. `startRun` correctly stamps the run with the entry's real workspace (onboarding-store.ts:231-237), but the tab's GET calls `listRuns()` / `listTemplates()` / `listPipeline()` with no argument, so every read falls to `DEFAULT_WORKSPACE_ID`. The run they just started never appears in "Active runs"; templates they create (`createTemplate(body.name, tasks, body.questionnaire)` at route.ts:49, no workspace) land in — and are readable by — the default tenant.
- **Root cause**: The E0 Phase 1 tenancy migration added `workspace_id` to all five onboarding tables and threaded `workspaceId` parameters through the store, but the HTTP layer never derives the caller's workspace (the repo-standard `currentWorkspace(request)` used by e.g. `app/api/pipeline/events/route.ts` is absent here). Half-wired tenancy: writes are correctly scoped via the entry, reads are hard-defaulted.
- **Impact**: Non-default-tenant runs are invisible to their own recruiters (and their `intakeSubmitted` nudge state with them), while template names — which can encode client/role details — leak across tenants. This is the exact silently-fell-to-default class the `*-tenancy.test.ts` source guards were built to catch elsewhere.
- **Fix sketch**: Derive the workspace once per request via `currentWorkspace(request)` and pass it to `listRuns`, `listTemplates`, `createTemplate`, and the `listPipeline` filter in both GET and POST. Add the onboarding routes to the existing tenancy source-guard pattern so a future bare call regresses loudly.

## 4. The PII revoke action exists only as an API — no recruiter UI can reach it
- **Severity**: Medium
- **Lens**: ui
- **Category**: built-but-unwired
- **File**: `app/api/onboarding/[id]/route.ts:51`
- **Scenario**: A hire falls through after onboarding started. The recruiter wants to kill the candidate's live onboarding link and erase the collected emergency-contact/dietary data — the documented purpose of `cancelRun`. Nothing in `OnboardingTab.tsx` (list or `RunDetailView`) renders a cancel/revoke control; a repo-wide search finds zero UI callers of `action: "cancel"` on this route. The only way to revoke is hand-crafting a PATCH with curl.
- **Root cause**: The backend revoke (bug-ui §candidate-onboarding #2) shipped with route + store + purge semantics but the front-of-house affordance was never added, and the run list offers no status management at all.
- **Impact**: In practice the revoke path is dead code for real operators: withdrawn candidates' onboarding links and stored PII outlive the hire decision — precisely the risk the feature was built to close.
- **Fix sketch**: Add a guarded "Revoke onboarding" action to `RunDetailView` (arm-then-confirm, matching the `InviteLifecyclePanel` armed-action pattern) that PATCHes `{ action: "cancel" }`, then returns to the list. Show the resulting `cancelled` state in the run list (pairs with finding 2).

## 5. Templates are documented as editable but are immutable and undeletable
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: doc-behavior-mismatch
- **File**: `app/_lib/onboarding.ts:12`
- **Scenario**: A recruiter creates a template from the healthcare preset with a typo in "Verify professional license", or wants to add a task next quarter. The code promises this works — "Editable per template once created" (onboarding.ts:12) and presets are "prefilled, then editable" (onboarding.ts:128, repeated at 264 in the tab) — but the API supports only `create_template` (`app/api/onboarding/route.ts:39`) and the template list in `OnboardingTab.tsx:205-212` is a read-only name+counts card. There is no update, rename, or delete anywhere.
- **Root cause**: "Editable" was implemented as "editable during creation" (the `TemplateManager` pre-save form), but the comments and the P1-4 design language claim per-template editability post-creation. No `updateTemplate`/`deleteTemplate` store function exists.
- **Impact**: Every mistake is permanent and the only recourse is creating a near-duplicate, so the template dropdown accumulates dead variants ("Standard onboarding", "Standard onboarding v2", …) with no way to prune; existing runs also pick up no fix since they reference the template by id. Future developers reading the comments will assume an edit path exists and hunt for it.
- **Fix sketch**: Either add `update_template` / `delete_template` actions (edit reuses `TemplateManager` seeded from the existing template; delete refuses or soft-archives when runs reference it) — or, if immutability is the intended trade-off (runs render live from `tasks_json`, so edits would mutate in-flight checklists), say so: replace the "editable once created" comments with the actual rule and hide it from the UI copy.

## 6. Starting a run swallows API errors — a 409/500 looks like a no-op button
- **Severity**: Medium
- **Lens**: ui
- **Category**: silent-error-state
- **File**: `app/features/sub_onboarding/OnboardingTab.tsx:71`
- **Scenario**: A recruiter clicks "Start onboarding" for a candidate whose entry just went terminal (hired-then-rejected). The POST returns 409 "Only Hired candidates can be onboarded." — but `start()` never checks `r.ok`: it parses the error envelope, finds no `p.run.id`, reloads, and renders the same list. The button appears to do nothing, with no message. The same handler shape also hides 500s, and `reload()`/the mount fetch (lines 51-69) will happily `applyData` an `{ error }` envelope, blanking all three sections to their empty states ("no candidates ready") instead of showing a failure.
- **Root cause**: None of the tab's top-level fetches inspect `response.ok` or surface an error; only `TemplateManager.save` and `RunDetailView` (which was explicitly patched for exactly this envelope-as-data bug, lines 374-380) do. The fix was applied to one fetch site and not propagated to its siblings in the same file.
- **Impact**: Recruiters get a dead button or a falsely-empty tab with no signal to retry or report; the 409's useful message ("Only Hired candidates…") is computed server-side and then discarded.
- **Fix sketch**: Mirror the `RunDetailView` pattern at the tab level: keep an `error` state, set it from `p.error ?? t("saveFailed")` whenever `!r.ok` (in `start`, `reload`, and the mount effect) without clobbering loaded data, and render the existing `role="alert"` banner above the sections.
