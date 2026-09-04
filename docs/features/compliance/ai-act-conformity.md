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
| **Art. 10** Data & data governance | 🟡 | Consent lifecycle + TTL (`app/_lib/consent.ts` — `consentTtlDays`, `consentExpiresAt`, `consentStatus`), read-time PII gate + outreach suppression (`consent.ts:72` `consentWithholdsPii`), one-transaction erasure incl. transcript/scorecard/outbox/rediscovery scrub (plus the retired onboarding tables where a pre-removal database still has them) (`app/_lib/db/pipeline.ts:1341` `scrubEntryLinkedPii`, `pipeline.ts:1400` `anonymizeEntry`), expiry sweep (`pipeline.ts:1471` `anonymizeExpiredConsents`), no-egress mode both halves (`app/_lib/offline.ts`, `pipeline/jobfit/llm/offline.py`), provider keys encrypted at rest (`app/_lib/db/core.ts` — around line 617, "UI-entered keys encrypted with KP_SECRET"). | G8 (no training/seed-data governance artifact), G12 (whole-DB export/import pre-multi-workspace) |
| **Art. 11 + Annex IV** Technical documentation | 🔴 | This document's §4 is the skeleton; no model card, no instructions-for-use published. | G2 |
| **Art. 12** Record-keeping (automatic logs) | 🟢/🟡 | Per-tenant tamper-evident decision chain: HMAC-SHA256 with key rotation + anti-downgrade + atomic seal (`app/_lib/decision-record-store.ts` — `sealDecisionRecord` ~L199, `verifyDecisionChain` ~L350, `heldOutEntryIds` ~L403); each record stamps kind, actor (`auto:scorecard-v5` vs `human:recruiter`), policyVersion, candidateRef, rationale, reasonCode, decisive inputs; the auto-reject and holdout arms of a wave now seal the SAME policyVersion the approval token bound (family-floor map and holdout rate included), so a reject record joins back to its approval; `verifyDecisionChain` re-hashes incrementally from an in-process per-workspace checkpoint with a scheduled full re-hash (`CHAIN_FULL_VERIFY_INTERVAL_MS`), reporting `verifiedFromSeq` / `fullyVerified` so a partial re-hash is never presented as the full proof; operational log `pipeline_events` with honest auto/human attribution (`app/_lib/decision-attribution.ts`); `consent_events` append-only (`app/_lib/db/core.ts`); `llm_usage` ledger incl. `deterministic` source honesty (`core.ts`). | G4 (no `audit_events` for auth/config/PII-read/export), G6 (no retention window config), G7 (no SIEM/signed export) |
| **Art. 13** Transparency & instructions for use | 🟡 | Provenance dossier "for a compliance review under the EU AI Act" (`app/_lib/provenance-dossier.ts`); jurisdiction regime catalog with explicit not-legal-advice framing (`app/_lib/compliance-regimes.ts`); public compliance endpoint (`app/api/compliance/route.ts`); internal posture board at `/trust` (`app/trust/`, noindexed, see below). | G2 (no deployer instructions-for-use), and — **newly closed** — the candidate dossier gap (previously G9) is now partially addressed, see below |
| **Art. 14** Human oversight | 🟢 | Signed human-approval token on auto-reject waves — server recomputes and refuses on cohort drift, client-supplied approver ignored, and the token is **spent on commit** so one review authorizes one wave rather than a 15-minute window of them (`consumeScreenWaveApprovalToken`, `app/_lib/screen-wave-approval.ts`; the 409 carries a machine-readable `reason` from `SCREEN_WAVE_REFUSAL_REASONS`, `app/api/decisions/screen-wave/route.ts`); AUTO1 retired — unattended pass queues rejects for a human, never executes them (`app/_lib/automation-pass.ts:302-308`, comment explicitly titled "AUTO1 RETIRED (UAT M6 / GDPR Art. 22)"); approval-kind taxonomy fails closed on typos (`app/_lib/approval-kinds.ts`); advance-top-N stops before Offer (`app/api/pipeline/command/route.ts`); sticky group-eval governance — governed modes can't downgrade to auto-seal (`app/_lib/group-eval-governance.ts`); autonomy pause, **single-click by design** and scoped to the case-lifecycle orchestrator (`app/_lib/dev-control.ts` `getAutonomy`, read only at `app/_lib/devcase-orchestrator.ts:104`; the arm-then-confirm guard in `app/control/ControlRoom.tsx` is on **Reconcile**, not on pause — `app/control/AutonomyBar.tsx:6-8` states the reasoning); human disposition captured on analyses (`app/_lib/db/core.ts`). | **G5 mostly closed** — `resolveApprover()` names the signed-in person, and the bulk-rejection wave now REFUSES to commit rather than seal an approval it cannot attribute (`isNamedApprover()` at `app/_lib/screen-wave.ts`, commit only); the audit table badges the historical role-only records instead of rewriting them. Residual: single-candidate seals stay role-attributed by design, plus two role-only call sites (see G5 in §3); **G15 closed** — the pause is now a real Art. 14(4)(e) stop control: `instrumentation-node.ts` reads `getAutonomy()` once per tick (`clockIsPaused`) and, while paused, skips every discretionary pass (inbound pull + edge drain, scheduling policy pass, interview reminders, offer lapse, offer reminders), records one `clock_halted` audit row on the transition, and still writes its liveness heartbeat so a pause cannot be mistaken for a wedged clock. The GDPR consent-expiry sweep is the one **documented exemption** (see G15 in §3) |
| **Art. 15** Accuracy, robustness, cybersecurity | 🟡→ improved | Calibration with honesty floor + Brier (`app/_lib/calibration.ts`); per-source label-leakage disclosure; deterministic clean-arm holdout, sealed and read back (`app/_lib/screen-wave-holdout.ts`, `decision-record-store.ts`); threshold changes sealed as human policy acts (`app/api/analytics/calibration/apply-threshold/route.ts:82` — `kind: "screening_threshold_adjusted"`); unevidenced skill claims discounted for all candidates (`pipeline/jobfit/transform.py`); fail-closed null scores (`app/_lib/match-score.ts`); tie-safe cutoffs + score-staleness flags (`screen-wave.ts`); weighting-robustness matrix (`app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` — path corrected, see below); bilingual-parity eval gates (`pipeline/jobfit/tests/test_tech_bilingual_parity.py`, confirmed present); **name/gender-proxy neutrality eval now exists** (`pipeline/jobfit/tests/test_name_neutrality.py`) — this closes what was G3. | G3 closed; G10 (no post-market drift monitoring beyond display) still open |
| **Art. 26** Deployer obligations | 🟡 | The product operationalizes the deployer's duties: oversight assignment via `KP_OPERATOR_NAME` (`app/_lib/auth/operator-approver.ts`), logs kept (chain never pruned), candidate information duties via the disclosure layer. | G2 (instructions-for-use is the vehicle for telling deployers *their* duties: worker-representative notification, Art. 27 FRIA for public bodies, log retention ≥ 6 months) |
| **Art. 50** Transparency (AI interaction) | 🟢 | `AiDisclosure` on quick/conversational/dev-case apply, voice portal, offer, schedule, **and now `/status/[token]`** (`app/_components/AiDisclosure.tsx`; `app/status/[token]/StatusClient.tsx:324` — the comment cites "EU AI-Act pack G9/G11" directly). (`/onboarding/[token]` carried it too until the post-hire onboarding module was removed with that surface.) Voice consent is server-enforced at credential mint AND transcript persist (`app/_lib/interview-consent.ts`, `app/api/interview/connect/route.ts`); "AI-led conversation" / "Reviewed by a human" chips (`app/interview/[token]/page.tsx`). | **G11 closed** (was the last uncovered candidate surface; every surviving candidate surface renders `AiDisclosure`) |
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
| G5 | Real reviewer identity on sealed records. | 14, 12 | Provider | S | **Mostly closed.** Three layers now: (1) the E0 identity layer is threaded — `resolveApprover()` / `humanActor()` name the signed-in person (`app/_lib/auth/operator-approver.ts`); (2) **the bulk-rejection wave now REFUSES to commit rather than seal an approval nobody owns** — `isNamedApprover()` + `NAMED_APPROVER_REQUIRED` (same file) gate the seal path at `app/_lib/screen-wave.ts` (commit only; a dry run still previews), so the state that produced the 08-17 host's 66 unattributed records is no longer reachable for the highest-stakes decision, and the refusal names both doors (sign in, or set `KP_OPERATOR_NAME`); (3) sealed records are never rewritten, so the audit table MARKS the historical ones instead — the actor column runs `parseEventActor` and badges a role-only actor (`app/features/insights/analytics/sections/DecisionRecordsTable.tsx`, `analytics.decisionRecords.actorRoleOnly`). Residual: single-candidate seals still fall back to `human:recruiter` by design (refusing them would remove the one-at-a-time human review), and two role-only call sites remain (`app/api/analytics/calibration/apply-threshold/route.ts`; the reinstate/scorecard/schedule seals under `app/api/pipeline/[id]` and `app/api/schedule`). Guards: `app/_lib/screen-wave-guards.test.ts` §5, `app/_lib/trust-posture.test.ts` |
| G6 | Log-retention window: chain is never pruned (fine) but retention is neither configured nor documented; Act minimum 6 months. Document "retained for the life of the workspace" + erasure carve-out (`pipeline.ts` scrub function explicitly excludes `decision_records`, citing Art. 17(3)(b)/(e)). | 12, 19, 26 | Both | S | **Open** — fold into G2 doc |
| G7 | Signed/SIEM audit export; today the only export is the whole-DB dump. | 12, 26 | Provider | M | **Open** |
| G8 | Training/seed-data governance artifact for `data/seed_calibration/` + market-pulse corpora. | 10 | Provider | S | **Open** |
| G9 | Candidate-facing explanation of an individual decision. | 86, 13 | Both | M | **Partially closed** — `app/_lib/status-decisions.ts` + `/status/[token]` now render a redacted per-decision explanation (kind, attribution, reason, decisive facts for auto-rejects). Full sealed dossier remains operator-only by design, not by gap. |
| G10 | Post-market monitoring + serious-incident process. | 72, 73 | Provider | M | **Open** |
| ~~G11~~ | ~~Add `AiDisclosure` to `/status/[token]` and `/onboarding/[token]`.~~ | 50 | Provider | S | **Closed** — both pages rendered `<AiDisclosure />`, each citing this gap by name. `/onboarding/[token]` has since been removed with the post-hire module; `/status/[token]` still renders it |
| G12 | Per-tenant export/import. | 10 | Provider | M | **Closed** — the decision chain is per-tenant (`app/api/decisions/records/route.ts`: "integrity is PER-TENANT... each team has its own independent chain"), and `app/api/workspace/export/route.ts` / `import/route.ts` now move ONE ORGANIZATION (`dumpOrg` / `restoreOrg`), scoped by the tenancy manifest (`orgExportClass`) and gated on `org:manage`. Round trip pinned by `app/_lib/db-portability-org.test.ts`. Two documented limits remain, both surfaced to the operator rather than silent: the restore is in-place (same deployment), and six singleton config tables carry no `org_id` so a backup cannot carry them (`ORG_CONFIG_NOT_PORTABLE`). |
| G13 | Document the no-demographic-data posture as the deliberate bias-mitigation choice, its limits, and the deployer-side 4/5ths workflow (`app/_lib/adverse-impact.ts`). | 10 | Provider | S | **Open** |
| G14 | Registration + declaration-of-conformity scaffolding. Premature before G1/G2; keep on the E-track. | 47-49, 71 | Provider | L | **Open** |
| G16 | `AiDisclosure` asserts a human-in-the-loop the config can turn off. The body reads "A human reviews and makes every advance, offer, and rejection decision; nothing adverse is decided automatically." The FIRST clause is false whenever a workspace sets an interview-plan gate to `auto`: `app/_lib/automation-run.ts` then ratifies an advance unattended via `actOnPipelineEntry` with `actor: "system"` (decision kind `auto_advanced`, actor `auto:interview-plan`), and the offer branch extends an offer with no human in the loop. The component renders UNCONDITIONALLY on eight public candidate surfaces (`/apply/[id]`, `/apply/[id]/quick`, `/devcase/apply/[token]`, `/interview/[token]`, `/schedule/[token]`, `/status/[token]`, `/offer/[token]`, InterviewSimTab). Scope, honestly: the schema default is `human` (`decision-config-schema.ts`), so a DEFAULT install tells the truth — this is false only where an operator opted into an auto gate. The SECOND clause survives: auto mode never overrides a hold or reject, and auto-reject is human-triggered from Decisions. So the defect is the human-in-the-loop claim, not the adversity claim. | 50, 13 | Provider | M | **Open** — found by the scan-sweep of 2026-08-25 |
| ~~G15~~ | ~~Widen the autonomy pause into a real Art. 14(4)(e) stop control.~~ | 14 | Provider | M | **Closed (2026-08-22)** — see below |

