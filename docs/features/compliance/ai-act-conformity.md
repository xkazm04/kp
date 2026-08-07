# EU AI Act conformity pack — kp

Status: working conformity map + gap register + Annex IV technical-documentation
skeleton. Originally compiled 2026-07-27 against commit `283c5c1`; **re-verified
and corrected 2026-07-30** against the current tree (see "Corrections since
2026-07-27" below). Evidence is `file:line` or `file` into this repo, spot-checked
against current source — treat exact line numbers as approximate; several have
drifted by tens of lines since the pack was written as the surrounding code
grew. **This is an engineering artifact, not legal advice and not a claim of
certified conformance** — the product's own `/trust` page and
`app/_lib/trust-posture.ts` carry the same disclaimer, and that module is now
the single-sourced, tested, live projection of this map — prefer it when the
two disagree.

Clock: the AI Act's high-risk obligations apply in full from **2 August 2026**
(entered into force 1 Aug 2024; general application 2 Aug 2026, with Annex III
high-risk systems placed on the market before that date grandfathered only
until substantially modified). **That date is now three days away.**

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
(`docs/architecture/self-hosting.md`) may make the customer both if they substantially
modify the system. This pack tracks both sets of obligations because the
product ships controls for each.

---

## 2. Conformity map

Legend: 🟢 mechanism exists and is enforced in code · 🟡 partial · 🔴 absent.
Gap ids (G1…) resolve in §3.

| Obligation | Status | What exists (evidence) | Gaps |
|---|---|---|---|
| **Art. 9** Risk-management system | 🔴 | Nothing under `docs/` resembles a risk register, DPIA, or residual-risk analysis; only backlogged (`docs/product/enterprise-readiness.md`). | G1 |
| **Art. 10** Data & data governance | 🟡 | Consent lifecycle + TTL (`app/_lib/consent.ts` — `consentTtlDays`, `consentExpiresAt`, `consentStatus`), read-time PII gate + outreach suppression (`consent.ts:72` `consentWithholdsPii`), one-transaction erasure incl. transcript/scorecard/outbox/onboarding/rediscovery scrub (`app/_lib/db/pipeline.ts:1341` `scrubEntryLinkedPii`, `pipeline.ts:1400` `anonymizeEntry`), expiry sweep (`pipeline.ts:1471` `anonymizeExpiredConsents`), no-egress mode both halves (`app/_lib/offline.ts`, `pipeline/jobfit/llm/offline.py`), provider keys encrypted at rest (`app/_lib/db/core.ts` — around line 617, "UI-entered keys encrypted with KP_SECRET"). | G8 (no training/seed-data governance artifact), G12 (whole-DB export/import pre-multi-workspace) |
| **Art. 11 + Annex IV** Technical documentation | 🔴 | This document's §4 is the skeleton; no model card, no instructions-for-use published. | G2 |
| **Art. 12** Record-keeping (automatic logs) | 🟢/🟡 | Per-tenant tamper-evident decision chain: HMAC-SHA256 with key rotation + anti-downgrade + atomic seal (`app/_lib/decision-record-store.ts` — `sealDecisionRecord` ~L199, `verifyDecisionChain` ~L350, `heldOutEntryIds` ~L403); each record stamps kind, actor (`auto:scorecard-v5` vs `human:recruiter`), policyVersion, candidateRef, rationale, reasonCode, decisive inputs; operational log `pipeline_events` with honest auto/human attribution (`app/_lib/decision-attribution.ts`); `consent_events` append-only (`app/_lib/db/core.ts`); `llm_usage` ledger incl. `deterministic` source honesty (`core.ts`). | G4 (no `audit_events` for auth/config/PII-read/export), G6 (no retention window config), G7 (no SIEM/signed export) |
| **Art. 13** Transparency & instructions for use | 🟡 | Provenance dossier "for a compliance review under the EU AI Act" (`app/_lib/provenance-dossier.ts`); jurisdiction regime catalog with explicit not-legal-advice framing (`app/_lib/compliance-regimes.ts`); public compliance endpoint (`app/api/compliance/route.ts`); internal posture board at `/trust` (`app/trust/`, noindexed, see below). | G2 (no deployer instructions-for-use), and — **newly closed** — the candidate dossier gap (previously G9) is now partially addressed, see below |
| **Art. 14** Human oversight | 🟢 | Signed human-approval token on auto-reject waves — server recomputes and refuses on cohort drift, client-supplied approver ignored (`app/_lib/screen-wave-approval.ts`, `app/api/decisions/screen-wave/route.ts`); AUTO1 retired — unattended pass queues rejects for a human, never executes them (`app/_lib/automation-pass.ts:302-308`, comment explicitly titled "AUTO1 RETIRED (UAT M6 / GDPR Art. 22)"); approval-kind taxonomy fails closed on typos (`app/_lib/approval-kinds.ts`); advance-top-N stops before Offer (`app/api/pipeline/command/route.ts`); sticky group-eval governance — governed modes can't downgrade to auto-seal (`app/_lib/group-eval-governance.ts`); autonomy kill switch + arm-then-confirm (`app/_lib/dev-control.ts`, `app/control/ControlRoom.tsx`); human disposition captured on analyses (`app/_lib/db/core.ts`). | G5 (approver identity is a role string unless `KP_OPERATOR_NAME` is set — E0 identity layer now exists (`app/_lib/db/users.ts`, memberships) but `operatorApprover()` in `app/_lib/auth/operator-approver.ts` has not yet been threaded to the logged-in user) |
| **Art. 15** Accuracy, robustness, cybersecurity | 🟡→ improved | Calibration with honesty floor + Brier (`app/_lib/calibration.ts`); per-source label-leakage disclosure; deterministic clean-arm holdout, sealed and read back (`app/_lib/screen-wave-holdout.ts`, `decision-record-store.ts`); threshold changes sealed as human policy acts (`app/api/analytics/calibration/apply-threshold/route.ts:82` — `kind: "screening_threshold_adjusted"`); unevidenced skill claims discounted for all candidates (`pipeline/jobfit/transform.py`); fail-closed null scores (`app/_lib/match-score.ts`); tie-safe cutoffs + score-staleness flags (`screen-wave.ts`); weighting-robustness matrix (`app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` — path corrected, see below); bilingual-parity eval gates (`pipeline/jobfit/tests/test_tech_bilingual_parity.py`, confirmed present); **name/gender-proxy neutrality eval now exists** (`pipeline/jobfit/tests/test_name_neutrality.py`) — this closes what was G3. | G3 closed; G10 (no post-market drift monitoring beyond display) still open |
| **Art. 26** Deployer obligations | 🟡 | The product operationalizes the deployer's duties: oversight assignment via `KP_OPERATOR_NAME` (`app/_lib/auth/operator-approver.ts`), logs kept (chain never pruned), candidate information duties via the disclosure layer. | G2 (instructions-for-use is the vehicle for telling deployers *their* duties: worker-representative notification, Art. 27 FRIA for public bodies, log retention ≥ 6 months) |
| **Art. 50** Transparency (AI interaction) | 🟢 | `AiDisclosure` on quick/conversational/dev-case apply, voice portal, offer, schedule, **and now `/status/[token]` and `/onboarding/[token]`** (`app/_components/AiDisclosure.tsx`; `app/status/[token]/StatusClient.tsx:324`; `app/onboarding/[token]/OnboardingClient.tsx:239` — both comments cite "EU AI-Act pack G9/G11" directly); voice consent is server-enforced at credential mint AND transcript persist (`app/_lib/interview-consent.ts`, `app/api/interview/connect/route.ts`); "AI-led conversation" / "Reviewed by a human" chips (`app/interview/[token]/page.tsx`). | **G11 closed** (was the last uncovered candidate surface; both token pages now render `AiDisclosure`) |
| **Art. 72/73** Post-market monitoring & serious incidents | 🔴 | Absent — no incident log, no monitoring plan. | G10 |
| **Art. 86** Explanation of individual decisions | 🟡 (improved) | The sealed per-candidate dossier exists (`GET /api/decisions/records?candidate=…`) but stays operator-gated by design. **New:** `app/_lib/status-decisions.ts` derives a redacted `CandidateDecisionView` (kind, attribution, reasonCode, and — for auto-rejects — the decisive threshold facts) from the same sealed rows and renders it on `/status/[token]`; rejection copy is sourced from this record rather than generated. | G9 now **partially** closed — candidates get a structured explanation of their own decision; they still cannot browse the full sealed chain (by design, not a gap) |
| **GDPR Art. 22** (adjacent, load-bearing) | 🟢 | The whole oversight layer above is framed in-code as "no solely-automated significant decision" (`screen-wave-approval.ts`); fairness-cleared rejects still queue for a human (`automation-pass.ts`). | — |
| **Bias / non-discrimination** (Art. 10(2)(f)(g), Recital 56) | 🟡 | Fail-closed fairness gate: early-career AND unknown archetypes never auto-rejected, drift audited (`app/_lib/archetypes.ts` — `isFairnessProtected`, `isEarlyCareer`); defense-in-depth backstop re-derives the sole legitimate reject path (`app/_lib/automation-fairness.ts`); four-fifths primitive with small-cohort floor (`app/_lib/adverse-impact.ts`) — browser-only on pasted counts, nothing persisted; scope-honest copy everywhere ("the app holds no demographic data"); **name-neutrality eval now enforced** (see Art. 15 row). | G13 (document the no-demographic-data posture as the deliberate mitigation choice) |

---

## 3. Gap register (prioritized)

Effort: S ≤ 1 day · M ≤ 1 week · L longer. "By" = who owes it under the Act.
Struck-through items closed since 2026-07-27.

| # | Gap | Art. | By | Effort | Status |
|---|---|---|---|---|---|
| G1 | Risk-management document: hazard list (wrongful rejection, disparate impact, hallucinated evidence, automation complacency), mitigations (map to §2 mechanisms), residual risks, review cadence. Fold the DPIA into it. | 9 | Provider | M | **Open** — `docs/RISK_MANAGEMENT.md` not created |
| G2 | Annex IV technical documentation + deployer instructions-for-use (oversight duties, `KP_OPERATOR_NAME`, log retention ≥ 6 months, worker-info duties, Art. 27 FRIA note). §4 below is the skeleton. | 11, 13, 26 | Provider | M | **Open** — `docs/INSTRUCTIONS_FOR_USE.md` not created; highest-priority remaining doc gap given the 2026-08-02 date |
| ~~G3~~ | ~~Name/gender-proxy neutrality test on the scorer.~~ | 10, 15 | Provider | S-M | **Closed** — `pipeline/jobfit/tests/test_name_neutrality.py` asserts byte-identity of the deterministic scorer's output across Czech male/female(-ová)/Vietnamese/Ukrainian/Arabic/Roma-associated name perturbations |
| G4 | `audit_events` table (auth, role/config changes, PII reads, exports). | 12 | Provider | M | **Open** — no `audit_events` table anywhere in `app/` or `pipeline/` |
| G5 | Real reviewer identity on sealed records: `operatorApprover()` still returns `"operator (single-operator deployment)"` unless `KP_OPERATOR_NAME` is set (`app/_lib/auth/operator-approver.ts:11-13`). E0 identity layer exists (`app/_lib/db/users.ts`, memberships) but is not yet threaded through. | 14, 12 | Provider | S | **Open** |
| G6 | Log-retention window: chain is never pruned (fine) but retention is neither configured nor documented; Act minimum 6 months. Document "retained for the life of the workspace" + erasure carve-out (`pipeline.ts` scrub function explicitly excludes `decision_records`, citing Art. 17(3)(b)/(e)). | 12, 19, 26 | Both | S | **Open** — fold into G2 doc |
| G7 | Signed/SIEM audit export; today the only export is the whole-DB dump. | 12, 26 | Provider | M | **Open** |
| G8 | Training/seed-data governance artifact for `data/seed_calibration/` + market-pulse corpora. | 10 | Provider | S | **Open** |
| G9 | Candidate-facing explanation of an individual decision. | 86, 13 | Both | M | **Partially closed** — `app/_lib/status-decisions.ts` + `/status/[token]` now render a redacted per-decision explanation (kind, attribution, reason, decisive facts for auto-rejects). Full sealed dossier remains operator-only by design, not by gap. |
| G10 | Post-market monitoring + serious-incident process. | 72, 73 | Provider | M | **Open** |
| ~~G11~~ | ~~Add `AiDisclosure` to `/status/[token]` and `/onboarding/[token]`.~~ | 50 | Provider | S | **Closed** — both pages render `<AiDisclosure />`; each comment explicitly cites this gap by name |
| G12 | Per-tenant export/import (whole-DB today). | 10 | Provider | M | **Partially closed** — the decision chain itself is now per-tenant (`app/api/decisions/records/route.ts` comment: "Tenant (P1): integrity is PER-TENANT... each team has its own independent chain"). `app/api/workspace/export/route.ts` and `import/route.ts` remain explicit whole-DB dumps; the route's own comment flags this must be rebuilt before `KP_MULTI_WORKSPACE` ships. |
| G13 | Document the no-demographic-data posture as the deliberate bias-mitigation choice, its limits, and the deployer-side 4/5ths workflow (`app/_lib/adverse-impact.ts`). | 10 | Provider | S | **Open** |
| G14 | Registration + declaration-of-conformity scaffolding. Premature before G1/G2; keep on the E-track. | 47-49, 71 | Provider | L | **Open** |

Already adequate, keep as-is: the Art. 14 oversight layer, the Art. 12 decision
chain, voice-consent enforcement, GDPR erasure/consent machinery, KP_OFFLINE,
and now the name-neutrality eval and candidate-facing AI disclosure/explanation.

---

## 4. Annex IV technical-documentation skeleton

Each heading lists what fills it. Items marked ⏳ depend on a gap above.

1. **General description** — purpose (candidate screening/interview support for
   employment selection); provider; versions (`AUTOMATION_VERSION` map,
   `app/_lib/automation-run.ts:42`); hardware/deployment forms (SaaS,
   self-host Docker/Helm — `docs/architecture/self-hosting.md`); interaction with external
   systems (Gemini/Claude/OpenAI/ElevenLabs engines, relay webhook, Polar —
   see `SUBPROCESSORS` in `app/_lib/trust-posture.ts` for the current list).
2. **Detailed description of elements & development** —
   - design spec: `docs/_archive/AUTOMATION_SPEC.md`, `docs/product/enterprise-readiness.md`;
   - system architecture: Next.js app + Python jobfit pipeline; scoring
     pathway `pipeline/jobfit/` → `match-score.ts` → screen-wave;
   - ⏳ model cards for each engine/use-case, prompt-version registry (today
     only the version *label* is sealed, not the prompt text);
   - human-oversight measures: §2 Art. 14 row (largely done — cite it);
   - ⏳ training/seed-data description (G8).
3. **Monitoring, functioning, control** — accuracy metrics: calibration +
   Brier + holdout clean arm (§2 Art. 15 row); robustness: deterministic
   fallbacks, fail-closed nulls; ⏳ post-market monitoring plan (G10);
   foreseeable-misuse note (running waves without reading previews — mitigated
   by approval-token cohort binding).
4. **Appropriateness of performance metrics** — why Brier/reliability bins +
   outcome-based holdout; the label-leakage taxonomy is the honest-measurement
   argument; the name-neutrality eval (formerly ⏳ G3) is now shipped evidence
   here, not a gap.
5. **Risk-management system** — ⏳ G1 document, referenced here.
6. **Lifecycle changes** — the sealed policy chain (`screening_threshold_adjusted`
   records, `app/api/analytics/calibration/apply-threshold/route.ts:82`),
   `docs/_archive/SCORING_REBASELINE.md` as the model-change discipline precedent, git
   history + CI gate.
7. **Standards applied** — none claimed yet; ⏳ list harmonized standards when
   adopted (otherwise describe the §2 mechanisms as the chosen means).
8. **EU declaration of conformity** — ⏳ G14 template.
9. **Detailed description of the system's logging capabilities** — §2 Art. 12
   row verbatim: chain schema (`decision-record-store.ts`), sealed-kind
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
  token; do not script around it with bypass-style env flags).
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
Since this pack was first compiled, three more code-level items closed: the
**name-neutrality eval (G3)**, **AI disclosure on the last two candidate
surfaces (G11)**, and a **redacted candidate decision-explanation view (G9,
partially)**. What remains is almost entirely **documentation and process**
— risk management (G1), Annex IV + instructions-for-use (G2), monitoring/
incident runbooks (G10) — plus `audit_events` + reviewer identity (G4/G5) and
per-tenant export/import (G12, decision-chain half already done). None of the
remaining code gaps is architecturally hard; the documentation gaps are
writing work with evidence that already exists in the codebase. With the
2026-08-02 applicability date now days away, **G1 and G2 are the sequencing
priority** — they are the documents an auditor or enterprise customer's legal
team asks for first, and nothing else on this list blocks writing them today.

