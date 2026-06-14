> Moonshots: 5 (Tier1/2/3: 3/2/0)

# JOBS, SOURCING & DEMAND — Moonshots

**Cluster framing.** kp today is an ATS that *ingests* demand (paste an ad → `ingestJobAd` → structured `Job` row) and *passively* ranks a closed internal pool against it (`buildCandidatePool` → `recruiter.rank_candidates_for_job`). The campaign pack (`campaign.py`) and source-attribution economics (`source-analytics.ts`) already prove kp can *generate* and *measure* demand-side creative. The moonshot leap: stop treating the candidate pool as a fixed ~160-row corpus (`PROFILE_POOL_CAP + ANALYSIS_POOL_CAP`) and stop treating each company's jobs as a private island. Turn the bidirectional engine kp already owns (structured `Job` ⇄ archetype-aware fair-ranked candidate) into a **two-sided talent network** where demand and supply compound across every recruiter on the platform. Everything below works backward from "kp owns the top of the funnel for an entire market," not "kp imports JDs better."

---

## 1. **The Living Talent Graph — a cross-tenant candidate network where every CV analyzed anywhere is rediscoverable everywhere (with consent)**
- **Tier**: 1 (10x category-defining)
- **Category**: data-as-moat / marketplace-network
- **Impact**: Today rediscovery (`rediscoverForJob`) and recruiter ranking only see *this recruiter's* ~160 cached profiles + analyses. A "silver medalist" rejected at Company A is invisible to Company B's open role — even though kp has already scored, archetyped, and confidence-banded that exact person. The moonshot: a consent-gated **talent graph** spanning all tenants, where a candidate analyzed once becomes a standing, portable, fair-ranked node that *any* role on kp can rediscover. 10x: a brand-new recruiter publishing their first JD instantly sees a ranked, archetype-split, KO-gated shortlist drawn from the entire network — zero sourcing spend, day one. The data network effect is the moat: more analyses → denser graph → better first-day shortlists → more recruiters → more analyses.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: It inverts kp's economics. Every competitor's ATS makes a recruiter's candidate data a private liability; kp makes it a shared, compounding asset. It converts a single-tenant scoring tool into a marketplace where supply is the network's, not the seat's — the thing no incremental "better import" can ever become.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Add a `consent` + `visibility` axis to the pool builder. `app/_lib/candidate-pool.ts` already single-sources every ranking view through `buildCandidatePool()` / `poolEntryFromAnalysis()`; introduce a `network_visible` flag on profile/analysis rows and a `buildNetworkPool(scope: "tenant" | "network")` sibling that the existing `rediscoverForJob` / `/candidates` paths opt into. No ranking math changes — the same `recruiter.py` scores the larger pool.
  2. Add candidate-side consent capture at the point of analysis and in the conversational/quick apply (`lead-intake.ts` already stores `contact`, `locale`, `sourceChannel` — extend with a `network_opt_in`).
  3. Introduce a tenant boundary on `jobs`/profiles (today `job-ingest.ts` writes a global `jobs` table) and a network index that respects it.
  4. Replace the `PROFILE_POOL_CAP`/`ANALYSIS_POOL_CAP` linear scan with the embedding bridge (`embedding_bridge.py`) as an ANN prefilter so network-scale pools stay fast.
  5. Surface network silver-medalists in `RediscoverPanel.tsx` with a provenance/consent badge alongside the existing `prior.kind` chips.
  6. Revenue: network shortlists as an entitlement tier in billing.
- **Dependencies**: multi-tenant identity & row-level scoping (today implicitly single-tenant); candidate consent UX; embedding index for scale; legal/GDPR review (CZ-market, candidate PII).
- **Risks**: Consent and GDPR are existential, not optional — a leak poisons the brand. Cold-start: graph is worthless until dense. Recruiters may resist sharing "their" candidates (mitigate: asymmetric — you only *receive* network candidates if you *contribute*).
- **What changes if we ship it**: kp stops selling an ATS seat and starts selling access to a living talent market. Sourcing cost for a new role trends toward zero; the moat is the graph, which no single-tenant competitor can replicate.