Already adequate, keep as-is: the Art. 12 decision
chain, voice-consent enforcement, GDPR erasure/consent machinery, KP_OFFLINE,
and now the name-neutrality eval and candidate-facing AI explanation. The
disclosure itself is no longer in that list — see G16: its text is correct for a
default install and false for one that opted into an auto gate, which is the same
claim-outran-the-code shape G15 was.
The Art. 14 oversight layer is adequate on its *decision* gates (nothing adverse
happens without a human), and since 2026-08-22 also on the pause's REACH — G15 is
closed.

### G15 in detail — what the pause now stops, and the one thing it does not

`app/_lib/dev-control.ts` `getAutonomy()` used to have exactly one behavioural
consumer (`app/_lib/devcase-orchestrator.ts`), so an operator who pressed Pause
during an incident still had the server clock sending candidate-facing interview and
offer reminders, lapsing live offers, running the scheduling policy pass and filing
inbound leads — while the Control Room said "Paused" and the copy beside the button
promised to "halt all automation immediately".

`instrumentation-node.ts` now reads the flag once per tick (`clockIsPaused`), and the
scope is a stated decision rather than an accident of which module imported
`dev-control`:

- **Halted while paused** — every discretionary pass: the L0 pull pass and the L1 edge
  drain (both file leads through the intake core, which dispatches a candidate-facing
  acknowledgement), the scheduling policy pass, interview reminders, offer lapse and
  offer reminders. Nothing is lost by halting them: pull cursors advance only over
  applied events, the edge holds its log until acked, reminders re-become due, and an
  offer's expiry is applied lazily on the candidate's own read anyway.
