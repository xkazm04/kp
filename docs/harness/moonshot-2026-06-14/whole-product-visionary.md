> Moonshots: 6 (Tier1/2: 5/1)

# kp — Whole-Product Moonshots

**Altitude**: whole-product, category-defining bets that reframe what kp IS — not feature additions to any one of the 25 contexts.

**Grounded on**: `README.md` (the studio is an end-to-end Czech-market AI hiring workspace with CV+GitHub analysis, candidate↔job matching+fairness, a kanban pipeline driven by an autonomous automation clock, voice interviews via ElevenLabs/OpenAI, an LLM-era dev-case engine, scheduling/offers, analytics, a multi-provider LLM layer + Polar billing/entitlements); `package.json`; the full 25-context / 10-group map in `docs/harness/code-refactor-2026-06-14/_scan-plan.json`; `instrumentation.ts` (the heartbeat clock → `tickScheduler()` → automation pass — the real autonomy spine); `app/_lib/db/billing.ts` (the **single-workspace** model: `billing_state` has exactly ONE row `id='workspace'`).

**Two load-bearing facts that shape everything below:**
1. **kp is single-tenant today.** Every store keys to one implicit workspace. That is the largest latent moonshot: there is no cross-customer network, no data moat that compounds across employers, no marketplace — *yet*. The backlog's "outcome-feedback loop" closes the loop *within* one tenant. The bigger bet is to close it *across* tenants.
2. **kp already runs autonomously.** `instrumentation.ts` is a durable, self-rescheduling clock that claims due runs and fires policy passes behind a kill switch + audit trail (`/control`). This is not a recruiting *tool* — it is a recruiting *operator* that happens to expose a UI. The moonshots lean on that distinction.

**The reframe.** Today kp is a *better hiring workspace for one employer*. The category-defining version is one of three things kp is uniquely positioned to become, and the moonshots below are ordered by how far each pushes that reframe: (a) the **measurement standard** for hiring in the AI-coding era (the dev-case durable-skill thesis becomes an industry score everyone trusts); (b) a **two-sided talent network** where the data moat compounds across every employer on the platform; (c) an **autonomous recruiting agency** sold as an outcome, not software.

---

