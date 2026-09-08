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
| **Art. 4 AI literacy** | In force 2 Feb 2025, enforceable from 2 Aug 2026; softened by the Omnibus from a duty to *ensure* literacy to one to *take measures to support* its development, with an express clarification that no specific level need be guaranteed | Low. Now **named** in two documents and **discharged** by none — see the Art. 4 row in §2 and G23. |

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

**Coverage of this map, stated so a reviewer does not have to count.** Until
2026-09-08 the table below carried roughly **11** of the ~20 articles that bind a
provider, and §6's verdict — "what remains is almost entirely documentation" — was
drawn from that partial list. Art. 17 (the QMS), 18, 19, 20, 21, 25, 43, 47/48,
plus Art. 4 and Art. 5, were absent entirely; Art. 50 was scored on its 50(1) limb
only, which hid the single obligation on this map with a **2026** deadline. Those
rows are added below and §6 is re-drawn from the complete list. Ordering is by
article number; the two non-Annex-III rows (GDPR Art. 22, bias) stay at the end.

| Obligation | Status | What exists (evidence) | Gaps |
|---|---|---|---|
| **Art. 4** AI literacy | 🔴 | **Nothing in the product.** Two documents now *name* the duty and pass it to the customer — `docs/architecture/self-hosting.md:173` ("AI literacy for the recruiters who use it", correctly flagged as softened by the Omnibus and correctly filed under the deployer's duties) and `app/_lib/trust-posture.ts:54` (in the "what still binds today" copy). That is the whole of it: verified 2026-09-08 by a full-text search for "AI literacy" across `app/`, `docs/` and `messages/` — six hits, all of them either this pack, the backlog, or those two lines. There is **no literacy material**: nothing tells a recruiter what the match score is and is not, no onboarding content, no in-product explanation of the model's limits at the point a score is read. Naming an obligation is not discharging it. **The trap to avoid**: this is not Art. 26(2). Art. 26(2) — assign oversight to natural persons with the necessary **competence, training and authority** — was *not* softened by the Omnibus, lands on the deployer, and kp already enforces its sharp end (`isNamedApprover()`, see the Art. 14 row). Art. 4 is a much weaker, effort-shaped obligation, and it binds kp for its **own** staff as well as reaching deployers' recruiters through the material kp ships. | G23 |
| **Art. 5** Prohibited practices — 5(1)(f) emotion inference in the workplace | 🟢 | **kp does not infer emotion, for three independent structural reasons, and all three are now pinned by `pipeline/jobfit/tests/test_ai_act_emotion_inference.py`** (382 lines; `ScorecardPromptTest` + `RubricHasNoAffectAxisTest`, 10 tests). (1) **The input** — the interview persists a *transcript* and never audio, so no prosodic signal (pitch, tremor, pause length, vocal energy) ever reaches the scorer; the analyzer physically cannot hear the candidate, and this is the strong reason. (2) **The rubric** — the test walks every scored competency in `interview-rubrics.json` against a two-tier affect vocabulary: HARD terms (`emotion*`, `sentiment*`, `mood*`, `prosod*`, `demeano*`, `nerv*`, `enthusias*`, `charisma`, `personality`, …) banned in a competency's name, description or anchor; AXIS_ONLY terms banned only where they *name a rated dimension*, so a legitimate anchor is never failed for a word choice. Two calibration tests keep that vocabulary honest in both directions — one asserts it bites, one asserts it does not bite legitimate competencies. (3) **The instruction** — `automation.interview_scorecard` tells the model to rate substance and never lower a rating for nerves, hesitation, filler words, silences, a slow start or imperfect grammar/accent, and the test asserts that sentence against the prompt **a provider actually receives**, across every rubric variant. Gated: `pipeline/jobfit/tests/run_gated.py` discovers the whole test directory, so this runs in `npm run test:python:gate`. One judgement is recorded rather than defined away — `industryAxes.frontline_service` mentions "composure under pressure" and "attitude"; both are in AXIS_ONLY, so the moment either becomes a rated dimension the file fails, which is exactly where the judgement should be re-made. **Why pinned rather than trusted:** a breach of Art. 5 is unlawful *per se* — €35M / 7%, in force since 2 February 2025, penalties since 2 August 2025 — and per the Commission's prohibited-practices guidelines (C(2025) 884) **no safeguard cures it**. Human oversight, candidate consent, a confirmation gate, a disclosure and an accuracy claim are all irrelevant to conduct the Act forbids outright. "A recruiter reviews every scorecard" is not a defence, so the invariant cannot live in a prompt nobody tests. | — |
| **Art. 9** Risk-management system | 🔴 | Nothing under `docs/` resembles a risk register, DPIA, or residual-risk analysis; only backlogged (`docs/product/enterprise-readiness.md`). | G1 |
| **Art. 10** Data & data governance | 🟡 | Consent lifecycle + TTL (`app/_lib/consent.ts` — `consentTtlDays`, `consentExpiresAt`, `consentStatus`), read-time PII gate + outreach suppression (`consent.ts:72` `consentWithholdsPii`), one-transaction erasure incl. transcript/scorecard/outbox/rediscovery scrub (plus the retired onboarding tables where a pre-removal database still has them) (`app/_lib/db/pipeline.ts:1341` `scrubEntryLinkedPii`, `pipeline.ts:1400` `anonymizeEntry`), expiry sweep (`pipeline.ts:1471` `anonymizeExpiredConsents`), no-egress mode both halves (`app/_lib/offline.ts`, `pipeline/jobfit/llm/offline.py`), provider keys encrypted at rest (`app/_lib/db/core.ts` — around line 617, "UI-entered keys encrypted with KP_SECRET"). | G8 (no training/seed-data governance artifact), G12 (whole-DB export/import pre-multi-workspace) |
| **Art. 11 + Annex IV** Technical documentation | 🔴 | This document's §4 is the skeleton; no model card, no instructions-for-use published. | G2 |
| **Art. 12** Record-keeping (automatic logs) | 🟢/🟡 | Per-tenant tamper-evident decision chain: HMAC-SHA256 with key rotation + anti-downgrade + atomic seal (`app/_lib/decision-record-store.ts` — `sealDecisionRecord` ~L199, `verifyDecisionChain` ~L350, `heldOutEntryIds` ~L403); each record stamps kind, actor (`auto:scorecard-v5` vs `human:recruiter`), policyVersion, candidateRef, rationale, reasonCode, decisive inputs; the auto-reject and holdout arms of a wave now seal the SAME policyVersion the approval token bound (family-floor map and holdout rate included), so a reject record joins back to its approval; `verifyDecisionChain` re-hashes incrementally from an in-process per-workspace checkpoint with a scheduled full re-hash (`CHAIN_FULL_VERIFY_INTERVAL_MS`), reporting `verifiedFromSeq` / `fullyVerified` so a partial re-hash is never presented as the full proof; operational log `pipeline_events` with honest auto/human attribution (`app/_lib/decision-attribution.ts`); `consent_events` append-only (`app/_lib/db/core.ts`); `llm_usage` ledger incl. `deterministic` source honesty (`core.ts`). | G4 (no `audit_events` for auth/config/PII-read/export), G6 (no retention window config), G7 (no SIEM/signed export) |
| **Art. 13** Transparency & instructions for use | 🟡 | Provenance dossier "for a compliance review under the EU AI Act" (`app/_lib/provenance-dossier.ts`); jurisdiction regime catalog with explicit not-legal-advice framing (`app/_lib/compliance-regimes.ts`); public compliance endpoint (`app/api/compliance/route.ts`); the posture board at `/trust` (`app/trust/`) — **public and indexed since 2026-08-05**, reversing the 2026-07-30 internal-for-now call (`app/trust/page.tsx` records the flip; the route is in `app/sitemap.ts` and `app/_lib/auth/public-routes.ts`). | G2 (no deployer instructions-for-use), and — **newly closed** — the candidate dossier gap (previously G9) is now partially addressed, see below |
| **Art. 14** Human oversight | 🟢 | Signed human-approval token on auto-reject waves — server recomputes and refuses on cohort drift, client-supplied approver ignored, and the token is **spent on commit** so one review authorizes one wave rather than a 15-minute window of them (`consumeScreenWaveApprovalToken`, `app/_lib/screen-wave-approval.ts`; the 409 carries a machine-readable `reason` from `SCREEN_WAVE_REFUSAL_REASONS`, `app/api/decisions/screen-wave/route.ts`); AUTO1 retired — unattended pass queues rejects for a human, never executes them (`app/_lib/automation-pass.ts:302-308`, comment explicitly titled "AUTO1 RETIRED (UAT M6 / GDPR Art. 22)"); approval-kind taxonomy fails closed on typos (`app/_lib/approval-kinds.ts`); advance-top-N stops before Offer (`app/api/pipeline/command/route.ts`); sticky group-eval governance — governed modes can't downgrade to auto-seal (`app/_lib/group-eval-governance.ts`); autonomy pause, **single-click by design** and scoped to the case-lifecycle orchestrator (`app/_lib/dev-control.ts` `getAutonomy`, read only at `app/_lib/devcase-orchestrator.ts:104`; the arm-then-confirm guard in `app/control/ControlRoom.tsx` is on **Reconcile**, not on pause — `app/control/AutonomyBar.tsx:6-8` states the reasoning); human disposition captured on analyses (`app/_lib/db/core.ts`). | **G5 mostly closed** — `resolveApprover()` names the signed-in person, and the bulk-rejection wave now REFUSES to commit rather than seal an approval it cannot attribute (`isNamedApprover()` at `app/_lib/screen-wave.ts`, commit only); the audit table badges the historical role-only records instead of rewriting them. Residual: single-candidate seals stay role-attributed by design, plus two role-only call sites (see G5 in §3); **G15 closed** — the pause is now a real Art. 14(4)(e) stop control: `instrumentation-node.ts` reads `getAutonomy()` once per tick (`clockIsPaused`) and, while paused, skips every discretionary pass (inbound pull + edge drain, scheduling policy pass, interview reminders, offer lapse, offer reminders), records one `clock_halted` audit row on the transition, and still writes its liveness heartbeat so a pause cannot be mistaken for a wedged clock. The GDPR consent-expiry sweep is the one **documented exemption** (see G15 in §3) |
| **Art. 15** Accuracy, robustness, cybersecurity | 🟡→ improved | Calibration with honesty floor + Brier (`app/_lib/calibration.ts`); per-source label-leakage disclosure; deterministic clean-arm holdout, sealed and read back (`app/_lib/screen-wave-holdout.ts`, `decision-record-store.ts`); threshold changes sealed as human policy acts (`app/api/analytics/calibration/apply-threshold/route.ts:82` — `kind: "screening_threshold_adjusted"`); unevidenced skill claims discounted for all candidates (`pipeline/jobfit/transform.py`); fail-closed null scores (`app/_lib/match-score.ts`); tie-safe cutoffs + score-staleness flags (`screen-wave.ts`); weighting-robustness matrix (`app/features/hiring/decisions/groupEval/GroupEvalFairnessPanel.tsx` — path corrected, see below); bilingual-parity eval gates (`pipeline/jobfit/tests/test_tech_bilingual_parity.py`, confirmed present); **name/gender-proxy neutrality eval now exists** (`pipeline/jobfit/tests/test_name_neutrality.py`) — this closes what was G3. | G3 closed; G10 (no post-market drift monitoring beyond display) still open |
| **Art. 17** Quality management system | 🟡 | **The largest omission from this map until 2026-09-08, and the most interesting, because kp has a great deal of Art. 17 substance that has never been described as a QMS.** In summary — the head-by-head mapping is below the table: **36 gates** declared in `AGENTS.md` and reconciled **in both directions** against `.github/workflows/ci.yml` by `scripts/docs/check-guidance.mjs` (`gate-unlisted` for a CI step no document names, `gate-stale` for a documented gate CI no longer runs), with `.ai/manifest.yaml` `guidance.gates` as the machine-readable copy — so the list of controls cannot silently diverge from the controls that run; **8 architecture decision records** in `docs/architecture/decisions/` whose `sources:` paths and index entries are gated by `scripts/docs/check-adrs.mjs` (`npm run docs:check`); **validation harnesses** in `pipeline/jobfit/eval/` with declared pass thresholds (`thresholds.py`), three of them CI-gated (`test:eval:ci` = matching + automation + fault); **debt ratchets** that make a suppression a declared, capped number rather than a habit (`scripts/lint/ts-ratchet.mjs`, `scripts/lint/ruff-ratchet.mjs`, and `LEAK_CEILING` / `FORWARD_CEILING` at `app/api/error-response-contract.test.ts:268`); **fail-closed tenancy** (`app/_lib/tenancy.ts:430` `assertTenancyReady`); the **doc-sync Stop hook** (`.claude/settings.json:21` → `scripts/docs/check-doc-sync.mjs`) and the pre-push gate (`.githooks/pre-push`); a **CycloneDX 1.5 SBOM per release** (`scripts/release/sbom.mjs`) and `npm run release:check` reconciling `package.json` ↔ the Helm chart's `appVersion` ↔ `CHANGELOG.md`. What is missing is (a) the document that says *this is the quality management system*, mapped to Art. 17(1)(a)–(m), and (b) four heads that are genuinely empty. | G17; the empty heads are G1 (17(1)(g)), G10 (17(1)(h),(i)) and G20 (17(1)(j)) |
| **Art. 18** Keep the technical documentation for 10 years | 🔴 | There is nothing to keep: Annex IV documentation does not exist yet (G2), so the retention duty currently has no object — which is a reason to state the duty now, not a reason to omit the row. What exists and would serve it once G2 lands: git history, `CHANGELOG.md` under semantic versioning with `npm run release:check` holding it in lockstep with `package.json` and the chart's `appVersion`, per-release SBOM and provenance attestation (`scripts/release/sbom.mjs`, `scripts/release/provenance.mjs`, both fixtured under `npm run test:release`). None of that is **declared** as the Art. 18 archive, no retention period is stated anywhere in the tree, and Art. 18(1) also requires the QMS documentation (Art. 17) and any notified-body decisions to be kept alongside — so this row cannot close before G2 and G17 do. | G18 |
| **Art. 19** Provider keeps automatically generated logs, ≥ 6 months | 🟡 | The logs exist, are tamper-evident and are never pruned — see the Art. 12 row. The nuance this pack owed and did not state: **Art. 19 binds the provider only for logs "under its control"**, and in a self-hosted install the decision chain lives in the operator's own SQLite file, which kp cannot reach, read or retain. So the duty splits by face — it is kp's own in SaaS, and the deployer's under Art. 26(6) in OSS, which `docs/architecture/self-hosting.md` §1a already tells the operator ("KP never prunes the decision chain, so the practical duty is on your backups"). What is missing on **both** sides is the same thing: no retention window is configured (`KP_*` has no knob for it) or documented, and the 6-month floor is asserted in prose with nothing enforcing it. | G6 |
| **Art. 20** Corrective actions and duty to inform | 🔴 | No AI-Act-shaped corrective-action procedure exists: nothing defines what observation would trigger withdrawal, recall or disabling of a deployed system, what a "bring into conformity" fix looks like for a scoring change, or who is told. The nearest mechanism is the **security** channel — `SECURITY.md` publishes advisories as the outbound path with a stated target of 5 working days after a fix, and frames it against CRA Art. 14 — but a security advisory is not an Art. 20 corrective action, and the same document records the structural obstacle: kp is a private package with no registry coordinate, so advisories reach self-hosters by **pull, not push**. Under AGPL distribution kp has **no register of its deployers to inform at all**. That is the honest blocker here and writing a procedure does not solve it; the realistic answers are a published advisory feed the operator subscribes to (partly done, `SECURITY.md`) plus an in-product notice, and neither is an Art. 20 *procedure* yet. | G19 |
| **Art. 21** Cooperation with competent authorities | 🔴 | No named contact for an authority, no stated procedure for handling a reasoned request, and no commitment on language — Art. 21(1) lets an authority ask in a language it easily understands, and kp's compliance documentation is English-only even though the product itself ships four locales. Art. 21(2) log access is trivial in SaaS and **impossible** in OSS: the decision chain is the operator's file. `SECURITY.md` provides a channel for vulnerability reports, which is not a market-surveillance channel. One question this repository cannot answer and should not pretend to: whether an **Art. 22 authorised representative** is required turns on where the kp vendor is legally established, and no file in the tree states that (the same unresolved fact `regulatory-backlog.md` R-61 flags for the CRA steward classification). | G20 |
| **Art. 25** Responsibilities along the AI value chain | 🟡 | **Discharged more thoroughly than most rows on this map, and in a document rather than in code.** `docs/architecture/self-hosting.md` §1a states the open-source exemption's non-reach (Art. 2(12) does not cover high-risk, Art. 5 or Art. 50, and Art. 3(3) makes free AGPL distribution "placing on the market"), the deployer default, the three Art. 25(1) triggers — including naming the guide's own white-label branding feature (§8b) as the textbook Art. 25(1)(a) case — and **kp's foreseen-configuration envelope**: an explicit two-list split of what a deployer may change and stay a deployer (per-stage automation gates including `auto`, screening thresholds and family floors, the shipped model adapters, locale/branding/retention/`KP_OFFLINE`/deployment shape) versus what kp judges crosses Art. 3(23) (editing scoring prompts, pointing the scorer at an unbenchmarked self-hosted model through the `*` wildcard, anything that changes what the score means). Read it there; it is not restated here. **Why the envelope being kp's own matters:** Art. 3(23) is drafted so the *provider's* initial conformity assessment sets the boundary, and the Commission's Art. 25 value-chain guidelines are **announced but unpublished**, so there is no instrument to defer to and kp defines the line while the Commission is silent. Two real limits: the envelope is prose with **no gate behind it** — nothing fails when a release quietly moves the line, and no notice reaches an operator when it does; and the **upstream** half of Art. 25 is unassembled — what kp obtains from its own model suppliers (`regulatory-backlog.md` R-48, Annex XII intake) is recorded nowhere. | G21 |
| **Art. 26** Deployer obligations | 🟡 | The product operationalizes the deployer's duties: oversight assignment via `KP_OPERATOR_NAME` (`app/_lib/auth/operator-approver.ts`), logs kept (chain never pruned), candidate information duties via the disclosure layer. | G2 (instructions-for-use is the vehicle for telling deployers *their* duties: worker-representative notification, Art. 27 FRIA for public bodies, log retention ≥ 6 months) |
| **Art. 43** Conformity assessment | 🔴 not started — and **much smaller than the word suggests** | Worth stating plainly, because "conformity assessment" frightens providers out of planning one. Employment is **Annex III point 4**, and Art. 43(2) routes Annex III points 2–8 to the procedure **based on internal control (Annex VI)**, which *expressly does not provide for the involvement of a notified body*. There is no audit to book, no certificate to buy, no third party in the loop and no notified-body number to carry. Annex VI is three steps: verify the QMS conforms to Art. 17, examine the technical documentation against Chapter III Section 2, and verify the post-market monitoring plan under Art. 72 — i.e. the Art. 17, Art. 11/Annex IV and Art. 72 rows of this very table. The assessment is a self-declaration whose entire cost is the **quality of its inputs**, which is precisely why G1, G2 and G17 sequence ahead of it and not the other way round. The Omnibus additionally makes an **SME / small-mid-cap simplified technical-documentation template** available, and kp is comfortably inside that threshold. ⚠️ The Omnibus's precise wording on SME conformity-assessment and QMS relief is carried from `regulatory-backlog.md` and has **not** been read in primary form here — see §4 verification debt in that file before this reaches a customer document. | G14 |
| **Art. 47 / 48** EU declaration of conformity & CE marking | 🔴 | Neither exists: a full-text search of the tree finds no declaration-of-conformity artifact and no CE-marking surface. Both are cheap once G1/G2/G17 exist, and the software-only shape is the part usually got wrong. **Art. 47** is one written declaration in the **Annex V** form (system identity, provider, a statement of conformity with the Act, the standards or common specifications applied, and the conformity-assessment procedure followed), drawn up per *system* rather than per release, kept 10 years, and provided machine-readable where feasible — updating it is part of the Art. 20/Art. 43(4) modification loop, not a one-off. **Art. 48** applies the CE marking; for a system with no physical form Art. 48(2) provides for a **digital** CE marking, affixed so it is easily accessible, which for kp honestly means the product's own `/trust` surface plus the release artifacts, not a sticker. No notified-body identification number follows the marking here, because the Annex VI route involves none. | G14 |
| **Art. 50(1)** Transparency (AI interaction) | 🟢 | `AiDisclosure` on quick/conversational/dev-case apply, voice portal, offer, schedule, **and now `/status/[token]`** (`app/_components/AiDisclosure.tsx`; `app/status/[token]/StatusClient.tsx:324` — the comment cites "EU AI-Act pack G9/G11" directly). (`/onboarding/[token]` carried it too until the post-hire onboarding module was removed with that surface.) Voice consent is server-enforced at credential mint AND transcript persist (`app/_lib/interview-consent.ts`, `app/api/interview/connect/route.ts`); "AI-led conversation" / "Reviewed by a human" chips (`app/interview/[token]/page.tsx`). | **G11 closed** (was the last uncovered candidate surface; every surviving candidate surface renders `AiDisclosure`) |
| **Art. 50(2)** Synthetic-content marking | 🔴 | **The only obligation on this map with a 2026 deadline, and nothing addresses it.** The AI voice interview delivers fully synthetic speech to a candidate, and there is no watermark, no C2PA manifest and no marking of any kind — verified 2026-09-08 by a full-text search for watermark / C2PA / synthetic-content / provenance-metadata across `packages/voice-tts/` (providers `elevenlabs.ts`, `piper.ts`, `kokoro.ts`, `fake.ts`; `text/normalize.ts`; `validate.ts`) and `app/api/tts/route.ts`: **zero hits**. Art. 50(2) requires providers of systems generating synthetic audio to mark the output in a machine-readable format detectable as artificially generated; the transparency duties applied on 2 August 2026 and the marking grace period for pre-existing systems ends **2 December 2026**. This row is why §6's "what remains is almost entirely documentation" needed re-drawing: this one is code. Worse in the OSS face — the keyless Piper and Kokoro paths produce wholly unmarked speech with no upstream provider to lean on, while a hosted provider could at least be pinned to a marking-capable configuration. A final **Code of Practice on Transparency of AI-Generated Content** (10 June 2026) is an accepted compliance vehicle for signatories; non-signatories must demonstrate adequacy individually. ⚠️ The Code of Practice's date and signatory count are carried from `regulatory-backlog.md` R-07 and not independently verified here. | G22 |
| **Art. 72/73** Post-market monitoring & serious incidents | 🔴 | Absent — no incident log, no monitoring plan. | G10 |
| **Art. 86** Explanation of individual decisions | 🟡 (improved) | The sealed per-candidate dossier exists (`GET /api/decisions/records?candidate=…`) but stays operator-gated by design. **New:** `app/_lib/status-decisions.ts` derives a redacted `CandidateDecisionView` (kind, attribution, reasonCode, and — for auto-rejects — the decisive threshold facts) from the same sealed rows and renders it on `/status/[token]`; rejection copy is sourced from this record rather than generated. | G9 now **partially** closed — candidates get a structured explanation of their own decision; they still cannot browse the full sealed chain (by design, not a gap) |
| **GDPR Art. 22** (adjacent, load-bearing) | 🟢 | The whole oversight layer above is framed in-code as "no solely-automated significant decision" (`screen-wave-approval.ts`); fairness-cleared rejects still queue for a human (`automation-pass.ts`). | — |
| **Bias / non-discrimination** (Art. 10(2)(f)(g), Recital 56) | 🟡 | Fail-closed fairness gate: early-career AND unknown archetypes never auto-rejected, drift audited (`app/_lib/archetypes.ts` — `isFairnessProtected`, `isEarlyCareer`); defense-in-depth backstop re-derives the sole legitimate reject path (`app/_lib/automation-fairness.ts`); four-fifths primitive with small-cohort floor (`app/_lib/adverse-impact.ts`) — browser-only on pasted counts, nothing persisted; scope-honest copy everywhere ("the app holds no demographic data"); **name-neutrality eval now enforced** (see Art. 15 row). | G13 closed |

### Art. 17 in detail — the QMS heads, mapped honestly

Art. 17(1) asks for a **documented** quality management system and then enumerates
what it must cover, (a) through (m). kp's position is unusual and worth naming
precisely: **the system largely exists as running machinery and does not exist as a
document.** That is the opposite of the failure mode this repository normally has
(claims outrunning code), and it is why Art. 17 reads 🟡 rather than 🔴.

Every path below was verified against the tree on 2026-09-08.

| Art. 17(1) head | State | What fills it |
|---|---|---|
| **(a)** Regulatory-compliance strategy, incl. conformity-assessment compliance and **management of modifications** | 🔴 / 🟡 | No written compliance strategy — that is this pack's own missing parent document. The *modification-management* half exists in engineering form: semantic versioning with `npm run release:check` reconciling `package.json` ↔ the Helm chart's `appVersion` ↔ `CHANGELOG.md`; a threshold change sealed as a human policy act (`kind: "screening_threshold_adjusted"`, `app/api/analytics/calibration/apply-threshold/route.ts`); `AUTOMATION_VERSION` and the sealed `policyVersion` riding every decision record. What is absent is the link from a modification to a **re-assessment decision** — nothing says which change would oblige kp to revisit the Art. 43 assessment. |
| **(b)** Design, design control and design **verification** techniques | 🟡 | `docs/architecture/decisions/` (8 accepted ADRs) is the design-control record, and it is machine-checked rather than aspirational: `scripts/docs/check-adrs.mjs` fails when an ADR's `sources:` path no longer exists, when the index drifts from the records, or when a supersedes/superseded-by pair is not reciprocal. Design verification runs as gates: `design:check` (token lockstep), `i18n:check` (4-locale parity), `api:check` (the API reference against the routes that exist, including which side of the auth gate each sits on). Missing: any notion of a design *input* — a requirement set the design is verified **against**. ADR 0007 ("a repo law that isn't a gate isn't a law") is the closest thing to a stated design philosophy. |
| **(c)** Development, quality control and quality assurance | 🟢 | The strongest head. **36 gates** are declared in `AGENTS.md`'s table and reconciled with `.github/workflows/ci.yml` **in both directions** by `scripts/docs/check-guidance.mjs` — `gate-unlisted` fails when CI runs a step no document names, `gate-stale` fails when a documented gate no longer runs — with `.ai/manifest.yaml` `guidance.gates` as the machine-readable copy and `guidance.gates_doc` naming the one file that carries the table. That reconciliation is the QMS-grade property: the list of controls cannot silently diverge from the controls that execute. Beneath it: three **ratchets** turning debt into a declared ceiling (`scripts/lint/ts-ratchet.mjs` over `ts-debt.json`, `scripts/lint/ruff-ratchet.mjs` over `ruff.toml`, and `LEAK_CEILING`/`FORWARD_CEILING` at `app/api/error-response-contract.test.ts:268` over the handlers that still forward a raw error message); a flake policy with a bounded quarantine (`test-quarantine.json`, `npm run test:flake`); a CI wall-clock budget (`perf-budget.json`, `npm run test:perf`); a pre-push gate running the fast core (`.githooks/pre-push`, verified live by `npm run hooks:check`); and two review lenses in `review.yml`, one deterministic (`scripts/review/constitution-check.mjs`) and one judgemental. |
| **(d)** Examination, test and **validation** procedures, before/during/after development, and their frequency | 🟡 | The harnesses exist: `pipeline/jobfit/eval/` holds `matching_eval`, `automation_eval`, `fault_eval`, `interview_eval`, `intake_eval` and a judging layer, with pass thresholds declared as data in `thresholds.py`. Three of them are CI-gated (`test:eval:ci` = matching + automation + fault, keyless and deterministic); `interview_eval` and `intake_eval` are **not** in CI and run on demand. Behind them: the gated Python suite with a skip ceiling (`test:python:gate`, `KP_SKIP_BASELINE`), the node:test suite, and a declared keyless Playwright subset pinned to `ci.yml` by `scripts/docs/__tests__/keyless-e2e-pin.test.mjs`. Documented in `docs/development/testing-and-evaluation.md` and `docs/development/automation-eval.md`. What is missing is the Art. 17 shape of it: no written procedure states *which* validation runs at *what frequency* against *which acceptance criterion*, and **no accuracy figure is declared anywhere** despite continuous measurement (`regulatory-backlog.md` R-38) — Art. 15(3) wants numbers in the instructions for use. |
| **(e)** Technical specifications, incl. **standards applied** | 🔴 | None citable, and that is a fact about the state of the art rather than about kp — see §4 item 7, rewritten. |
| **(f)** Data management systems and procedures | 🟡 | See the Art. 10 row: consent lifecycle with TTL, read-time PII gate, one-transaction erasure whose SQL is parsed and held against the tenancy manifest, `KP_OFFLINE` as an egress floor in both halves, provider keys encrypted at rest. Structurally, `app/_lib/tenancy.ts:430` `assertTenancyReady` is a **fail-closed boot guard**: any new persistent table is a reported gap until it is scoped and listed. Missing: the governance artifact for the corpora kp actually ships — `data/seed_calibration/` (which does carry `FROZEN.json`, `JUDGE_RUBRIC.md` and a judge report, so the raw material exists) and the market-pulse corpora. That is G8. |
| **(g)** The Art. 9 risk-management system | 🔴 | G1. Nothing under `docs/` is a risk register. |
| **(h)** Post-market monitoring per Art. 72 | 🔴 | G10. |
| **(i)** Serious-incident reporting per Art. 73 | 🔴 / 🟡 | `SECURITY.md` is a real incident channel in both directions — private vulnerability reporting inbound, published advisories outbound with a stated 5-working-day target — but it is a **security** incident process. An Art. 73 serious incident is a different object (death or serious harm to health, serious and irreversible disruption of critical infrastructure, infringement of fundamental-rights obligations, serious harm to property or environment) on its own clocks, and nothing in the tree recognises that category, let alone routes it. G10. |
| **(j)** Handling communication with authorities, notified bodies, operators and other parties | 🔴 | G20 — see the Art. 21 row. |
| **(k)** Record-keeping of all relevant documentation and information | 🟡 | The decision chain (Art. 12 row) is exemplary for *decisions*. For **documentation**, the record is git history plus `CHANGELOG.md` plus per-release SBOM and provenance attestation — none of it declared as the Art. 18 archive, and no retention period stated. G18. |
| **(l)** Resource management, incl. **security of supply** | 🟡 | `npm run sbom` emits a CycloneDX 1.5 document covering both runtimes (npm lockfile + the resolved pip environment) and attaches it to every GitHub Release, which is exactly the artifact "is my deployment affected by this advisory?" needs; `scripts/security/check-actions.mjs` refuses a new workflow action riding a mutable tag; `npm audit` and `pip-audit` gate the dependency tree; `scripts/docs/__tests__/toolchain-pin.test.mjs` pins the toolchain. What has **no** supplier-qualification procedure is the supply that matters most: the LLM providers. `regulatory-backlog.md` R-17 shipped a declared, dated provider-posture registry (`SUBPROCESSORS` in `app/_lib/trust-posture.ts`, bound to `LLM_PROVIDERS` by a coverage test), which is the evidence base — but nothing yet **refuses** to route to a provider whose posture is unacceptable, and R-48 records that no Annex XII documentation is collected per model. |
| **(m)** Accountability framework — responsibilities of **management and other staff** | 🔴 | **The sharpest honest finding in this section.** kp's accountability framework is real and it is machine-shaped: ADR 0007 states the principle that a rule which is not a gate is not a rule; the doc-sync Stop hook (`.claude/settings.json:21` → `scripts/docs/check-doc-sync.mjs`) makes an agent either update the coupled doc or say in one sentence why not; `scripts/docs/feature-doc-map.json` couples source globs to the doc that describes them; `.claude/CLAUDE.md` allocates duties to *sessions*. Art. 17(1)(m) asks for something categorically different — **named people, with management roles and stated responsibilities**. No file in this repository names an owner for anything. Around 90% of changes here are written by an agent (ADR 0007's own framing), which makes the question "who is accountable" sharper here than in a conventional codebase, not softer. G17 is where this lands, and it is the part of the QMS document that cannot be assembled from evidence that already exists. |

