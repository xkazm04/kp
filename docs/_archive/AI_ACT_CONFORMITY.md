> **Archived 2026-07-30.** This was the original conformity pack (compiled
> 2026-07-27, commit `283c5c1`). Superseded by the re-verified, corrected
> version at `docs/features/compliance/ai-act-conformity.md` — several
> citations here had drifted (a wrong FairnessPanel path, gaps G3/G11 that
> have since shipped, G9 partially closed). Kept for historical diffing only;
> do not treat its gap statuses as current.

# EU AI Act conformity pack — kp

Status: working conformity map + gap register + Annex IV technical-documentation
skeleton. Compiled 2026-07-27 against commit `283c5c1` (evidence is `file:line`
into this repo). **This is an engineering artifact, not legal advice and not a
claim of certified conformance** — the product's own landing copy carries the
same disclaimer (`messages/en.json → landing.trust.footnote`).

Clock: the AI Act's high-risk obligations apply in full from **2 August 2026**
(entered into force 1 Aug 2024; general application 2 Aug 2026, with Annex III
high-risk systems placed on the market before that date grandfathered only
until substantially modified).

---

## 1. Classification

kp screens, scores, ranks, interviews, and helps decide on job candidates.
That is **Annex III point 4 (employment, workers management and access to
self-employment)**, both limbs:

- **4(a)** — "AI systems intended to be used for the recruitment or selection
  of natural persons, in particular to place targeted job advertisements, to
  analyse and filter job applications, and to **evaluate candidates**": CV
  analysis + match scoring (`pipeline/jobfit/`, `app/_lib/match-score.ts`),
  screening waves (`app/_lib/screen-wave.ts`), AI voice interviews with AI
  scorecards (`app/api/interview/complete/route.ts`), group evaluation
  (`app/_lib/group-eval-run.ts`).
- **4(b)** — decisions affecting the promotion/termination and task allocation
  side is out of scope for kp today (candidate-side only), but offer decisions
  and pipeline advancement fall under selection.

**Conclusion: kp is a high-risk AI system.** The derogation of Art. 6(3)
(narrow procedural tasks / preparatory activities) does not apply: the score
materially shapes reject/advance outcomes by design.

**Roles.** The kp vendor is the **provider** (Art. 16 chain: Art. 9–15,
Annex IV, conformity assessment, registration). A customer running kp on their
candidates is a **deployer** (Art. 26). Self-hosted installs
(`docs/SELF_HOSTING.md`) may make the customer both if they substantially
modify the system. This pack tracks both sets of obligations because the
product ships controls for each.

---

## 2. Conformity map

Legend: 🟢 mechanism exists and is enforced in code · 🟡 partial · 🔴 absent.
Gap ids (G1…) resolve in §3.

