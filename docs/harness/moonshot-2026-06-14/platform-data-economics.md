> Moonshots: 5 (Tier1/2/3: 3/2/0)

# Cluster: PLATFORM, DATA & ECONOMICS — Moonshots (2026-06-14)

> The moat layer. kp already captures the rarest substance in recruiting — *outcome-labeled* hiring decisions (advance/hold/pass with rationale, time-in-stage, hire/decline, source spend, interview scorecards, dev-case transfer scores) — but it locks every gram of it inside one workspace's `kp.sqlite`. Every analytic is single-tenant. The benchmark harness scores *models* against *static contracts*, never against *what actually got hired*. Billing meters *counts* (candidates, cases, minutes), never *value created*. Each of these is a moat hiding in plain sight. The moonshots below convert kp's private exhaust into a compounding, defensible asset.

Grounding read (~24 source files across all six slugs): `app/_lib/db/core.ts`, `pipeline.ts`, `analytics.ts`, `analyses.ts`, `interviews.ts`, `devcase.ts`; `app/_lib/db-portability.ts`; `app/api/workspace/{export,import}/route.ts`; `app/_lib/ops-telemetry.ts`; `app/_lib/tasks.ts`; `pipeline/jobfit/embedding_bridge.py`; `pipeline/jobfit/llm/{registry,base,capabilities,monitor}.py` + `llm/bench/{runner,contracts,scenarios}.py`; `app/_lib/llm-config.ts`, `llm-secret.ts`; `app/_lib/billing/{enforce,entitlements,plans,reduce,sync}.ts`; `app/api/analytics/{route,spend,decisions}.ts`; `app/_lib/{source-analytics,analytics-bottleneck,analytics-momentum}.ts`; `app/features/{tabs.ts,CommandPalette.tsx,useAttention.ts}`; `app/api/search/route.ts`.

---

## 1. **The Hiring Benchmark Network — federated outcome data that no competitor can copy**
- **Tier**: 1 (10x category-defining)
- **Category**: data-as-moat | marketplace-network
- **Impact**: Every workspace's `pipeline_events` + `analyses.disposition` + `interview_sessions.scorecard_json` already encode the one thing recruiting tools never have: *labeled outcomes* (this candidate, this score, this rationale → hired/declined, in N days). Today each customer sees only their own funnel. Turn that into a **privacy-preserving, opt-in benchmark exchange**: a customer contributes *aggregated, anonymized* outcome statistics (k-anonymous role-family × seniority × score-band → hire-rate, time-to-hire, offer-accept-rate, source cost-per-hire) and in return sees their funnel ranked against the network — "your time-to-hire for senior backend is 41 days vs. network p50 of 28; your auto-reject threshold is dropping candidates the network hires at 60%." The data network *gets better the more customers join*, which is the textbook definition of a moat a feature can't replicate. For whom: every recruiter, who today flies blind on whether their bar is calibrated.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: Not "more analytics." It is a structural shift from a single-player tool to a **two-sided data network with increasing returns**. The proposed list has single-tenant forecasting/period-deltas/targets but explicitly *no cross-customer aggregation* — this is the first thing that makes kp un-cloneable, because a new entrant starts with zero network and can never catch up on labeled outcomes.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Add a `benchmarkContribution(window)` pure aggregator next to the existing windowed economics in `app/_lib/source-analytics.ts` / `app/_lib/db/analytics.ts` — it consumes the *same* `PipelineAnalytics` snapshot already computed and emits only k-anonymous buckets (drop any cell with n<5). Ship it behind a new `GET /api/analytics/contribution` route that returns the redacted payload locally first (no upload), so the privacy contract is testable before any network exists.
  2. Stand up a minimal aggregation endpoint (separate service, append-only) that ingests signed contribution blobs keyed by an anonymous workspace id; store only bucketed counts, never rows.
  3. Add a `benchmark` panel to `AnalyticsTab.tsx` rendering the customer's cells against returned network percentiles, reusing the existing period-delta UI conventions.
  4. Gate contribution as an opt-in entitlement (`benchmark_network`) in `app/_lib/billing/plans.ts`; make *reading* the network a paid feature, *contributing* the price of admission.
  5. Add differential-privacy noise + a re-identification audit before opening cross-org reads.
