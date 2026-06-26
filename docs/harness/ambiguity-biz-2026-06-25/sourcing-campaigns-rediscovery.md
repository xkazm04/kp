# Sourcing, Campaigns & Rediscovery — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C0/H3/M2/L0

## 1. Pool caps silently drop the OLDEST candidates — directly contradicting rediscovery's "no one falls through the cracks" promise
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: broken-value-promise / silent-data-loss
- **File**: app/_lib/candidate-pool.ts:17
- **Observation**: The pool is hard-capped at `PROFILE_POOL_CAP = 100` + `ANALYSIS_POOL_CAP = 60` (~160). `listProfileRecords(PROFILE_POOL_CAP)` / `listAnalysisRecords(ANALYSIS_POOL_CAP)` keep the newest N; the overflow "older profiles are excluded from ranking/rediscovery" (lines 51, 59). On overflow the only signal is a server `console.warn` — the recruiter sees nothing. The `/rediscover` route's `skipped` array (rediscover.ts → route.ts:25) reports ONLY ranker-unscoreable malformed profiles, never cap-dropped ones.
- **Why it matters**: Rediscovery's entire selling point (RediscoverPanel.tsx:84, rediscover.ts:11-16) is "we won't let strong PAST candidates fall through the cracks." The candidates most likely to be forgotten silver medalists are the OLDEST ones — and those are exactly the rows the cap silently discards first. On any real recruiting corpus (>160 CVs is trivial), the feature quietly stops doing the one thing it promises, with zero user-visible signal. That is a silent wrong hiring outcome and a churn risk once a recruiter discovers a great past applicant was never resurfaced.
- **Recommendation**: At minimum, surface a cap-hit notice in the rediscover/candidates payload (like `skipped`) so the recruiter knows the pool was truncated. Better: page/stream the ranker over the full corpus, or rank by last-activity rather than recency so dormant-but-strong candidates aren't structurally excluded.
- **Effort**: M

## 2. Quick-apply campaign URL carries no variant/campaign attribution — generated ad variants can never be measured or optimized
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / measurement-gap
- **File**: app/api/jobs/[id]/campaign/route.ts:44
- **Observation**: Every campaign generates 4 distinct ad variants by hook type (number/location/problem/skills — CampaignTab.tsx:22-27), but all of them close with the identical CTA `applyUrl = .../apply/${job.id}/quick?lang=${lang}`. There is no variant id, campaign id, hook type, or UTM-style source param on the link. The pack is even a durable artifact (`campaign_packs` table) yet nothing ties an inbound apply back to the creative that drove it.
- **Why it matters**: This is the core measurement surface of a "sourcing campaign" product and it's left on the table. A recruiter spends ad budget across 4 hooks and cannot tell which hook (or campaign, or language) converts — so they can't optimize spend, and kp can't build the "creative → applicant → hire attribution" analytics that would justify a paid Campaigns tier. Competitors (Recruitis-style) live on exactly this funnel reporting.
- **Recommendation**: Append a stable attribution param per variant (e.g. `?lang=..&src=campaign&v=<hookType>&cid=<packId>`) and capture it on the quick-apply submit, persisted on the application. Then the existing analytics group can report applies/hires per variant — turning the campaign pack from a copy generator into a measurable channel.
- **Effort**: M

