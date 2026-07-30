# Talentpilot coverage — design & implementation plan

Companion to `docs/COMPETITOR_TALENTPILOT.md` (the teardown; gap IDs A1–A13, B1–B6,
C1–C8 are defined there). **That document says what the gap is. This document is what we
build, in what order, and how we know a wave is done.**

Status: **living plan — we execute it wave by wave.** Update the status column in §9 as
each item lands. Waves are ship-loop milestones; see §8 for the execution protocol.

---

## 1. Correction to the teardown's closing caveat

The teardown ended with "the usage ledger is ~100% unmetered — fix that before selling on
it." **That is stale and wrong.** It came from the tiger *init* scan (2026-06-20); the
2026-07-15 scan flipped it:

> "the `llm_usage` ledger is **rebuilt and DEFAULT-ON** (not gated on LightTrack) — table
> `db/core.ts:646`, writer `db/llm.ts`, emitted per-envelope, sidecar set on every spawn.
> Cost is stamped on every adapter with a priced-model regression test. **kp can now cost
> and bill its own AI.**" — `tiger/Tiger.md`

Ship-loop dimension 5 agrees: 🟢 "ledger complete + usage panel". So metering is **not a
blocker — it is an asset we have not productized.** That changes W4 from remediation to
packaging, and frees the remediation budget for what tiger says is *actually* open (§4).

---

## 2. Ordering principles

1. **Truth before marketing.** Two of our flagship differentiators have open integrity
   findings in the tiger vault. Claiming "verified work-sample hiring" while the devcase
   judge self-grades would be a false claim. Integrity fixes come first — they are small
   and they are load-bearing for everything we say afterwards.
2. **Sell what we already built before building what we lack.** kp has more shipped
   surface than the competitive story admits. W0 is almost entirely packaging.
3. **Buy the commodity, build the wedge.** 40 ATS connectors is a purchase. Work-sample
   verification is not for sale anywhere — that is where engineering time goes.
4. **Every wave ends sellable.** No wave is a pure prerequisite for a later wave.
5. **De-locking gates the commercial waves, not the technical ones.** W5 can run in
   parallel; it blocks revenue, not code.

Wave numbering **differs from the teardown's §3** (which had post-hire at W4). Mapping is
in §9. Canonical numbering is this document's.

---

## 3. Wave map

| Wave | Name | Closes | Effort | Blocked by |
|---|---|---|---|---|
| **W0** | Integrity & proof | A11, A13↑, C3, C4↑, C6, C7↑ + tiger #11/#12/#13 | M | nothing — **start here** |
| **W1** | Integration parity | C1, C2, A12 | L | vendor decision D1, D2 |
| **W2** | Sourcing without a pool | A2, A3 | M | W1.1 (shared credential seam) |
| **W3** | Fit assessment | A7, A8, A9 | L | nothing |
| **W4** | AI economics & model governance | C5↑, plus bets 4+5 | M | nothing |
| **W5** | De-lock (multi-market) | A10 + the industry-lock finding | L | nothing |
| **W6** | Post-hire, narrow | B1, partial B2 | M | W3 (traits feed the graph) |
| **W7** | Two-sided / candidate mode | bet 6 | L | deferred — see `docs/V2_PLAN.md` |

↑ = we are already ahead; the work is packaging, not capability.

---

## 4. W0 — Integrity & proof

**Goal:** every competitive claim we make is true, provable, and visible to a buyer.
**Why first:** cheapest wave, unblocks all sales conversation, and repairs two claims we
are currently making on shaky ground.

