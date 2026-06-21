---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-retail-vp-volume
character_name: Brittany Walsh
role: VP Talent Acquisition (high-volume hourly), US retail chain ~25,000
cert_level: L1
language: en
verdict: L1-fail
grounding_overall: 2.4 / 8
---

# L1 — Brittany Walsh · full-onboarding-lifecycle

> L1 theoretical walk over the code-derived surface model. No browser. Every
> finding carries `file:line`; "missing/broken" claims are code-cross-checked
> before recording. My lens: high-volume US hourly — thousands of seasonal hires,
> req-to-offer in days, batch everything, cost-per-hire <$400, WOTC + I-9, comp
> in $/hr. Per-candidate AI prose that can't scale to 10,000 is a liability, not
> a feature.

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** Good news first: there's a bulk paste-ad path —
`IngestAdPanel` splits N ads on dashed separators and loops one hardened POST per
ad with a per-row result table (`app/features/sub_jobs/IngestAdPanel.tsx:37-43`).
That's the only place this app remembers I have volume. But there's no
"clone this req to 700 stores" — it's still author/paste-per-role. And when I look
at what the matcher actually *knows* about roles — `data/taxonomy.json` — it is
**100% tech/IT**: python, react, kubernetes, data_scientist, product_owner. There
is not one retail/hourly term: no cashier, stocker, sales associate, picker,
shift-lead. My entire workforce is invisible to the matching graph.

**2. AI match / shortlist.** The machinery (match_reasoning.py) writes a
per-candidate narrative. For a software hire to a recruiter carrying 15 reqs,
lovely. For me, screening 9,000 seasonal applicants, a paragraph each is a *cost*
— tokens I pay for and prose nobody reads. There is no "give me a yes/no/maybe
column for 9,000 rows" mode. The grounding is also tech-shaped via the taxonomy
above.

**3. CV analysis / job-fit + salary.** This is where the tool tells me who it was
built for. The Gemini prompt literally opens *"You are a precise HR tech analyst
for the Czech Republic technology market"* and mandates *"Salary numbers are
monthly gross CZK based on the current Prague/Czech tech market"*
(`pipeline/jobfit/gemini.py:423,433`). The benchmark file is **CZK-only, three
tech families, monthly** (`data/salary_benchmarks.json:2-3`), and the money
invariant hard-codes a **350,000 CZK/month** ceiling and 5,000-CZK rounding
(`pipeline/jobfit/salary_band.py:20-33`). A US cashier at $14/hr cannot be
expressed here. This is not "roughly right for my market" — it is wrong-domain and
wrong-currency by construction.

**4. Applicants in the pipeline.** Here the app finally meets me halfway: PIPE1
bulk-select mode lets me isolate a filtered cohort and **batch move / batch accept
/ batch reject** with a two-step confirm on bulk-reject (it emails N people) and a
result rollup (`app/features/sub_pipeline/PipelineTab.tsx:132-142`). That's real
throughput for advance/reject. Consent/AI-disclosure exists but is explicitly
**GDPR-framed** (`app/_lib/consent.ts:1-6`) — built for the EU, not my EEOC world.

**5. Screening decisions.** The screen-wave is a genuine batch operation over a
job's Screened cohort, with a dry-run **preview** before commit, a fail-closed
fairness gate, per-decision rationale, a sealed audit record, and queued rejection
comms (`app/_lib/screen-wave.ts:98-251`). Structurally this is the best part of the
app for me — it's batch, it's auditable, nobody gets silently auto-rejected. BUT:
the rationale and fairness framing are EU-shaped; there's no adverse-impact / 4/5ths
EEOC lens, and it's **per-job** (`screen-wave.ts:128`), not cross-req — I'd run it
700 times for the same cashier role across stores.

**6. Interview schedule + prep + rubric.** Self-scheduling invite + prep pack
exist, but per candidate. No "schedule these 300" batch. For hourly I want
auto-slot the whole accepted cohort; not here.

