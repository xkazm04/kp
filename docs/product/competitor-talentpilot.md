# Competitor teardown — Talentpilot

> **Implementation plan lives in `docs/product/coverage-plan.md`.** This document is
> the analysis (gap IDs A/B/C are defined here and referenced there); that one is the
> executable wave plan and holds the canonical wave numbering.
>
> One correction to §4 item 4 below: the closing caveat about the usage ledger being
> unmetered is **stale**. It came from the tiger init scan (2026-06-20); the 2026-07-15
> scan flipped it — the ledger is rebuilt, default-on and cost-stamped per adapter.
> See the coverage plan §1.

Research date: **2026-07-30**. Sources are public marketing/FAQ/case-study pages plus
third-party listings; every claim below is *their* claim unless marked otherwise.
kp-side statements were verified against this repo (files cited inline).

---

## 0. Why this one matters

Talentpilot is not a distant US competitor. It is **the** competitor:

- Founded 2023, dual HQ **Dover, Delaware + Prague, Czechia** (River Garden, Rohanské nábřeží).
- Named customers: **Notino, Rohlik Group, Mews, J&T, Porsche, Smartlook, TITANS, Semantic Visions, Solidpixels** — i.e. the exact Czech enterprise logo set kp is aiming at (see `csas-seed`: our seed corpus targets Česká spořitelna).
- Two-way sync with **Recruitis and Teamio** — the two ATSes that own the Czech market.
- Localized site: **en / čeština / polski**. They are running the CEE play we are running.
- Traction: 100+ companies, 25 000+ individuals assessed.

They are ~2 years ahead on go-to-market in our home market. The good news: their moat is
narrower than their website suggests, and the two things they *cannot* buy are things we
already have running.

---

## 1. Their advantage inventory

Verdict legend: **MISSING** (we have nothing) · **PARTIAL** (we have a weaker version) ·
**HAVE** (parity) · **AHEAD** (we are better today).

### 1.1 Product — talent acquisition

| # | Their capability | Their claim | kp today | Verdict |
|---|---|---|---|---|
| A1 | **"Alex" — one named agent across the whole funnel** | Single persona does requirements → screen → interview → report → feedback; "automates up to 90% of routine activities" | Capability is spread across tabs/tools with no persona or single narrative | **PARTIAL** — we have more surface, less story |
| A2 | **External sourcing pool** | Autonomous search of **800M+** public profiles; "triple-source": external pool + internal employees + historical ATS candidates | Rediscovery of *our own* past applicants (`app/_lib/rediscover.ts`, `rediscovery-relevance.ts`) + campaigns against our own pool (`app/_lib/db/campaign.ts`). No external pool. | **MISSING** |
| A3 | **Hyper-personalized outreach at scale** | Per-candidate campaign generated from the JD; agent contacts candidates on your behalf; sentiment analysis halts outreach on reply | Campaign variants + outreach send (`app/api/jobs/[id]/candidates/outreach/route.ts`); no reply-detection/auto-halt | **PARTIAL** |
| A4 | **24/7 voice screening interviews** | Voice interviews any hour; 40%+ of Rohlik's interviews ran outside business hours; ~30 min avg; structured report in **<30 s** | Full in-browser voice interview: OpenAI Realtime + ElevenLabs switcher, session lifecycle, transcript, telemetry, consent (`app/_lib/voice/*`, `app/api/interview/*`) | **HAVE** |
| A5 | **AI-native job application** | Interview link embedded in the posting — candidate self-serves, zero recruiter touch | Quick Apply + Conversational Apply Intake + public job detail page; interview is not yet a one-click artifact of the posting | **PARTIAL** |
| A6 | **Structured scoring rubric** | Four criteria types: hard skills (3-level), soft skills (0–100% over 5 tiers), qualifications (3-level), open-ended | Interview scorecards + rubric + transcript review; decision rules; group-eval comparison | **HAVE** |
| A7 | **Psychometrics — Big Five (FFM)** | Validated personality assessment, "10 000+ empirical studies", co-developed with organizational psychologists | **Nothing.** Grep for FFM/Big-Five/Hofstede returns only taxonomy strings and one doc. | **MISSING** |
| A8 | **Culture fit — Hofstede dimensions** | Culture-fit score, traits, alignment insights dashboard | Nothing | **MISSING** |
| A9 | **Team Impact Analysis / Company DNA** | Projects how a hire shifts existing team dynamics; surfaces the stated-vs-actual culture "say-do gap" from employee conversations | Nothing | **MISSING** |
| A10 | **Language coverage** | Alex interviews in **12–14 languages**, can switch language mid-interview to test real proficiency | UI in 4 locales (`messages/{cs,de,en,fr}.json`); no mid-interview language switch | **PARTIAL** |
| A11 | **Personalized rejection feedback** | Hyper-personalized rejection mail explaining the decision; pitched as a cNPS/employer-brand lever | Rejections cite the recorded decision reasoning (never LLM-generated freeform), protected-attribute lines dropped whole; candidate NPS captured at terminal outcomes and folded into the metric pack (`app/_lib/comms.ts`, `app/_lib/candidate-nps-store.ts`, `app/_lib/metric-pack.ts`) — shipped 2026-07-30, coverage-plan W0.6/W0.6b | **HAVE** *(updated 2026-07-30 — was PARTIAL)* |
| A12 | **Zero-touch scheduling** | **Nylas**-powered calendar integration, no recruiter intervention | Self-scheduling invites + reminders + add-to-calendar links (`app/_lib/calendar-links.ts`, `schedule-store.ts`). No OAuth free/busy read, no event write-back. | **PARTIAL** |
| A13 | **Anti-cheating detection** | Generic claim, unspecified | 6 anti-delegation controls in the dev-case module: hash chain, prompt capture, canaries, watermark, perturbation, baseline diff | **AHEAD** |

