# Candidate Profile & Job Matching — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 3 bug / 1 ui / 1 biz

## 1. Match & candidate-pool resolution drops the workspace, then reads jobs from an unscoped corpus
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Tenancy / data isolation
- **Value**: impact 9/10 · effort 3/10 · risk 3/10
- **File**: `app/_lib/match-candidate.ts:37`, `app/_lib/match-input.ts:36`, `app/api/profile/candidates/route.ts:12`, `app/_lib/db/jobs.ts:209` & `:250`
- **Scenario**: A second workspace is minted (the infra already exists: `createWorkspace`, `/api/workspaces`, a switch-workspace route, and `currentWorkspace()` resolves a real per-request tenant from the signed session). Recruiter B opens the Profile tab or runs a match. `/api/profile/candidates` calls `listAnalysisRecords(200)` with no workspace; `resolveCandidate` calls `loadAnalysis(slug)` with no workspace; `writeMatchInput` calls `getProfileRecord(id)` with no workspace — all silently fall back to `DEFAULT_WORKSPACE_ID`. Worse, the corpus the matcher and reasoning runner score against (`listCorpusJobs`, `getJob`) has **no `workspace_id` column or filter at all**, so every tenant's published jobs are matched and quoted in verdicts.
- **Root cause**: The DB layer added a `workspaceId` parameter (defaulting to the single default) as a tenancy seam, but the Match/Profile-candidate call sites — unlike `app/api/profile/route.ts`, which threads `currentWorkspace()` everywhere — never pass it, and the jobs store was never given the column.
- **Impact**: Latent today (one workspace) → full cross-tenant candidate/profile/job leak the moment a second workspace exists. Silent: no error, just another tenant's data ranked and reasoned over.
- **Fix sketch**: Thread `await currentWorkspace()` into `resolveCandidate`/`writeMatchInput`/the candidates route (they already accept it). Add a `workspace_id` column + `WHERE workspace_id = ?` to `getJob`/`listCorpusJobs` (and their callers in `match/route.ts` and `reasoning-run.ts`). Add a tenancy test that fails if a default is used at these seams.

## 2. Archetype registry edits are a non-atomic read-modify-write on a file the live pipeline reads
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Concurrency / data loss
- **File**: `app/_lib/archetype-registry.ts:112` (`updateArchetype`), `:131` (`createArchetype`), `:67` (`writeRegistry`)
- **Scenario**: Two recruiters save archetype edits at nearly the same time (or one edits while a match/intake spawn is reading `archetypes.json`). Each handler does `readRegistry()` → mutate the in-memory array → `writeRegistry()`. The second write is based on a snapshot taken before the first landed, so the first edit is lost. Separately, `writeFile` is not atomic, so a Python spawn that reads the file mid-write can get a truncated/torn JSON and the intake/ranking run fails.
- **Root cause**: A shared JSON file is used as a mutable multi-writer store with no locking, no compare-and-swap, and no write-to-temp-then-rename, despite being read concurrently by every Python pipeline spawn.
- **Impact**: Silent lost updates to scoring weights / fairness flags (a compliance-critical field) and intermittent 500s on intake/match during an edit.
- **Fix sketch**: Write to a temp file in the same dir then `rename()` (atomic) so readers never see a partial file; serialize writers with a process-level mutex or move the registry into the SQLite store (workspace-scoped) with a versioned CAS update.

## 3. No "rank candidates for this job" view — only candidate→jobs
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Missing table-stakes capability
- **File**: `app/features/sub_match/MatchTab.tsx:77`, `app/features/sub_profile/CandidateMatrix.tsx:41`
- **Scenario**: A recruiter's day-one task is "I have an open req — who are my best candidates for it?" The Match tab only goes one candidate → many jobs, JobCompare compares roles for one candidate, and CandidateMatrix groups candidates by archetype (not by fit to a job). There is no surface that takes a job and returns a ranked, KO-filtered candidate shortlist — even though the deterministic scorer and `listMatrixProfiles`/`listOpenPositions` already exist to power it.
- **Root cause**: The product modeled matching candidate-centrically; the reverse (job-centric ranking), which is the primary recruiter workflow, was never built.
- **Impact**: Lost retention/differentiation — recruiters bounce to their ATS to do the one thing they came for; the per-candidate scoring investment is under-monetized.
- **Fix sketch**: Add a job→candidates mode (reuse the Python matcher with profiles as the corpus, or invert the existing matrix), surface a ranked shortlist with the same confidence/KO/weights UI, and let it feed the pipeline bulk-add already in `Results.tsx`.

## 4. WeightsPanel keeps stale slider values after a re-rank (never re-seeds from the response)
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: State sync / loading-state
- **File**: `app/features/sub_match/WeightsPanel.tsx:42`
- **Scenario**: Recruiter drags Skills to 70%, clicks "Apply & re-rank". The server clamps to the archetype bounds and renormalizes to sum 100% (say 62/25/13), and `Results` re-mounts the panel with the new `weights` prop. But `draft` was seeded once via `useState(weights)` and is only re-seeded on the *open* click; after an in-place apply the sliders still read 70% while the bars/score reflect 62%. `dirty` immediately re-evaluates true, so "Apply" stays enabled offering to re-apply the value the server already rejected.
- **Root cause**: The comment claims "Re-seeded from the response after each apply," but there is no effect syncing `draft` to the `weights` prop when it changes; the panel stays mounted (intentionally, per MatchTab) so the stale state survives.
- **Impact**: Sliders disagree with the rendered ranking; the recruiter can't tell what weighting is actually in effect and re-applies no-ops.
- **Fix sketch**: Add `useEffect(() => setDraft(weights), [weights])` (or key the panel on a server-returned weight signature) so the sliders snap to the in-effect, renormalized vector after every apply.

## 5. AI-drafted archetype can leave the routing control with no option selected
- **Lens**: 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Validation gap / state corruption
- **File**: `app/features/sub_profile/ProfileEditor.tsx:116` (`applyDraft` → `setChoice(draft.archetype || h.choice)`)
- **Scenario**: A recruiter uses "Draft with AI" before the `/api/archetypes` fetch resolves (or it failed, so `archetypeOptions` is the baseline list of 4). The draft returns an archetype id outside that list (a recruiter-created one, or any non-baseline id). `setChoice` is set to it, but the SegmentedControl has no matching segment, so it renders with nothing visibly selected. The recruiter's first click on any segment silently overwrites the AI-routed archetype, and saving persists the wrong routing/weights.
- **Root cause**: `applyDraft` trusts `draft.archetype` without checking it exists in the currently-available options; the options depend on an async registry load that may not have completed.
- **Impact**: Silent mis-routing of a candidate to the wrong scoring model / fairness lens — exactly the carefully-handled early-career/switcher cases where a wrong archetype hurts most.
- **Fix sketch**: When applying a draft, fall back to `"auto"` (or surface a notice) if `draft.archetype` isn't among `archetypeOptions`; block the editor's save path until the registry has loaded so the control always has the routed segment available.
