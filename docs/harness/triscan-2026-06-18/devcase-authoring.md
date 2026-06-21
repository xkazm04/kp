# Dev Case Authoring & Publishing — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 3 bug / 2 ui / 0 biz

## 1. Late submission lost when it arrives mid-evaluation of a collecting lifecycle
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Concurrency / silent data loss
- **Value**: impact 9/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/devcase-orchestrator.ts:256` (read at 257) · `app/_lib/tasks.ts:201` · `app/_lib/task-dedupe.ts:66`
- **Scenario**: A lifecycle task is running the `collecting` branch. It snapshots `listSubmissions(postingId)` at line 257, then spends time evaluating that batch. Candidate B applies via `/api/devcase/inbound` while the task is still `running`. `resumeCollectingLifecycle` calls `startTask("lifecycle", …)`, but `buildDedupeKey` returns the stable key `lifecycle:<id>`, so `getActiveTaskByDedupe` finds the in-flight run and **coalesces** (tasks.ts:184-186) — no new run is queued. The running task already captured its `subs` array and never sees B. It then advances the lifecycle to `ranked` → `promoted` and **returns** (line 320). B's submission is acknowledged ("we received your work") but is never evaluated, ranked, or promoted — a silent ghost.
- **Root cause**: The collecting handler reads submissions once and is not re-entrant; the dedup that (correctly) prevents duplicate concurrent runs also drops the *resume* signal for arrivals that land after the snapshot but before the run terminates. There is no "dirty/re-check" flag, and once the stage leaves `collecting` no further intake can resume it.
- **Impact**: Real candidates who applied to a published, automated posting are silently dropped from evaluation/promotion under normal timing — the exact failure a hiring tool must never have. Probability scales with evaluation duration (LLM calls of seconds each).
- **Fix sketch**: After the collecting batch completes, before advancing, re-read submissions and stay in `collecting` (loop) if new un-evaluated rows exist. Or set a durable `collecting_dirty` flag on intake; have the run clear-and-recheck it before transitioning to `ranked`, re-enqueuing itself if set. Mirror the `SYNC_DIRTY` pattern used elsewhere in the codebase.

## 2. Standalone publish route mints a duplicate posting + apply token (no idempotency)
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Publish idempotency
- **File**: `app/api/devcase/publish/route.ts:14` · `app/_lib/distribution.ts:31` · `app/_lib/db/devcase.ts:378`
- **Scenario**: `POST /api/devcase/publish` always calls `getAdapter().publish(devCase)` → `createPosting(...)`, which unconditionally INSERTs a new posting row with a fresh token and no `caseId` dedup. The CaseDetail button disables when `published` is true (CaseDetail.tsx:120), but that is a client-only guard: a retried request, a stale tab, the lifecycle having already published the case, or a direct API call each creates a *second* live posting with a *second* apply token. The orchestrator itself guards this via `lc.postingId` (orchestrator.ts:133-138) and its own comment flags the hazard — but the manual route inherited none of that protection.
- **Root cause**: Idempotency lives only in the orchestrator's in-memory `postingId` reuse and the disabled button; the publish *endpoint* has no server-side "already published this case on this channel?" check, and `dev_postings` has no UNIQUE constraint on `(case_id, channel)` (core.ts:344-353).
- **Impact**: Two competing apply links for one role; submissions split across tokens; the case-wide shortlist still merges them, but the duplicate token keeps collecting after a close (close iterates all postings, so partially mitigated) and clutters "Apply channels". Token *collision* is not a real risk (128-bit CSPRNG), but token *proliferation* is.
- **Fix sketch**: In `publish/route.ts` (or `LocalDistributionAdapter.publish`), look up an existing open posting for `(caseId, channel)` and return it instead of minting a new one; optionally add a partial UNIQUE index `(case_id, channel) WHERE status='open'` guarded like the submissions dedup index.

## 3. No in-context cancel for a running lifecycle generation
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Control correctness / discoverability
- **File**: `app/features/sub_dev/LifecycleRow.tsx:81` · `app/features/sub_dev/DevTab.tsx:132`
- **Scenario**: A recruiter kicks off "Run automated lifecycle"; analyze + design are multi-second LLM/Python steps the orchestrator *does* support aborting (orchestrator.ts:88-89 honors `signal.aborted`, and `cancelTask` SIGKILLs the Python child). But the Dev tab exposes no Cancel button — `cancelTask` is wired only into the separate global Tasks tab (TasksTab.tsx:357). To stop a misfired or runaway generation the user must leave the studio, find the right task among all background tasks, and cancel it there. The lifecycle row shows a spinner-equivalent ("Lifecycle running…") with no stop affordance.
- **Root cause**: The abort capability exists end-to-end in the backend and task runner but was never surfaced in the lifecycle UI where the work is initiated and watched.
- **Impact**: Wasted LLM budget on a wrong-need run; a recruiter who picked the wrong JD/repo cannot recover without a scavenger hunt — a journey dead-end during the longest-latency action in the feature.
- **Fix sketch**: Add a Cancel button on `LifecycleRow` (and/or the NeedForm "Lifecycle running…" state) that calls `cancelTask(taskId)` for the in-flight `lifecycle` task matching this lifecycle id; reuse the existing TasksProvider `cancelTask`.

## 4. Degraded scenario/seed warnings only show in CaseDetail, not where publishing is decided
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Surfacing / quality signal placement
- **File**: `app/features/sub_dev/CaseDetail.tsx:80` · `app/features/sub_dev/CasesTable.tsx:74` · `app/features/sub_dev/LifecycleRow.tsx:25`
- **Scenario**: The orchestrator honestly records when an interview scenario fell back to template probes (`scenario_template_only`) or a seed shipped skeleton-only (orchestrator.ts:160-200), and CaseDetail renders amber "template probes" / "skeleton only" badges (CaseDetail.tsx:94-115). But these warnings appear only after you open the case detail. The CasesTable row and the LifecycleRow — the surfaces a recruiter scans to decide what to publish/source/interview on — show none of it. A degraded case looks identical to a fully-grounded one in the list, so a recruiter can publish and start interviewing on generic template probes without ever seeing the warning.
- **Root cause**: The degraded-provenance signal is computed and displayed only in the leaf detail view; the list/row components don't read `scenario.source` / `seed.source`.
- **Impact**: The system's own honesty contract (don't pass a template off as a real LLM scenario) is undercut by placement — the warning isn't at the decision point. Quality-of-hire risk: candidates judged on generic, non-discriminating probes.
- **Fix sketch**: Surface a compact amber dot/badge on `CasesTable` rows and `LifecycleRow` when `kase.scenario?.source` or `kase.seed?.source` is non-`llm`, linking to the detail; the data is already on the loaded record (no new fetch).

## 5. Redesign at the gate re-debits case-design quota with no idempotency, encouraging hesitation
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Billing / metering
- **File**: `app/api/devcase/lifecycle/[id]/redesign/route.ts:37` · `app/api/devcase/lifecycle/route.ts:29`
- **Scenario**: Each `Regenerate with note` at the approval gate runs `meterGate("case_designs")` + `recordMeterUsage("case_designs")` (redesign route 37-39) — a full billable design unit, same as starting a lifecycle. A reviewer iterating on a flawed design ("narrow task 2", then "shorten the brief") is metered per click, with no dedup if the request is retried on a slow LLM call (the button disables locally, but a network retry / double POST each debits). There is no cap, no "first N redesigns free", and no idempotency key, so a transient 500 that actually completed server-side double-charges.
- **Root cause**: Redesign reuses the lifecycle-start billing path verbatim; metering is fire-and-forget with no request-level idempotency and no distinction between an initial design and a correction of one the customer already paid for.
- **Impact**: Customers are charged to *fix* a design the engine got wrong, punishing the exact human-in-the-loop behavior the gate is meant to encourage — a monetization mis-incentive plus a real double-debit-on-retry bug. Erodes trust in the meter.
- **Fix sketch**: Make redesign idempotent (debit keyed on a client-supplied request id, or skip the debit when the prior design for this lifecycle was itself unpaid/failed); consider a small free-redesign allowance per lifecycle so iterating toward a good case isn't penalized. At minimum, only `recordMeterUsage` after `runDesignArtifacts` succeeds, not before.