| ID | Item | Anchors | Acceptance |
|---|---|---|---|
| **W0.1** | **Devcase judge ≠ generator.** The `devcase_judge` capability is declared (`app/_lib/llm-config.ts:38`, `pipeline/jobfit/llm/capabilities.py:52`) but never wired — the generator grades its own case. Route evaluation through the `devcase_judge` capability with a distinct model. | devcase pipeline (Python), `llm-config.ts` | A test proves generator model ≠ judge model for a devcase run; tiger #11 closed |
| **W0.2** | **Devcase eval sees the submission.** Today the evaluation grades blind. | devcase evaluation (Python) | Regression test: perturbing the submission changes the score; tiger #12 closed |
| **W0.3** | **Group-eval seal traceability.** The auto-sealed `group_eval_lead` decision lacks the model's raw reasoning + `promptVersion` — an EU AI Act Art. 12 hole in the exact artifact we market as auditable. | `app/_lib/decision-attribution.ts:201-219`, `group-eval-run.ts` | Sealed record carries raw reasoning + promptVersion; tiger #13 closed |
| **W0.4** | **Metric pack.** Time-to-fill, recruiter capacity (roles/recruiter), screening-hours saved, cost-per-hire as first-class tiles + a one-page export. This is what answers their "55% ↓ time-to-fill / 4–6 → 8–12 roles". | `app/features/insights/analytics/*`, `app/_lib/analytics-*.ts`, `/api/analytics` | Four metrics render from real workspace data; export produces a shareable one-pager |
| **W0.5** | **Public trust surface.** `/trust` route: AI Act conformity summary (from `docs/AI_ACT_CONFORMITY.md`), DPA, subprocessor list, model list, data-flow diagram. | new `app/trust/`, `puml` renderer, `compliance-regimes.ts` | Page live in both themes, cs+en, linked from landing |
| **W0.6** | **Constructive rejection letter + cNPS.** Generate a specific, non-generic rejection explaining the decision from the sealed reasoning; capture cNPS on the status page. | `app/_lib/comms.ts`, `comms-envelope.ts`, `app/status/[token]/` | Letter cites real evidence, is locale-correct, and never leaks protected attributes; cNPS stored + surfaced in analytics |
| **W0.7** | **Make verified work-sample the headline.** Landing + pricing positioning around the six anti-delegation controls; comparison row vs "anti-cheating detection". | `app/landing/`, `app/features/settings/billing/BillingPlanCatalog.tsx` | Headline names the control set; pricing page shows the $20-vs-$290 contrast |

**Out of scope for W0:** anything requiring a third-party account.
**Gate:** `npm run typecheck && npm run lint && npm run test:unit && npm run test:python:gate && npm run build && npm run test:e2e && npm run i18n:check`.

---

## 5. W1 — Integration parity

**Goal:** stop losing deals to "does it plug into our ATS?".
**The gap is directional.** `app/_lib/ats-record.ts` is deliberately egress-only and says
so in its own header. We do not rewrite it — we **invert** it: the same normalized
`kp.ats.v1` shape becomes the ingest target too.

| ID | Item | Anchors | Acceptance |
|---|---|---|---|
| **W1.1** | **Bidirectional ATS seam.** Add ingest alongside egress: an inbound mapper to `kp.ats.v1`, an OAuth/credential store reusing the write-only secret doctrine, and a field-map config per connection. | `ats-record.ts`, `ats-config-store.ts`, `app/_lib/llm-secret.ts` (doctrine), `app/api/ats/*` | Round-trip test: external record → kp entity → egress record is stable; secrets never round-trip to client |
| **W1.2** | **Unified ATS API adapter** (decision D1). One integration buys ~40 connectors. | new `app/_lib/ats/providers/` | Two named systems sync candidates + stages two-way in a sandbox |
| **W1.3** | **Recruitis + Teamio native.** Home-market table stakes; already ship-loop backlog item 25. | same seam as W1.2 | Job publish + candidate ingest verified against both sandboxes |
| **W1.4** | **Calendar OAuth** (decision D2): Google + Microsoft free/busy read and event write, replacing link-only scheduling. | `app/_lib/calendar-links.ts`, `schedule-store.ts`, `app/features/hiring/schedule/*` | Slot suggestions respect real free/busy; confirmed slot writes a real event both sides |

**Dependencies:** D1 and D2 in §7 must be answered before W1.2/W1.4 start. W1.1 and W1.3
scoping can proceed regardless.

---

## 6. W2–W7 (summary specs)