---

## 2. **Demand Sensing — kp drafts the roles a company doesn't yet know it needs, from its own GitHub + pipeline signal**
- **Tier**: 1 (10x category-defining)
- **Category**: demand-generation / new-market
- **Impact**: Every sourcing tool waits for a recruiter to *type* a need (`JdBuilder` needs `title` + `needText`; `ingestJobAd` needs a pasted ad). kp already has two latent demand signals nobody uses: (a) the GitHub code analysis cluster snapshots a company's *actual* codebase and skill surface; (b) the pipeline/decisions data shows where roles stall, who churns, and which skills keep getting rejected. The moonshot: a **demand-sensing engine** that proactively proposes *draft JDs for roles the company structurally needs but hasn't opened* — "your backend repos show a Kafka migration in flight but you have no senior platform role open; here's a publish-ready JD + market band + a network shortlist." 10x: kp moves from *fulfilling* stated demand to *creating* it — generating the top of the funnel itself.
- **Feasibility**: medium
- **Time-horizon**: months
- **Why it's a moonshot**: It makes kp a *revenue-generating* surface for the customer, not a cost center. An ATS answers "who fits this role?"; a demand-sensing engine answers "what roles should you even have?" — a CFO-level question no JD builder competitor touches.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** A "suggested roles" producer that feeds the *existing* `JdBuilder` deep-link prefill. `JdBuilder.tsx` already reads `jdTitle`/`jdNeed`/`jdFamily`/`jdSeniority`/`jdRepo` from search params (the simulation prefill path). Ship a server route that emits 2–3 suggested `{jdTitle, jdNeed, jdFamily}` tuples and renders them as one-click "Draft this role" links into JdBuilder — reusing `jd-build-run.ts` end-to-end with zero new generation machinery.
  2. Ground suggestions in the GitHub snapshot cluster (`repo-snapshot.ts`, `github-evidence.ts`) — detected stack/activity → role-family + seniority gaps.
  3. Layer pipeline signal: roles with chronic KO near-misses (`NotEligibleSection` already surfaces "one must-have short") → "relax this requirement / open an adjacent role."
  4. Attach the market salary analysis (`jd-build-run` already does grounded bands) so each suggestion lands publish-ready.
  5. Close the loop: a suggested role published → auto-runs network rediscovery (#1) so it arrives with a shortlist.
- **Dependencies**: GitHub analysis must be connected at the org level (today candidate-repo scoped); pipeline-signal aggregation; the suggestion ranker (which gaps matter most).
- **Risks**: Suggesting roles a company won't fund feels like noise — must be confidence-gated and tied to real signal (the `defaulted_fields`/phantom discipline from `jobs.py` is the right honesty model). Over-reach into headcount planning is politically sensitive.
- **What changes if we ship it**: kp generates demand instead of waiting for it. The product expands from "recruiter tool" to "workforce-planning copilot," opening a buyer (heads of eng / ops) the ATS never reached.

---

## 3. **The Reverse Marketplace — candidates publish a fair-ranked anonymized profile and roles bid for them**
- **Tier**: 1 (10x category-defining)
- **Category**: marketplace-network / interface-expansion
- **Impact**: kp's whole engine is *job → ranked candidates* (`rank_candidates_for_job`, the "recruiter-facing inverse of matching"). Run it the *other* direction at network scale and you get a reverse marketplace: a candidate (consented, anonymized) becomes a node that **every open `Job` row ranks itself against**, and the candidate sees their ranked, archetype-fair, KO-explained shortlist of *roles that want them* — with one-tap reach-out flipped (`useReachOut` already files a candidate into a pipeline + first-touch in one idempotent call; here the recruiter is the receiver). 10x: kp owns *both* sides of the top of the funnel — it's no longer where recruiters look for people, it's where people look for roles, and the fairness machinery (`fairness_matrix`, archetype shielding) is the differentiator a job board can't claim.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: Job boards are keyword search; LinkedIn is a social graph. Neither ranks *fairly* with KO-explanation and archetype shielding. kp's deterministic, auditable, bias-defensible matrix (the `FairnessAuditPanel` CSV is "the artifact a compliance review asks for") becomes a *consumer* promise: "you were ranked on evidence and potential, here's exactly why." That's category-defining for candidate trust.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** A "roles for this candidate" route that loops the published `Job` corpus and scores ONE candidate against each — the exact inverse already factored. `recruiter.py`/`rank_candidates_for_job` plus `score_job` per job; reuse `resolveCandidatePoolEntry()` from `candidate-pool.ts` to load the single candidate, then map over `listJobs`. The matrix cluster (`matrix_cli.py`, `matrix-stats.ts`) already does one-candidate-many-jobs — wire its output to a candidate-facing view.
  2. Add a candidate-owned, anonymized public profile page (mirror the existing public token pages — `app/jds/[slug]/page.tsx`, `app/apply/[id]`).
  3. "Roles that want you" feed: top-ranked open jobs with KO-explained fit (reuse `MissingSkillsTiers`/`SkillChips`).
  4. Recruiter-side inbound: a candidate's express-interest lands via `useReachOut`'s mirror as a pipeline entry with consent provenance.
  5. Anonymized-until-mutual-interest reveal (double opt-in), preserving fairness audit.
- **Dependencies**: candidate accounts/identity; consent + anonymization (overlaps #1); cross-tenant job visibility; abuse/spam controls.
- **Risks**: Two-sided cold start (need both candidates and open roles live). Anonymization vs. usefulness tension. Recruiter spam toward candidates must be rate-limited (the `rate-limit.ts` primitive exists).
- **What changes if we ship it**: kp becomes a destination candidates visit, not just a backend recruiters operate. Supply self-serves in; the funnel inverts; kp's fairness becomes a consumer brand.

---

## 4. **Omnichannel Demand Ingestion — kp becomes the universal inbox for roles from anywhere (Slack, email, ATS sync, board scrape)**
- **Tier**: 2 (3-5x)
- **Category**: platform-distribution
- **Impact**: Today a role enters kp exactly one way: a human pastes prose into the ingest panel (`ingestJobAd` → `IngestAdPanel`). The moonshot generalizes the *content-hash-deduped, LLM-parsed, normalized-to-`Job`* pipeline kp already nailed into an **omnichannel demand intake**: forward a hiring-manager email, drop a JD in a Slack channel, sync from an existing ATS, or point kp at a careers page — and any of them becomes a structured, matchable, draft `Job`. 3-5x: every role a company has anywhere becomes a kp node automatically, so the matching/rediscovery/network engine runs over the *complete* role set, not just the ones someone bothered to paste.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot (Tier 2)**: It's distribution leverage on an asset kp already owns — the parse+dedup+normalize core is built and battle-tested. Audacious in reach (kp ingests the world's demand), but a clear extension rather than a new science, hence Tier 2.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** A generic ingest endpoint that accepts a raw-text payload from any channel and reuses the existing pipeline verbatim. The inbound channel-webhook plumbing already exists (`app/api/channels/webhooks/[token]/route.ts`, `lead-intake.ts`'s "provided-only KO semantics" for third-party payloads); add a *job* counterpart that calls `ingestJobAd(adText)` and `insertJob(..., jobContentHash(text), "draft")` — the content-hash dedup in `job-ingest.ts` already guarantees the same ad forwarded twice won't fork a duplicate.
  2. Email-forwarding address per tenant (reuse channel token routing).
  3. Slack/Teams app that turns a posted JD into a draft `Job` + returns the lint findings (`jd-lint.ts`) inline.
  4. Read-only ATS connectors (Greenhouse/Lever) syncing open reqs.
  5. Careers-page watcher for self-ingest of a company's own postings.
- **Dependencies**: per-tenant inbound tokens (channel infra exists); connector OAuth; dedup across channels (hash core exists).
- **Risks**: Connector maintenance burden; parse quality on messy email threads; dedup across *semantically* identical but textually different ads (the hash is exact-match only — may need the embedding bridge to catch near-dupes).
- **What changes if we ship it**: kp captures 100% of a company's demand with near-zero recruiter effort, which is the precondition that makes the network (#1) and demand-sensing (#2) operate over complete data rather than a hand-curated subset.

---

## 5. **Self-Optimizing Sourcing — the campaign engine closes its own loop from creative to hire**
- **Tier**: 2 (3-5x)
- **Category**: data-as-moat / demand-generation
- **Impact**: kp already generates per-variant ad creative with per-variant apply links (`campaign.py`'s `&v=v1` rewrite → `pipeline_entries.source_variant`) and *measures* which variants convert (`source-analytics.ts`'s `variantPauseRecommendations`). But the loop is open: it *recommends* pausing a loser, then stops — "a RECOMMENDATION, never an actuator." The moonshot closes it: an engine that learns which **hook types, phrasings, and channels** convert to *hires* (not just leads) for each role-family/archetype/market, and auto-drafts the next campaign weighted toward winners. 3-5x: sourcing creative stops being a one-shot generate-and-forget and becomes a compounding, self-improving asset whose conversion edge grows with every campaign run on the platform.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot (Tier 2)**: It converts kp's accumulating attribution data into a defensible learning loop — the more campaigns run, the better the creative, a data-as-moat flywheel. Tier 2 because the measurement and creative halves both already exist; the moonshot is fusing them into closed-loop learning, not inventing either.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Feed historical variant outcomes back into generation. `source-analytics.ts` already computes per-variant `total`/`reachedInterview`/`hired` by `hookType`-bearing variant; pass the winning `hookType` distribution for this role-family into `draft_campaign_pack`'s prompt (`campaign.py` already structures variants by the canonical `HOOK_TYPES`) as a "weight toward these hooks" directive — a one-parameter change to an existing prompt builder.
  2. Extend attribution from lead→hire (the `pipeline_entries` source columns already thread through to decisions/analytics).
  3. Per-archetype/market learned priors (which hooks convert junior-CZ vs senior-remote).
  4. Aggregate priors across tenants (network learning — overlaps #1's moat).
  5. Auto-schedule the next variant pass when `variantPauseRecommendations` flags a loser, drafting replacements weighted to winners.
- **Dependencies**: durable variant→hire attribution (columns exist); enough volume per role-family for signal; cross-tenant aggregation for the strong version.
- **Risks**: Sparse data per single tenant (the cross-tenant aggregate is what makes it work — couples to #1). Overfitting to past winners can homogenize creative and decay novelty. Must keep the `campaign.py` honesty contract (no fabricated facts) intact under optimization pressure.
- **What changes if we ship it**: Sourcing creative becomes a learning system, not a template. kp's conversion-per-spend advantage compounds and is locked behind proprietary cross-market outcome data competitors can't see.

---

### Synthesis — the connected end-state
These are not five features; they're one flywheel. **#4 (omnichannel ingest)** captures all demand → **#2 (demand sensing)** generates more of it → **#1 (talent graph)** makes supply a shared compounding asset → **#3 (reverse marketplace)** pulls supply in directly → **#5 (self-optimizing sourcing)** makes every campaign sharper using network-wide outcomes. The shared substrate already exists: the structured `Job` row, the archetype-fair `recruiter.py` ranker, content-hash dedup, per-variant attribution, and the embedding bridge. The moonshot is to stop running all of it inside one recruiter's silo and let it compound across the market — turning kp from an ATS into the talent network that owns both sides of the funnel.
