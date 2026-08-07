# Guided Pipeline Simulation — bug-hunter + ui-perfectionist scan

> Context: A keyless, guided JD→Hired demo that drives real clicks through the app with a bottom bar, spotlight, explain drawer, group-eval and offer frames — plus the new ControlDock/ControlRoom operator surfaces and the CV-intake sim endpoint.
> Files reviewed: 13 of 23 (+ cv-intake, proxy, jobs.ts, CvSimCard as supporting reads)
> Total: 5

## 1. `/api/sim/apply-cv` files a demo CV into the JOB-OWNER workspace with no `(SIM)` marker — leaking a permanent, analytics-counted, unpurgeable real entry

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption / tenant-isolation / silent-failure
- **File**: `app/api/sim/apply-cv/route.ts:36-64`, `app/_lib/cv-intake.ts:104,119`, `app/features/simulation/constants.ts:7-18`
- **Scenario**: A demo-session prospect (isolated to `DEMO_WORKSPACE="demo"`) — or any operator using the channels "Test with a real CV" card (`CvSimCard.tsx:64`) — POSTs a CV with a `jobId`. `getJob(jobId)` is a workspace-UNSCOPED PK read (`jobs.ts:326-335`), so any job id resolves. The route calls `ingestCvApplication` WITHOUT `workspaceId`, so it defaults to `getJobWorkspace(job.id)` (`cv-intake.ts:104`) — the job's owner, or `DEFAULT_WORKSPACE_ID` for a seeded NULL-workspace corpus job — **not the caller's demo session**. The entry is stamped with the real `job.title` (`cv-intake.ts:119`), carrying no `(SIM)` marker.
- **Root cause**: The demo's whole isolation story (per `/api/demo`) is that `currentWorkspace()` scopes every write to `demo`. `apply-cv` bypasses that seam by deriving the target workspace from the job, not the session — and the sim's cleanup/analytics contract is title-marker-based (`constants.ts`: `SIM_TITLE_LIKE` is BOTH the purge key and the analytics read-side exclusion), which apply-cv never sets.
- **Impact**: A demo/sim action drops a REAL candidate into a real workspace's pipeline at "Accepted". `resetSim` (deletes only `%(SIM)%` titles) can never remove it, and the analytics funnel/hire-rate filter (which excludes only marked rows) COUNTS it as a genuine applicant — permanent corruption of hiring metrics with no cleanup path. This is the exact "sim leaks into real pipelines/analytics" risk.
- **Fix sketch**: Pass an explicit `workspaceId` = the caller's `currentWorkspace()` (reject when the job isn't in it), and stamp intake with the `(SIM)`/demo marker (or a `demo` boolean column every reader filters) so cleanup and analytics both exclude it. Make the marker the single gate the way inbound already relies on it.