### W2 — Sourcing without buying a pool
- **W2.1 BYO-pool ingest** — CSV/XLSX, LinkedIn Recruiter export, ATS candidate DB → existing matching engine. Gets us 2/3 of their "triple-source" using the customer's own lawful data. Anchors: `app/_lib/job-ingest.ts` (ingest pattern), `candidate-pool.ts`, matching engine.
- **W2.2 Referral graph** — employee → candidate edges as a first-class source; feeds rediscovery relevance. Anchors: `rediscovery-relevance.ts`, `source-analytics.ts`.
- **W2.3 Outreach reply detection + auto-halt** — inbound webhooks already exist; wire reply → pause campaign. Anchors: `app/api/channels/inbound/[token]/route.ts`, `db/campaign.ts`.
- **W2.4 Market Pulse fillability** — supply/demand + realistic band per role per region; answers a question they cannot ("is this role fillable at this price?"). Anchors: `data/market_pulse.json`, `salary-band.ts`, `winnability`.
- **W2.5 Defensible sourcing trail** — lawful basis + Art. 14 notice per sourced candidate. Anchors: `consent.ts`, `provenance-dossier.ts`. *This is the counter to their 800M scraped pool, not an afterthought — build it with W2.1, not after.*

### W3 — Fit assessment, more defensible than theirs
- **W3.1** Candidate-completed **IPIP-NEO-120** (public domain) → Big Five scores. Self-report, **not inferred from CV or voice** — inference of traits from voice is emotion-recognition-adjacent under the AI Act and a high-risk classification we decline to take on. This is a *feature* of our posture, and a public argument against theirs.
- **W3.2** Work-values inventory + explicit company-values calibration. **Do not** ship individual-level Hofstede: it is a national-culture framework and applying it per person is contested. Name that in competitive material.
- **W3.3** Team-composition delta — reuse `group-eval-run.ts` + Group Eval Verdict & Fairness to project fit against the *actual* team, with the existing fairness gate.
- **W3.4** Guardrails — advisory-only, never auto-reject, every use written to the decision chain with attribution, AI-Act impact check surfaced (`compliance-regimes.ts`).

### W4 — AI economics & model governance *(rescoped per §1)*
Reframed from "fix the ledger" to **"productize the ledger nobody else has."**
- **W4.1 Tenant + subject attribution.** `llm_usage` (`db/core.ts:646`) has no org column and no job/candidate reference — it can cost the *workspace* but not a *hire*. Add tenant scoping + optional subject ref, backfill-safe.
- **W4.2 Customer-facing AI cost surface.** Cost per hire / per job / per use-case, exportable. Today `ModelsUsagePanel` is an internal settings panel; make it a buyer-facing artifact.
- **W4.3 BYOM completeness.** A BYOM tier that silently misses call sites is a broken promise. Tiger flags `github-analysis` as a TS-direct bypass. Add a **coverage test asserting every registered call site honours BYOM routing** so this cannot regress.
- **W4.4 Publish the benchmark methodology.** We run a blind-judge model benchmark (`pipeline/jobfit/llm/bench/*`, Lens 3, 4 sites). Publishing "here is how we chose each model, here is the eval you can re-run" is procurement-grade and unavailable from a black-box agent vendor.
- **W4.5 Metered billing hookup.** Ledger → `billing/entitlements.ts` overage, closing the loop between real cost and the $5 BYOM / $10 / $20 tiers.
- *(Also folds in bet 5: published interview-quality evidence from the voice-plane WER harness + text-plane eval framework — same trust-artifact family as W4.4.)*

### W5 — De-lock (multi-market)
Prerequisite for competing outside CZ/IT, per the 20-HR-cohort UAT finding: taxonomy beyond
IT, multi-currency comp (CZK is currently load-bearing), locale expansion (pl/sk/de/hu/ro —
`/i18n-translate` exists and `npm run i18n:check` guards parity), and **voice-interview**
language coverage including mid-interview language switch (A10 — more valuable than UI
locales, because it is what they demo).

