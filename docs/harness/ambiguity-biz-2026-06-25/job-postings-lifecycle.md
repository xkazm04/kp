# Job Postings & Lifecycle — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H2/M2/L0

## 1. Closed roles stay in the rematch corpus — two contradictory "is-live" predicates in one file
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: lifecycle / silent-wrong-outcome
- **File**: app/_lib/db/jobs.ts:274
- **Observation**: `listCorpusJobs` (the set every rematch scores a candidate against, handed to the Python scorer in `automation-run.ts:119`) filters with `WHERE status IS NULL OR status != 'draft'` — so `'closed'` roles are **kept**. Yet 75 lines earlier the `openOnly` browse filter uses `(status IS NULL OR status = 'published')` (jobs.ts:200), and `isJobOpenForApplications` (job-ingest.ts:122) agrees: closed = not live. Two definitions of "live" in the same file disagree precisely on closed roles. This directly contradicts the close feature's stated purpose ("kept being ranked against the pool", close/route.ts:8-10) and the rematch cache-key's own warning that "a cached rematch could route to a since-closed role" (automation-cache-key.ts:35).
- **Why it matters**: A recruiter closes a filled/abandoned role expecting it gone. But candidate rematch still scores and can rank that closed role as a top fit — silently routing/recommending a candidate to a position nobody will process. Worse, because the closed id stays in the corpus, the cache fingerprint doesn't even change on close, so the stale "route to a closed role" result the comment was meant to prevent persists for the full 168h TTL.
- **Recommendation**: Change `listCorpusJobs` to `WHERE status IS NULL OR status = 'published'` (mirror `openOnly`/`isJobOpenForApplications`), or extract one canonical `LIVE_STATUS_SQL` predicate shared by all three call sites so they can never diverge again.
- **Effort**: S

## 2. No external distribution — the whole "publish" lifecycle dead-ends at copy-to-clipboard
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / value-left-on-table
- **File**: app/api/jobs/[id]/publish/route.ts:16
- **Observation**: `/publish` explicitly disclaims the obvious capability: "this is 'Source into Pipeline' (internal go-live), NOT external 'Publish to job boards'." The only outward artifacts are a manually-copied Markdown blob (jobMarkdown.ts:7-9 even calls itself "the product's external output (the copy-to-job-board artifact)") and clipboard-copied apply links. There is no hosted public posting page and no one-click syndication, despite the lifecycle strip already carrying a "channels" segment and per-job webhooks existing.
- **Why it matters**: For a recruiting SaaS, distribution *is* the recruiter's top pain and the natural paid tier (per-board syndication, a branded hosted careers page, UTM-tracked apply links). Today every role's reach depends on the recruiter hand-pasting Markdown into each board — the product builds the posting and then abandons it at the moment of highest value. This is the single largest differentiation/revenue lever the context leaves on the table.
- **Recommendation**: Ship a hosted public posting page rendered from `jobToMarkdown` (reuse the apply-link host canonicalization already in place), then layer paid one-click syndication / careers-page embedding on top.
- **Effort**: M (hosted page) / L (true syndication)

## 3. Closing a seeded corpus role silently reclassifies it as a metered, billable job
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: lifecycle / billing-correctness / tribal-knowledge
- **File**: app/api/jobs/[id]/close/route.ts:19
- **Observation**: The close button is offered on **every** non-closed role in the posting modal (JobPostingModal.tsx:191-201), including the seeded corpus jobs that carry `status = NULL` ("seeded/live corpus job"). Closing one flips `NULL → 'closed'` (close/route.ts:19) and withdraws its pipeline entries. Reopening (Reopen = re-`/publish`) then sets `'closed' → 'published'`. But `countPublishedJobs` counts only `status = 'published'` (job-ingest.ts:134), and `activeJobsGate` (enforce.ts:62) caps the free plan at 1 such job. So a demo/seeded role that previously cost nothing now permanently consumes the recruiter's single free active-job slot. The `NULL` semantics and the rule "seeded jobs must never become metered" live only as scattered comments — there is no guard and no documented state machine.
- **Why it matters**: A recruiter exploring seeded sample roles can, by closing+reopening one, lock themselves out of publishing their *real* job on the free plan — a confusing, support-generating, trust-eroding billing surprise with no recorded reasoning anywhere. The undocumented `NULL`-lifecycle is exactly the tribal knowledge a future contributor will break.
- **Recommendation**: Either block close/reopen on `NULL`-status seeded jobs, or on reopen preserve `NULL` for jobs that were never recruiter-authored; document the full status state machine (NULL/draft/published/closed transitions + billing implications) in docs/JD_LIFECYCLE.md.
- **Effort**: S-M

## 4. `MIN_AD_CHARS = 30` is an unexplained floor far below a real job ad
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic-number / edge-case / LLM-cost
- **File**: app/_lib/split-ads.ts:11
- **Observation**: The single source-of-truth ingest floor is 30 characters, with no recorded reasoning for the value. The ingest route then tells the user "Provide the full job ad text (at least ~30 chars)" (ingest/route.ts:20-21) — internally contradictory, since 30 chars ("Senior Engineer, remote, Praha") is one short phrase, not a full ad. Anything ≥30 chars is forwarded to the Claude CLI parser and upserted as a real Job.
- **Why it matters**: The floor is too low to do its job: near-empty or junk pastes pass straight to the LLM ad-parser, burning a metered subscription call and minting a hallucinated/garbage role into the matchable corpus (which then also pollutes rematch — see #1). In bulk paste, separator artifacts just above 30 chars become phantom imports.
- **Recommendation**: Raise the floor to a value that reflects an actual ad (≈200-400 chars) and record the rationale in the comment; keep client guard, splitter, and server guard reading the one constant.
- **Effort**: S

## 5. Drafts never age or nudge — the revenue-activating step silently stalls
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: retention / activation
- **File**: app/_lib/job-ingest.ts:146
- **Observation**: `listDraftJobs` returns drafts "newest first" but exposes no age, and `DraftsPanel` (DraftsPanel.tsx) renders them as a flat list with a "Source into Pipeline" button and no reminder, no aging, no auto-expiry. A pasted ad or authored JD that the recruiter doesn't publish simply sits as a draft forever.
- **Why it matters**: Draft → published ("Source into Pipeline") is the exact step that activates the product's core value (candidate sourcing) and the step that drives metered usage / the paid active-job cap. A forgotten draft is silent activation drop-off — the user did the hard part (writing/ingesting the role) and never reached the payoff, and nothing pulls them back.
- **Recommendation**: Surface draft age in `DraftsPanel`, badge drafts older than N days, and add a lightweight nudge (in-app or email) for stale drafts; consider an "oldest draft" prompt on the Jobs tab.
- **Effort**: S-M
