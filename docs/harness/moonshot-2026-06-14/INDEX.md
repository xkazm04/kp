# Moonshot Architect Scan — kp, 2026-06-14

> Ambitious 10x / category-defining opportunity scan (NOT a defect audit). Moonshots are scored on **Tier × Feasibility × Time-horizon**, not severity.
> 6 deep **Opus** subagents (5 capability clusters + 1 whole-product visionary), each grounded in the real scaffold and seeded to design BEYOND kp's ~141 existing backlog ideas. **Scan-only** — each chosen moonshot becomes its own future Pipeline A goal; no code was written and no baseline captured (per moonshot-scan convention).

---

## Totals

| | Tier 1 (10x) | Tier 2 (3-5x) | Tier 3 | **Total** |
|---|---:|---:|---:|---:|
| Raw proposals (6 reports) | 20 | 11 | 0 | **31** |

**After cross-cluster dedup: ~8 distinct strategic themes, ~6 flagship Tier-1 bets.** The most important result of this scan is the **convergence**: six agents working independently kept arriving at the *same* category-defining bets from different angles — that agreement is the signal.

| # | Cluster report | Moonshots | T1/T2 |
|---|---|---:|---:|
| 1 | `candidate-intelligence.md` | 5 | 3/2 |
| 2 | `jobs-sourcing.md` | 5 | 3/2 |
| 3 | `hiring-workflow.md` | 5 | 3/2 |
| 4 | `assessment-automation.md` | 5 | 3/2 |
| 5 | `platform-data-economics.md` | 5 | 3/2 |
| 6 | `whole-product-visionary.md` | 6 | 5/1 |

---

## The two foundational primitives that gate almost everything

The single highest-leverage finding: nearly every Tier-1 moonshot rests on one of **two primitives kp doesn't fully have yet**. Build these and a whole tier of bets unlocks; skip them and the moonshots stay aspirational.

- **P1 — A persisted outcome ledger** (hire / retention / performance outcomes joined back to scores & decisions). This is the accepted-but-still-**unbuilt** "outcome-feedback spine" from the 2026-06-13 scan (ideas 28e0da31/05790bb8/43de88f2/f0af55d4). It gates Theme C (calibration, self-tuning, outcome-tuned routing) and feeds Themes B & F.
- **P2 — Multi-tenancy** (kp is single-workspace today — confirmed via `db/billing.ts` / one `kp.sqlite`). It gates Theme B (cross-tenant graph), Theme F (marketplaces), and Theme G (platform/API).

**Wedge insight:** both have a single-tenant wedge that delivers value before the full primitive exists — P1 as a per-workspace calibration loop, P2 as a redact-only cross-workspace aggregate. Start there.

---

## Triage themes (31 → 8 clusters)

### A. The Durable-Skill Standard / Verified Passport  ⭐ strongest convergence (4 agents)
Own *the score the industry hires on* — a portable, candidate-owned, verifier-signed credential of what a candidate was **observed** to do (not claimed). "FICO for the AI-coding era."
- whole-product #1 **Durable-Skill Standard** (T1, flagship) · candidate-intel #5 **Verified-Skill Passport** (T2) · assessment #5 **Verifier-Signed Competence Credential** (T2) · platform #4 **Portable Candidate Passport** (T2)
- Wedge (Step 1, exists today): sign + export the dev-case engine's `observed`-evidence as a credential (`db-portability.ts` + devcase `provenance.py`).

### B. Cross-tenant Talent / Benchmark Graph — the data moat  ⭐ convergence (4 agents)
Turn each workspace's private candidate + outcome data into an opt-in, consent-gated, k-anonymous network that compounds with every customer — cold-start becomes unwinnable for entrants.
- jobs-sourcing #1 **Living Talent Graph** (T1) · whole-product #2 **Talent Graph** (T1) · platform #1 **Hiring Benchmark Network** (T1) · candidate-intel #2 **Longitudinal Candidate Graph** (T1, the per-tenant precursor)
- Wedge: redact-only aggregator over the existing `PipelineAnalytics` snapshot (needs P2).

### C. Outcome-Closed Intelligence — calibration & self-tuning  ⭐ convergence (4 agents)
Every score becomes a *measured probability*; every policy threshold tunes itself against what actually happened; even the LLM router learns from realized hires.
- candidate-intel #1 **Calibration Engine** (T1, measured Brier score) · hiring-workflow #3 **Outcome-Closed Decision Loop** (T1) · assessment #3 **Self-Tuning Autonomous Recruiter** (T1) · platform #2 **Outcome-Tuned Router** (T1)
- Wedge: `calibrationPairs()` join over existing `score` + `disposition` columns in `db/analyses.ts` (needs P1).

