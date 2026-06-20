---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-logistics-eu-ops
character_name: Anke Brandt
cert_level: L1
method: code-grounded surface walk (no browser)
verdict: L1-conditional
---

# Anke Brandt (HR Operations Lead, Logistics/warehousing, DE/EU, ~4000) — L1 walk of full-onboarding-lifecycle

> *"Good machinery. But the data is a Czech bank, the money is in crowns, and
> nowhere can I show the Betriebsrat the AI-Act paperwork. Acceptable as a demo;
> not yet documentable for my world."*

## Per-stage in-character walkthrough

**1. Post / ingest the role.** The Jobs/Library tabs exist and roles ingest, but
the **role taxonomy is software/data/product/IT only** (`data/taxonomy.json`
terms list, :4-168) — Python, React, Scrum, SAP. There is **no Lagerist /
Kommissionierer / Staplerfahrer / shift-lead** vocabulary, no blue-collar
families. A warehouse JD has nothing to match against. *On what basis would this
rank my forklift drivers?* Already off my world.

**2. AI match / shortlist.** Machinery is real (match-reasoning pipeline), but it
votes role-family across `{software_engineering, data_ai, product_project}` only
(`data/taxonomy.json::role_family_votes` throughout). My roles don't exist in the
graph, so any reasoning is forced through a tech lens. I'd not put that in front
of a DC manager.

**3. CV analysis / job-fit — salary read.** Here's where I stop. The benchmark
file declares itself **`"currency": "CZK"`, `"market": "Czech Republic monthly
gross salary, technology roles, 2026"`** (`data/salary_benchmarks.json:2-3`) with
only `software_engineering / data_ai / product_project` bands (:6-28). The offer
page literally falls back to **`offer.currency ?? "CZK"`**
(`app/offer/[token]/page.tsx:189`). My comp is **EUR against a Tarif band**.
A Czech-crown tech salary is not a wrong number — it's a wrong *country*. **I
credit the provenance dossier** (`app/_lib/provenance-dossier.ts:9-26`, reachable
via `app/_components/results/ReportActions.tsx`): a Markdown record of *why* each
score is what it is, explicitly framed for "compliance review under the EU AI
Act." That is exactly the artefact I need — fed the wrong comp data.

**4. Applicants in the pipeline / consent.** The consent core is genuinely good:
GDPR data-processing consent with a **12-month TTL + erasure + anonymize-on-expiry
that scrubs PII but keeps non-identifying scoring artefacts**
(`app/_lib/consent.ts:8-58, 105-154`), surfaced to the recruiter at
`app/api/pipeline/[id]/consent/route.ts`. Data-minimization instinct: present.
But consent is **granted by the act of applying** (`recordEntryConsent(entry.id,
"apply")`, `app/api/apply/[id]/route.ts:448`) — *implied*, bundled, with **no
separate AI-screening opt-in**.

**5. Screening decisions — the human-in-the-loop test.** This is the strongest
stage and it mostly passes my hardest bar. `runScreenWave` has a **fail-closed
fairness gate** (early-career/unknown archetypes shielded,
`app/_lib/screen-wave.ts:152-162`), a **dry-run preview that commits nothing**
(:113-117, 189-193), a per-row **rationale** persisted to an audit event, and a
**tamper-evident sealed decision record** with actor `auto:screen-wave`, policy
version, and inputs (:215-223). Attribution is honest: a three-state
auto/human/unknown map that *refuses to default an unknown to AUTO*
(`app/_lib/decision-attribution.ts:84-87`). **But:** the wave *does* flip a
candidate to `reject` and queue a rejection email with **`actor: "system"`** and
no human approval gate in the path (`screen-wave.ts:204, 231-239`). It's a
*configurable* auto-reject, bounded by a fairness gate — but it is still a
**solely-automated rejection** when enabled. For me that's the EU AI Act / Art. 22
line, and there is no candidate-facing disclosure attached at the moment of the
automated reject.

**6. Interview schedule + prep + rubric.** Reachable; not my fit blocker (timezone
handling exists). Deferred to L2 for relevance to a shift-worker context.

**7. Group-eval / fair pick.** Fairness + sanity-check machinery present; L2 for
output quality.

**8. Offer.** Accept lands on a **concrete onboarding next-step** inline
(`app/offer/[token]/page.tsx:194-209`) and a deadline countdown (:228-239) — no
dead-end. Good. Currency default is the CZK problem above.

**9. Onboarding hand-off.** Accept token → pre-boarding questionnaire
(`app/onboarding/[token]/page.tsx`), answers surface on the recruiter tab — chain
is intact, **no dead-end**. But the defaults are **generic office**: tasks =
contract/ID/**laptop**/email accounts/buddy (`app/_lib/onboarding.ts:13-21`);
questionnaire = preferredName/**tshirtSize**/dietaryNeeds/equipmentPrefs
(:25-32). **Nothing about safety briefing, PPE, forklift licence, or shift
assignment.** Templates *are* editable via the API (`create_template` +
`coerceTasks`, `app/api/onboarding/route.ts:39-47`, `onboarding.ts:41-56`) — but
the **recruiter UI (`OnboardingTab.tsx`) exposes no template editor/creator**;
it only starts runs against the seeded default. So "editable" is true in code,
**unreachable in the UI** for me.