### 1.2 Product — post-hire (their whole second half)

| # | Capability | Their claim | kp today | Verdict |
|---|---|---|---|---|
| B1 | **Skills graph of the org** | Map skills across all teams; connect to learning platforms for learning paths | Dev skill-profiles only (`app/_lib/db/skill-profiles.ts`) | **MISSING** |
| B2 | **Three-way skills calibration** | Self-assessment + manager eval + AI-verified → internal talent marketplace | Nothing | **MISSING** |
| B3 | **AI performance reviews** | Manager copilot; goals + KPIs + 360° feedback | Nothing | **MISSING** |
| B4 | **Project team staffing** | Recommends team compositions from skills/motivations/traits | Nothing | **MISSING** |
| B5 | **Workforce planning / succession** | Agent interviews employees about motivation & career; reorg + reskilling recommendations | Nothing | **MISSING** |
| B6 | **Onboarding** | Not emphasized | Not offered — kp ends at Hired and hands off to the HRIS (`candidate.hired` ATS webhook). kp shipped onboarding templates/runs/checklists/e-sign and then removed them: post-hire activity is a different product, and carrying it diluted the hiring story | **PARITY (both out of scope)** |

### 1.3 Integrations, trust, commercial

| # | Capability | Their claim | kp today | Verdict |
|---|---|---|---|---|
| C1 | **ATS connectors** | **40+ two-way**: Greenhouse, Ashby, Lever, **Recruitis, Teamio** | One vendor-neutral **egress** contract: `kp.ats.v1` record + HMAC-signed lifecycle webhook (`app/_lib/ats-record.ts`, `ats-egress.ts`). Explicitly documents its own ceiling: "vendor-neutral EGRESS, not a certified per-vendor connector." No ingest, no OAuth, no field map. | **MISSING** (this is the biggest gap) |
| C2 | **HCM connectors** | 20+: SAP, Workday, Oracle | None | **MISSING** |
| C3 | **Certifications** | **ISO 27001**, GDPR, CCPA, EU AI Act | GDPR consent/provenance/data-access-by-token shipped; `docs/_archive/AI_ACT_CONFORMITY.md` written; SOC2/ISO in `docs/product/enterprise-readiness.md` backlog, not certified | **PARTIAL** |
| C4 | **Explainability** | "Explainable AI scoring" | Sealed decisions with tamper-evident hash + auto/human attribution, per-tenant decision chains, provenance dossier, AI-Act regime surfacing (`app/_lib/decision-attribution.ts`, `compliance-regimes.ts`, `provenance-dossier.ts`) | **AHEAD** |
| C5 | **Data posture** | Never sold/shared; not used for model training | Same posture, plus write-only key store, per-tenant guards, BYOM, self-host path (`docs/architecture/self-hosting.md`) | **AHEAD** |
| C6 | **Proof** | 100+ customers, named enterprise logos, 2 published case studies, 4.7/5 across 282 reviews (third-party listing; their G2 profile itself shows no reviews — treat the 282 as unverified) | Zero external logos, zero case studies | **MISSING** |
| C7 | **Pricing** | Core **$290/mo/user** + screening interviews **$0.40/min** as an add-on (150 min bundled); enterprise pricing is quote-only | Free / Starter 240 CZK (~$10) / Growth 480 CZK (~$20) / BYOM 120 CZK (~$5) / Enterprise custom; interview minutes 790 CZK per 100 min ≈ **$0.34/min** (`app/_lib/billing/plans.ts`) | **AHEAD** — ~14× cheaper base, published |
| C8 | **Segment** | Third-party review: best for *enterprise in-house teams*, explicitly **"not agencies or smaller operations"**; requires ATS/HCM integration to deliver full value | kp works standalone with no ATS | **AHEAD** — their disqualified segment is our beachhead |