### D. Trust, Defensibility & Compliance Layer
Make every decision legally defensible and the whole system EU-AI-Act-native.
- hiring-workflow #1 **Hiring Decision System of Record** (T1, signed/hash-chained/replayable) · whole-product #5 **Bias & Compliance Authority** (T1) · candidate-intel #4 **Drift & Disagreement Sentinel** (T2)
- Wedge: seal the structured `ScreenDecision` + `recordAutomationEvent` call sites in `screen-wave.ts` into immutable artifacts.

### E. Assessment Redefined — fraud-proof by construction
Move the take-home INSIDE the product and observe the *process*, and red-team every case before a human sees it.
- assessment #1 **Live Work Surface** (T1) · candidate-intel #3 **Adversarial Proof-of-Skill** (T1) · assessment #2 **Adversarial Assessment Gym** (T1)
- Wedge: embedded editor + sandboxed run over the already-materialized seed repo (`seed_materializer.py`).

### F. Marketplace & New Business Models
Flip the funnel: candidates publish fair-ranked anonymized profiles and roles bid; sell the *hire* (outcome), not the software; bill on realized hires.
- jobs-sourcing #3 **Reverse Marketplace** (T1) · whole-product #4 **Two-Way Marketplace** (T1) · whole-product #3 **Autonomous Recruiting Agency** (T1) · jobs-sourcing #2 **Demand Sensing** (T1) · platform #5 **Value-Metered Pricing on Realized Hires** (T2)
- Needs P1 (to bill outcomes) + P2 (two-sided).

### G. Platform & Distribution
Distribution beyond the studio: an embeddable, metered hiring-intelligence API, a programmable agent runtime + skill marketplace, and universal role ingestion.
- platform #3 **Embeddable Hiring-Intelligence API** (T1) · whole-product #6 **Recruiting Operator Platform** (T2) · jobs-sourcing #4 **Omnichannel Demand Ingestion** (T2) · jobs-sourcing #5 **Self-Optimizing Sourcing** (T2)

### H. Workflow & Interface Expansion (nearest-term, lowest-risk)
- hiring-workflow #2 **Structured-Interview-as-a-Service** (T1) · hiring-workflow #4 **Requisition Orchestrator** (T2) · hiring-workflow #5 **Adaptive Fact-Checking Voice Interviewer** (T2) · assessment #4 **Apply-to-Assess Continuity** (T2)

---

## Suggested conversion-to-goal sequence

Moonshots don't run as fix-waves — each becomes a Pipeline A goal in its own session. Recommended order (dependency- and wedge-aware):

1. **P1 wedge — the outcome ledger + Calibration Engine (Theme C).** Highest leverage, single-tenant, mostly additive on `db/analyses.ts` + `dev-outcomes.ts`. Unlocks C wholesale and feeds B/F. *Start here — it's also the cheapest of the category-definers.*
2. **Theme D — Decision System of Record.** High feasibility on the existing structured `ScreenDecision` spine; turns "trust us" into a defensible artifact; strong B2B/compliance pull. Pairs naturally with #1.
3. **Theme E — Live Work Surface / fraud-proof assessment.** Builds on the real dev-case engine; differentiator while AI-padded CVs erode everyone else's signal.
4. **Theme A — Durable-Skill Standard / Passport.** The flagship category-definer; export-credential wedge is doable now, but the *standard* play wants #3's richer observed-evidence first.
5. **P2 — multi-tenancy**, then **Theme B (Benchmark Network)** and **Theme F/G (marketplace, platform, API).** Largest bets, longest horizon; gated on the tenancy boundary.

Themes H are the safe near-term goals if a smaller, lower-risk iteration is wanted instead of a category-definer.

---

## How this scan was run

- **Scanner**: `moonshot_architect` role (`src/lib/prompts/registry/agents/moonshot-architect.ts`) — 10x / category-defining thinking, audacious-but-with-a-path.
- **Model**: every analysis subagent ran on **Opus with a max-depth preamble** (the design IS the payoff — never sonnet for moonshot analysis).
- **Shape**: 6 subagents — 5 capability clusters (candidate-intelligence, jobs-sourcing, hiring-workflow, assessment-automation, platform-data-economics) + 1 whole-product visionary. Each read the real scaffold (file lists reused from `../code-refactor-2026-06-14/_scan-plan.json`) so every moonshot's Step 1 cites a real module.
- **Seeding**: each agent was given kp's ~141 existing backlog ideas (themes) and told to design BEYOND them — additive differentiation, not re-proposal.
- **Output per moonshot**: Tier / Category / Impact / Feasibility / Time-horizon / Why-it's-a-moonshot / Path-to-implementation (Step 1 doable now) / Dependencies / Risks / What-changes-if-we-ship.
- **Verification**: header counts (`> Moonshots:`) sum to 31; `## N.` headers sum to 31.
- **No code changed, no commits of source** — this is a planning artifact. Reports: 6 cluster files + this INDEX.