**7. Group-eval / fair pick.** Side-by-side N-candidate compare — designed for
choosing *one* from a small slate. Irrelevant at my volume; I'm not deliberating
over individual hourly cashiers.

**8. Offer.** Offers are single: `respondToOffer` is one-token, one-candidate
(`app/_lib/offer-finalize.ts:17`), minted per entry. No batch-offer the accepted
cohort. Offer currency *is* a stored field (`app/_lib/offers-store.ts:82`) so $/hr
isn't structurally impossible — but the numbers feeding it come from the CZK
pipeline above, and TTL is a fixed 7 days (`app/_lib/offer-policy.ts:9`), generous
for my apply-today-start-Saturday cycle but fine.

**9. Onboarding hand-off.** Deterministic, and on accept it auto-starts one run +
dispatches one onboarding link (`offer-finalize.ts:96-122`) — **one at a time**,
no bulk onboard. The default tasks are generic office: contract, ID/tax/bank,
**laptop & equipment**, email accounts, onboarding buddy, first-day plan, team
intro (`app/_lib/onboarding.ts:13-21`). Questionnaire fields: preferredName,
**tshirtSize**, dietaryNeeds, **equipmentPrefs**, emergencyContact, startDate
(`onboarding.ts:25-32`). That's a salaried-office welcome. My world is **I-9 /
E-Verify, W-4, direct deposit, WOTC, uniform size, shift/availability, store
assignment** — none of it here. Tasks are editable (`coerceTasks`, max 40,
`onboarding.ts:35-56`) so I *could* retype the checklist, but the structured
compliance artifacts (I-9, WOTC) aren't fields, just free-text labels — and e-sign
is an audit stamp, not real eIDAS/US e-sign (`onboarding.ts:1-6`).

## Findings

