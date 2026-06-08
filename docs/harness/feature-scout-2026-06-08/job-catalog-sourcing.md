# Feature Scout — Job Catalog, Ingestion & Sourcing (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~17

## 1. Surface the prose-ad ingest in the Jobs UI ("Paste a job ad")
- **Value**: High
- **Category**: feature
- **Effort**: S
- **Where it slots in**: `app/features/sub_jobs/JobsTab.tsx:83` (after `<DraftsPanel />`) — the full ingest backend already exists at `app/api/jobs/ingest/route.ts:15`
- **Gap**: `/api/jobs/ingest` parses a prose ad into a structured, deduped, matchable Job via the Claude CLI — but **no UI ever calls it** (grep for `jobs/ingest` / `adText` across `app/**/*.tsx` returns nothing). A recruiter can only get roles into the catalog through the seed corpus or the JD-builder; they cannot paste the ad they were handed.
- **Opportunity**: A "Paste a job ad" card/modal in JobsTab: textarea → POST `/api/jobs/ingest` → on success refetch the list and open the new job's posting. Reuse the existing 30-char guard and the `created` flag (to say "already in catalog" on a content-hash hit).
- **Why it matters**: The single most-requested ATS action — "add this role" — is fully built server-side but unreachable, so the product looks like a read-only seeded demo.
- **Sketch**: Small client component mirroring `DraftsPanel`'s self-contained pattern; thread an `AbortController` so navigating away SIGKILLs the parse (the route already honors `request.signal`).

## 2. Ingest a role from a posting URL (and bulk-paste several)
- **Value**: High
- **Category**: integration
- **Effort**: M
- **Where it slots in**: `app/_lib/job-ingest.ts:145` (`ingestJobAd`) / `app/api/jobs/ingest/route.ts:17` — both take only inline `adText`
- **Gap**: Ingestion accepts pasted prose text only. There is no "fetch from URL" path and no bulk import — every role is one manual copy-paste. No file in `app/` references `fromUrl`, `csv`, or `bulk` ingestion of jobs.
- **Opportunity**: Accept `{ url }` on the ingest route: server-fetch the page, strip to readable text (existing `safe-url.ts` guards SSRF), then run the same `ingestJobAd`. Add a multi-ad mode (split on a delimiter / array body) that loops the parser and reports per-ad created/duplicate counts.
- **Why it matters**: Recruiters live in job-board tabs; "paste the link" is dramatically faster than copying ad text, and bulk import lets a team seed a real catalog in minutes instead of one ad at a time.
- **Sketch**: Branch in the POST handler on `url` vs `adText`; reuse `jobContentHash` for dedup so re-importing the same URL reuses the prior Job (`created=false`).

## 3. "Reach out" directly from a sourcing result
- **Value**: High
- **Category**: automation
- **Effort**: M
- **Where it slots in**: `app/features/sub_jobs/RecruiterCandidates.tsx:212` and `RediscoverPanel.tsx:78` — both only offer "+ pipeline"
- **Gap**: The sourcing surfaces (recruiter candidate ranking, talent rediscovery) can only **Add to pipeline**. The outreach machinery already exists — `app/_lib/comms-dispatch.ts:28` `dispatchOutreach` routes through the durable outbox — but it only fires later from pipeline automation, never from the moment a recruiter spots a strong silver-medalist.
- **Opportunity**: A "Reach out" action beside "Add to pipeline" that creates the entry **and** dispatches a first-touch outreach draft (role + matched-skills context) in one click, landing in the same Outbox audit log.
- **Why it matters**: Rediscovery's whole promise is "don't let strong past candidates fall through the cracks" — but today acting on a resurfaced candidate still means hunting them down in the pipeline tab to message them. One-click outreach closes the discover→contact loop.
- **Sketch**: Extend `useAddToPipeline` with an `addAndReach` variant, or add a thin `/api/jobs/[id]/candidates/[cid]/outreach` route that calls `createPipelineEntry` then `dispatchOutreach`; reuse `candidateRecipient`'s name-resolution contract.

## 4. Per-role sourcing analytics on the posting
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where it slots in**: `app/features/sub_jobs/JobPostingModal.tsx:82` (tab list) — stats today are corpus-wide chips in `JobsTab.tsx:69`
- **Gap**: The only catalog metrics are global `jobStats` chips (total / entry-eligible / by-family). A single role's posting modal shows the ad, its candidates, rediscovery, and interview compare — but no **sourcing health for that role**: how many eligible vs KO-filtered, the score distribution, how many already sourced into pipeline, how many drafts published with 0 sourced.
- **Opportunity**: A compact "Sourcing" header on the Candidates tab: eligible/KO counts (already computed at `RecruiterCandidates.tsx:84-87`), a score histogram, and "N sourced into pipeline" — so a recruiter sees whether a role is well-supplied or starved before publishing.
- **Why it matters**: Turns sourcing from a blind "click and hope" into a decision: a role with 1 eligible candidate needs a wider net or a relaxed must-have, and the recruiter should see that up front.
- **Sketch**: Derive from the already-fetched candidates payload (no new compute); optionally fold in `candidateOutcomes()` counts the rediscover route already loads.

## 5. Saved searches / candidate segments for sourcing
- **Value**: Medium
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/features/sub_jobs/useJobsList.ts:23` (ephemeral filter state) and `app/_lib/candidate-pool.ts:46` (one flat, cap-bounded pool)
- **Gap**: Catalog filters (family / seniority / mode / entry / text) reset on reload — nothing is saveable. And the candidate pool is one undifferentiated list capped at ~160 (`PROFILE_POOL_CAP + ANALYSIS_POOL_CAP`); there is no way to segment sourcing (e.g. "early-career only", "knows German", a named talent list).
- **Opportunity**: Persist named saved searches (catalog filters and/or a candidate-pool segment) so a recruiter can one-click "Reopen: Junior remote Data roles" or score a role against just the "German-speaking" segment instead of the whole capped pool.
- **Why it matters**: Recurring sourcing patterns are recreated by hand every session; saved segments also sidestep the silent pool-cap drop (`candidate-pool.ts:50`) by letting a recruiter target a smaller, relevant population.
- **Sketch**: A `saved_searches` table (filters JSON + optional candidateId list); pass a segment id through `buildCandidatePool` to filter entries before the recruiter_cli ranker.

## 6. Cross-role rediscovery digest (not just per-role on demand)
- **Value**: Low
- **Category**: automation
- **Effort**: M
- **Where it slots in**: `app/api/jobs/[id]/rediscover/route.ts:36` — rediscovery runs only when a recruiter opens one role's Rediscover tab
- **Gap**: Talent rediscovery is strictly pull-per-role: you must open each posting and wait for a scan. There is no catalog-wide view of "every strong silver-medalist across all open roles", so a great rejected candidate only resurfaces if someone happens to open the right role.
- **Opportunity**: A "Rediscoveries" panel on JobsTab that runs rediscovery across published roles and lists the top cross-role matches (candidate → best-fit open role), each with the existing one-click add.
- **Why it matters**: Proactively surfaces re-engageable talent the recruiter would otherwise never look for — the rediscovery value only triggers today if they manually visit the exact matching role.
- **Sketch**: Iterate published jobs over the shared `buildCandidatePool`, reuse the existing `SCORE_FLOOR`/`pickPrior` logic, dedup per candidate to their best role; cache/throttle since this is N roles × pool.