## 2. `resetSim()` always purges the DEFAULT workspace, so the public demo's `(SIM)` rows are never cleaned and "cleared" lies

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / silent-failure
- **File**: `app/_lib/sim-store.ts:40-57`, `app/api/sim/reset/route.ts:9`
- **Scenario**: `resetSim(workspaceId = DEFAULT_WORKSPACE_ID)` and the reset route calls `resetSim()` with no argument — it has no access to the caller's session. The public demo runs under `DEMO_WORKSPACE="demo"` (`/api/demo` mints that session), so every sim `pipeline_entries`/`pipeline_events` row it creates carries `workspace_id="demo"`, but the workspace-scoped DELETEs (`sim-store.ts:55,57`) target `"workspace"`. Nothing matches.
- **Root cause**: The purge is hardcoded to one workspace instead of the caller's. Inversely, the `jobs`/`jds` DELETEs (`:58,61`) are workspace-UNSCOPED, so an operator's reset (or a low-trust demo session's auto-reset at run start, `SimulationProvider.tsx:366`) reaches across the shared `jobs` table and deletes another workspace's `(SIM)` jobs.
- **Impact**: Demo-workspace pipeline residue accumulates unbounded across every public run (each demo shows stale prior-run candidates, degrading the demo itself), while `POST /api/sim/reset` returns `{ cleared }` counted from the wrong workspace — success theater. A demo session also destructively touches the real workspace's shared sim jobs.
- **Fix sketch**: Thread the caller's `currentWorkspace()` into `resetSim` and scope the `jobs`/`jds` DELETEs by `workspace_id` too, so reset purges exactly the caller's tenant and can't reach across it.

## 3. Autonomy control room fires consequential/irreversible actions on a single click with no confirmation

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: interaction-correctness / unguarded-action
- **File**: `app/control/ControlRoom.tsx:196-206,220-222,311`
- **Scenario**: The page bills itself as the human-oversight safeguard for a "high-risk AI hiring system", yet the Art. 22 human gate — "Approve & continue" (`:220`) — approves a candidate gate on one click with no confirm and no undo. "Pause (kill switch)" / "Resume" / "Reconcile" (`:196-206`) and "Apply suggested → floor" (`:311`, which changes the promote threshold governing every future auto-decision) are equally single-click.
- **Root cause**: The consequential controls reuse the same lightweight button treatment as read-only navigation; nothing distinguishes a reversible view toggle from an irreversible policy/gate mutation.
- **Impact**: A misclick approves an automated hiring decision or shifts the promote floor for the whole pipeline — precisely the class of action an oversight surface exists to make deliberate. On a 3s-polling list whose rows shift under the cursor, mis-approval is plausible.
- **Fix sketch**: Gate approve / apply-floor / reconcile behind a confirm step (inline "Confirm approve?" two-step, or a small dialog) and show the resulting change; keep pause/resume immediate (a kill switch should be) but visually separate it from the audit/nav controls.

## 4. ControlDock phase stepper encodes done/current/upcoming in color + icon only; the `<ol>` has no accessible name

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / color-only-state
- **File**: `app/features/simulation/ControlDock.tsx:287-316`
- **Scenario**: The new "Flight Deck" console (which replaces the old SimBar) renders the chronology as an `<ol>` of `<button>`s. Completion is conveyed purely by background color (coral active / `moss/15` done / `stone-100` upcoming) and by swapping `<Check>` for the phase icon (both `aria-hidden`). Only the active step gets `aria-current="step"`; done and upcoming steps have no text or ARIA state, and the `<ol>` itself has no label.
- **Root cause**: State lives entirely in visual tokens with no accessible equivalent — the same gap the 2026-06-20 report flagged on `SimBar.tsx:118-146`, re-introduced verbatim in the new component.
- **Impact**: A screen-reader user hears seven bare phase labels with no "completed/current/upcoming"; a colorblind user can't distinguish moss-done from stone-upcoming (the check glyph is the only non-color cue, and it's `aria-hidden`).
- **Fix sketch**: Add `aria-label="Pipeline phases"` to the `<ol>` and give each button an `aria-label` embedding state ("Screen — completed / current / upcoming"); keep the check/phase icon decorative. Extract this into one shared stepper so both the a11y and the visual state can't drift again.

## 5. Control-room outcome form uses placeholder-as-label and unlabeled 1–5 rating buttons

- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: `app/control/ControlRoom.tsx:274-275,375-385`
- **Scenario**: The "candidate" and "score" inputs (`:274-275`) carry only a `placeholder`, no `<label>` or `aria-label` — the accessible name vanishes the moment a value is typed, so a screen reader announces an unnamed textbox. The inline performance picker renders five buttons whose only content is the digit `1`–`5` (`:375-385`), so each announces just "1"…"5" with no "performance rating" context.
- **Root cause**: The Select controls next to them correctly pass `ariaLabel`, but the raw inputs and the digit buttons were left with visual-only affordances.
- **Impact**: Keyboard/SR operators recording hiring outcomes (a compliance-relevant record) get ambiguous field names and rating controls. Low because it's a small internal oversight surface with a sighted workaround.
- **Fix sketch**: Add `aria-label` (or visually-hidden `<label>`) to both inputs, and give each rating button `aria-label={`Rate performance ${p} of 5`}`; wrap the group in `role="group"` with an accessible name.