```yaml
- id: HRVOL-OB-01
  journey: full-onboarding-lifecycle
  character: hr-retail-vp-volume
  cert_level: L1
  type: quality-gap
  severity: blocker
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Comp pipeline is hard-coded CZK/month Prague-tech — cannot express a US hourly wage
  expected: A salary/offer read in US $/hr for my market, with a basis I can post legally.
  got: >
    The Gemini analysis prompt declares itself "a precise HR tech analyst for the
    Czech Republic technology market" and forces "monthly gross CZK"; the benchmark
    file is CZK-only / 3 tech families / monthly; the money invariant hard-codes a
    350k CZK/month ceiling and 5k-CZK rounding. A $14/hr cashier is inexpressible.
  evidence:
    - 'pipeline/jobfit/gemini.py:423'
    - 'pipeline/jobfit/gemini.py:433'
    - 'data/salary_benchmarks.json:2-3'
    - 'pipeline/jobfit/salary_band.py:20-33'
  code_check: confirmed-absent
  l2_priority: low   # the gap is fully visible in code; L2 would only re-confirm the wrong number
  verdict: 'A salary read I cannot legally use is worse than none. Blocker for my world.'

- id: HRVOL-OB-02
  journey: full-onboarding-lifecycle
  character: hr-retail-vp-volume
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy has zero retail/hourly roles — my whole workforce is ungrounded
  expected: Cashier, stocker, sales associate, picker, shift-lead as first-class taxonomy terms feeding the match.
  got: >
    data/taxonomy.json is entirely tech/IT (python, react, k8s, data_scientist,
    product_owner, scrum…). No retail/hourly/frontline term exists, so any
    matching/role-family vote for my reqs is guesswork on an off-domain graph.
  evidence:
    - 'data/taxonomy.json:4-168'
  code_check: confirmed-absent
  l2_priority: med
  verdict: 'Matching cannot reason about a job family it has never heard of.'

- id: HRVOL-OB-03
  journey: full-onboarding-lifecycle
  character: hr-retail-vp-volume
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: effort
  title: No batch offer and no batch onboarding — the back half of the funnel is per-candidate-only
  expected: Select the accepted cohort → one click offers all; accept → bulk onboarding dispatch.
  got: >
    respondToOffer / offer minting is single-token, single-candidate; on accept it
    starts ONE run and dispatches ONE onboarding link. Pipeline has bulk
    move/accept/reject (PIPE1) but offer + schedule + onboarding have no batch path.
    At 1,000s/week that's thousands of manual clicks — my cost-per-hire blows past
    target.
  evidence:
    - 'app/_lib/offer-finalize.ts:17'
    - 'app/_lib/offer-finalize.ts:96-122'
    - 'app/features/sub_pipeline/PipelineTab.tsx:132-142'
  code_check: confirmed-absent
  l2_priority: med
  verdict: 'Per-candidate offers/onboarding do not scale to high-volume hourly.'

- id: HRVOL-OB-04
  journey: full-onboarding-lifecycle
  character: hr-retail-vp-volume
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: No WOTC screening and no I-9/E-Verify — US-hourly table stakes are absent
  expected: WOTC eligibility capture at intake; I-9/E-Verify, W-4 as structured onboarding artifacts.
  got: >
    Grep for WOTC/I-9/E-Verify/tax-credit across app code returns only docs/messages,
    no feature. Onboarding default tasks are generic-office (contract, ID/tax/bank,
    laptop, accounts, buddy) and the questionnaire is tshirtSize/dietary/equipment —
    a salaried welcome. I lose $2,400–9,600/hire in uncaptured WOTC and can't run
    a compliant US hourly onboarding out of the box.
  evidence:
    - 'app/_lib/onboarding.ts:13-21'
    - 'app/_lib/onboarding.ts:25-32'
  code_check: confirmed-absent
  l2_priority: low
  verdict: 'In US hourly, WOTC and I-9 are the job, not a nice-to-have.'

- id: HRVOL-OB-05
  journey: full-onboarding-lifecycle
  character: hr-retail-vp-volume
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: trust
  title: Screening compliance is EU AI Act / GDPR-framed, not US EEOC / adverse-impact
  expected: An auditable screen with a US adverse-impact (4/5ths) / EEOC lens I can hand my legal team.
  got: >
    The screen-wave audit + fairness gate are solid and batch (a genuine strength),
    but the framing — and the consent module — are GDPR/EU. No EEOC, no 4/5ths
    adverse-impact reporting. Defensible in Prague, not pre-vetted for a US chain.
  evidence:
    - 'app/_lib/screen-wave.ts:98-251'
    - 'app/_lib/consent.ts:1-6'
  code_check: by-design   # built for a Czech bank; correct there, mis-fit for me
  l2_priority: med
  verdict: 'The bones are right; the jurisdiction is someone else’s.'

- id: HRVOL-OB-06
  journey: full-onboarding-lifecycle
  character: hr-retail-vp-volume
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: time-saved
  title: Match/analysis emits per-candidate prose with no volume yes/no/maybe mode
  expected: A bulk binary disposition column at scale; narrative only on demand for exceptions.
  got: >
    The match/analysis pipeline is built to produce a per-candidate narrative +
    full score breakdown. There is no "9,000 rows → yes/no/maybe" lane. At my
    volume the prose is a token cost I pay and never read — slower and dearer than
    roughing it, which fails the adoption test.
  evidence:
    - 'pipeline/jobfit/gemini.py:420-445'
    - 'pipeline/jobfit/pipeline.py:684'
  code_check: confirmed-absent
  l2_priority: med
  verdict: 'Eloquence-per-candidate is the wrong unit of work for high volume.'
```

## Strengths (what NOT to touch)
- **Bulk ad ingest** with per-row results and abort-on-unmount — the one place the
  app respects volume (`IngestAdPanel.tsx:37-47`).
- **Pipeline bulk-select** with batch move/accept/reject, two-step confirm on the
  irreversible bulk-reject, and a per-action result rollup
  (`PipelineTab.tsx:132-142`) — exactly the throughput primitive I need; extend it.
- **Screen-wave** is genuinely batch, with a dry-run preview, fail-closed fairness
  gate, sealed auditable record, and queued (never-ghosting) rejection comms
  (`screen-wave.ts:98-251`). Best-in-class machinery — just point it at my domain.