### 1.4 Their headline numbers (for our counter-positioning)

55% ↓ time-to-fill · 65% ↑ HR productivity · 27% ↓ attrition · $25K saved per 100 hires ·
NPS 60+ · up to 80% of recruiting tasks automated · 4.6/5 candidate experience.
Rohlik, 3 months: 10 000+ candidates, 100+ roles, 800+ AI interviews, 400+ hours of AI
conversation, recruiter load 4–6 → 8–12 roles, 9/10 candidate recommendation.

kp has **no comparable instrumented number** to put on a slide. That is a marketing gap
with an engineering fix (§3, W0).

---

## 2. What is actually a moat (do not attack head-on)

1. **The 800M profile pool (A2).** Licensed/scraped data at that scale is a capex+legal
   position, not a sprint. Attack it *sideways* (§3 W2) — and note that in the EU a
   scraped 800M-profile pool is a GDPR Art. 14 liability we can turn into a talking point.
2. **40+ certified ATS connectors (C1).** Each is OAuth + field mapping + certification +
   maintenance. We do not out-build 40. We buy ~40 with one integration (§3 W1).
3. **Psychometric science credibility (A7–A9).** "Co-developed with organizational
   psychologists, 10 000 studies" is a *trust* asset. We can reach instrument parity with
   public-domain inventories, but not their authority claim, quickly.
4. **Enterprise logos (C6).** Only closable by closing customers.

Everything else in §1 is reachable.

---

## 3. Coverage plan

Sequenced by (deal-blocking impact) ÷ (effort). Each wave is a ship-loop milestone
candidate; W0–W2 is the "stop losing deals to them" set.

### W0 — Proof & trust surface *(cheap, highest immediate ROI)*
Nothing here needs new product; it makes existing product sellable against them.

| Item | Closes | Anchor |
|---|---|---|
| **Metric pack**: instrument time-to-fill, recruiter capacity, cost-per-hire, screening-hours-saved as first-class analytics tiles, exportable as a one-pager | §1.4 | `app/features/insights/analytics/*`, Forecast & Momentum contexts |
| **Publish the trust page**: `AI_ACT_CONFORMITY.md` → public route, + DPA, subprocessor list, data-flow diagram, model list | C3, C4 | new `app/trust/`, reuse `puml` renderer |
| **"Auditable decision" demo**: show the sealed hash chain + provenance dossier as a candidate-facing and auditor-facing artifact | C4 (turn AHEAD into a sales asset) | `provenance-dossier.ts`, `decision-attribution.ts` |
| **Constructive rejection letter** generator + cNPS capture on the status page | A11 | `comms.ts` + `app/status/[token]/` |
| **Start ISO 27001** (readiness assessment, not certification) | C3 | `docs/product/enterprise-readiness.md` E-track |

