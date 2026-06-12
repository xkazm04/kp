# Biz+UI Scan — Dev Case Studio UI (2026-06-12)

> Total: 5 (2H/3M/0L)

(Prior-scan delta: feature-scout 06-10 findings #1 apply page, #2 outcome recording, #6 seed visibility are now shipped as W5-1/W5-2/W5-3 — verified in `app/devcase/apply/[token]/` and `SubmissionRow.tsx`. Its #3 control-room link, #4 outbox body/filters, #5 compare remain open but are KNOWN and not re-flagged. The 06-08 report for this context does not exist. Dual-theme check: sub_dev/devcase surfaces resolve through the remapped token seam (`white`/`stone-*`/status scales/`score-*` are all re-declared under `[data-theme="dark"]` in `app/globals.css`), and recipe migration is documented as opportunistic — no token bypass found worth a slot.)

## 1. Persist recorded outcomes to the submission row — the calibration loop can double-count
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/features/sub_dev/SubmissionRow.tsx:94`
- **Scenario**: A recruiter records "Hired (perf 4)" on a promoted submission and sees the confirmation pill. Tomorrow (or after any reload/tab switch that remounts the row) the same row shows the untouched Hired/Rejected/Withdrawn buttons again — to them or a colleague it reads as "not recorded yet", so they record it again, possibly differently.
- **Root cause**: `outcome.recorded` is component-local state only (`SubmissionRow.tsx:94-99`); the `Submission` type carries no outcome field (`DevTypes.ts:71-80`) and `GET /api/devcase/postings` never joins `dev_outcomes` (`app/api/devcase/postings/route.ts:9`). The human write path `recordOutcome` is a blind INSERT (`app/_lib/dev-outcomes.ts:103-115`) — only the pipeline's auto path dedupes by `ref`+`outcome` (`dev-outcomes.ts:135`). So re-records, and human "hired" beside an auto-recorded "rejected" for the same `ref`, all persist as separate rows that `calibrate()` counts individually (`dev-outcomes.ts:230-257`).
- **Impact**: The promote-floor calibration — the studio's learning-loop differentiator — gets silently biased by duplicate/conflicting rows for one candidate, the exact failure W5-2 was built to prevent. Recruiters also lose the audit answer "what did we decide about this person?" on the one surface where they decide it.
- **Fix sketch**: Add a `latestOutcomeByRefs(refs)` reader to `dev-outcomes.ts` and merge it into the postings GET (submission.id is the `ref` by contract); extend `Submission` with `outcome?: {outcome, performance, recordedAt}` and seed `SubmissionRow`'s pill from server truth (local state stays as the optimistic layer). Mirror the `recordPipelineOutcome` ref-level dedupe in the human path (reject or upsert when a row with the same `ref` exists, surfacing "already recorded as X" via the existing `payload.error` pattern).

## 2. Require/surface candidate contact — the funnel can produce a winner you cannot reach
- **Lens**: business_visionary
- **Severity**: High
- **Category**: user_benefit
- **File**: `app/devcase/apply/[token]/DevApplyForm.tsx:24`
- **Scenario**: A candidate applies through the public page leaving the optional contact field empty (name + repo are the only required fields, `DevApplyForm.tsx:24,70-78`). The pipeline evaluates them top of the ranking; the recruiter promotes them — and has no email/phone anywhere. Even when a candidate DOES provide contact, the workbench never shows it: the recruiter sees only `candidateRef` + `repoRef` on the row.
- **Root cause**: The inbound webhook requires only `candidate` + `repoRef` (`app/api/devcase/inbound/route.ts:41`); comms fall back to the display name as recipient — `to: input.contact || input.candidateRef` (`app/_lib/distribution.ts:81`), which dead-letters the promote invite/close-out note once a real relay (`COMMS_WEBHOOK_URL`) is wired. The API already serves `contact` on every submission (`app/_lib/db.ts:3589`) but `DevTypes.Submission` drops it (`DevTypes.ts:71-80`) and `SubmissionRow.tsx:180-199` renders neither contact nor the candidate's `notes`.
- **Impact**: The entire automated take-home funnel — design, publish, collect, evaluate, rank — converts to nothing at the moment of value (inviting the best candidate to interview). For a Czech-market recruiter tool, an unreachable top candidate is a lost hire, and the candidate gets ghosted by construction.
- **Fix sketch**: Make contact required on the PUBLIC form with a light email/phone shape check (keep it optional on the internal `/api/devcase/submit` path), and add the existing-i18n explainer "we can only invite you onward with a contact". In the workbench, add `contact`/`notes` to `Submission`, show contact as a `mailto:`-capable line on the row and notes in the expanded eval area — both values are already in the payload.

## 3. Map the "closed" stage — a finished case renders as one that never started
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/features/sub_dev/LifecycleRow.tsx:11`
- **Scenario**: The recruiter closes a case (W5-3) — candidates are notified, postings stop. The lifecycle row now shows a plain lowercase "closed" chip in the neutral pre-publication tint, and its progress rail goes fully grey: every dot renders "upcoming", and the screen-reader rail label announces all seven steps as upcoming. In the cases table the same raw "closed" string appears in the neutral chip.
- **Root cause**: The close route writes `stage: "closed"` (`app/api/devcase/lifecycle/[id]/close/route.ts:52`), but `LIFECYCLE_STEPS` and `STAGE_LABEL` in `DevTypes.ts:157-168` never learned the terminal stage. `LifecycleRow.tsx:11-12` maps only `awaiting_approval`/`published`, so `indexOf("closed")` = -1 → every dot fails `i <= idx` (`LifecycleRow.tsx:97`) and `railLabel` (`LifecycleRow.tsx:41-43`) reports all steps upcoming; the chip falls through `STAGE_LABEL[lc.stage] ?? lc.stage` and the `done` styling checks only `promoted` (`LifecycleRow.tsx:14,50`). `stageChip` in `CasesTable.tsx:12-16` has the same hole.
- **Impact**: The one state that means "this hiring loop completed" is visually indistinguishable from "nothing ever happened" — recruiters scanning the studio can't tell archived successes from stuck intakes, undermining trust in the automation the rail exists to narrate (and the a11y description is factually wrong).
- **Fix sketch**: Add `closed: "closed"` to `STAGE_LABEL`; in `LifecycleRow` map `closed` to a full rail (`idx = LIFECYCLE_STEPS.length - 1` with a distinct terminal dot color, e.g. `bg-ink`/`bg-steel`) and give the chip + `stageChip` a dedicated terminal tint (solid stone/ink) so done-and-archived reads differently from both amber gates and moss live states. Pure mapping change, no API touch.

## 4. Stop swallowing failures of the studio's primary actions
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: functionality
- **File**: `app/features/sub_dev/DevTab.tsx:168`
- **Scenario**: The recruiter clicks "Run lifecycle", "Publish", the gate's plain "Approve", or "Promote to pipeline" while the server errors (or automation is paused via the control room's kill switch). The button blips through its busy state and... nothing. No banner, no toast, no chip — the studio looks like it ignored the click, and the recruiter retries or assumes the pipeline hung.
- **Root cause**: `runLifecycle` (`DevTab.tsx:168-175`), `approveLifecycle` (`DevTab.tsx:177-180`) and `publish` (`DevTab.tsx:182-189`) never check `r.ok` or read the error payload; `promote` does `if (r.ok) setPromoted(true)` and discards the failure branch (`SubmissionRow.tsx:154-167`). The SAME files already ship the correct repo pattern — `payload?.error ?? "…"` + `role="alert"` — in `closeCase` (`LifecycleRow.tsx:29-37`), approve-with-edits (`LifecycleRow.tsx:142-165`) and outcome recording (`SubmissionRow.tsx:101-126`). Worst asymmetry: inside the same ReviewPanel, approving WITH edits surfaces errors while approving WITHOUT edits routes to the parent's silent `onApprove` (`LifecycleRow.tsx:156-158`).
- **Impact**: Exactly the actions that move a case through the funnel are the only ones that can fail invisibly; with the known paused-automation state (06-10 #3) still unsurfaced, a deliberate halt or a 500 both present as a dead UI — eroding the trust an autonomous-pipeline product depends on.
- **Fix sketch**: Lift the existing error pattern into the four handlers: capture `payload?.error`, hold it in state, render a `role="alert"` line beside the triggering control (NeedForm footer for runLifecycle, posting card for publish, EvalPanel footer for promote). For the gate, pass an async `onApprove` that rethrows so ReviewPanel's existing catch covers both paths.

## 5. Reload dev data on relevant task transitions, not every 2s poll tick
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: maintenance
- **File**: `app/features/sub_dev/DevTab.tsx:134`
- **Scenario**: With the Dev tab open, the app re-fetches `/api/devcase` (full role/case/scenario JSON for every case), `/api/devcase/postings` (all submissions + eval bundles), `/api/devcase/lifecycle` and `/api/devcase/comms` every 6 seconds forever — and every 2 seconds whenever ANY task runs anywhere in the workspace (a 10-minute CV analysis on another tab ≈ 1,200 dev-studio fetches).
- **Root cause**: The reload effect depends on the raw `tasks` array (`DevTab.tsx:134-140`), and `TasksProvider.refresh` calls `setTasks(p.tasks)` with a fresh identity on every poll tick (`app/features/tasks/TasksProvider.tsx:71-79`), looping at 2000/6000 ms (`TasksProvider.tsx:164-171`). The effect even disables the exhaustive-deps lint to do it.
- **Impact**: Constant SQLite reads + JSON serialization of the four heaviest dev payloads for zero new information; on the 2s cadence the studio competes with the very background tasks it is waiting on, and any future render work keyed off these loaders re-runs continuously.
- **Fix sketch**: Replace the dep with a memoized fingerprint of dev-relevant tasks — `tasks.filter(t => ["lifecycle","evaluate_submission","need_analysis","design_artifacts"].includes(t.kind)).map(t => t.id + t.status).join("|")` — so the four loaders fire only when a dev task appears or changes status (the existing `lifecycleActive` memo at `DevTab.tsx:133` already shows the filtering idiom).