- **No silent success** in the flows I checked: bulk ops carry `{ok, failed, verb}`
  rollups; offer/onboarding dispatch failures record a durable reconcile event
  rather than a bare 500 (`offer-finalize.ts:111-121`).
- **Offer currency is a stored field** (`offers-store.ts:82`) — $/hr is structurally
  reachable once the comp source is fixed.

## Per-journey verdict
**L1-fail.** Two of my eight scored criteria are blocked at the structural level
before any live run: comp is inexpressible in $/hr (HRVOL-OB-01, trust blocker) and
the role taxonomy has no retail family (HRVOL-OB-02). Add the missing WOTC/I-9 and
the per-candidate-only back half (offer/onboarding), and the end-to-end thread does
not produce an output I'd put my name on for US hourly. The batch/audit bones are
strong — this is a domain-fit failure, not a machinery failure.

## Grounding score per AI surface
Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp,
company size, jurisdiction, prior pipeline history, my own data}.

| Surface | grounding | note |
|---|---|---|
| Match / shortlist (`match_reasoning.py`) | **3/8** | real CV+JD+pipeline reach it, but taxonomy is tech-only, comp/jurisdiction/size are bank-shaped, no retail roles. |
| CV analysis + salary (`gemini.py`, `salary_band.py`) | **2/8** | real CV+JD only; comp/market/jurisdiction explicitly hard-coded CZK-Prague-tech. |
| Screen-wave (`screen-wave.ts`) | **3/8** | real cohort + history + a fairness lens, but EU jurisdiction, no industry/comp/size. |
| Group-eval (`group-eval-run.ts`) | **2/8** | not built for my volume; off-domain. |
| Onboarding (deterministic) | **n/a (AI)** | generic-office defaults; editable but not US-hourly out of box. |

**Overall grounding: 2.4 / 8** — "good machinery fed wrong-domain context," the
predicted defect, confirmed in code.

## Estimated time-saved + adopt?
- **As built, for my world: net-negative.** The bulk ingest + pipeline batch +
  screen-wave *would* save a coordinator real hours IF the domain fit. But I'd
  retype every onboarding checklist, ignore an unusable CZK salary read, find no
  retail matching, do offers/onboarding one-by-one, and capture $0 WOTC. Cost-per-
  hire goes **up**, not toward my <$400 target. **Confidence: high** — the blockers
  are static-code facts, not latency questions L2 might rescue.
- **Adopt? No.** Not for high-volume US hourly today. (Confidence high.)

## First-person review — Brittany Walsh
"Look, the engine room is impressive. The screening wave with a preview and a real
audit trail, the bulk-reject that double-checks before it emails a few hundred
people, the ingest that eats a stack of ads at once — somebody who knows volume
built those, and I'd kill for them in my stack.

But this tool was built for a *bank in Prague hiring software engineers*, and it
never tries to hide it — the salary prompt literally says 'Czech Republic
technology market, monthly gross CZK.' I hire cashiers in Ohio at fourteen bucks an
hour by the thousand. There isn't a cashier in the taxonomy. There's no WOTC, no
I-9 — that's not a feature gap for me, that's the entire compliance spine of US
hourly hiring, and it's a 'tshirt size' field instead. My offers and onboarding go
out one human at a time, which at ten thousand seasonal hires is a non-starter; my
cost-per-hire would be worse than my current vendor, and cost-per-hire is the only
number my CFO cares about.

Trust? On the *machinery*, yes. On the *output for my world*, no — I can't post a
CZK monthly band on a US req, and I won't pay LLM tokens to write a paragraph about
a cashier nobody will read. What's missing for my industry: $/hr comp, a retail
taxonomy, WOTC + I-9/E-Verify, and batch offer/schedule/onboard.

Would I tell a peer? I'd tell my friend who runs **corporate/professional EU**
hiring to take a serious look — for *that* job this is sharp. For a high-volume US
hourly VP like me? I'd say 'great bones, wrong store' and keep moving."
