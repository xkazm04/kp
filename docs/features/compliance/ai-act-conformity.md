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

Clock: **the Annex III high-risk obligations apply from 2 December 2027**, not
2 August 2026. **Regulation (EU) 2026/1744** (the "AI Omnibus") entered into
force **27 July 2026** and moved the date; Annex I product-embedded systems move
further, to 2 August 2028. Verified against the Commission's own page on
2026-09-08:
<https://digital-strategy.ec.europa.eu/en/policies/regulatory-framework-ai>.
This pack asserted 2 August 2026 until 2026-09-08 and reasoned from its
imminence; every such passage has been re-baselined.

**What did not move, and therefore binds today:**

| Regime | Status | Exposure |
|---|---|---|
| **Art. 5 prohibitions**, incl. 5(1)(f) emotion inference in the workplace | In force 2 Feb 2025; penalties from 2 Aug 2025 | €35M / 7%. No safeguard cures a breach — oversight and disclosure are irrelevant to a prohibition. |
| **Art. 50 transparency** — disclosure 50(1), synthetic-content marking 50(2) | Applied 2 Aug 2026; the **marking** grace period for pre-existing systems ends **2 December 2026** | €15M / 3%. The only 2026 deadline kp actually has. |
| **Art. 4 AI literacy** | In force 2 Feb 2025, enforceable from 2 Aug 2026; softened by the Omnibus to an *effort* obligation | Low, and currently uncovered. |

**The deferral is a 15-month runway, not a reprieve — and grandfathering is not
available to kp.** Art. 111 grandfathers high-risk systems placed on the market
before the applicability date *only until they are substantially modified*. kp
ships continuously, and any material change to scoring or automation voids it.
No conformity strategy here may rest on Art. 111; plan for full applicability on
**2 December 2027** and treat the runway as the time in which Tier 6 of
[`regulatory-backlog.md`](./regulatory-backlog.md) — the documentation chain —
gets written.

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

**The JD builder and the role-intake flow are inside the system too.** This pack
omitted them until 2026-09-08, which was the single largest classification error
in it — Annex III 4(a) names *"to place targeted job advertisements"* in the same
breath as evaluating candidates, and the components are these:

- `app/_lib/jd-build-run.ts` + `app/_lib/jd-build-start.ts`, entered at
  `app/api/jds/generate/route.ts`, take a **high-level need description**
  (`JdBuildInput.needText`) and generate the role's responsibilities and required
  skills themselves.
- `app/_lib/intake-brief.ts` projects a conversational `RoleBrief` onto those same
  inputs — `briefMustSkills` / `briefNiceSkills` / `briefStatedRequirements`
  produce the graded must-have / nice-to-have requirement set the build consumes.