- **Exempt** — the GDPR consent-expiry sweep (`anonymizeExpiredConsents`). This is not
  an automated *decision* about a candidate, which is what the Art. 14 oversight
  surface governs; it is the execution of a statutory retention duty (storage
  limitation, GDPR Art. 5(1)(e)) once the lawful basis has lapsed. Continuing to hold
  identifiable data past consent expiry IS the unlawful state, so a UI toggle able to
  suspend the scrub would let an operator park a deployment in it indefinitely. The
  sweep also destroys nothing a human decision needs — it de-identifies and keeps
  stage/score/notes. A future per-candidate, audited "legal hold" belongs on the
  consent record, not on this pause.
- **Always** — the liveness heartbeat, so `schedulerLiveness` still distinguishes a
  PAUSED clock from a WEDGED one. A pause must not look like a crash.
- **Fail-closed** — if the autonomy flag cannot be read, the tick halts. Every gated
  sweep needs the same SQLite file the flag does, so halting costs nothing, and a stop
  control that keeps going when it cannot read its own flag is not a stop control.
- **Audited** — one `clock_halted` / `clock_resumed` row in `dev_audit` per transition
  (not per tick: at a 1-minute cadence that would bury the Art. 12 chain).

Follow-up, tracked here rather than left implicit: the public projection in
`app/_lib/trust-posture.ts` (Art. 14 `gap`) still describes the pre-fix scope. It now
UNDER-claims the control, which is the safe direction, but it should be updated —
together with the pinned comment in `app/_lib/trust-posture.test.ts`, whose assertion
requires the Art. 14 row to keep naming *some* pause-related gap.

