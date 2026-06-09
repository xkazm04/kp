# Job Catalog, Ingestion & Sourcing — UI+Bug combined scan
> Total: 4 findings (0 crit / 2 high / 2 med / 0 low)
> Group: Jobs & Job Descriptions | Lens mix: 3 bug / 1 ui | Files read: 18

## 1. Ingested ads go live as `published`, silently skipping the draft → source-into-pipeline lifecycle
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: State mutation at trust boundary / lifecycle inconsistency
- **File**: `app/api/jobs/ingest/route.ts:27`
- **Scenario**: A recruiter pastes a prose ad in `IngestAdPanel`. The route calls `insertJob(job, jobContentHash(adText))` with no `status` argument. `insertJob`'s default is `status = "published"` (`app/_lib/job-ingest.ts:52`), so the new row is created already-published.
- **Root cause**: The JD-builder save path deliberately passes `"draft"` (`app/api/jds/save/ingest-job.ts:54`) so authored roles enter the draft → publish lifecycle, surface in `DraftsPanel`, and get candidates sourced into the pipeline by `POST /api/jobs/[id]/publish`. The ingest route omits the third arg and inherits the `"published"` default, so pasted-ad jobs are born "live" but **the publish route's sourcing step never runs for them** — `runSourceForRole` + `createPipelineEntry` are only invoked from `/publish`, which the user is never prompted to call because the job is never a draft and never appears in `DraftsPanel` (`listDraftJobs` filters `status = 'draft'`).
- **Impact**: Two parallel "add a role" paths behave inconsistently. An ingested role looks identical to a JD-built one in the corpus but has **zero sourced pipeline candidates** and offers no UI affordance to source them — the recruiter must notice the empty pipeline and manually re-add candidates from the Candidates tab. The promised "ingest → matchable role with surfaced candidates" flow is half-wired.
- **Fix sketch**: Pass `"draft"` explicitly: `insertJob(job, jobContentHash(adText), "draft")`, so ingested ads land in `DraftsPanel` and go through the same Source-into-Pipeline step as authored JDs. Alternatively, if ingested ads are intended to auto-source, have the ingest route invoke the same sourcing logic — but the draft path is the smaller, consistent change.

## 2. Recruiter Candidates tab shows stale data (and a stuck error) when the open modal switches to a different job
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Stale state / effect-dependency gap
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:52-59` (and `app/features/sub_jobs/JobPostingModal.tsx:117`, `app/features/sub_jobs/JobsTab.tsx:213`)
- **Scenario**: The posting modal is open on job A's Candidates tab. A second deep-link (`?tab=jobs&job=B`) resolves, or the just-ingested `pendingOpenId` resolves to a different job, while the modal is still mounted. `JobsTab` renders `<JobPostingModal job={openJob} />` with **no `key`** (line 213), so React reuses the same `JobPostingModal` and the same `RecruiterCandidates` instance; only the `jobId` prop changes.
- **Root cause**: `RecruiterCandidates` holds `data`/`error` in local state and its auto-load effect depends only on `[autoLoad]` (line 59, with `exhaustive-deps` disabled). When `jobId` changes on an already-mounted instance, the effect does not re-fire, and the early `if (!data)` gate at line 71 is now false — so job A's scored candidates (and any `error`) remain on screen for job B, with no way to refresh. The "Score saved candidates" button only shows while `data` is null.
- **Impact**: A recruiter can Add/Reach-out to job A's ranked candidates believing they match job B — the `add`/`reach` calls use the new `jobId`, filing the wrong candidate set under the wrong role. Same hazard for a sticky error.
- **Fix sketch**: Key the modal subtree by job id (`<JobPostingModal key={openJob.id} ... />`) so a job change remounts it, OR add `jobId` to the effect deps and reset `data`/`error` when `jobId` changes. `RediscoverPanel` and `CompareInterviews` use `useJsonFetch` keyed on the URL so they already re-fetch; only `RecruiterCandidates` (hand-rolled `load`) has the gap.

## 3. Candidates fetch omits `encodeURIComponent(jobId)`, diverging from the sibling rediscover/compare panels
- **Severity**: Medium
- **Lens**: 🐛 Bug
- **Category**: Validation gap at trust boundary / inconsistency
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:37`
- **Scenario**: `fetch(`/api/jobs/${jobId}/candidates`)` interpolates the raw id. `RediscoverPanel` (`RediscoverPanel.tsx:27`) and `CompareInterviews` (`CompareInterviews.tsx:144`) both wrap the id in `encodeURIComponent`. Job ids today are slugified to `[a-z0-9-]` (`pipeline/jobfit/jobs.py:362`) or `jd-<slug>` / `m-...`, so this is currently safe — but the contract isn't enforced: `normalize_job` accepts an explicit `id` / `raw.get("id")` (`jobs.py:340`) ahead of the slug fallback, and `insertJob` stores any id verbatim.
- **Root cause**: A raw id containing `/`, `?`, `#`, or `%` would break the path or be silently mis-routed (e.g. `a/b` → wrong route, `a?x` → spurious query). The three panels render the same id three different ways; only one is hardened.
- **Impact**: Latent path-injection / mis-routing if an externally-supplied or future id format ever carries a non-`[a-z0-9-]` character; immediate harm is a confusing 404 rather than the real candidates list. Low blast radius today, but it's a one-line trust-boundary inconsistency between siblings.
- **Fix sketch**: Wrap the id: `fetch(`/api/jobs/${encodeURIComponent(jobId)}/candidates`)`, matching the other two panels.

## 4. CandidateCard header row can't wrap — badges + action buttons overflow on narrow / two-column widths
- **Severity**: Medium
- **Lens**: 🎨 UI
- **Category**: Missing responsive behavior
- **File**: `app/features/sub_jobs/RecruiterCandidates.tsx:228`
- **Scenario**: Each candidate card's header is `<div className="flex items-center gap-2">` containing, in one non-wrapping row: a `ScoreBadge`, the `low–high` confidence span, a `ConfidenceBandBadge`, the candidate label, the archetype pill, a `FitTierBadge`, and an `ml-auto` cluster with the "Reach out" + "+ pipeline" buttons. The cards live in a `lg:grid-cols-2` grid (line 109), so on a laptop each card is roughly half the modal width, and on a phone the modal itself is narrow.
- **Root cause**: The row has no `flex-wrap`. With a long candidate label or several matched-skill conditions, the fixed cluster of badges plus two buttons exceeds the column width. `items-center` + no-wrap forces single-line layout, so children either get squeezed (truncating `ml-auto` buttons off-edge) or push horizontal overflow — and the long `c.label` has no `truncate`/`min-w-0`, unlike the rediscover list which guards with `min-w-0 flex-1` + `truncate` (`RediscoverPanel.tsx:70-71`).
- **Impact**: On narrow viewports the primary actions (Reach out / Add to pipeline) can be clipped or shoved out of view, and the label collides with the badges — degraded usability exactly where a recruiter triages candidates. The sibling rediscover surface already handles this correctly, so the two candidate views are visually inconsistent.
- **Fix sketch**: Add `flex-wrap` to the header row and wrap the label in a `min-w-0 truncate` cell (mirroring `RediscoverPanel`), keeping the action cluster on its own wrap line via the existing `ml-auto`. No behavior change, restores parity with the rediscover card.