- The build then **files a matchable `jd-<slug>` opening into the workspace's
  corpus** (stated in `jd-build-start.ts`'s own header), which is precisely what
  `app/_lib/match-score.ts` and the screening wave score CVs against.

Two reasons this is not carved out, both from the **draft** Commission guidelines
on the Art. 6 classification of high-risk AI systems (19 May 2026 — **still a
draft, not adopted**; the Art. 6(5) guidelines are targeted for end-2026, and
this paragraph is re-checked when they land):

1. A JD generator that **derives the required qualifications itself** from a
   high-level description, *and* feeds a scorer that evaluates CVs against the JD
   it wrote, is **not** a narrow procedural task under Art. 6(3)(a). It is not
   formatting or transcribing a requirement a human set; it sets the requirement.
2. A component that would qualify for the filter **on its own** loses it when it
   forms part of a complex system whose joint outputs materially influence a
   decision in a high-risk use case. kp's builder does both things at once, so
   neither escape is open.

**Product consequence worth recording now:** if kp ever wants to ship the JD
library as a standalone low-risk product, the paragraph above is the
specification of what it would have to stop doing — the builder would have to
stop deriving qualifications (take them only as the recruiter typed them), or
stop feeding the scorer (no `jd-<slug>` opening in the matchable corpus).
Doing one is arguably enough; doing neither is not a defensible split.

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
| **Art. 13** Transparency & instructions for use | 🟡 | Provenance dossier "for a compliance review under the EU AI Act" (`app/_lib/provenance-dossier.ts`); jurisdiction regime catalog with explicit not-legal-advice framing (`app/_lib/compliance-regimes.ts`); public compliance endpoint (`app/api/compliance/route.ts`); the posture board at `/trust` (`app/trust/`) — **public and indexed since 2026-08-05**, reversing the 2026-07-30 internal-for-now call (`app/trust/page.tsx` records the flip; the route is in `app/sitemap.ts` and `app/_lib/auth/public-routes.ts`). | G2 (no deployer instructions-for-use), and — **newly closed** — the candidate dossier gap (previously G9) is now partially addressed, see below |
| **Art. 14** Human oversight | 🟢 | Signed human-approval token on auto-reject waves — server recomputes and refuses on cohort drift, client-supplied approver ignored, and the token is **spent on commit** so one review authorizes one wave rather than a 15-minute window of them (`consumeScreenWaveApprovalToken`, `app/_lib/screen-wave-approval.ts`; the 409 carries a machine-readable `reason` from `SCREEN_WAVE_REFUSAL_REASONS`, `app/api/decisions/screen-wave/route.ts`); AUTO1 retired — unattended pass queues rejects for a human, never executes them (`app/_lib/automation-pass.ts:302-308`, comment explicitly titled "AUTO1 RETIRED (UAT M6 / GDPR Art. 22)"); approval-kind taxonomy fails closed on typos (`app/_lib/approval-kinds.ts`); advance-top-N stops before Offer (`app/api/pipeline/command/route.ts`); sticky group-eval governance — governed modes can't downgrade to auto-seal (`app/_lib/group-eval-governance.ts`); autonomy pause, **single-click by design** and scoped to the case-lifecycle orchestrator (`app/_lib/dev-control.ts` `getAutonomy`, read only at `app/_lib/devcase-orchestrator.ts:104`; the arm-then-confirm guard in `app/control/ControlRoom.tsx` is on **Reconcile**, not on pause — `app/control/AutonomyBar.tsx:6-8` states the reasoning); human disposition captured on analyses (`app/_lib/db/core.ts`). | **G5 mostly closed** — `resolveApprover()` names the signed-in person, and the bulk-rejection wave now REFUSES to commit rather than seal an approval it cannot attribute (`isNamedApprover()` at `app/_lib/screen-wave.ts`, commit only); the audit table badges the historical role-only records instead of rewriting them. Residual: single-candidate seals stay role-attributed by design, plus two role-only call sites (see G5 in §3); **G15 closed** — the pause is now a real Art. 14(4)(e) stop control: `instrumentation-node.ts` reads `getAutonomy()` once per tick (`clockIsPaused`) and, while paused, skips every discretionary pass (inbound pull + edge drain, scheduling policy pass, interview reminders, offer lapse, offer reminders), records one `clock_halted` audit row on the transition, and still writes its liveness heartbeat so a pause cannot be mistaken for a wedged clock. The GDPR consent-expiry sweep is the one **documented exemption** (see G15 in §3) |
| **Art. 15** Accuracy, robustness, cybersecurity | 🟡→ improved | Calibration with honesty floor + Brier (`app/_lib/calibration.ts`); per-source label-leakage disclosure; deterministic clean-arm holdout, sealed and read back (`app/_lib/screen-wave-holdout.ts`, `decision-record-store.ts`); threshold changes sealed as human policy acts (`app/api/analytics/calibration/apply-threshold/route.ts:82` — `kind: "screening_threshold_adjusted"`); unevidenced skill claims discounted for all candidates (`pipeline/jobfit/transform.py`); fail-closed null scores (`app/_lib/match-score.ts`); tie-safe cutoffs + score-staleness flags (`screen-wave.ts`); weighting-robustness matrix (`app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` — path corrected, see below); bilingual-parity eval gates (`pipeline/jobfit/tests/test_tech_bilingual_parity.py`, confirmed present); **name/gender-proxy neutrality eval now exists** (`pipeline/jobfit/tests/test_name_neutrality.py`) — this closes what was G3. | G3 closed; G10 (no post-market drift monitoring beyond display) still open |
| **Art. 26** Deployer obligations | 🟡 | The product operationalizes the deployer's duties: oversight assignment via `KP_OPERATOR_NAME` (`app/_lib/auth/operator-approver.ts`), logs kept (chain never pruned), candidate information duties via the disclosure layer. | G2 (instructions-for-use is the vehicle for telling deployers *their* duties: worker-representative notification, Art. 27 FRIA for public bodies, log retention ≥ 6 months) |
| **Art. 50** Transparency (AI interaction) | 🟢 | `AiDisclosure` on quick/conversational/dev-case apply, voice portal, offer, schedule, **and now `/status/[token]`** (`app/_components/AiDisclosure.tsx`; `app/status/[token]/StatusClient.tsx:324` — the comment cites "EU AI-Act pack G9/G11" directly). (`/onboarding/[token]` carried it too until the post-hire onboarding module was removed with that surface.) Voice consent is server-enforced at credential mint AND transcript persist (`app/_lib/interview-consent.ts`, `app/api/interview/connect/route.ts`); "AI-led conversation" / "Reviewed by a human" chips (`app/interview/[token]/page.tsx`). | **G11 closed** (was the last uncovered candidate surface; every surviving candidate surface renders `AiDisclosure`) |
| **Art. 72/73** Post-market monitoring & serious incidents | 🔴 | Absent — no incident log, no monitoring plan. | G10 |
| **Art. 86** Explanation of individual decisions | 🟡 (improved) | The sealed per-candidate dossier exists (`GET /api/decisions/records?candidate=…`) but stays operator-gated by design. **New:** `app/_lib/status-decisions.ts` derives a redacted `CandidateDecisionView` (kind, attribution, reasonCode, and — for auto-rejects — the decisive threshold facts) from the same sealed rows and renders it on `/status/[token]`; rejection copy is sourced from this record rather than generated. | G9 now **partially** closed — candidates get a structured explanation of their own decision; they still cannot browse the full sealed chain (by design, not a gap) |
| **GDPR Art. 22** (adjacent, load-bearing) | 🟢 | The whole oversight layer above is framed in-code as "no solely-automated significant decision" (`screen-wave-approval.ts`); fairness-cleared rejects still queue for a human (`automation-pass.ts`). | — |
| **Bias / non-discrimination** (Art. 10(2)(f)(g), Recital 56) | 🟡 | Fail-closed fairness gate: early-career AND unknown archetypes never auto-rejected, drift audited (`app/_lib/archetypes.ts` — `isFairnessProtected`, `isEarlyCareer`); defense-in-depth backstop re-derives the sole legitimate reject path (`app/_lib/automation-fairness.ts`); four-fifths primitive with small-cohort floor (`app/_lib/adverse-impact.ts`) — browser-only on pasted counts, nothing persisted; scope-honest copy everywhere ("the app holds no demographic data"); **name-neutrality eval now enforced** (see Art. 15 row). | G13 closed |

---

## 3. Gap register (prioritized)

Effort: S ≤ 1 day · M ≤ 1 week · L longer. "By" = who owes it under the Act.
Struck-through items closed since 2026-07-27.

| # | Gap | Art. | By | Effort | Status |
|---|---|---|---|---|---|
| G1 | Risk-management document: hazard list (wrongful rejection, disparate impact, hallucinated evidence, automation complacency), mitigations (map to §2 mechanisms), residual risks, review cadence. Fold the DPIA into it. | 9 | Provider | M | **Open** — `docs/RISK_MANAGEMENT.md` not created |
| G2 | Annex IV technical documentation + deployer instructions-for-use (oversight duties, `KP_OPERATOR_NAME`, log retention ≥ 6 months, worker-info duties, Art. 27 FRIA note). §4 below is the skeleton. | 11, 13, 26 | Provider | M | **Open** — `docs/INSTRUCTIONS_FOR_USE.md` not created; still the highest-priority remaining doc gap, now on the merits rather than on a date (see §6). The deployer-role half of it is partly discharged already: `docs/architecture/self-hosting.md` §1a now states the provider/deployer split and kp's foreseen-configuration envelope |
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
| ~~G13~~ | ~~Document the no-demographic-data posture as the deliberate bias-mitigation choice, its limits, and the deployer-side 4/5ths workflow (`app/_lib/adverse-impact.ts`).~~ | 10 | Provider | S | **Closed (2026-09-08)** — written up below ("G13 in detail"). The Omnibus’s tightening of Art. 10(5) / new Art. 4a raised its value: collecting no special-category data means kp owes no exceptional-circumstances justification. The cost — kp cannot measure its own disparate impact — is stated rather than implied. |
| G14 | Registration (Art. 49 EU database) + Annex V declaration of conformity + CE marking, off an Art. 43 internal-control assessment. | 43, 47-49, 71 | Provider | L | **Open — and no longer "premature".** It was deferred behind G1/G2 on the reading that a conformity assessment was years out; **15 months is exactly the horizon on which one gets planned**, not deferred. Two things make it cheaper than the old L suggests: the Omnibus makes an **SME / small-mid-cap simplified technical-documentation template** available, and kp is comfortably inside that threshold; and Art. 43 for Annex III point 4 is **internal control** — no notified body. G1/G2 remain the inputs, so the sequence is unchanged; what changed is that G14 now has a date to work back from. |
| ~~G16~~ | ~~`AiDisclosure` asserts a human-in-the-loop the config can turn off.~~ The body read "A human reviews and makes every advance, offer, and rejection decision; nothing adverse is decided automatically." The FIRST clause was false whenever a workspace set an interview-plan gate to `auto`: `app/_lib/automation-run.ts` ratifies an advance unattended via `actOnPipelineEntry` with `actor: "system"` (decision kind `auto_advanced`, actor `auto:interview-plan`), and the offer branch extends an offer with no human in the loop. It rendered UNCONDITIONALLY on eight public candidate surfaces (`/apply/[id]`, `/apply/[id]/quick`, `/devcase/apply/[token]`, `/interview/[token]`, `/schedule/[token]`, `/status/[token]`, `/offer/[token]`, InterviewSimTab), in four locales. | 50, 13 | Provider | M | **Closed (2026-09-08)** — the copy now states the one absolute it earns (a rejection is always a person's, and no setting can delegate it) and carries "by default" on advance and offer with the delegation named, in all four catalogs. It is pinned by `app/_components/ai-disclosure-copy.test.ts`, which fails if the retired absolute returns or if the rejection guarantee is dropped. Found by the scan-sweep of 2026-08-25; the landing page had retired the same sentence on 2026-08-28 and the candidate-facing copy outlived it by ten days. |
| ~~G15~~ | ~~Widen the autonomy pause into a real Art. 14(4)(e) stop control.~~ | 14 | Provider | M | **Closed (2026-08-22)** — see below |

Already adequate, keep as-is: the Art. 12 decision
chain, voice-consent enforcement, GDPR erasure/consent machinery, KP_OFFLINE,
and now the name-neutrality eval and candidate-facing AI explanation. The
disclosure has since JOINED that list — see G16, closed 2026-09-08. Until then its
text was correct for a default install and false for one that had opted into an auto
gate, which is the same claim-outran-the-code shape G15 was; it now states the one
absolute it earns and hedges the two it does not.
The Art. 14 oversight layer is adequate on its *decision* gates (nothing adverse
happens without a human), and since 2026-08-22 also on the pause's REACH — G15 is
closed.

### G13 in detail — why kp holds no demographic data, and what that costs

Closed 2026-09-08 by writing it down. The posture always existed; what was missing
was the statement that it is a **choice**, with its price named. An undocumented
absence reads to a reviewer as an oversight, and this one is the opposite.

**The choice.** kp collects no race, sex, age, disability, religion or union data,
and derives none. It does not ask for a date of birth, and the CV photo is redacted
before egress on the blind path. There is no protected-attribute column anywhere in
the schema for an automated decision to correlate with.

**What that buys, and the Omnibus has just made it worth more.** Art. 10(5) — with
the new Art. 4a — permits processing special categories *for the purpose of bias
detection and correction* only "in exceptional circumstances, where strictly
necessary and subject to safeguards". The Omnibus **restored a stricter standard**
than the proposal sought. A vendor that collects demographics to measure its own
fairness now owes an exceptional-circumstances justification, an access-control and
retention regime around the most sensitive data it holds, and a GDPR Art. 9 basis
for holding it at all. kp owes none of that, because it processes none. The cheapest
way to survive a rule about sensitive data is not to have any.

**How fairness is tested instead: perturbation, not collection.**
`pipeline/jobfit/tests/test_name_neutrality.py` asserts **byte-identity** of the
deterministic scorer's output across Czech male, Czech female (`-ová`), Vietnamese,
Ukrainian, Arabic and Roma-associated name variants of the same candidate. That is a
direct test of the proxy that actually leaks — the name — and it needs no protected
attribute to run. `test_tech_bilingual_parity.py` does the same for language.
`app/_lib/archetypes.ts` adds a fail-closed shield: early-career and unknown
archetypes are never auto-rejected, and `app/_lib/automation-fairness.ts` re-derives
the sole legitimate reject path as a defence in depth.

**The price, stated plainly.** kp **cannot measure its own disparate impact.** A
four-fifths analysis needs aggregate counts per protected group, and kp has none, so
no dashboard in this product can tell a deployer whether their hiring outcomes are
skewed. Perturbation testing proves the scorer does not react to a name; it does not
prove that outcomes across a real population are balanced, and those are different
claims. Anyone who says otherwise is overselling.

**What fills the gap: the deployer's own workflow.** `app/_lib/adverse-impact.ts` is
a pure, stateless four-fifths primitive with a minimum-cohort floor, deliberately
browser-only and persisting nothing. A deployer who holds their own aggregate EEO
counts — from a separate voluntary survey, kept outside kp — can compute the ratio
against kp's selection outcomes without those counts ever entering the candidate
store. The module's header carries the same honest ceiling.

**What would reopen this.** A customer obligation to report demographic outcomes
from the product itself (some public-sector and US federal-contractor regimes do
require it), or a supervisory authority reading Art. 10(2)(f)/(g) to require
measured bias detection rather than designed-out bias exposure. Either would mean
building a separated, consent-based, aggregate-only demographic store — and the
Art. 10(5) exceptional-circumstances justification to go with it. Neither has
happened, and until one does, collecting nothing is both the safer and the cheaper
posture.

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

The public projection in `app/_lib/trust-posture.ts` has since caught up: its Art. 14
`gap` now describes the post-fix scope (every discretionary pass halted, the
consent-expiry sweep named as the one deliberate exemption). This section previously
carried a follow-up note saying the projection still described the pre-fix scope; that
note was stale and is removed. The pinned assertion in `app/_lib/trust-posture.test.ts`
still requires the Art. 14 row to name *some* pause-related gap, and the exemption is
what it names.

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
writing work with evidence that already exists in the codebase.

**G1 and G2 remain the sequencing priority, but the reason has changed.** Until
2026-09-08 this verdict rested on an applicability date days away; that date is
now 2 December 2027 (see the Clock above). The conclusion survives the
re-baselining on three grounds that never depended on the date:

1. **They are the documents asked for first** — by an auditor, by an enterprise
   customer's legal team, by a German works council exercising BetrVG § 80(3),
   and by every RFP that reaches a regulated employer. None of those wait for
   December 2027.
2. **They are the inputs to everything downstream.** G14 (registration,
   declaration of conformity, CE marking) is assembled *from* G1 and G2, and 15
   months is the horizon on which that assembly gets planned rather than
   deferred — which is why G14 is no longer marked premature.
3. **kp cannot buy time with Art. 111.** Grandfathering ends at the first
   substantial modification, and a continuously-shipped scoring product
   modifies itself materially several times a quarter. The runway is 15 months
   of writing, not 15 months of waiting.

What the deferral genuinely changes is the *order of urgency between regimes*,
not the order within this list: Art. 5, Art. 50 (marking grace ends 2 December
2026) and the national employment layer bind today and outrank every Annex III
row above. Those live in Tiers 1–5 of
[`regulatory-backlog.md`](./regulatory-backlog.md); this pack is the Annex III
map they sit above.

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
