# Job Postings & Lifecycle — bug-hunter + ui-perfectionist scan

> Context: Create, ingest, publish and close job postings and track their lifecycle (Jobs tab table, posting modal, ad ingestion, draft splitting).
> Files reviewed: 18 of 21
> Total: 5

## 1. Reopening a closed role leaves the pipeline half-resurrected with no audit event

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: `app/api/jobs/[id]/publish/route.ts:33-103`, `app/_lib/db/pipeline.ts:571-604` (createPipelineEntry terminal-status flip), `app/_lib/db/pipeline.ts:361-387` (closeEntriesByJobId)
- **Scenario**: A recruiter closes a filled role — `closeEntriesByJobId` marks every active, non-Hired entry `role_closed` and records a `role_closed` timeline event. Later they click **Reopen** (which just re-POSTs `/publish`). `getJobStatus` is `"closed"`, so `already=false` and the route re-runs `runSourceForRole`. For each re-scored candidate `createPipelineEntry` finds the existing `m-<cand>-<job>` row, sees `isTerminalEntryStatus("role_closed")`, and flips it back to `status='active'` — keeping the stale stage and writing **no** event.
- **Root cause**: Reopen is modelled as "publish again + let sourcing incidentally un-terminal whatever it re-selects", not as an explicit inverse of close. So resurrection is partial and silent: candidates the matcher no longer returns (or *all* of them, since sourcing is best-effort and a `sourcingWarning` path re-sources zero) stay stranded in `role_closed` while the role is open, and those it does return jump to active with a timeline that still ends at `role_closed` — the audit trail lies. A close arriving during another request's multi-second sourcing `await` is also immediately re-added as active (no transaction spans the source step).
- **Impact**: A reopened role's funnel silently disagrees with reality; withdrawn candidates are either abandoned or un-withdrawn with no record, corrupting reject-rate/funnel analytics that key on `role_closed`.
- **Fix sketch**: Add an explicit `reopenEntriesByJobId(jobId)` that flips `role_closed→active` in one transaction and records a `role_reopened` event, and call it from the publish route when transitioning `closed→published` — do not rely on re-sourcing to reverse a close.

## 2. [STILL-OPEN] Lifecycle transitions never refresh the Jobs table — status badge/chips go stale

- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state (stale-state / missing-refetch)
- **File**: `app/features/sub_jobs/JobsTab.tsx:237` (`<JobPostingModal … onClose />`), `app/features/sub_jobs/JobPostingModal.tsx:48-112` (close/publish), `app/features/sub_jobs/DraftsPanel.tsx:57` (`loadDrafts` only)
- **Scenario**: Prior scan #1 — still open. A recruiter closes/reopens a role in the modal, or clicks "Source into Pipeline" in DraftsPanel; the modal updates its own local state but `JobsTab` is never told, so the underlying `JobRow` keeps rendering the cached `job.status` (`JobStatusBadge`), and `statTotal`/`openOnly` reflect pre-change data until a manual reload. It still matters because `JobPostingModal` takes only `{job,onClose}` — no `onChanged`, unlike `IngestAdPanel` which correctly gets `onIngested`/`onBulkComplete`→`reload()`.
- **Root cause**: The list-refetch plumbing (`useJobsList().reload`) exists and is wired to ingestion but was never threaded to the two surfaces that mutate a job's lifecycle. DraftsPanel refreshes only its own draft list, not the corpus table.
- **Impact**: The catalog misrepresents which roles are open; a just-closed role still reads live and survives an "open only" filter.
- **Fix sketch**: Add `onChanged?: () => void` to `JobPostingModal` (fire in close/publish success) and to `DraftsPanel`, and wire both to `reload` in `JobsTab`.

## 3. Bulk-paste splitter fragments a single ad on any markdown/signature rule

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case (validation-gap)
- **File**: `app/_lib/split-ads.ts:15-25`
- **Scenario**: In bulk mode a recruiter pastes ONE ad that contains a horizontal rule or section divider — `---`, `***`, `===`, `___`, or an email-signature dash line — all common in real job ads and markdown. `SEPARATOR = /^[ \t]*[-—_=*]{3,}[ \t]*$/m` treats every such line as an ad boundary, so `splitJobAds` returns multiple chunks and each ≥30-char fragment is sent to the LLM as a *separate* job, minting duplicate/garbage postings.
- **Root cause**: The separator alphabet (`- — _ = *`) collides with ordinary in-body markup; the only guard is the 30-char floor, which section-sized fragments clear. The "Import N" preview count reflects the wrong split but doesn't explain why.
- **Impact**: One pasted role silently becomes several partial jobs in the corpus (and pipeline, once published) — hard to notice and tedious to unpick.
- **Fix sketch**: Require a stricter, less markup-collision-prone delimiter (e.g. a blank line *plus* a rule, or a sentinel like `%%%`/`=== NEW AD ===`), and surface the parsed boundaries in the preview so the recruiter confirms the count before import.

## 4. Ingest panel never resets its results/progress across mode-switch or reopen

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_jobs/IngestAdPanel.tsx:210-224` (cancel handler), `:41` (bulk toggle), `:228-244` (results render)
- **Scenario**: A recruiter runs a bulk import (populating the `results` per-row table), then unchecks "bulk" and adds a single ad — the stale bulk results table still renders beneath the unrelated single-add note. Collapsing the panel via Cancel clears `adText`/`error`/`note` but **not** `results`/`progress`, so reopening the panel shows the previous run's rows and (if aborted) a frozen progress label.
- **Root cause**: `results`/`progress` are only ever appended to, never cleared on the transitions that make them stale (bulk toggle, panel close, starting a single add).
- **Impact**: Confusing, apparently-live status from a finished/abandoned run; the panel looks like it's mid-import when it isn't.
- **Fix sketch**: Clear `results` and `progress` in the Cancel/close handler, on `setBulk` change, and at the start of `submit`.

## 5. Post-ingest auto-open silently no-ops when "open only" is filtered, and leaks the pending id

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure (edge-case)
- **File**: `app/features/sub_jobs/JobsTab.tsx:57-64` (`pendingOpenId`), `app/api/jobs/ingest/route.ts:32` (inserts status `"draft"`), `app/_lib/db/jobs.ts:291-294` (openOnly excludes drafts)
- **Scenario**: `/api/jobs/ingest` always inserts the parsed ad as a **draft**. `JobsTab.onIngested` sets `pendingOpenId` and reloads, expecting the new job to appear so the render-phase effect can auto-open its modal. But if the recruiter has the **openOnly** filter checked, `listJobs` filters drafts out, the id never matches, the modal never opens, and `pendingOpenId` stays set — so the *next* ingest (or any list change producing a matching id) can auto-open a modal unexpectedly.
- **Root cause**: The auto-open latch assumes the ingested job is always visible in the current filtered view; a draft under the openOnly filter isn't.
- **Impact**: The recruiter sees the "added to catalog" note but no posting opens (looks like nothing happened), plus a latent stray auto-open later.
- **Fix sketch**: When latching `pendingOpenId`, ensure the ingested draft is reachable (e.g. clear/ignore `openOnly` for that latch, or open by id directly from the ingest result instead of waiting for it to surface in the filtered list); clear `pendingOpenId` after a bounded number of misses.