## 3. "Surfaces the hits the moment they become true" is overstated — alerts only fire on publish or a MANUAL Refresh, never when a strong candidate actually enters the pool
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: comment-vs-reality / retention-automation gap
- **File**: app/features/sub_jobs/RediscoveryFeed.tsx:27
- **Observation**: The feed header comment promises alerts "the moment they become true — raised on publish, re-swept on demand." In practice there are exactly two triggers: `raiseRediscoveryAlertsForJob` on job publish (publish/route.ts:99) and `sweepRediscoveryAlerts` behind the feed's Refresh button (alerts/route.ts:56 → rediscover.ts:126). The sweep is literally named "the 'a strong candidate entered the pool' trigger" (rediscover.ts:122-124) but is wired to a manual click — nothing fires it when a new CV/profile is actually saved. Confirmed: no caller of `raiseRediscovery*` exists in the CV/profile write path.
- **Why it matters**: The compelling rediscovery moment — a great candidate uploads a CV that matches an open role — produces no alert unless a human remembers to open Jobs and click Refresh. The headline automation promise degrades to a manual chore, undercutting the retention/"set-and-forget" value that makes a standing feed worth building, and the code comment misleads the next maintainer into thinking pool-change auto-detection exists.
- **Recommendation**: Either (a) call `sweepRediscoveryAlerts` (or a per-candidate variant) from the CV-save/profile-create path so a new strong entrant auto-raises alerts, or (b) correct the comments to state plainly that pool-change detection is manual-only. Option (a) is the high-value lever and reuses the existing sweep verbatim.
- **Effort**: S

## 4. The "promising" score floor of 55 is triplicated across Python + two TS sites with no shared source — a tuning change will silently desync rediscovery
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic-number / cross-language drift
- **File**: app/_lib/rediscover.ts:20
- **Observation**: `SCORE_FLOOR = 55` (rediscover.ts:20) is documented as "mirrors matching.FIT_PROMISING_THRESHOLD," which is independently defined as `FIT_PROMISING_THRESHOLD = 55` in pipeline/jobfit/matching.py:70. A THIRD copy, `POOL_FIT_FLOOR = 55` (RecruiterCandidates.tsx:115), is hand-declared with the comment "≥ the rediscover SCORE_FLOOR" rather than importing it. Three literals, one intended meaning, no single source of truth.
- **Why it matters**: If anyone tunes the Python `FIT_PROMISING_THRESHOLD` (the engine's actual fit boundary) to, say, 60, the two TS floors stay at 55: rediscovery and the "Pool Fit" filter would then surface candidates the engine no longer considers promising, silently diverging the "silver medalist" definition from the ranking that produced it. Pure tribal-knowledge coupling held together by comments.
- **Recommendation**: Single-source the value: have the ranker emit its `fitTier`/threshold in the payload (the UI already consumes `fitTier`), or define one import-free TS constant that both `SCORE_FLOOR` and `POOL_FIT_FLOOR` reference, and add a sync assertion against the Python constant in a test.
- **Effort**: S

## 5. CoachPanel hard-codes cs-CZ / CZK salary formatting even though the salary contract is APP_CURRENCY-denominated — a sibling explicitly warns against this exact literal
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: hardcoded-assumption / i18n-currency
- **File**: app/features/sub_jobs/CoachPanel.tsx:30
- **Observation**: `fmtBand` renders every winnability salary band as `${band[0].toLocaleString("cs-CZ")} … CZK` — locale and currency both hardcoded. Yet salary-band.ts:11-19 establishes the contract that a job band is denominated in `APP_CURRENCY`, and salary-band.ts:129 explicitly cautions against "a hardcoded 'CZK' literal that silently mislabels bands if APP_CURRENCY ever changes." The Coach panel violates the very rule its own domain module documents.
- **Why it matters**: The pre-publish coach is where a recruiter decides whether a salary "undercuts the market" — a verdict (`belowMarket`) rendered next to a band that is force-labeled CZK regardless of the role's actual denomination. If APP_CURRENCY is ever changed (or an EUR role is graded), the panel will confidently display a mislabeled number and a "below market" verdict against the wrong currency, an undocumented happy-path assumption embedded in the UI.
- **Recommendation**: Route the band through the shared `formatSalaryRange`/`APP_CURRENCY` helper (as the JD builder does) instead of `toLocaleString("cs-CZ")` + a literal "CZK", so the coach's display tracks the same currency contract the matcher uses.
- **Effort**: S