## 1. **The Durable-Skill Standard — own the score the industry hires on (the "credit score for the AI-coding era")**
- **Tier**: 1 (10x category-defining)
- **Category**: foundational-primitive → data-as-moat
- **Impact**: Today every employer re-evaluates every candidate from scratch, and the whole industry is in crisis because the old signal (LeetCode, lines of code, "did they write this themselves?") is dead — kp's dev-case engine *already* assumes 100% of candidate code is LLM-generated and grades durable capabilities instead (problem framing, tooling fluency, judgment/verification, architecture, transfer). The moonshot: turn that internal rubric into **a portable, candidate-owned, cryptographically-attested Durable Skill Profile (DSP)** — a standardized 5-axis score with provenance, that a candidate earns once and carries across employers, and that employers learn to *ask for by name*. The 10x change: hiring stops being N redundant evaluations and becomes one trusted lookup. For candidates: a credential that isn't a degree or a GitHub vanity graph. For employers: signal that survives the AI-coding era. For kp: it becomes the *unit of account* for technical hiring — the thing everyone benchmarks against.
- **Feasibility**: medium — the rubric, the covert-probe case design, the transfer score, the provenance/confidence envelopes, and the LLM-judge already exist in `pipeline/jobfit/devcase/`. The hard part is standardization + trust (attestation, anti-gaming, cross-employer acceptance), not the scoring engine.
- **Time-horizon**: quarters → years
- **Why it's a moonshot**: it's not "a better take-home tool." It's a bet to *define a category metric* the way FICO defined creditworthiness or SAT defined college readiness. Standards are winner-take-most: whoever owns the score owns the market. Audacious because it requires both sides of the market to adopt a number kp invents.
- **Path to implementation**:
  1. **Wedge (today's scaffold)**: freeze the dev-case `transfer score` + 5 durable axes (`pipeline/jobfit/devcase/evaluate.py`, `reflect.py`, `models.py`) into a **versioned, signed `DurableSkillProfile` artifact** with the existing `provenance.py` confidence envelope. Render it as a shareable, public, candidate-facing page (reuse the `/apply/[id]` and `/offer/[token]` public-token-page pattern) — a "score card" with the methodology link kp already ships at `/about`.
  2. Make it *earned, not given*: the DSP is minted only from a real graded case submission, anti-gamed by the existing covert probes (ambiguity / legacy-trap / verification-trap / underspecification) and the fairness gate that never silently auto-rejects early-career candidates.
  3. Let candidates *carry it in*: add a route so an inbound applicant can present a prior DSP token; kp verifies the signature and the issuing case, then *skips re-grading* — instant lookup instead of re-evaluation. This is the demand-side hook.
  4. Open the methodology: publish the rubric + a calibration report (you already run `lifecycle_eval.py` + audits) as a versioned public standard, so third parties can *trust* and *cite* the score.
  5. Issue an SDK/badge + verification endpoint so a candidate can embed "kp Durable Skill: 78 (verified)" on LinkedIn/their site, every click drives employer awareness.
- **Dependencies**: signed/versioned artifact format; a public verification route; calibration data volume (needs Moonshot #2's scale to be *trusted*, but ships standalone first); legal/consent framing for a portable candidate credential.
- **Risks**: cold-start trust (a score nobody recognizes is worthless — chicken/egg with adoption); gaming once it has value; fairness/bias scrutiny on a credential with real consequences (regulatory exposure under EU AI Act high-risk hiring rules — must be explainable, which the provenance envelope helps); incumbents (LinkedIn, HackerRank) cloning the idea once proven.
- **What changes if we ship it**: kp stops being a workspace one company logs into and becomes *infrastructure the industry runs on*. The score is the product; the workspace is just where it's minted. Defensible because the standard + the calibration data compound.

---

## 2. **The Talent Graph — flip single-tenant into a two-sided network with a cross-employer data moat**
- **Tier**: 1 (10x category-defining)
- **Category**: marketplace-network → data-as-moat
- **Impact**: kp is single-workspace today (`billing_state` = one row). Every analysis, match, interview transcript, dev-case grade, hire, and *outcome* lives in one silo and benefits one employer. The moonshot: introduce a tenant boundary and a **consented, shared Talent Graph** — candidates exist once across all employers, their evaluations and outcomes accrue to *their* node, and employers query a living pool instead of re-sourcing cold. The compounding moat: every hire/no-hire/post-hire-outcome on *any* employer makes the matcher and the calibration smarter for *every* employer. This is the difference between a tool (linear value) and a network (super-linear value). 10x for whom: mid-market Czech/CEE employers who can't out-source the big agencies suddenly share a warm pool; candidates get rediscovered for roles they never applied to (kp already has a `RediscoverPanel` + talent-rediscovery — today scoped to one tenant).
- **Feasibility**: low-to-medium — technically the per-domain repositories (`app/_lib/db/*.ts`) and the SQLite-one-file model make tenanting a real lift, and consent/privacy across employers is the genuinely hard part. But the *primitives* (profiles with provenance, rediscovery, candidate-pool, fairness) all exist.
- **Time-horizon**: years
- **Why it's a moonshot**: it inverts the entire data architecture and the business it implies — from "sell software seats" to "operate a network." Audacious because the value only appears at scale (network effects), and because cross-employer candidate data is a privacy minefield that, done right, becomes the moat *because* it's hard.
- **Path to implementation**:
  1. **Wedge (today's scaffold)**: introduce an explicit `workspace_id` (today's implicit `id='workspace'` in `billing.ts` is the seam) and thread it through the per-domain stores as a no-op default first — pure refactor, zero behavior change, ships as plumbing. This is the one concrete, current-scaffold step.
  2. Add a *candidate-owned* identity that can span workspaces (built on the DSP token from Moonshot #1 — a candidate's node = their portable profile + score), gated by explicit candidate consent per-employer-visibility.
  3. Build the **shared rediscovery surface**: when Employer B opens a role, query consented candidates across the graph (extend `RediscoverPanel` / `candidate-pool.ts`), with strict fairness + consent filters.
  4. Feed *outcomes* back into a cross-tenant calibration layer (the backlog's outcome-loop, but at network scale) so the matcher and decision config improve from the whole graph, not one tenant.
  5. Privacy/consent control room for candidates (who can see me, for what, revoke anytime) — reuse the `/control` kill-switch + audit pattern, candidate-facing.
- **Dependencies**: tenant boundary (step 1); candidate identity/consent system; a privacy/legal model (GDPR — this is the make-or-break); Moonshot #1's portable profile as the candidate node.
- **Risks**: GDPR / cross-employer consent is existential — get it wrong and it's a lawsuit, not a feature; cold-start (a network with one employer is just the current product); two-sided chicken-and-egg (need candidates to attract employers and vice versa); incumbent LinkedIn owns the identity layer already.
- **What changes if we ship it**: kp becomes the *CEE talent network*, not a workspace — defensible by data that no single-tenant competitor can replicate, with value that grows quadratically in participants instead of linearly in seats.

---

## 3. **Autonomous Recruiting Agency — sell the outcome (a hired candidate), not the software**
- **Tier**: 1 (10x category-defining)
- **Category**: business-model → new-market
- **Impact**: kp already *operates* a pipeline autonomously: the clock (`instrumentation.ts`) claims due runs, fires policy passes that auto-advance/reject with fairness gates, sources, screens, schedules, and reminds — all behind a kill switch and human approval gates. The moonshot: stop selling the *workspace* and start selling the *result*. kp runs the entire funnel as a managed autonomous agent ("kp Autopilot"), the employer defines the role + guardrails, and kp delivers a vetted shortlist — or a hire — **priced per outcome** (the backlog hints at pay-per-shortlist; this goes further to a full agency model that competes with the 15-25%-of-salary recruiting agencies on cost and speed). 10x: a Czech mid-market employer pays a 20%-of-salary agency fee and waits weeks; kp delivers a fairness-audited shortlist in days at a fraction of the cost, with a full audit trail no human agency can produce. New market: kp now competes for the *agency budget*, which is 10-50x the size of the SaaS-seat budget.
- **Feasibility**: medium — the autonomous spine, approval gates, audit trail, comms dispatch, and outcome calibration are all built. The lift is *trust packaging* (SLA, guardrails, human-in-the-loop escalation) and the billing model, not new AI.
- **Time-horizon**: months → quarters
- **Why it's a moonshot**: it's a business-model reinvention, not a feature. Selling outcomes means kp takes on delivery risk (and reward) the way an agency does — a fundamentally different, far larger, far more defensible position than per-seat SaaS. Audacious because most "AI recruiting" products are tools that make a human recruiter faster; this *replaces the agency*.
- **Path to implementation**:
  1. **Wedge (today's scaffold)**: package the existing autonomous pass + `/control` room as a **"Autopilot mode" for a single role** — recruiter sets guardrails (fairness thresholds via `decision-config`, the kill switch, approval kinds), kp runs the clock-driven pass end-to-end and surfaces a ranked, audited shortlist using `screen-wave` + `group-eval` that already exist. Zero new pipeline; it's a packaging + framing of `automation-pass.ts` + `scheduler.ts`.
  2. Add an **outcome ledger**: tie the existing `dev-outcomes` / calibration store to a per-role success definition (shortlist accepted / interview booked / hired) so "outcome" is measurable and billable.
  3. Wire outcome → billing: extend the Polar layer (`app/_lib/billing/`) from subscription-only to a **usage/outcome SKU** (charge on accepted shortlist or hire).
  4. Define the SLA + escalation: when confidence is low or fairness gates trip, kp escalates to a human (reuse approval gates) — this is what makes it sellable to risk-averse employers.
  5. Publish per-role economics (kp already has `analytics/spend` + source economics) as a *cost-vs-agency* dashboard — the sales weapon.
- **Dependencies**: outcome ledger; usage/outcome billing SKU; SLA + escalation policy; strong fairness/audit story (it's now making consequential decisions on kp's commercial hook — must be defensible).
- **Risks**: liability for autonomous hiring decisions (EU AI Act high-risk); a bad autonomous shortlist burns trust fast; outcome-pricing cash-flow lumpiness; employers' emotional resistance to "AI chose my candidates."
- **What changes if we ship it**: kp moves up-market from a SaaS tool to a *service that delivers hires*, competing for the agency budget. Margin and defensibility both jump because the moat is the autonomous operator + the outcome data, not the UI.

---

## 4. **Two-Way Marketplace: candidates run kp on employers (the "Glassdoor + Levels.fyi with teeth")**
- **Tier**: 1 (10x category-defining)
- **Category**: marketplace-network → interface-reinvention
- **Impact**: every kp capability today points one direction — employer evaluates candidate. But kp already holds the other side's gold: a calibrated Czech salary model (`salary_benchmarks.json` + the documented Platy.cz/Levels.fyi/Glassdoor corpus), role-fit scoring, JD-quality linting (`jd-lint.ts`), and a grounded market-evidence engine. The moonshot: flip the product to also serve **candidates evaluating employers and offers** — "kp for candidates": upload your CV + an offer, get a grounded, fair-market salary verdict, a JD red-flag analysis, a fit score, and negotiation talking points — and crucially, candidates who do this *enter the talent graph* (feeds #2). 10x: kp becomes a destination *candidates* visit (huge top-of-funnel, consumer-grade reach) instead of only a B2B tool recruiters log into. New interface: a consumer-facing, conversational "is this offer fair?" surface vs. the recruiter studio.
- **Feasibility**: high — the salary engine, the grounded-evidence path, JD lint, and the conversational `/apply` interface all exist. This is largely re-aiming existing engines at a new audience.
- **Time-horizon**: weeks → months
- **Why it's a moonshot**: it converts a B2B tool into a two-sided marketplace and unlocks a consumer-scale acquisition channel for the talent graph. Audacious because it changes *who the customer is* and turns kp's salary data into a public magnet.
- **Path to implementation**:
  1. **Wedge (today's scaffold)**: ship a public, no-login **"Salary & Offer Check"** page that runs the existing `scripts/salary.py` / `pipeline.jobfit.service.analyze` path with `--grounding` against a pasted offer — kp *already* has CLI parity for exactly this (`salary.py`, `jobfit.py`). Render it with the existing `SalaryGauge` + grounded-evidence components. Pure re-surfacing of a built pipeline.
  2. Add **JD red-flag analysis** for candidates by re-aiming `jd-lint.ts` ("this 'rockstar ninja' JD signals X; comp band looks 15% below market for the role").
  3. Add a **fairness/negotiation pack**: reuse `interview.py`'s STAR scaffolds + the gap analysis as candidate-side talking points.
  4. Make the check *create a profile* (consented): the candidate's anonymized result seeds their talent-graph node (the on-ramp for #2).
  5. Crowdsource verified comp data back into `salary_benchmarks.json` (candidates confirm real offers) — a candidate-fed data flywheel that no recruiter-only product can build.
- **Dependencies**: public/unauthenticated surface + abuse rate-limiting (`rate-limit.ts` exists); consent for candidate data; the salary corpus (built).
- **Risks**: consumer acquisition is a different motion than B2B sales; salary-verdict accuracy is reputationally load-bearing; could distract from the core B2B revenue; data-quality of crowdsourced comp.
- **What changes if we ship it**: kp owns *both sides* — the only AI recruiting product candidates *want* to use — turning acquisition cost into a flywheel and feeding the talent graph organically.

---

## 5. **Bias & Compliance Authority — be the explainable, EU-AI-Act-native system of record for fair hiring**
- **Tier**: 1 (10x category-defining)
- **Category**: new-market → data-as-moat
- **Impact**: hiring is *high-risk* under the EU AI Act (in force, with phased obligations through 2026-2027) and Czech NIS2/regulatory tightening — every employer using AI in hiring now needs explainability, audit trails, bias monitoring, and human-oversight records *by law*. kp is almost uniquely positioned: it *already* has fairness gates (`automation-fairness.ts`), a cross-scheme fairness matrix in group-eval, an immutable audit trail at `/control`, provenance envelopes, and human-approval gates. The moonshot: package this into **"kp Compliance" — a certified, exportable fair-hiring system of record** that any employer (even those using *other* ATS tools) can adopt to satisfy the regulation, with continuous bias monitoring across the funnel and regulator-ready reports. 10x new market: kp sells to *every* AI-using employer's legal/compliance budget, including ones who'll never replace their ATS — and becomes the trusted neutral arbiter of "was this hire fair?"
- **Feasibility**: medium — the fairness math, audit trail, and explainability primitives exist; the lift is the compliance framing, the certification/report artifacts, and an ingestion path for *external* decisions.
- **Time-horizon**: quarters
- **Why it's a moonshot**: it's a wedge into a brand-new, regulation-driven, budget-rich market where kp's existing fairness investment is a 2-year head start — and it's the kind of trust layer that, once adopted, is impossibly sticky (you don't rip out your compliance system of record).
- **Path to implementation**:
  1. **Wedge (today's scaffold)**: turn the existing `/control` audit trail + group-eval fairness matrix + decision-attribution into a **one-click "Fair Hiring Report"** export (PDF/CSV — `export-utils.ts` exists) for a role: every automated decision, the rationale, the fairness check, the human-oversight record. Pure assembly of `decision-attribution.ts` + audit rows + fairness panel.
  2. Add **continuous bias monitoring**: aggregate decision outcomes across the funnel (analytics layer exists) into drift/disparity alerts surfaced in `/control`.
  3. Map outputs to the **EU AI Act high-risk checklist** (transparency, human oversight, record-keeping) so the report is regulator-shaped, not generic.
  4. Open an **ingestion endpoint** so decisions made *outside* kp (in the employer's existing ATS) can be logged and audited — kp as the neutral compliance layer over any stack.
  5. Pursue third-party certification/attestation of the methodology (leverages the calibration harness `lifecycle_eval.py` + audits as evidence).
- **Dependencies**: external-decision ingestion; regulator-mapped report templates; legal review of the compliance claims; the fairness + audit primitives (built).
- **Risks**: regulatory claims carry liability (over-promising "compliant" is dangerous); the standard is still settling (moving target); requires credibility/partnerships (auditors, law firms) kp doesn't have yet.
- **What changes if we ship it**: kp becomes the *trusted compliance authority* for AI hiring in CEE — a wedge that lands kp in employers who'd never buy its recruiting workspace, and a moat made of audit data + regulator trust.

---

## 6. **The Recruiting Operator Platform — open the autonomous spine as a programmable agent runtime + skill marketplace**
- **Tier**: 2 (3-5x)
- **Category**: platform-distribution → foundational-primitive
- **Impact**: kp's automation pass is a fixed set of tasks (screen / outreach / rejection / prep / scorecard / rematch / offer / policy-pass) hard-wired into `automation.py`. The moonshot: expose the autonomous clock + approval-gate + audit spine as a **programmable recruiting-agent runtime** — employers (and third parties) define *custom* automation skills/policies (e.g., "for senior security roles, run a NIS2-knowledge probe before screening"; "auto-rematch rejected candidates to junior roles after 30 days") that plug into the existing scheduler and inherit the fairness gates, kill switch, and audit trail for free. A skill marketplace lets best-practice recruiting policies be shared/sold across the talent graph. 3-5x: kp stops being a fixed workflow and becomes a *platform* others build hiring automation on — distribution + lock-in via an ecosystem.
- **Feasibility**: medium — the scheduler (`scheduler.ts` / `scheduler-store.ts`), the registered-job pattern (the README's AUTO6 reminder-job model), approval kinds, and the multi-provider LLM layer (`pipeline/jobfit/llm/`) are all the right substrate; the lift is a safe extension/sandboxing API and a policy DSL.
- **Time-horizon**: quarters
- **Why it's a moonshot**: platformization with an ecosystem flywheel is audacious for a single-tenant app — it bets that kp's *primitives* (autonomous + gated + audited + fair) are valuable enough that others want to build on them, creating distribution kp can't buy.
- **Path to implementation**:
  1. **Wedge (today's scaffold)**: formalize the existing automation tasks behind a **registered-skill interface** mirroring the AUTO6 reminder-job pattern (`ensureReminderJob` / `claimDueRun` / `recordRun` in `scheduler-store.ts`) — refactor the 7 hard-wired tasks in `automation.py` into pluggable skill descriptors with declared fairness gates + approval kind. No new capability; it makes the *existing* pass extensible.
  2. Add a **policy DSL / config** (extend `decision-config-schema.ts`) so a recruiter can compose a custom pass from skills without code.
  3. Sandbox + capability-scope the LLM calls per skill via the existing provider/registry/capabilities layer (`pipeline/jobfit/llm/registry.py`, `capabilities.py`) so a custom skill can't exceed its budget or bypass a gate.
  4. Ship a **skill marketplace** surface where vetted recruiting policies are shared across the talent graph (ties to #2).
  5. Expose a webhook/API so external systems trigger and observe skills (the `RemoteTrigger`/cron pattern + `/api/automation/run` already anticipates this).
- **Dependencies**: a safe extension API + sandboxing; policy DSL; the fairness/gate framework must be enforceable on *third-party* skills (the trust contract); ideally the tenant boundary from #2.
- **Risks**: third-party skills making consequential hiring decisions is a fairness/liability hazard (every skill must inherit gates — hard to enforce); platform adoption is its own chicken/egg; complexity could outrun the single-tenant codebase.
- **What changes if we ship it**: kp becomes a *recruiting-automation platform* with an ecosystem moat — distribution via others' skills, lock-in via the runtime, and a marketplace that compounds across the network.

---

## Synthesis — how these stack into a company, not six features

These are deliberately *interlocking*, not independent — which is what makes them a strategy rather than a wishlist:

- **#1 (the score)** is the candidate-side primitive. **#2 (the graph)** is the network those scores live in. **#4 (candidate-side product)** is the consumer on-ramp that *fills* the graph. **#3 (autonomous agency)** is the up-market revenue engine that runs *on* the graph. **#5 (compliance)** is the trust layer that makes #3 sellable in a regulated market. **#6 (platform)** is the distribution flywheel once the spine is proven.
- **The single most audacious bet is #1, the Durable-Skill Standard** — because owning the *measurement* of hiring in the AI-coding era is the only one of these that is winner-take-most and that nothing in the 141-idea backlog approaches. Everything else is a network or business-model bet *on top of* a number kp gets to define.
- **Every STEP 1 is doable in the current scaffold** and is mostly *re-surfacing or refactoring* a built capability (dev-case transfer score → signed artifact; implicit `id='workspace'` → explicit `workspace_id`; automation pass → "Autopilot mode"; `salary.py` → public offer-check; `/control` audit → Fair Hiring Report; 7 tasks → registered-skill interface). The moonshot is never the wedge — it's where the wedge *leads*.
- **The cross-cutting prerequisite the backlog hasn't named**: kp must cross the **single-tenant → multi-tenant** boundary (#2 step 1) to unlock the compounding-data versions of #1, #3, #5, and #6. That refactor is the highest-leverage non-obvious investment on this list.