---

## Corrections since 2026-07-27

Re-verified against the tree on 2026-07-30 (feature-structure refactor,
tenancy work, decision/rejection-reason and candidate-NPS features have
landed since). Corrections applied in this rewrite:

- **Wrong path**: the original cited
  `app/features/sub_decisions/group-eval/FairnessPanel.tsx`, which does not
  exist. The real component is
  `app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx`.
- **G3 was open, now closed**: `pipeline/jobfit/tests/test_name_neutrality.py`
  exists and its own docstring cites this pack's G3/G10 by name as the reason
  it was written.
- **G11 was open, now closed**: both `app/status/[token]/StatusClient.tsx`
  and `app/onboarding/[token]/OnboardingClient.tsx` render `<AiDisclosure />`,
  each with a comment citing the gap it closes.
- **G9 was fully open, now partially closed**: `app/_lib/status-decisions.ts`
  is new since the pack was written and its header explicitly frames itself
  as addressing "docs/AI_ACT_CONFORMITY.md G11" (the code comment mislabels
  it G11 rather than G9 — this doc corrects the cross-reference; the content
  is squarely an Art. 86 candidate-explanation mechanism).
- **G12 nuance**: the decision chain is now explicitly per-tenant
  (`app/api/decisions/records/route.ts` comment), narrowing G12 to the
  export/import routes specifically rather than the whole data-governance
  story.
- **Line-number drift**: most cited files still exist and still contain the
  named functions, but exact line ranges have shifted (by single digits to
  ~40 lines in the busiest files — `decision-record-store.ts`, `core.ts`,
  `pipeline.ts`) as unrelated work landed. Ranges above are corrected where
  verified; some are given as function names / approximate lines rather than
  exact spans to reduce future staleness.
- No obligation dropped in status (no 🟢 regressed to 🟡 or 🔴); the map only
  improved.