### W6 — Post-hire, narrow
Skills graph from hire records + internal mobility only (B1, partial B2), reusing the match
engine and `db/skill-profiles.ts`. **Explicitly refuse** performance reviews, workforce
planning and succession (B3–B5) — different product, different buyer. Say so publicly:
"we are a hiring system, not an HCM" is sharper positioning than half an HCM.

### W7 — Two-sided (deferred)
Candidate/student mode per `docs/V2_PLAN.md`. Moat + acquisition channel; not this cycle.

---

## 7. Decision register

Answer before the dependent wave starts; each has a recommendation so work is never blocked
on silence.

| ID | Decision | Recommendation |
|---|---|---|
| **D1** | Unified ATS API vendor vs hand-built connectors | **Buy** a unified ATS API. 40 hand-built connectors is their moat, not ours; one integration reaches parity. |
| **D2** | Calendar: direct Google/MS OAuth vs Cronofy/Nylas | **Direct OAuth** for Google + Microsoft (covers ~all of our market), no vendor fee, no PII intermediary — which also strengthens the W0.5 trust story. |
| **D3** | W3 psychometrics: license a validated instrument vs public-domain IPIP | **IPIP** (public domain, validated, free) — their authority claim is unmatched either way, so spend the money elsewhere. |
| **D4** | Does W5 de-locking start in parallel now, or after W1? | **Parallel** — it is mostly data/content work and blocks revenue, not code. |
| **D5** | ISO 27001: start readiness now or after W1? | **Now** (readiness assessment only). Long lead time; it is a live deal-blocker vs their certification. |

---

## 8. Execution protocol

- **One wave = one ship-loop milestone.** State in `.claude/ship-loop/`; this doc holds the
  design, `state.md` holds progress.
- **Atomic commits per item ID** (`feat(w0.4): ...`), so a wave can partially land.
- **Full gate at the end of every wave**, no exceptions:
  `npm run typecheck && npm run lint && npm run test:unit && npm run test:python:gate && npm run build && npm run test:e2e && npm run i18n:check`
- **Both themes verified** for every new surface (`docs/DESIGN.md`; Studio Light + Spark Dark).
- **Tiger re-scan after W0 and W4** — those waves change LLM call sites; the vault must
  reflect it.
- **Context map**: read `context-map.json` before editing; regenerate from Vibeman after
  structural additions (W1 and W3 add new contexts).
- **Session reality:** W0 is fully executable now — it needs no third-party account. W1,
  and W2.1's connectors, need credentials, so they start once D1/D2 are answered.

---

## 9. Traceability — teardown gap → wave item

| Gap | Description | Wave item | Status |
|---|---|---|---|
| A2 | 800M external pool | W2.1, W2.2, W2.4 (sidestep) | ☐ |
| A3 | Outreach at scale + reply halt | W2.3 | ☐ |
| A5 | AI-native application | W0.7 packaging, W1.4 | ☐ |
| A7 / A8 / A9 | Big Five / Hofstede / team impact | W3.1, W3.2, W3.3 | ☐ |
| A10 | 12–14 languages, mid-interview switch | W5 | ☐ |
| A11 | Personalized rejection | W0.6 | ☐ |
| A12 | Zero-touch scheduling | W1.4 | ☐ |
| A13 | Anti-cheating (we lead) | W0.1, W0.2, W0.7 | ☐ |
| B1 / B2 | Skills graph, calibration | W6 | ☐ |
| B3–B5 | Reviews, planning, succession | **declined** | — |
| C1 / C2 | ATS + HCM connectors | W1.1, W1.2, W1.3 | ☐ |
| C3 | ISO 27001 / trust artifacts | W0.5, D5 | ☐ |
| C4 | Explainability (we lead) | W0.3, W0.5 | ☐ |
| C5 | Data posture (we lead) | W4.2, W4.3, W4.4 | ☐ |
| C6 | Proof / metrics | W0.4 | ☐ |
| C7 / C8 | Price + segment (we lead) | W0.7 | ☐ |
| tiger #11 | Devcase judge self-grades | W0.1 | ☐ |
| tiger #12 | Devcase grades blind | W0.2 | ☐ |
| tiger #13 | Group-eval seal traceability | W0.3 | ☐ |