- **Dependencies**: app-wide auth/tenant identity (the open `ccb4d851` gap); a stable anonymous workspace id; the single-tenant analytics snapshot (exists).
- **Risks**: Privacy/legal (EEOC/GDPR on hiring outcomes) — must be aggregate-only and k-anonymous from day one; cold-start (needs ~dozens of workspaces before percentiles mean anything); contribution-incentive design.
- **What changes if we ship it**: kp stops competing on features and starts compounding on data. Calibration ("is my hiring bar right?") becomes a question only kp can answer, and the answer improves with every new logo.

---

## 2. **The Outcome-Tuned Router — close the loop from bench contracts to who actually got hired**
- **Tier**: 1 (10x category-defining)
- **Category**: llm-economics | data-as-moat
- **Impact**: The bench harness (`pipeline/jobfit/llm/bench/runner.py`) already scores every use-case × provider × model on `validRate`, `llmRate`, `p50/p95Ms`, tokens and `totalCostUsd` — but the contract (`bench/contracts.py`) only checks *structural* validity ("does the screen output have a recommendation+confidence?"), never *predictive* quality ("did this model's screen-keep correlate with an eventual hire?"). Join the bench/monitor telemetry to the *outcome* the workspace later recorded (`pipeline_events`: advanced→hired vs. rejected) and you get an **outcome-tuned router**: per use-case, automatically pick the cheapest model whose decisions *track human/hire outcomes* above a threshold. Today routing is static per use-case (`llm/registry.py` reads a fixed `KP_LLM_CONFIG`). For whom: the operator's margin (cheaper models where they're good enough) and the customer's trust (don't downgrade where it costs hires).
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: The proposed list has a "cost/quality auto-router" — but that scores quality against *contracts/benchmarks*. This scores quality against **realized hiring outcomes**, which only kp's own funnel can supply. It makes the LLM-economics layer self-improving on proprietary labels: a recruiting-specific quality signal no general LLM gateway (OpenRouter, Portkey) can compute.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Extend `BenchRecord` / `summarize()` in `pipeline/jobfit/llm/bench/runner.py` with an `outcome_label` field and a new contract family in `bench/contracts.py` that, given a scenario tied to a real `pipeline_entry`, checks whether the model's verdict agreed with the recorded disposition — the harness already runs scenarios "through real production paths," so the wiring point exists.
  2. Persist bench/monitor envelopes (currently fire-and-forget to LightTrack in `llm/monitor.py`) into a new `llm_decision_outcomes` table joined on candidate+use_case, so agreement-with-outcome accrues over time.
  3. Compute a per-(use-case, provider, model) *outcome-agreement* score and surface it in the bench console alongside cost/latency.
  4. Make `resolve_provider()` in `llm/registry.py` consult a generated routing table that prefers the cheapest model above the agreement floor (still static-overridable).
  5. Expose the cost-vs-outcome frontier in the Models tab so the operator sees "switching screen to Haiku saves 80% and loses 0.5pt agreement."
