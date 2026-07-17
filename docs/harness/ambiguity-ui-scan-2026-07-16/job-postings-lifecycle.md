# Job Postings & Lifecycle — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

## 1. Close route is the only lifecycle transition with zero workspace scoping
- **Severity**: High
- **Lens**: ambiguity
- **Category**: tenancy-asymmetry
- **File**: `app/api/jobs/[id]/close/route.ts:10`
- **Scenario**: A recruiter in a non-default workspace closes their own published role. The route never calls `currentWorkspace()`: `getJob(id)` is an unscoped point read (fine), but `closeEntriesByJobId(id)` at line 24 runs with its `DEFAULT_WORKSPACE_ID` fallback (`app/_lib/db/pipeline.ts:429`), so the withdrawal query filters `workspace_id = 'workspace'` and matches none of the team's in-flight entries — the close "succeeds" with `withdrawn: 0` while the funnel keeps chasing a retired role. There is also no ownership check at all: any caller can close another team's job or a shared seeded-corpus job (status NULL → 'closed' hides it from every tenant's catalog and rematch corpus; a later reopen then flips the shared row to 'published').
- **Root cause**: The publish route was hardened for tenancy (fetches `ws`, passes it to `countPublishedJobs` and `reopenEntriesByJobId`) but its mirror wasn't; publish/route.ts:55 even documents the assumption — "`ws` here equals the default workspace the close scoped to under the single-tenant lock" — i.e. correctness rests on a lock that lives in a different module and will silently stop holding when multi-workspace goes live.
- **Impact**: Under real multi-tenancy: silent non-withdrawal of in-flight candidates (inflated active funnel, candidates chased for a filled role) and cross-tenant close of jobs, including globally-shared corpus rows. Today it's latent, but the invariant is enforced nowhere and asserted only in a comment.
- **Fix sketch**: Mirror publish: `const ws = await currentWorkspace()` in the close route, pass it to `closeEntriesByJobId(id, ws)`, and reject (404) when `getJobWorkspace(id)` is neither NULL-owned-appropriately nor the caller's workspace — decide explicitly whether seeded (workspace NULL) jobs are closable at all, and encode that decision in code rather than a comment.

## 2. The abort machinery is unreachable: Cancel is disabled exactly while there is something to cancel
- **Severity**: High
- **Lens**: ui
- **Category**: dead-cancel-state
- **File**: `app/features/sub_jobs/IngestAdPanel.tsx:240`
- **Scenario**: A recruiter starts a 10-ad bulk import (each ad is a sequential ~2-minute Claude CLI parse), realizes the paste was wrong after row 2, and reaches for Cancel — but the button carries `disabled={busy}`, so it is inert for the entire run. The only way to stop the import is to navigate away from the tab (the unmount abort).
- **Root cause**: The component builds a full cancellation path — `abortRef.current?.abort()` in the Cancel handler, `controller.signal.aborted` early-returns in both submit paths ("lets a cancel mid-run stop cleanly", line 111-112), the route SIGKILLs the CLI child — then disables the one button that triggers it during the only window where it matters.
- **Impact**: Long, unstoppable LLM runs that keep burning subscription calls on a result the user already knows is wrong; the code's own comments promise a mid-run cancel that the UI cannot deliver. Worst on bulk (up to N × 120s), but the single-ad parse is equally uncancellable.
- **Fix sketch**: Keep Cancel enabled while busy and branch the handler: when `busy`, abort the controller and reset the run state (keep the panel open, show a "cancelled after X of Y" note using the partial `results`); when idle, keep the current close-panel behavior. The submitBulk aborted-path should also stop returning early without clearing `busy` for the still-mounted case.

## 3. Publishing from the Drafts panel leaves the Jobs table (and stats) stale
- **Severity**: Medium
- **Lens**: ui
- **Category**: stale-sibling-state
- **File**: `app/features/sub_jobs/DraftsPanel.tsx:57`
- **Scenario**: A recruiter clicks "Source into Pipeline" on a draft. The Drafts panel refreshes itself (`loadDrafts()`), but the corpus table sitting directly below it still shows the same row badged DRAFT, the header chips keep the old counts, and with "open only" ticked the newly-live role stays invisible — until a filter is touched or the page reloads.
- **Root cause**: The same transition was fixed for the modal path (JobPostingModal's `onChanged` → `patchJobStatus` + `reload()`, JobsTab.tsx:254-259, "job-postings-lifecycle #2"), but DraftsPanel is deliberately "self-contained" (its design comment, lines 15-16) and JobsTab mounts it with no props (JobsTab.tsx:111) — so the second publish surface never got the callback the first one did.
- **Impact**: Two adjacent surfaces on one screen disagree about the same job's lifecycle right after the user changed it; the DRAFT badge (whose whole point is "apply links dead") lies until an unrelated interaction.
- **Fix sketch**: Give DraftsPanel an optional `onPublished?: (jobId: string) => void` fired after a successful publish, and have JobsTab pass `(id) => { patchJobStatus(id, "published"); reload(); }` — the exact pair the modal path already uses. Self-containment is preserved (the prop is optional, other mounts unaffected).

## 4. Salary bands have no unit contract — the posting hardcodes "CZK / month" and Czech digit grouping in both languages
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: implicit-units
- **File**: `app/features/sub_jobs/jobMarkdown.ts:3`
- **Scenario**: A recruiter ingests an ad stating "€65,000/year", opens the posting tab in English, and copies a document that reads "**Salary:** 65 000 CZK / month" — wrong currency, wrong period, and cs-CZ thousands separators (non-breaking spaces) inside an English posting. Meanwhile the table's `formatBand` (JobsTypes.ts:147-150) shows a unitless "65–0k" style figure, so nothing in the UI ever states what the numbers mean.
- **Root cause**: `Job.salaryBand` is a bare `number[]` (JobsTypes.ts:48) with no unit/currency/period anywhere in the type or its producers; `fmtSalary` bakes `toLocaleString("cs-CZ")` + the literal `CZK / month` outside the `JobMarkdownStrings` table, so even the carefully-built EN/CS locale split (JOB3) can't correct it. The CZK-monthly assumption is true for the seeded Czech-market corpus but is nowhere stated, and ingest accepts arbitrary ads.
- **Impact**: The copy-to-job-board artifact — the product's external output, which the code elsewhere goes to lengths to keep honest (the "market estimate" label at line 97) — can assert a fabricated salary statement on behalf of the employer for any non-CZK-monthly source ad.
- **Fix sketch**: Document the contract at the type: either commit to "salaryBand is always normalized to CZK/month by the ingest pipeline" (and verify jobs_cli actually converts), or extend the band with `{currency, period}` and thread it through `fmtSalary`/`formatBand`. Short term, move the currency/period string and the number locale into `JobMarkdownStrings` so at least the EN posting formats as English.

## 5. The `?job=` deep link dies silently when the target isn't in the fetched slice
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: silent-deeplink-miss
- **File**: `app/features/sub_jobs/JobsTab.tsx:81`
- **Scenario**: A recruiter follows a Pipeline deep link (`?tab=jobs&job=<id>`) to a role that ranks past the list endpoint's default `LIMIT 300` (db/jobs.ts:342 — the corpus is ordered by entry-eligibility, not recency, so an ordinary published role can easily sit below the cut). `jobs.find(...)` misses, `appliedJobParam` is stamped anyway, and nothing happens — no modal, no message, and the param is never retried.
- **Root cause**: The once-per-param guard (a deliberate fix so refetches can't re-open a closed modal) treats "not found in the current page" identically to "already handled": the miss branch records the param and drops it on the floor. The ingest latch got a documented miss-vs-open resolution (lines 57-72); the sibling deep link did not.
- **Impact**: A navigation the app itself minted (Pipeline → "this role") intermittently no-ops depending on corpus size and ranking — the worst kind of bug report ("the link works for some jobs"). The user gets zero feedback that the target exists but wasn't shown.
- **Fix sketch**: On a miss, fetch the job directly (`GET /api/jobs` already has `q`, or add a by-id lookup — `getJob` exists server-side) and open the modal from that record instead of requiring membership in the rendered slice; if it truly doesn't exist, show a small dismissible "role not found" notice. Alternatively pass `jobParam` into `useJobsList` so the fetch guarantees inclusion.

## 6. `withdrawn: 0` conflates "nothing was in flight" with "withdrawal failed"
- **Severity**: Low
- **Lens**: ambiguity
- **Category**: best-effort-ambiguity
- **File**: `app/api/jobs/[id]/close/route.ts:23`
- **Scenario**: A recruiter closes a role with five active candidates; `closeEntriesByJobId` throws (line 24-27 catches and only `console.error`s). The response still says `ok: true, withdrawn: 0`, and the modal shows the "withdrew N" reassurance only when `closedCount > 0` (JobPostingModal.tsx:240) — so the recruiter sees exactly what an empty funnel looks like, while five candidates remain active against a closed role.
- **Root cause**: The best-effort decision ("the close already committed, so a withdrawal failure is logged, not surfaced") is reasonable, but the payload gives the client no way to distinguish the failure from a genuine zero — the error is flattened into the success shape's zero value.
- **Impact**: The one UI element built to prove "the pipeline was reconciled, not silently abandoned" (the JOB2 comment at JobPostingModal.tsx:56-57) is silently absent in precisely the case it was designed for; the stranded entries surface only later as funnel noise.
- **Fix sketch**: Add `withdrawalFailed: true` (or `withdrawn: null`) to the response on the catch path, and have the modal render a quiet amber "role closed, but its in-flight candidates could not be withdrawn — check the pipeline" note, mirroring the existing `sourcingWarning` pattern on publish.
