# Job Postings & Lifecycle — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Active-job billing cap is bypassable by concurrent publishes (check-then-set race)
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Race / billing entitlement bypass
- **Value**: impact 8/10 · effort 3/10 · risk 3/10
- **File**: `app/api/jobs/[id]/publish/route.ts:28-32`
- **Scenario**: Free plan allows 1 active job. A recruiter (or a double-clicked "Source into Pipeline" button, or two browser tabs) fires `POST /publish` for two different drafts near-simultaneously. Both requests run `getJobStatus(id) === "published"` (false), both call `activeJobsGate(countPublishedJobs())` while the count is still 0, both pass the gate, then both `setJobStatus(id,"published")` — two live jobs on a 1-job plan.
- **Root cause**: The read (`countPublishedJobs`) and the write (`setJobStatus`) are separate statements with no transaction or row-level guard. `activeJobsGate` is a pure decision over a count captured before the write; nothing serializes the two publishes. `job-ingest.ts`'s connection doesn't even set `busy_timeout`, so it relies purely on statement ordering.
- **Impact**: Revenue gate is defeatable; the paid feature (multiple active jobs) leaks to free. Also corrupts the entitlement story the rest of billing trusts.
- **Fix sketch**: Wrap count-gate-set in a single better-sqlite3 `db.transaction()` in `job-ingest.ts` (e.g. `publishWithCap(id, limit)`), re-reading `countPublishedJobs()` inside the txn and aborting if `>= limit`. Return a sentinel the route maps to 402. SQLite's write serialization then makes the cap atomic.

## 2. Closing a role abandons its already-sourced pipeline candidates
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Lifecycle / data-consistency dead-end
- **File**: `app/api/jobs/[id]/close/route.ts:16-18`
- **Scenario**: Recruiter publishes a role (sourcing files N candidates as "Accepted" pipeline entries), interviews, then clicks "Close role" because it's filled. Close only flips `jobs.status='closed'`. The N pipeline entries stay `active`/`Accepted`; `JobLifecycleStrip` still shows "funnel N", decisions/offers counts, and the Pipeline tab still lists them as live work for a role no one can apply to.
- **Root cause**: Close is a pure status flip with no cascade. There's no notion of "withdraw remaining candidates" or "archive funnel" — the terminal state was added for the apply surface (410) but never reconciled the in-flight pipeline it leaves behind.
- **Impact**: Recruiters chase candidates for a filled role; dashboards overstate active funnel; "hired" vs "abandoned" is indistinguishable. Undermines the just-added close feature's value.
- **Fix sketch**: On close, offer (or auto-run) a reconcile: mark this job's still-`active` entries as `withdrawn`/`role_closed` with an audited event, and exclude `closed`-job entries from the lifecycle strip's `active` counts. Surface a count in the close confirm ("3 candidates still in pipeline — withdraw them?").

## 3. No reopen / no draft-revert: close is a one-way trap
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Missing lifecycle transition / journey dead-end
- **File**: `app/_lib/job-ingest.ts:115-117`
- **Scenario**: A recruiter mis-clicks "Close role" (or a role re-opens after a hire falls through). `setJobStatus` supports `published`, but the only UI transitions are draft→publish and *→closed. The modal's close button becomes `disabled` once closed (`isClosed`), and the catalog badges it amber forever. The only recovery is editing the DB.
- **Root cause**: The state machine was built forward-only per surface; there's no "Reopen" action wired to `setJobStatus(id,"published")`, even though the function already accepts it and re-publish is documented idempotent.
- **Impact**: Recruiters expect to reopen a req (standard ATS capability). A common, recoverable mistake becomes unrecoverable in-product — a sharp differentiation gap and a support burden.
- **Fix sketch**: Add a "Reopen" button shown when `isClosed` that POSTs `/publish` (already idempotent + quota-gated, which correctly re-checks the active-jobs cap on reopen). Flip the modal/footer to allow it; clear the amber badge on success.

## 4. Bulk ingest fires a reload + modal auto-open storm per created ad
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: State thrash / unexpected UI side effect
- **File**: `app/features/sub_jobs/IngestAdPanel.tsx:119` + `JobsTab.tsx:105-112,55-62`
- **Scenario**: Recruiter bulk-imports 10 ads. For *each* created row, `submitBulk` calls `onIngested(result)`, which in `JobsTab` runs `setPendingOpenId(result.jobId)` **and** `reload()`. So a 10-ad import triggers 10 corpus refetches mid-loop, and `pendingOpenId` ends up set to the last created job — whose modal pops open the instant that job lands in the refreshed list, on top of the still-running import results table.
- **Root cause**: The single-ad auto-open contract (latch onto the just-added job) was reused verbatim for the per-row bulk callback, where "open the modal" is wrong and "refetch on every row" is wasteful.
- **Impact**: N redundant `/api/jobs` fetches during a bulk run; a modal hijacks the screen while the user is still reading the import summary. Confusing and janky on the exact power-user path bulk was built for.
- **Fix sketch**: Give `onIngested` (or a sibling `onBulkComplete`) a `silent`/no-auto-open variant for bulk; debounce/coalesce to a single `reload()` after the loop finishes (the results table already reports per-row outcomes). Only auto-open for the single-ad path.

## 5. Quota (402) on publish is shown as a generic "sourcing failed" warning, not an upgrade prompt
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Error-state mishandling / monetization moment
- **File**: `app/features/sub_jobs/JobPostingModal.tsx:74-86` + `DraftsPanel.tsx:31-46`
- **Scenario**: A free-plan recruiter hits the 1-active-job cap and clicks "Source into Pipeline". The route returns `402 {error, code:"quota_exceeded", meter:"active_jobs", plan}`. The client only checks `!r.ok` and renders `p.error` in the amber "warn" note styled identically to a broken-pipeline sourcing failure — no upgrade CTA, no distinction between "your pipeline broke" and "you've hit your plan limit."
- **Root cause**: `publishRole`/`sourceDraft` collapse every non-OK response into the same `tone:"warn"` note and ignore the structured `code`/`meter` fields the billing layer deliberately returns for client branching.
- **Impact**: The single highest-intent upsell moment (recruiter actively trying to publish a 2nd job) renders as an error, not an "Upgrade in Billing" path — lost conversion and a confusing message ("close one or upgrade") with no link.
- **Fix sketch**: Branch on `p.code === "quota_exceeded"`: show a distinct quota state (not warn-amber) with a link to the Billing tab / close-a-role action. Reuse the existing client-side quota i18n the rest of the app uses for `quota_exceeded`.