- **Dependencies**: persisted LLM telemetry (today ephemeral/LightTrack-only); the benchmark scenarios bound to real entries (partially exists); outcome data accrual time.
- **Risks**: Confounding (a model's screen and a human's decision aren't independent); thin outcome volume early; fairness — must never let cost pressure auto-downgrade a model in a way that disparately impacts a protected cohort (tie into the existing fairness gates).
- **What changes if we ship it**: LLM spend becomes self-optimizing against the only metric that matters — hires — and the routing table itself becomes a proprietary asset that improves with usage.

---

## 3. **kp as an Embeddable Hiring-Intelligence API & Marketplace — distribution beyond the studio**
- **Tier**: 1 (10x category-defining)
- **Category**: platform-distribution | marketplace-network
- **Impact**: Everything valuable in kp — CV→profile extraction, candidate×job fit scoring with KO gates, group-eval with fairness matrix, dev-case design+grading, salary banding — runs through clean Python CLIs behind the typed `python-runner.ts` bridge and per-domain repositories. Today they're reachable only through kp's own tabs. Expose them as a **versioned, metered public API + embeddable widgets** so an ATS (Greenhouse, Lever), a job board, or a staffing agency embeds "kp Fit Score" / "kp Dev-Case" into *their* product. kp becomes the *scoring layer of record* — the Stripe/Plaid of hiring intelligence — earning per-call while sitting under everyone else's UI. For whom: the entire long tail of HR-tech that can't build a fairness-audited scoring pipeline.
- **Feasibility**: medium
- **Time-horizon**: quarters
- **Why it's a moonshot**: The proposed list stops at internal "batches API." This is **platform distribution**: turning kp from a destination into infrastructure, with a developer ecosystem and marketplace economics on top. Distribution + data network #1 reinforce each other — every embedded call is another outcome eventually labeled.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Introduce an API-key auth shim and a `v1` namespace by wrapping the *existing* engine entrypoints — e.g. mount `app/api/v1/score/route.ts` that calls the same `spawnPython`/`parsePythonJson` path `app/api/match/route.ts` already uses, validating input with the *generated* Zod schemas in `app/_lib/schemas.generated.ts` so the public contract is auto-derived from Pydantic. Meter each call through the existing `recordMeterUsage()` in `app/_lib/billing/entitlements.ts`.
  2. Add an `api_keys` table + scopes alongside `provider_keys`; reuse the AES-256-GCM `llm-secret.ts` pattern for key hashing.
  3. Publish OpenAPI generated from the Zod schemas; ship a thin JS/Python SDK.
  4. Build one embeddable React widget ("Fit Score" badge) served from kp, themed via the existing token system.
  5. Open a partner directory + revenue-share tier in `plans.ts` for resellers.
- **Dependencies**: app-wide auth (`ccb4d851`); rate-limiting (the in-process `rate-limit.ts` exists but needs durable, per-key limits); API versioning discipline.
- **Risks**: Support/SLA burden of being infrastructure; the Python-spawn model must scale beyond one in-process Node host (today `MAX_CONCURRENT=2` in `tasks.ts`); competitors with existing distribution.
- **What changes if we ship it**: kp's TAM stops being "recruiters who adopt a new tool" and becomes "every product that touches a candidate." Each integration deepens the data moat.

---

## 4. **Portable, Verifiable Candidate Passport — the workspace dump becomes a candidate-owned, cross-org asset**
- **Tier**: 2 (3-5x)
- **Category**: foundational-primitive | new-market
- **Impact**: `db-portability.ts` already proves kp can serialize an entire workspace into a signed, schema-versioned (`DUMP_FORMAT`/`DUMP_VERSION`), identifier-safe JSON document and re-materialize it atomically. Re-aim that primitive at the *candidate*: emit a **portable, cryptographically signed "Candidate Passport"** — their extracted profile, dev-case `transfer_score`, interview scorecard, and provenance envelope — that the candidate owns and can present to *another* kp workspace, which verifies and imports it without re-running the whole gauntlet. A verified-skills credential that travels. For whom: candidates (own their evaluation) and downstream employers (trust a portable, audited score).
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: The proposed list has "schema-versioned workspace dumps" as an *ops* feature. This repurposes the same serialization+validation core into a **candidate-side network primitive** — a new market (verifiable talent credentials) and a viral loop (passports pull new workspaces in).
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Add a `dumpPassport(candidateId)` next to `dumpWorkspace()` in `app/_lib/db-portability.ts` that selects *only* that candidate's rows across `profiles`/`analyses`/`interview_sessions`/dev-case submissions, reusing the existing `encodeCell`/`SAFE_IDENT`/version-stamping machinery, and a `coercePassportPayload()` mirror of `coerceDumpPayload()`.
  2. Sign the passport with an operator key (extend the `llm-secret.ts` crypto helpers to detached signatures).
  3. Add `POST /api/passport/verify` that validates signature + schema and returns the trusted score without re-import.
  4. UI: a candidate-facing token page (pattern already used by `app/interview/[token]`, `app/offer/[token]`) to download/share the passport.
  5. Optional public registry of revocation + issuer trust.
- **Dependencies**: the dump/load core (exists); signing keys; the per-candidate row selection (straightforward over existing repositories).
- **Risks**: Trust bootstrapping (why would employer B trust workspace A's score?) — needs the benchmark network (#1) for calibration; consent/privacy on candidate data export; fraud/replay (mitigated by signing + revocation).
- **What changes if we ship it**: Evaluation stops being thrown away at the workspace boundary. Candidates accumulate a portable reputation, and every passport handoff seeds another workspace — a candidate-driven distribution channel kp doesn't pay for.

---

## 5. **Value-Metered Pricing on Realized Hires — bill the outcome, not the API call**
- **Tier**: 2 (3-5x)
- **Category**: llm-economics | new-market
- **Impact**: Billing today meters *counts* — `ai_candidates`, `case_designs`, `interview_minutes` — via the clean `splitSpend`/`meterAllowance`/`recordMeterUsage` precedence model in `entitlements.ts`. But kp *knows* when a workspace actually hires (`pipeline_events` terminal `hired`). Add a **realized-outcome meter**: a low-or-zero platform fee plus a success fee at the moment a candidate sourced/scored by kp reaches `hired`. Pricing aligns kp's revenue with the customer's only real ROI — a hire — which is exactly the value the existing automation ROI ledger already quantifies in CZK. For whom: budget-conscious teams who balk at seat/usage pricing but happily pay per hire.
- **Feasibility**: high
- **Time-horizon**: months
- **Why it's a moonshot**: The proposed list mentions "outcome-based pricing" abstractly; this grounds it in the *specific* hire event kp already records and the *specific* meter primitive that already handles included-allowance + credit-overflow splitting. It reframes kp from a cost center to a performance partner — a pricing model SaaS competitors structurally can't match without kp's outcome data.
- **Path to implementation**:
  1. **STEP 1 (current scaffold):** Add a `hire_success` meter to `METERS` in `app/_lib/billing/plans.ts` and a pure `recordHireSuccess(entryId)` that calls the *existing* `recordMeterUsage()` exactly once per entry when a `pipeline_event` of kind `hired` is appended (dedupe on entry id, reusing the idempotency pattern from `billing/reduce.ts`'s order dedup).
  2. Wire the hook into the single place hire events are recorded (`app/_lib/db/pipeline.ts`), guarded so replays/reinstatements don't double-bill.
  3. Add a success-fee line to the BillingTab usage display, reusing `splitSpend` so display never diverges from billed.
  4. Introduce a "Performance" plan in `plans.ts` (low base + per-hire fee) behind the gateway abstraction (`billing/gateway.ts`) so Polar/Paddle can invoice it.
  5. Add an attribution window (was the hire kp-sourced/scored?) using `source_channel`/`source_campaign` already on `pipeline_entries`.
- **Dependencies**: reliable hire-event recording (exists); attribution fields (exist); gateway invoicing support for usage charges.
- **Risks**: Attribution disputes (did kp cause the hire?) — needs a defensible, documented rule; revenue lumpiness; gaming (customers marking hires elsewhere). Mitigate with the source attribution already captured.
- **What changes if we ship it**: kp's pricing becomes the most aligned in the category — it only wins when the customer wins — which is itself a sales moat and a story no flat-rate competitor can tell.

---

### Synthesis
The throughline: **kp already records the rarest asset in hiring — labeled outcomes — and currently discards its leverage at three boundaries**: the workspace boundary (#1 benchmark network, #4 passport), the model-quality boundary (#2 outcome-tuned router), and the product boundary (#3 embeddable API). #5 monetizes the same outcome signal directly. #1, #2, and #3 are the Tier-1 compounding moats; together they make a new entrant's cold start unwinnable, because the value is in data and distribution that accrue only with time and logos — not in any feature they could ship.
