# Marketing truth recheck — 2026-10-09

Base: `4443387e8` (main). Branch `autopilot/accepted-idea-delivery-6407b3f4`.

## Reconcile
`pipeline/jobfit/devcase/design.py:30` is `ROLE_DESIGN_PROMPT_VERSION = "role-design-v5"`; `about.jd.status.s0` read `role-design-v4` in en, cs, de and fr. Not yet fixed on base, so step 2 ran.

## Fixes (1 of the 6 allowed)
| Commit | Claim | Failing-on-base proof |
| --- | --- | --- |
| `46b76d709` `fix(about): the deck names role-design-v5, and a test now pins both prompt version ids` | `about.jd.status.s0` names `role-design-v5`, the id in `design.py:30`. Only the version token changed, in all four catalogs. | New test "the status lines name the prompt versions the pipeline runs, in every locale" failed before the copy edit: `en: about.jd.status.s0 must name role-design-v5 (pipeline/jobfit/devcase/design.py ROLE_DESIGN_PROMPT_VERSION)`. It passes after (12/12 in chapters.test.ts). |

The same test also pins `about.assignments.status.s2` to `BASELINE_PROMPT_VERSION = "baseline-solve-v1"` (`baseline.py:28`) in all four locales. That claim was already true.

## Inventory
About 104 candidate strings were scanned. Rows below are the ones that state a checkable product fact. Scene sample data (7 requirements, 120/74/8, Kafka, 31k LOC, `4 min 12 s`, Alex "PM, no portfolio") is **example**.

| Key | Claim | Source | Pin | Verdict |
| --- | --- | --- | --- | --- |
| about.jd.status.s0 | role-design-v5 | design.py:30 | pinned by the new test | TRUE (fixed) |
| about.assignments.status.s2 | baseline-solve-v1 | baseline.py:28 | pinned by the new test | TRUE |
| about.jd.status.s12 / jd status | "hard cap 8" | design.py:179 asks the model for "(≤8)". Nothing enforces it; the fallback at design.py:213 uses `max(6, len(stated))` | unpinned | UNVERIFIABLE as "hard" (see report-only) |
| about.jd.sources.jdDetail | first 4 000 characters | design.py:147 `jd_text[:4000]` | unpinned | TRUE |
| about.jd.status.s3 | must-haves trace to stated input | design.py:175 | pinned by "chapter 1's grounding sentence…" | TRUE |
| about.scoring.* | 0.5 / 0.4 thresholds | matching.py `_MATCH_THRESHOLD`, taxonomy.py `_SIBLING_MATCH` | pinned by "chapter 2's two thresholds…" | TRUE |
| about.screening.layerA | gates: language, seniority, education, work mode | matching.py:336 `KoReasonKey` (adds early_career) | pinned (subset check) | TRUE |
| about.screening.figuresNote | 120/74/8 illustrative | none | pinned | example |
| about.archetypes.declaration / fallback / status | 0.9, 0.4, 0.55 | archetypes.json detection | pinned by "quoted detection constants…" | TRUE |
| about.archetypes.declaration | contradiction lowers confidence to 0.65 | archetypes.json:80, :83 | unpinned | TRUE |
| about.chapters.archetypes.lede | two of three archetypes fairness-protected | archetypes.json `fairnessProtected` false/true/true | unpinned | TRUE |
| about.assignments.note | prompt above {aim} (0.85) | artifact_checks.py `sim >= 0.85` | pinned by "chapter 5's baseline-similarity threshold…" | TRUE |
| about.gates.status.s0 | pass proposes four actions | gates/data.ts ACTIONS (4) | pinned (parked kinds) | TRUE |
| about.gates.noteHired | manual move to Hired returns 422 | app/api/pipeline/[id]/route.ts:225 (422 branch) | unpinned | TRUE (comment-level evidence) |
| about.gates.status.s7 | the pass no longer applies a rejection | automation-run.ts: no reject gate | pinned in MarketingClaims ("no auto branch for rejection") | TRUE |
| landing.marquee.6, siteChrome.menu.languages | 4 languages | i18n/locales.ts | pinned | TRUE |
| landing.trust.human.body | human-approved by default, one automatic knockout | automation-run.ts, apply route | pinned | TRUE |
| landing.pricing.* | prices, quotas, packs | PricingSection source | pinned by PricingSection.test.ts | TRUE |
| landing.pricing.enterprise.capabilities (SSO) | marked planned | no SSO code | pinned | TRUE |
| landing.proof.cards.defend.body | interview in Czech or English | types.ts:42 "UI only ever sends cs/en"; `coerceLanguage` accepts any BCP-47 tag | unpinned | UNVERIFIABLE (UI limits to cs/en, the API does not) |
| landing.features.inbox | "five doors" | five sources listed in body | unpinned | UNVERIFIABLE (no source enum checked) |
| landing.proof.cards.sealed.body, landing.features.gates.body | tamper-evident chain, kill switch | decision chain code | unpinned | UNVERIFIABLE here (security claim, not checked) |
| landing.features.offer.body | figure is deterministic: role band × fit | not read | unpinned | UNVERIFIABLE |
| landing.pricing.enterprise.stat*, source | 60–70%, ~23 h, 40–51 h | cited studies, not code | unpinned | UNVERIFIABLE (external) |
| landing.trust.subtitle / gdpr | EU AI Act, GDPR, Article 22 | compliance docs | unpinned | UNVERIFIABLE (compliance, report-only) |

## Fixes not made
No further claim is mechanically FALSE: every number, cap, threshold or version id I could trace to code matches it. The remaining rows are unpinned or UNVERIFIABLE.

## Report-only
1. `about.jd.status.s12` ("6 must-haves kept · hard cap 8"). Evidence: design.py:179 asks the model for "(≤8)" in the prompt, and nothing in code truncates the model's list. Proposed English: "6 must-haves kept · prompted to stay under 8". The scene's "6 kept" is an example.
2. `landing.proof.cards.defend.body` ("in Czech or English"). Evidence: types.ts:42-48 says the UI sends only cs/en, but the server accepts any language tag. This is true of the UI today. Proposed: no change, or "(the interview UI offers Czech and English)".
3. `landing.features.inbox.title/body` ("five doors"). The five sources are not tied to a code enum that I checked. Proposed: pin them against the intake source list before keeping the count.
4. Trust, security and compliance rows (sealed chain, kill switch, GDPR Art. 22, EU AI Act, deterministic offer figure, enterprise ROI stats). These were not verified in this pass and are the operator's to own. Pin `offer.body` and the chain claim to code in a follow-up.
5. Claims held in app/ code (scene `data.ts`, `about-jsonld.ts`) were not inventoried.

## Gates
i18n:check OK; typecheck pass; lint 0 errors (49 pre-existing warnings); test:unit 13015/13015; scripts/kpi 85/85; test:docs all pass.

## Notes
CHANGELOG.md was not updated because it is dirty in the shared checkout.