---

## L1 findings

```yaml
- id: ANKE-L1-01
  journey: full-onboarding-lifecycle
  character: hr-logistics-eu-ops
  cert_level: L1
  type: trust
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Screening wave can issue a solely-automated rejection (actor "system") with no human approval gate
  expected: Under EU AI Act high-risk + GDPR Art. 22, no FINAL adverse decision on a candidate without a human in the loop; an auto-reject must be queued for human approval or be advisory-only.
  got: runScreenWave flips status to "reject", seals the record, and queues the rejection email with actor:"system" — gated only by a fairness shield + a config toggle, with no human-approval step in the path.
  evidence: ['app/_lib/screen-wave.ts:169-243', 'app/_lib/screen-wave.ts:204', 'app/api/decisions/screen-wave/route.ts:11-26', 'app/_lib/decision-attribution.ts:39']
  code_check: present-broken
  l2_priority: high
  verdict: For Anke this is the one that blocks go-live; the dry-run preview (screen-wave.ts:189-193) is the seed of the fix but isn't an enforced human gate.

- id: ANKE-L1-02
  journey: full-onboarding-lifecycle
  character: hr-logistics-eu-ops
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Salary read is hard-anchored to CZK / Czech tech market — no EUR, no Tarif band, no logistics comp
  expected: Comp in EUR against a German/EU market or collective-agreement (Tarif) band for warehouse roles, with a basis.
  got: salary_benchmarks.json declares currency CZK, market "Czech Republic ... technology roles", three tech families only; offer page defaults to "CZK".
  evidence: ['data/salary_benchmarks.json:2-28', 'app/offer/[token]/page.tsx:189', 'pipeline/jobfit/salary_band.py:20-33']
  code_check: confirmed-absent
  l2_priority: med
  verdict: A wrong-country comp number is unusable in front of a German manager; the band machinery is fine, the data is foreign.

- id: ANKE-L1-03
  journey: full-onboarding-lifecycle
  character: hr-logistics-eu-ops
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Role taxonomy has zero logistics/warehouse/blue-collar vocabulary — all software/data/product
  expected: Taxonomy that represents Lagerist/Kommissionierer/Staplerfahrer/shift-lead families so a warehouse CV can be matched on its own terms.
  got: every term in data/taxonomy.json votes only software_engineering/data_ai/product_project; no blue-collar families exist.
  evidence: ['data/taxonomy.json:4-168', 'data/salary_benchmarks.json:6-28']
  code_check: confirmed-absent
  l2_priority: med
  verdict: Match/shortlist for her roles is forced through a tech lens; not defensible to a DC manager.

- id: ANKE-L1-04
  journey: full-onboarding-lifecycle
  character: hr-logistics-eu-ops
  cert_level: L1
  type: trust
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: No AI-specific candidate consent/disclosure — consent is implied by applying, no opt-in to AI screening, no Betriebsrat/co-determination concept
  expected: A distinct, candidate-facing AI-use disclosure + opt-in at application, plus internal documentation a works council / DPO can sign off (EU AI Act transparency).
  got: recordEntryConsent fires on apply (implied, bundled data-processing consent); AiDisclosure shows an "AI assists, a human decides" note but is informational, not a separate AI opt-in; no Betriebsrat/co-determination/EU-AI-Act-registration concept anywhere in app code.
  evidence: ['app/api/apply/[id]/route.ts:443-451', 'app/_components/AiDisclosure.tsx:8-31', 'app/_lib/consent.ts:8-14']
  code_check: present-but-missed
  l2_priority: high
  verdict: The disclosure component is a genuine strength but is not the granular AI opt-in the AI Act/Betriebsrat regime needs; downgraded from blocker because human-in-the-loop framing IS shown.

- id: ANKE-L1-05
  journey: full-onboarding-lifecycle
  character: hr-logistics-eu-ops
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: missing
  title: Onboarding defaults are generic-office; warehouse pre-boarding not editable from the recruiter UI
  expected: Editable-in-UI onboarding tasks/questionnaire for warehouse pre-boarding (safety briefing, PPE, forklift licence, shift assignment).
  got: DEFAULT_ONBOARDING_TASKS are contract/ID/laptop/accounts/buddy; questionnaire is tshirtSize/dietary/equipment. Templates are editable via the API (create_template/coerceTasks) but OnboardingTab.tsx exposes no editor — only "start run" against the default.
  evidence: ['app/_lib/onboarding.ts:13-32', 'app/api/onboarding/route.ts:39-47', 'app/features/sub_onboarding/OnboardingTab.tsx:26-90']
  code_check: present-but-missed
  l2_priority: med
  verdict: Editability exists in the data layer but is unreachable for her; the office defaults assume a knowledge worker.

- id: ANKE-L1-06
  journey: full-onboarding-lifecycle
  character: hr-logistics-eu-ops
  cert_level: L1
  type: trust
  severity: minor
  impact: { frequency: low, reachability: med, trust_erosion: med }
  dimension: trust
  title: Cannot bring her own (logistics/EU) dataset — workspace locked to the default tenant
  expected: Bring her DC corpus so outputs are tested against her real roles/market.
  got: multi-tenant isolation is locked to the default workspace.
  evidence: ['app/_lib/workspace-lock.ts']
  code_check: by-design
  l2_priority: low
  verdict: Known ceiling (per journey scope), not a fresh defect — but it bounds every fit answer above; she's judging bank data, not hers.
```