### W1 — Integration parity *(the single biggest gap)*

| Item | Closes | Note |
|---|---|---|
| **Unified ATS API (Merge.dev or equivalent) — two-way** | C1 (~40 connectors) | One integration + field-map UI. `ats-record.ts` already *is* the normalized shape a unified API maps to; we need the **ingest** direction and OAuth credential storage. |
| **Native Recruitis + Teamio ingest** | C1, home-market parity | Both have public APIs; Recruitis↔Teamio interop is documented. These two are table stakes in CZ/SK and they already have them. |
| **Calendar OAuth: Google + Microsoft free/busy read + event write** | A12 | Replaces our link-based scheduling with true zero-touch. Cronofy/Nylas if buy-over-build. |
| **HCM egress** (Workday/SAP via the same unified layer) | C2 | Lower priority — post-hire is W4. |

### W2 — Sourcing, without buying a data pool

| Item | Closes | Approach |
|---|---|---|
| **Triple-source parity minus the pool** | A2 | Internal employees + past applicants (have) + **referral graph** + **BYO-pool ingest** (LinkedIn Recruiter export, ATS candidate DB, CSV/XLSX) run through the existing matching engine. Their "triple-source" is 2/3 our own data anyway. |
| **Czech-market sourcing grounded in Market Pulse** | A2 differentiation | MPSV VPM + ISPV data we already ingest → supply/demand + realistic salary band per role per region. They match profiles; we tell you whether the role is *fillable* at that price. |
| **Outreach reply detection + auto-halt** | A3 | Inbound channel webhooks already exist (`app/api/channels/inbound/[token]/route.ts`); wire reply → pause campaign. |
| **Positioning**: "sourcing you can defend under GDPR" | A2 counter | Lawful-basis + Art. 14 notice trail per sourced candidate, from `consent.ts` + provenance. |

### W3 — Fit assessment, done more defensibly than theirs

Their A7–A9 is the strongest *sales* story on their site. Build parity, but pick a
posture the EU AI Act rewards:

| Item | Approach |
|---|---|
| **Personality inventory** | Candidate-completed, **public-domain IPIP-NEO-120/300** (Big Five) rather than inferring traits from a CV or a voice recording. Self-report is a defensible legal basis; trait inference from voice is arguably emotion-recognition-adjacent and a high-risk classification headache. |
| **Work-values / culture instrument** | Hofstede at the individual level is contested (it is a *national*-culture framework). Use a work-values inventory + explicit company-values calibration. **This is an attackable flank in their science story — say so in competitive material.** |
| **Team composition delta** | Reuse group-eval + differentiators machinery (`group-eval-run.ts`, Group Eval Verdict & Fairness) to project fit against the *actual* current team, with the fairness gate already in place. |
| **Guardrails** | Instrument results are advisory-only, never auto-reject; every use lands in the decision chain with attribution. Ship the AI-Act impact check alongside (`compliance-regimes.ts`). |

### W4 — Post-hire, narrowly

Do **not** chase B3–B5 (performance reviews, workforce planning, succession) — that is a
second product and a different buyer. Take only the part that reuses the matching engine:

- **Skills graph from hire records + internal mobility** (B1, partial B2): employees become
  matchable profiles; the existing rediscovery + match engine powers internal openings.
  Cheap because the engine exists.
- Defer B3–B5 and say so publicly ("we are a hiring system, not an HCM") — clearer
  positioning against a platform that is spread across both.

### W5 — De-lock the product *(prerequisite for everything commercial)*