**Two things about standards, so the row above is not misread.** **EN 18286:2026** is the
published European standard for an AI Act quality management system, and it is **not yet
cited in the Official Journal**, so applying it grants **no presumption of conformity**
under Art. 40 — it is a good template and nothing more. And the Omnibus opened
conformity-assessment and QMS relief for **SMEs and small mid-caps**, a threshold kp is
comfortably inside; Art. 17(2) already provided for a proportionate QMS for smaller
providers. ⚠️ Both sentences are carried from `regulatory-backlog.md` R-45 and the
Omnibus summary; neither the EN standard's text nor the Omnibus's QMS-relief article has
been read in primary form for this pack. Treat them as the direction of travel, not as
citations, until a human has opened the sources.

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
| G14 | Registration (Art. 49 EU database) + Annex V declaration of conformity + CE marking, off an Art. 43 internal-control assessment. | 43, 47-49, 71 | Provider | L | **Open — and no longer "premature".** It was deferred behind G1/G2 on the reading that a conformity assessment was years out; **15 months is exactly the horizon on which one gets planned**, not deferred. Two things make it cheaper than the old L suggests: the Omnibus makes an **SME / small-mid-cap simplified technical-documentation template** available, and kp is comfortably inside that threshold; and Art. 43 for Annex III point 4 is **internal control** — no notified body. G1/G2 remain the inputs, so the sequence is unchanged; what changed is that G14 now has a date to work back from. **Since 2026-09-08 §2 carries its own Art. 43 and Art. 47/48 rows** spelling out what each step actually requires — Annex VI's three checks, Annex V's form, and the digital CE marking Art. 48(2) provides for a system with no physical form. Add G17 to its inputs: Annex VI step 1 is *verify the QMS conforms to Art. 17*. |
| ~~G16~~ | ~~`AiDisclosure` asserts a human-in-the-loop the config can turn off.~~ The body read "A human reviews and makes every advance, offer, and rejection decision; nothing adverse is decided automatically." The FIRST clause was false whenever a workspace set an interview-plan gate to `auto`: `app/_lib/automation-run.ts` ratifies an advance unattended via `actOnPipelineEntry` with `actor: "system"` (decision kind `auto_advanced`, actor `auto:interview-plan`), and the offer branch extends an offer with no human in the loop. It rendered UNCONDITIONALLY on eight public candidate surfaces (`/apply/[id]`, `/apply/[id]/quick`, `/devcase/apply/[token]`, `/interview/[token]`, `/schedule/[token]`, `/status/[token]`, `/offer/[token]`, InterviewSimTab), in four locales. | 50, 13 | Provider | M | **Closed (2026-09-08)** — the copy now states the one absolute it earns (a rejection is always a person's, and no setting can delegate it) and carries "by default" on advance and offer with the delegation named, in all four catalogs. It is pinned by `app/_components/ai-disclosure-copy.test.ts`, which fails if the retired absolute returns or if the rejection guarantee is dropped. Found by the scan-sweep of 2026-08-25; the landing page had retired the same sentence on 2026-08-28 and the candidate-facing copy outlived it by ten days. |
| ~~G15~~ | ~~Widen the autonomy pause into a real Art. 14(4)(e) stop control.~~ | 14 | Provider | M | **Closed (2026-08-22)** — see below |
| G22 | **Art. 50(2) synthetic-content marking on the AI voice interview.** No watermark, no C2PA manifest, no marking of any kind in `packages/voice-tts/src/` or `app/api/tts/route.ts` — verified 2026-09-08, zero hits. **This is the only gap on this register with a 2026 deadline**: the marking grace period for pre-existing systems ends **2 December 2026**. Two decisions, not one piece of work: *what* marking (a provider-side watermark where the hosted provider offers one, versus a kp-side C2PA/soft-binding manifest that also covers the keyless Piper and Kokoro paths — those produce wholly unmarked speech and are the harder half), and *whether to sign* the Code of Practice on Transparency of AI-Generated Content, which is an accepted compliance vehicle for signatories while non-signatories must demonstrate adequacy individually. `regulatory-backlog.md` R-07 is the same item from the backlog's side. | 50(2) | Provider | M + one decision | **Open — highest time pressure on this register** |
| G17 | **Art. 17 quality management system: write the document that says the running machinery IS the QMS.** Structure it as Art. 17(1)(a)–(m) and fill each head from the mapping in §2 above — most of them are assembly work over evidence that already exists (36 reconciled gates, 8 gated ADRs, the eval harnesses and their thresholds, the ratchets, the fail-closed tenancy guard, the doc-sync hook, the SBOM). Four heads cannot be assembled and need a decision: **(a)** what modification obliges a re-assessment, **(d)** which validation runs at what frequency against what acceptance criterion, **(g)/(h)/(i)** which are G1 and G10, and above all **(m)** the accountability framework — Art. 17(1)(m) wants named people with management responsibilities, and no file in this repository names an owner for anything. EN 18286:2026 is a usable template and grants no presumption of conformity (§4 item 7). | 17 | Provider | M | **Open** — `docs/QUALITY_MANAGEMENT.md` not created; (m) is the part with no existing evidence to draw on |
| G18 | **Art. 18 technical-documentation retention: declare the 10-year archive.** Art. 18(1) covers the Annex IV documentation, the Art. 17 QMS documentation and any conformity-assessment decisions, kept 10 years after placing on the market and available to authorities. kp has candidate archives (git history, `CHANGELOG.md` held in lockstep with `package.json` and the chart `appVersion` by `release:check`, per-release SBOM and provenance) and declares none of them as *the* archive; no retention period appears anywhere in the tree. Cannot close before G2 and G17 produce something to retain — but the paragraph is a paragraph, and writing it while the documents are being written is cheaper than retrofitting it. | 18 | Provider | S | **Open** — fold into the G2/G17 documents |
| G19 | **Art. 20 corrective-action procedure, and the AGPL problem underneath it.** Define what observation triggers bringing a system into conformity, withdrawing, disabling or recalling it, and who is informed. The obstacle is not procedural: under AGPL distribution kp has **no register of its deployers**, and `SECURITY.md` already records that advisories reach self-hosters by pull rather than push because kp is a private package with no registry coordinate. So this splits into a procedure (S) and a **notification channel that actually reaches an operator** (M) — a subscribable advisory feed plus an in-product notice are the realistic shapes; a security advisory is not an Art. 20 corrective action and must not be presented as one. | 20 | Provider | S procedure / M channel | **Open** |
| G20 | **Art. 21 cooperation with competent authorities.** A named contact, a stated procedure for a reasoned request, a language commitment (Art. 21(1) — kp's compliance documentation is English-only while the product ships four locales), and a stated position on log access under Art. 21(2), which is trivial in SaaS and impossible in OSS because the chain is the operator's file. Also resolves Art. 17(1)(j). One prerequisite is a fact this repository does not hold: whether an **Art. 22 authorised representative** is required turns on the vendor's legal establishment. | 21, 17(1)(j), 22 | Provider | S (+ a legal fact to establish) | **Open** |
| G21 | **Art. 25: put a gate behind the foreseen-configuration envelope, and assemble its upstream half.** The envelope in `docs/architecture/self-hosting.md` §1a is kp's strongest value-chain asset and is prose with nothing enforcing it — nothing fails when a release moves the line (a new adapter, a new automation gate, a config surface that changes what the score means), and no notice reaches an operator whose deployment just left the envelope. A test asserting that the enumerated adapters, gate kinds and threshold knobs match what the code actually exposes is the same shape as the `SUBPROCESSORS` ↔ `LLM_PROVIDERS` coverage test that caught the undisclosed `qwen` adapter. Separately, the **upstream** half — what kp obtains from its own model suppliers — is unassembled (`regulatory-backlog.md` R-48, Annex XII intake). | 25 | Provider | S gate / M upstream | **Open** |
| G23 | **Art. 4 AI literacy material.** Zero product coverage: two documents name the duty (`self-hosting.md:173`, `trust-posture.ts:54`) and nothing discharges it. The Omnibus softened it from *ensure* to *take measures to support*, with an express clarification that no specific level need be guaranteed — so the bar is a genuine, proportionate effort, not a certification. Cheapest credible form: a short "what the score is and is not" page for recruiters, reachable from the app, plus a section in the instructions-for-use (G2) telling a deployer what to give its own staff. **Do not conflate with Art. 26(2)** — competence, training and authority for the people assigned oversight, unsoftened, the deployer's duty, and already enforced at its sharp end by `isNamedApprover()`. Enforceable since 2 August 2026. | 4 | Both | S | **Open** |

Already adequate, keep as-is: the Art. 12 decision
chain, voice-consent enforcement, GDPR erasure/consent machinery, KP_OFFLINE,
and now the name-neutrality eval and candidate-facing AI explanation — plus, since
2026-09-08, the **Art. 5(1)(f) emotion-inference posture**, whose three reasons
(transcript-only input, no affect axis in the rubric, an instruction to rate
substance not delivery) are pinned in the gated Python suite by
`pipeline/jobfit/tests/test_ai_act_emotion_inference.py`. That one is on this list
for a different reason from the others: it is not "good enough to leave", it is a
prohibition, and the only maintenance it needs is that the test keeps failing when
someone changes the invariant. The
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
7. **Standards applied** — **none, because none exists to apply. This is a fact
   about the state of the art, not a kp gap**, and until 2026-09-08 this item
   read "none claimed yet" in a way that invited the opposite reading.
   **Zero harmonised standards under the AI Act have been cited in the Official
   Journal**, so the Art. 40 presumption of conformity is currently unavailable
   **to every provider in the Union**, not just to kp. There is no shortcut being
   declined here; there is no shortcut. Nor is there a fallback: Art. 41 lets the
   Commission adopt **common specifications** where harmonised standards are
   insufficient or absent, that power was left untouched by the Omnibus, and
   **it has not been exercised** — so nothing has been adopted under Art. 41
   either.

   What Annex IV §7 should therefore say, and what Art. 17(1)(e) asks in the same
   words: where harmonised standards have not been applied in full, describe the
   **means used to ensure compliance**. For kp that is §2 of this pack — the
   mechanisms, each with its enforcement point — read together with the Art. 17
   mapping above. That is not a workaround; it is precisely what Art. 41's
   absence leaves a provider doing, and it is the more checkable answer of the
   two, because a mechanism with a gate behind it can be verified by running the
   gate.

   Two things to track rather than to claim:

   - **EN 18286:2026**, the European standard for an AI Act quality management
     system, is **published but not cited in the OJ**. Applying it grants no
     presumption of conformity today. It is worth using as the *template* for
     G17 — that is a different and much weaker statement than "the standard is
     applied", and this pack must not blur the two.
   - **Standardisation mandate M/613** to CEN-CENELEC — the mandate under which
     the harmonised standards are being drafted — currently **expires before the
     obligations it is meant to support apply**, which is why no citation has
     landed. ⚠️ A specific expiry date circulates in secondary sources and is
     recorded in `regulatory-backlog.md` R-45; it is **not** verified here and
     should not be repeated in a customer document until a human has opened the
     mandate. The watch item is the mismatch, not the date: the first OJ citation
     of a harmonised standard is one of the two events that changes this pack's
     plan (the other being adoption of the Art. 6(5) classification guidelines).
8. **EU declaration of conformity** — ⏳ G14 template, in the **Annex V** form, off
   the **Annex VI internal-control** assessment Art. 43(2) prescribes for Annex III
   point 4 (no notified body, so no identification number follows the CE marking).
   Its "standards or common specifications applied" field is where item 7 above
   lands: today that field says *none cited in the OJ*, and points at §2. See the
   Art. 43 and Art. 47/48 rows in §2.
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

**That conclusion survived the map being completed on 2026-09-08, with one
correction it did not survive.** The paragraph above was drawn from a map covering
about 11 of the ~20 articles that bind a provider; §2 now carries Art. 4, 5, 17,
18, 19, 20, 21, 25, 43 and 47/48 as well, and Art. 50 is scored on both limbs.
Three things changed, and only one of them changes the verdict:

1. **The verdict got stronger where the map was under-claiming.** Art. 5 is a 🟢
   row — kp does not infer emotion, and all three reasons are pinned by
   `test_ai_act_emotion_inference.py` in the gated suite. Art. 25 is 🟡 and
   substantially discharged, in `self-hosting.md`'s foreseen-configuration
   envelope, which is a genuine asset almost nobody in this category publishes.
   Art. 17 reads 🟡 rather than 🔴 because the QMS **exists as running
   machinery** — 36 gates reconciled with CI in both directions, gated ADRs,
   eval harnesses with declared thresholds, ratchets, a fail-closed tenancy
   guard, an SBOM per release — and has simply never been called a QMS.
2. **Art. 43 is far less frightening than "conformity assessment" sounds.**
   Annex III point 4 routes to **internal control under Annex VI**: no notified
   body, no audit to book, no certificate to buy. Its three steps are the Art. 17,
   Annex IV and Art. 72 rows of this table, so the cost is entirely the quality of
   G1, G2, G17 and G10 — which is the sequencing this pack already had.
3. **"Almost entirely documentation" is now wrong in exactly one place, and it is
   the place with a deadline.** **Art. 50(2) synthetic-content marking (G22) is a
   code gap**: the voice interview delivers synthetic speech with no watermark, no
   C2PA manifest and no marking anywhere in `packages/voice-tts/` or
   `app/api/tts/`, and the marking grace period ends **2 December 2026** — fifteen
   months before every Annex III row above it. It is the only item on this register
   whose clock runs in 2026, and the keyless Piper/Kokoro paths make the
   self-hosted face the harder half. Corrected reading: *what remains for
   2 December 2027 is almost entirely documentation; what remains for 2 December
   2026 is one piece of engineering.*

The four new documentation gaps (G17 Art. 17, G18 Art. 18, G19 Art. 20, G20
Art. 21) do not disturb the G1/G2 ordering — G17 consumes G1's output and G18
has no object until G2 exists — but G17's Art. 17(1)(m) **accountability
framework** is the one head on this map with no existing evidence to draw on.
Every other documentation gap is assembly work over machinery that already runs;
naming the people accountable is a decision someone has to make.

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
- **The map was incomplete, and the verdict was drawn from the incomplete map
  (2026-09-08).** §2 covered roughly 11 of the ~20 articles binding a provider.
  Ten rows were added — Art. 4, 5, 17, 18, 19, 20, 21, 25, 43, 47/48 — and Art. 50
  was split into its 50(1) and 50(2) limbs, which is what surfaced the only
  obligation on this register with a 2026 clock. `regulatory-backlog.md` R-41 is
  the item this discharges; R-45 is §4 item 7 and R-10 is G23. Three findings from
  the completion are worth carrying forward: **Art. 17 was the biggest omission
  and reads 🟡, not 🔴**, because a QMS's worth of machinery exists and has never
  been called one; **Art. 5 was being under-claimed** and is a 🟢 row with a test
  behind it; and **Art. 50(2) is a code gap, not a documentation gap**, which is
  the one place §6's "almost entirely documentation" needed correcting rather
  than confirming. New gaps: G17–G23 (G22 is the marking gap and carries the
  nearest deadline).
- **What could not be verified from the tree (2026-09-08), and is therefore
  labelled ⚠️ where it appears above**: the Omnibus's precise wording on SME /
  small-mid-cap conformity-assessment and QMS relief; EN 18286:2026's text and
  its OJ status; the M/613 mandate's expiry date; and the Code of Practice on
  Transparency of AI-Generated Content's date and signatory count. All four are
  carried from `regulatory-backlog.md`, which files them under its own §4
  verification debt. None of them may reach a customer document before a human
  opens the primary source.