## Strengths (do not touch)
- **Human-in-the-loop is structural where it counts:** fairness gate fails closed,
  dry-run preview, per-row rationale, **tamper-evident sealed decision record**
  with actor/policy/inputs, and a three-state attribution map that refuses to
  default an unknown decision to AUTO. (`app/_lib/screen-wave.ts:152-223`,
  `app/_lib/decision-attribution.ts:84-87`) — exactly the audit spine a DPO wants.
- **GDPR data-minimization done thoughtfully:** consent TTL + erasure +
  anonymize-on-expiry that scrubs PII *but keeps* non-identifying scoring
  artefacts. (`app/_lib/consent.ts:105-154`)
- **EU-AI-Act-aware provenance dossier** — a per-analysis "why this score" record
  explicitly built for compliance review. (`app/_lib/provenance-dossier.ts:9-26`)
- **No dead-ends across the thread:** offer→onboarding inline CTA + deadline
  (`app/offer/[token]/page.tsx:194-239`); onboarding token chain intact
  (`app/onboarding/[token]/page.tsx`); comms failures isolated per-candidate, not
  fatal (`app/_lib/screen-wave.ts:230-242`).
- **AI-disclosure framing** ("AI assists, a human decides") present at the point
  of application. (`app/_components/AiDisclosure.tsx`)

## Per-journey verdict
**L1-conditional.** The thread completes end-to-end with no structural dead-end,
and the compliance *machinery* (audit, fairness gate, consent lifecycle,
provenance) is unusually strong. But it carries **one blocker for Anke** (a
solely-automated reject path) and **three majors** (CZK/foreign comp,
tech-only taxonomy, no granular AI opt-in/works-council concept) that are
existential for a German logistics HR-ops lead. Eligible for L2; the blocker +
majors carry forward.

## Grounding score per AI surface
Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, her own data}.
- **Match / shortlist:** **grounding 3/8** — real CV + real JD + pipeline history
  reach it, but taxonomy is tech-only, comp is CZK, jurisdiction/size/her-data
  absent.
- **CV analysis / salary read:** **grounding 3/8** — real CV/JD + a *basis*
  (provenance dossier), but the comp band is wrong-country, taxonomy tech-only,
  jurisdiction absent.
- **Screening wave:** **grounding 5/8** — strong on real inputs, history,
  auditable record; missing jurisdiction-correct human-gate policy, her data,
  industry framing.
- **Overall grounding: ~3.7/8.** Excellent machinery, **bank-/Czech-/tech-shaped
  context**. The predicted defect ("good machinery fed wrong-domain context") is
  confirmed for this Character.

## Estimated time-saved + adopt?
- **Est. time-saved (confidence: low at L1, est. only):** the screen-wave +
  audit-trail-for-free pattern *could* take her ~12-20h/wave bulk read toward
  ~4-6h **and** generate the DPO/works-council documentation as a byproduct — her
  stated adoption threshold. But that saving is **only realizable once the taxonomy
  and comp are EU/logistics-correct**; on the seeded bank data it's an
  illusion (she'd re-do every match).
- **Adopt? Not yet.** As shipped (bank/Czech/tech defaults + a solely-automated
  reject path + no works-council artefact + no in-UI logistics onboarding), it
  **fails her go-live test**. The bones are adoptable; the data and the one
  auto-decision path are not.

## First-person Character review
"Honestly? I came in skeptical and the *audit layer* surprised me — a sealed,
replayable decision record with a named actor and the policy version, a fairness
gate that fails closed, a consent lifecycle with real anonymization, and a
provenance dossier that names itself an AI-Act review artefact. Whoever built that
has sat across a table from a DPO. That's rare and I'd tell a peer to look.

But I cannot take it live in my world. The salary comes out in Czech crowns for
'technology roles' — my drivers earn euros on a Tarif band, so every comp number
is the wrong country. My roles — Stapler, Kommissionierer — don't exist in the
taxonomy at all, so the shortlist is a tech tool guessing at warehouse work. The
onboarding asks the new hire their T-shirt size when I need a forklift licence and
a shift, and I can't even edit that from the screen I'm given. And the screening
wave will *reject a person on its own* when I switch it on — that is precisely the
line the EU AI Act and Art. 22 draw, and the Betriebsrat will block it on sight,
because there's no AI opt-in for the candidate and no co-determination artefact
for the council. Build me a logistics taxonomy, EUR/Tarif comp, an
approval-gated wave with a candidate AI notice, and a checklist I can edit — keep
every bit of that audit spine — and we talk. Today: a strong demo, not a
documentable system. Acceptable; not yet adoptable."