---

## 4. Annex IV technical-documentation skeleton

Each heading lists what fills it. Items marked ⏳ depend on a gap above.

1. **General description** — purpose (candidate screening/interview support for
   employment selection); provider; versions (`AUTOMATION_VERSION` map,
   `app/_lib/automation-run.ts:42`); hardware/deployment forms (SaaS,
   self-host Docker/Helm — `docs/architecture/self-hosting.md`); interaction with external
   systems (Gemini/Claude/OpenAI/ElevenLabs engines, relay webhook, Polar —
   see `SUBPROCESSORS` in `app/_lib/trust-posture.ts` for the current list).
   **That list is now held against the product's own provider catalog**: each row
   carries the `LLM_PROVIDERS` ids it discloses, and `trust-posture.test.ts` fails
   when a provider the app can route to has no row (which is how the `qwen`
   adapter — a configurable remote endpoint — shipped undisclosed) or when a row
   claims a provider that does not exist. `/trust` also states `LAST_REVIEWED`, the
   day the posture was last read against the code; the AI Act's application date is
   a fact about the regulation, not about the page.
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

- Give every reviewer a signed-in account whose profile carries a name, or set
  `KP_OPERATOR_NAME`, so oversight is assigned to named natural persons —
  Art. 26(2). Not optional for the screening wave: a bulk rejection whose
  approver cannot be named is refused rather than sealed.
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

- **Overclaimed control (2026-08-22)**: the Art. 14 row read "autonomy kill
  switch + arm-then-confirm", and the public projection in
  `app/_lib/trust-posture.ts` rendered that as "a kill switch arms and confirms
  separately". Both halves were false. The pause is **single-click by design**
  (`app/control/AutonomyBar.tsx:6-8` — "an oversight surface must be able to halt
  automation instantly"); the arm-then-confirm guard sits on **Reconcile**, which
  mutates lifecycle state. And it was **scoped**: `getAutonomy()` gated only
  `devcase-orchestrator.ts`, while the clock kept running five timed passes.
  Both the row and the public summary were corrected to say what the code does,
  and the scope was registered as G15 rather than left implied. The code half of
  G15 was then closed the same day — see "G15 in detail" in §3.
- **Wrong path**: the original cited
  `app/features/sub_decisions/group-eval/FairnessPanel.tsx`, which does not
  exist. The real component is
  `app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx`.
- **G3 was open, now closed**: `pipeline/jobfit/tests/test_name_neutrality.py`
  exists and its own docstring cites this pack's G3/G10 by name as the reason
  it was written.
- **G11 was open, now closed**: `app/status/[token]/StatusClient.tsx` renders
  `<AiDisclosure />` with a comment citing the gap it closes.
  `app/onboarding/[token]/OnboardingClient.tsx` did the same until the
  post-hire onboarding module was removed and that surface with it.
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