Known blocker from the 20-HR-cohort UAT (`kp-industry-locked-finding`): kp is structurally
bank/Czech/tech-locked — taxonomy, CZK comp, GDPR-only. Talentpilot ships 12–14 languages
and industry-agnostic psychometrics precisely because it is market-portable.
Concretely: taxonomy beyond IT, multi-currency comp, locale expansion (pl/sk/de/hu/ro at
minimum — `/i18n-translate` already exists), and **voice-interview** language coverage
(more important than UI locales) incl. mid-interview language switch (A10).

---

## 4. "Something on top" — where we win, not tie

These are asymmetric: each is already partly built here and structurally hard for them.

1. **Verified work-sample hiring for the LLM era.** Their anti-cheating is one bullet. We
   have a *whole module*: repo-grounded dev cases with hash chain, prompt capture,
   canaries, watermarking, perturbation and baseline diff, plus a persona-simulation
   harness (`/case-sim`) that proves the evaluation discriminates. The question "did the
   candidate or the model write this?" is the defining 2026 hiring problem and nobody is
   selling an answer. **This should be the headline, not a feature.**
2. **Cryptographically auditable decisions.** They say "Explainable AI". We can say: every
   verdict sealed with a tamper-evident hash, attributed to model + prompt version,
   per-tenant chain, candidate-visible provenance dossier, AI-Act Art. 12-shaped log. For
   banks, insurers and public sector (ČS is the seed target) this outranks psychometrics.
3. **Market Pulse as a data product.** Official Czech labour-market data (MPSV VPM + ISPV)
   → salary bands, winnability, offer analytics, fillability. They have no data product at
   all. Extend country by country as we de-lock (W5) and it compounds.
4. **Model transparency + BYOM + self-host.** LLM routing/registry, benchmarking harness,
   eval harness, calibration, usage ledger, `$5 BYOM` tier, self-hosting path. "Bring your
   own model, see every token, run it in your own VPC" is unavailable from an
   agent-as-a-black-box vendor and closes regulated deals they cannot enter.
   *Caveat from `tiger-harness`: the usage ledger is still the weakest link — ~100% of
   traffic is currently unmetered. Fix that before selling on it.*
5. **Published interview-quality evidence.** We have a voice-plane harness (real WS,
   measured WER) and a text-plane eval framework. They publish an NPS. Shipping
   "here is our measured interview reliability, here is the eval you can re-run" is a
   procurement-grade differentiator in exactly the segment they sell to.
6. **Two-sided: candidate/student mode.** `docs/_archive/v2-plan.md` — matching platform + student
   mode. They are employer-only. A candidate-side surface is both a moat and an
   acquisition channel they have no structure for.
7. **Price and self-serve.** $10–20/mo published vs $290/user/mo quote-only, with
   ~$0.34/min interviews undercutting their $0.40. Their own reviewers disqualify agencies
   and small teams. Own the segment they refuse, then grow up into it.

---

## 5. Positioning line

> They sell an **autonomous AI recruiter** to enterprises that already own an ATS.
> We sell **auditable, verified hiring** to everyone else — and prove the work is the
> candidate's, not a model's.

Talentpilot's weakest points to press: unpublished pricing, enterprise-only fit, ATS
dependency, individual-level Hofstede, a scraped 800M-profile pool in a GDPR jurisdiction,
and unverifiable review counts.

---

## 6. Explicitly not building

AI performance reviews · workforce planning/succession · a licensed 800M profile pool ·
40 hand-built native ATS connectors · authority claims about psychometric science we cannot
substantiate.

---

## Sources

- https://www.talentpilot.com/ · /talent-acquisition · /talent-management · /faq · /pricing · /about-talentpilot · /pre-screening-agent · /culture-fit-agent · /cs/alex
- https://www.talentpilot.com/pl/rohlik-case-study · https://www.talentpilot.com/en/titans-case-study
- https://www.effiflo.com/recruiting-tools/talentpilot · https://www.g2.com/products/talentpilot/reviews
- https://www.crunchbase.com/organization/supertalent · https://help.recruitis.io/