| Obligation | Status | What exists (evidence) | Gaps |
|---|---|---|---|
| **Art. 9** Risk-management system | 🔴 | Nothing under `docs/` resembles a risk register, DPIA, or residual-risk analysis; only backlogged (`docs/ENTERPRISE_READINESS.md` E-GDPR-2). | G1 |
| **Art. 10** Data & data governance | 🟡 | Consent lifecycle + TTL (`app/_lib/consent.ts:8-62`), read-time PII gate + outreach suppression (`consent.ts:64-103`), one-transaction erasure incl. transcript/scorecard/outbox scrub (`app/_lib/db/pipeline.ts:1310-1388`), expiry sweep (`pipeline.ts:1391-1404`), no-egress mode both halves (`app/_lib/offline.ts`, `pipeline/jobfit/llm/offline.py`), provider keys encrypted at rest (`app/_lib/db/core.ts:594-612`). | G8 (no training/seed-data governance artifact), G12 (whole-DB export/import pre-multi-workspace) |
| **Art. 11 + Annex IV** Technical documentation | 🔴 | This document's §4 is the skeleton; no model card, no instructions-for-use. | G2 |
| **Art. 12** Record-keeping (automatic logs) | 🟢/🟡 | Per-tenant tamper-evident decision chain: HMAC-SHA256 with key rotation + anti-downgrade + atomic seal (`app/_lib/decision-record-store.ts:66-386`); each record stamps kind, actor (`auto:scorecard-v5` vs `human:recruiter`), policyVersion, candidateRef, rationale, reasonCode, decisive inputs (`decision-record-store.ts:21-29,166-177`; `app/_lib/screen-wave.ts:371-420`); operational log `pipeline_events` with honest auto/human attribution (`app/_lib/decision-attribution.ts:17-138`); `consent_events` append-only (`app/_lib/db/core.ts:818-831`); `llm_usage` ledger incl. `deterministic` source honesty (`core.ts:614-638`). | G4 (no `audit_events` for auth/config/PII-read/export), G6 (no retention window config), G7 (no SIEM/signed export) |
| **Art. 13** Transparency & instructions for use | 🟡 | Provenance dossier "for a compliance review under the EU AI Act" (`app/_lib/provenance-dossier.ts:4-55`); jurisdiction regime catalog with explicit not-legal-advice framing (`app/_lib/compliance-regimes.ts:1-107`); public compliance endpoint (`app/api/compliance/route.ts`); README/docs describe engines and keyless degradation. | G2 (no deployer instructions-for-use), G9 (dossier recruiter-only) |
| **Art. 14** Human oversight | 🟢 | Signed human-approval token on auto-reject waves — server recomputes and refuses on cohort drift, client-supplied approver ignored (`app/_lib/screen-wave-approval.ts:3-32`, `screen-wave.ts:278-290`, `app/api/decisions/screen-wave/route.ts:43-72`); AUTO1 retired — unattended pass queues rejects for a human, never executes them (`app/_lib/automation-pass.ts:248-313`); approval-kind taxonomy fails closed on typos (`app/_lib/approval-kinds.ts:9-29`); advance-top-N stops before Offer (`app/api/pipeline/command/route.ts:126-142`); bulk reject bound to the previewed id set (`route.ts:82-96`); sticky group-eval governance — governed modes can't downgrade to auto-seal (`app/_lib/group-eval-governance.ts:20-45`); autonomy kill switch + arm-then-confirm (`app/_lib/dev-control.ts:68-77`, `app/control/ControlRoom.tsx:171-184`); human reversal sealed as `reinstated` (`app/api/pipeline/[id]/route.ts:114-121`); human disposition captured on analyses (`app/_lib/db/core.ts:206-213`). | G5 (approver identity is a role string unless `KP_OPERATOR_NAME` set) |
| **Art. 15** Accuracy, robustness, cybersecurity | 🟡 | Calibration with honesty floor + Brier (`app/_lib/calibration.ts:1-70`); per-source label-leakage disclosure (`calibration.ts:344-400`); deterministic clean-arm holdout, sealed and read back (`app/_lib/screen-wave-holdout.ts:1-73`, `decision-record-store.ts:388-421`); threshold changes sealed as human policy acts (`app/api/analytics/calibration/apply-threshold/route.ts:80-87`); unevidenced skill claims discounted for all candidates (`pipeline/jobfit/transform.py:182-189`, `docs/SCORING_REBASELINE.md`); fail-closed null scores — no `?? 0` (`app/_lib/match-score.ts:1-41`); tie-safe cutoffs + score-staleness flags + CAS no-ops (`screen-wave.ts:194-236,388-403`); weighting-robustness matrix with honest degenerate states (`app/features/sub_decisions/group-eval/FairnessPanel.tsx:11-60`); bilingual-parity eval gates (`pipeline/jobfit/tests/test_tech_bilingual_parity.py`). | G3 (no name/gender-proxy neutrality test — the most sensitive untested invariant), G10 (no post-market drift monitoring beyond display) |
| **Art. 26** Deployer obligations | 🟡 | The product operationalizes the deployer's duties: oversight assignment via `KP_OPERATOR_NAME` (`app/_lib/auth/operator-approver.ts:4-13`), logs kept (chain never pruned), candidate information duties via the disclosure layer. | G2 (instructions-for-use is the vehicle for telling deployers *their* duties: worker-representative notification, Art. 27 FRIA for public bodies, log retention ≥ 6 months) |
| **Art. 50** Transparency (AI interaction) | 🟢/🟡 | `AiDisclosure` on quick/conversational/dev-case apply, voice portal, offer, schedule (`app/_components/AiDisclosure.tsx`; coverage list in inventory); voice consent is server-enforced at credential mint AND transcript persist (`app/_lib/interview-consent.ts:1-52`, `app/api/interview/connect/route.ts:151-162`); "AI-led conversation" / "Reviewed by a human" chips (`app/interview/[token]/page.tsx:59-76`). | G11 (`/status/[token]` and `/onboarding/[token]` carry no disclosure) |
| **Art. 72/73** Post-market monitoring & serious incidents | 🔴 | Absent — no incident log, no monitoring plan. | G10 |
| **Art. 86** Explanation of individual decisions | 🟡 | The sealed per-candidate dossier exists (`GET /api/decisions/records?candidate=…`, `app/api/decisions/records/route.ts:20-40`) but is operator-gated; `/status/[token]` shows stage prose only. | G9 |
| **GDPR Art. 22** (adjacent, load-bearing) | 🟢 | The whole oversight layer above is framed in-code as "no solely-automated significant decision" (`screen-wave-approval.ts:3-23`); fairness-cleared rejects still queue for a human (`automation-pass.ts:300-312`). | — |
| **Bias / non-discrimination** (Art. 10(2)(f)(g), Recital 56) | 🟡 | Fail-closed fairness gate: early-career AND unknown archetypes never auto-rejected, drift audited (`app/_lib/archetypes.ts:35-82`, `screen-wave.ts:263,304-311`); defense-in-depth backstop re-derives the sole legitimate reject path (`app/_lib/automation-fairness.ts:1-67`); four-fifths primitive with small-cohort floor (`app/_lib/adverse-impact.ts:1-192`) — but browser-only on pasted counts, nothing persisted; scope-honest copy everywhere ("the app holds no demographic data"). | G3, G13 (no bias monitoring over the platform's own decisions — deliberate no-demographic-data posture; document it as the chosen mitigation) |

---

## 3. Gap register (prioritized)

Effort: S ≤ 1 day · M ≤ 1 week · L longer. "By" = who owes it under the Act.

| # | Gap | Art. | By | Effort | Where it lands |
|---|---|---|---|---|---|
| G1 | Risk-management document: hazard list (wrongful rejection, disparate impact, hallucinated evidence, automation complacency), mitigations (map to §2 mechanisms), residual risks, review cadence. Fold the DPIA (E-GDPR-2) into it. | 9 | Provider | M | new `docs/RISK_MANAGEMENT.md`; backlog 43 |
| G2 | Annex IV technical documentation + deployer instructions-for-use (oversight duties, `KP_OPERATOR_NAME`, log retention ≥ 6 months, worker-info duties, Art. 27 FRIA note). §4 below is the skeleton. | 11, 13, 26 | Provider | M | fill §4; ship as `docs/INSTRUCTIONS_FOR_USE.md` |
| G3 | Name/gender-proxy neutrality test on the scorer — flagged untested since 2026-06-25 (`docs/harness/ambiguity-biz-2026-06-25/pipeline-test-suite-python.md:28`). Perturbation eval: same CV, swapped names/pronouns ⇒ score delta ≈ 0. | 10, 15 | Provider | S-M | `pipeline/jobfit/tests/` + eval gate |
| G4 | `audit_events` table (auth, role/config changes, PII reads, exports) — named in the roadmap (E-AUD-2) but unbuilt. | 12 | Provider | M | backlog 42 |
| G5 | Real reviewer identity on sealed records: `actor` degrades to `"operator (single-operator deployment)"`; E0 identity layer now exists (`app/_lib/db/users.ts`, memberships) — thread the logged-in user into `operatorApprover()`. | 14, 12 | Provider | S | backlog 42 |
| G6 | Log-retention window: chain is never pruned (fine) but retention is neither configured nor documented; Act minimum 6 months (Art. 12/19/26(6)). Document "retained for the life of the workspace" + erasure carve-out (`pipeline.ts:1310-1320` keeps the chain through GDPR erasure — state the legal basis: adverse-action defense / Art. 17(3)(e)). | 12, 19, 26 | Both | S | G2 doc |
| G7 | Signed/SIEM audit export (E-AUD-3); today the only export is the whole-DB dump. | 12, 26 | Provider | M | backlog 42 |
| G8 | Training/seed-data governance artifact for `data/seed_calibration/` + market-pulse corpora: provenance, representativeness, known biases. | 10 | Provider | S | G2 doc annex |
| G9 | Candidate-facing explanation of an individual decision (Art. 86): scope a redacted read of the sealed dossier onto the candidate token surface; today it is operator-only and ignores consent/anonymization state. | 86, 13 | Both | M | new backlog item 52 |
| G10 | Post-market monitoring + serious-incident process: incident log, drift alarm on calibration/holdout divergence, reporting runbook (15-day clock). | 72, 73 | Provider | M | new backlog item 53 |
| G11 | Add `AiDisclosure` to `/status/[token]` and `/onboarding/[token]` (only uncovered candidate surfaces). | 50 | Provider | S | new backlog item 52 |
| G12 | Per-tenant export/import (whole-DB today, guarded by mode-checks — `app/api/workspace/{export,import}/route.ts`); prerequisite for multi-tenant data-governance claims. | 10 | Provider | M | existing E0 follow-up |
| G13 | Document the no-demographic-data posture as the deliberate bias-mitigation choice, its limits (no disparate-impact monitoring possible in-product), and the deployer-side 4/5ths workflow (`ComplianceSection.tsx`). Jurisdictions demanding audits (NYC LL144) need the deployer path. | 10 | Provider | S | G1/G2 docs |
| G14 | Registration + declaration-of-conformity scaffolding (EU database entry, CE marking path). Premature before G1/G2; keep on the E-track. | 47-49, 71 | Provider | L | E-track |

Already adequate, keep as-is: the Art. 14 oversight layer, the Art. 12 decision
chain, voice-consent enforcement, GDPR erasure/consent machinery, KP_OFFLINE.

---

## 4. Annex IV technical-documentation skeleton

Each heading lists what fills it. Items marked ⏳ depend on a gap above.

1. **General description** — purpose (candidate screening/interview support for
   employment selection); provider; versions (`AUTOMATION_VERSION` map,
   `app/_lib/automation-run.ts:36-53`); hardware/deployment forms (SaaS,
   self-host Docker/Helm — `docs/SELF_HOSTING.md`); interaction with external
   systems (Gemini/Claude/OpenAI/ElevenLabs engines, relay webhook, Polar).
2. **Detailed description of elements & development** —
   - design spec: `docs/AUTOMATION_SPEC.md`, `docs/ENTERPRISE_READINESS.md`;
   - system architecture: Next.js app + Python jobfit pipeline; scoring
     pathway `pipeline/jobfit/` → `match-score.ts` → screen-wave;
   - ⏳ model cards for each engine/use-case (13 LLM call sites — tiger
     inventory), prompt-version registry (today only the version *label* is
     sealed, not the prompt text);
   - human-oversight measures: §2 Art. 14 row (this is largely done — cite it);
   - ⏳ training/seed-data description (G8).
3. **Monitoring, functioning, control** — accuracy metrics: calibration +
   Brier + holdout clean arm (§2 Art. 15 row); robustness: deterministic
   fallbacks, CAS, fail-closed nulls; ⏳ post-market monitoring plan (G10);
   foreseeable-misuse note (running waves without reading previews — mitigated
   by approval-token cohort binding).
4. **Appropriateness of performance metrics** — why Brier/reliability bins +
   outcome-based holdout; the label-leakage taxonomy (`calibration.ts:344-400`)
   is the honest-measurement argument; ⏳ name-neutrality eval (G3).
5. **Risk-management system** — ⏳ G1 document, referenced here.
6. **Lifecycle changes** — the sealed policy chain (`screening_threshold_adjusted`
   records), `docs/SCORING_REBASELINE.md` as the model-change discipline
   precedent, git history + CI gate.
7. **Standards applied** — none claimed yet; ⏳ list harmonized standards when
   adopted (otherwise describe the §2 mechanisms as the chosen means).
8. **EU declaration of conformity** — ⏳ G14 template.
9. **Detailed description of the system's logging capabilities** — §2 Art. 12
   row verbatim: chain schema (`decision-record-store.ts:121-161`), sealed-kind
   call-site list, `pipeline_events`, `consent_events`, `llm_usage`; ⏳ G4
   `audit_events`; ⏳ G6 retention statement.

---

## 5. Deployer quick-sheet (until G2 ships as its own doc)

A customer operating kp on real candidates must, at minimum:

- Set `KP_OPERATOR_NAME` (and per-user identities once G5 lands) so oversight
  is assigned to named natural persons — Art. 26(2).
- Keep the decision chain: do not prune the SQLite DB below 6 months of
  decision history — Art. 26(6); kp never prunes it by itself.
- Ensure candidates see the disclosure surfaces (do not fork them out) and
  answer human-review requests within their process — Art. 26(7), GDPR Art. 22.
- Run screening only from previewed, approved waves (the product enforces the
  token; do not script around it with `KP_SKIP_GATE`-style bypasses).
- Public-body or public-service deployers: complete a fundamental-rights
  impact assessment before first use — Art. 27.
- Where local law requires bias audits (e.g. NYC LL144), use the adverse-impact
  worksheet (`Decisions → Compliance`) with externally collected demographic
  counts; kp itself holds none.

---

## 6. Verdict

kp's engineering posture is unusually strong on the two obligations that are
hardest to retrofit — **human oversight (Art. 14)** and **tamper-evident
record-keeping (Art. 12)** — and honest to a fault in its user-facing claims.
What is missing is almost entirely **documentation and process** (risk
management, Annex IV, instructions-for-use, monitoring/incident runbooks) plus
three code-level items: the name-neutrality eval (G3), `audit_events` +
reviewer identity (G4/G5), and candidate-facing disclosure/explanation
completion (G9/G11). None of the code gaps is architecturally hard; the
documentation gaps are writing work with evidence that already exists in the
codebase. Sequencing: G3 + G11 (small, code, this sprint) → G1/G2 (the
documents auditors ask for first) → G4/G5/G7 with the E2 audit epic → G10/G14
on the enterprise track.
