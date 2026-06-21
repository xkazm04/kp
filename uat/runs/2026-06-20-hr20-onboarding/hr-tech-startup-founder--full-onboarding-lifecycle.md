---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-tech-startup-founder
character_name: Maya Chen
role: Founder / Head of People (B2B SaaS, seed ~15, SF / remote US)
cert_level: L1
method: theoretical, code-grounded (NO browser)
language: en
---

# Maya Chen — L1 walk of full-onboarding-lifecycle

> Fit lens: 15-person SF startup, no ATS, hires generalist engineers + early GTM,
> fully remote, **equity-heavy comp**, onboarding = laptop + IP/equity docs + Slack.
> Senior bar: *would a founder trust an AI shortlist with no recruiter in the loop?*
> Central question per stage: does the output fit MY world, or is it bank-/Czech-shaped?

## Per-stage walkthrough (in character)

**1. Post / ingest the role.** I'd open Jobs and try to type "founding full-stack
eng, equity, remote US." The taxonomy (`data/taxonomy.json`) actually *does* carry
`company_startup`, `company_equity`, `company_remote`, `company_scaleup` tags
(:151-156) — pleasant surprise; it's not purely bank/office. Role families are
software/data/product, which covers my eng hires. So far, not bank-locked.

**2. AI match / shortlist.** The machinery exists (`match_reasoning.py` via
`/api/match/reasoning`). L1 can't judge prose quality (that's L2), but structurally
a reasoned shortlist is reachable. I want to see it name real CV facts — deferred.

**3. CV analysis / comp read.** This is where my world falls away. The Gemini
prompt is hardwired: *"You are a precise HR tech analyst for the Czech Republic
technology market"* and *"Salary numbers are monthly gross CZK based on the current
Prague/Czech tech market"* (`pipeline/jobfit/gemini.py:423,433`). The anchor band
(`data/salary_benchmarks.json`) is `"currency":"CZK"`, Czech tech, with a
plausibility ceiling of **350,000 CZK/month** (`salary_band.py:33`) — that's ~$15k
USD/month, so a normal SF senior eng base ($180–220k/yr ≈ $15–18k/mo) sits *at or
above the garbage-detection ceiling*. The prompt takes no industry / company-size /
market / currency parameter. Worse for me: equity is explicitly zeroed —
`company_modifier_effects.equity.factor_delta: 0.0` (`taxonomy.json:179`), "Equity
should be evaluated separately… no cash-band adjustment." For a startup offer that's
reading half the deal and then quoting the wrong half in koruna.

**4. Applicants in pipeline + consent.** Consent core is solid but Czech-shaped:
`CONSENT_TTL_DAYS = 365`, defaults cited to **Recruitis/Sloneek** (Czech ATSs),
GDPR anonymize-on-expiry (`app/_lib/consent.ts:8-10`). Fine machinery; framed for a
regulator I don't have.

**5. Screening decisions.** Genuinely good, and it answers my senior-bar question:
there IS a human in the loop. `runScreenWave` has a **dry-run preview** that commits
nothing (`screen-wave.ts:111-116,189-193`), a fairness gate that **fails closed**
(early-career + unknown archetypes shielded, :152-162), and every auto-reject is
sealed into a tamper-evident audit record (`sealDecisionSafe`, :215-223) with
attribution (`decision-attribution.ts:84-87` — three-state, never defaults unknown
to AUTO). I'd trust this to *propose*, with me committing. But the framing is EU AI
Act / GDPR; nothing speaks to US at-will / EEOC, which is the regime I'm actually in.

**6. Schedule + prep + rubric / 7. Group-eval.** Reachable; quality deferred to L2.

**8. Offer.** Offer page renders comp with **`currency ?? "CZK"`** as the default
(`app/offer/[token]/page.tsx:189`); `offer-finalize.ts` / `offers-store.ts` store a
currency but there's no USD/equity default for my market, and no equity/option-grant
field at all. Accept → onboarding is clean: the accepted token doubles as the
onboarding link and the page surfaces a concrete CTA inline (`page.tsx:194-209`),
not a dead-end. Good plumbing, wrong currency, no equity.

**9. Onboarding hand-off.** Chain works end-to-end: accept → `startRun` →
`dispatchOnboarding` (`offer-finalize.ts:102-110`) → candidate questionnaire page
(`app/onboarding/[token]/page.tsx`) → answers surface on the recruiter tab. Tasks
ARE editable per template (`coerceTasks`, `onboarding.ts:41-56`) — so the ceiling is
soft, not locked. BUT the `DEFAULT_ONBOARDING_TASKS` are pure generic-office —
"Collect ID, tax and bank details," "Assign an onboarding buddy," "Schedule team
intro" (:13-21) — with **no IP-assignment, no equity/option grant, no ship-laptop-
to-home** step, and the entry questionnaire (`tshirtSize`, `dietaryNeeds`,
`emergencyContact`, :25-32) has **no shipping address** — the one field a remote
day-one actually needs. I'd have to rebuild the whole default for my world.

---

## L1 findings

```yaml
- id: HR20-MAYA-01
  journey: full-onboarding-lifecycle
  character: hr-tech-startup-founder
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: CV/comp analysis is hardwired to the Czech/CZK market — no industry/market/currency input
  expected: >
    A US founder can get a comp read in USD (or set her market); the analysis
    prompt should receive industry / company-size / market / currency context.
  got: >
    The Gemini prompt is a fixed string: "precise HR tech analyst for the Czech
    Republic technology market" and "Salary numbers are monthly gross CZK based on
    the current Prague/Czech tech market." No market/currency/industry parameter is
    passed; the anchor band is CZK-only.
  evidence:
    - 'pipeline/jobfit/gemini.py:423'
    - 'pipeline/jobfit/gemini.py:433'
    - 'pipeline/jobfit/gemini.py:385'   # market_evidence = Prague/Czech signals
    - 'data/salary_benchmarks.json:2'   # "currency":"CZK", Czech tech market
  code_check: confirmed-absent
  l2_priority: high   # confirm the live comp read prints CZK for a US-startup CV
  verdict: 'Wrong-market headline AI output; major minimum per severity arbitration.'

- id: HR20-MAYA-02
  journey: full-onboarding-lifecycle
  character: hr-tech-startup-founder
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary plausibility ceiling (350k CZK/mo ≈ $15k) rejects normal SF eng comp as "garbage"
  expected: >
    A senior US engineer's base ($180–220k/yr) should be a valid, trusted figure.
  got: >
    SALARY_PLAUSIBILITY_CEILING = 350_000 CZK/month flags anything above as a data
    error "almost certainly a yearly figure mistaken for monthly." A real SF base
    sits at/above this ceiling, so a correct number would be flagged for manual
    review or distrusted.
  evidence:
    - 'pipeline/jobfit/salary_band.py:33'
    - 'pipeline/jobfit/salary_band.py:24-32'
  code_check: present-broken   # works as designed FOR CZK; broken for any non-CZK market
  l2_priority: med
  verdict: 'A correct USD figure is treated as garbage — silent trust erosion.'

- id: HR20-MAYA-03
  journey: full-onboarding-lifecycle
  character: hr-tech-startup-founder
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: missing
  title: Equity is invisible to comp output — the offer reads only cash; no option-grant field
  expected: >
    For a startup offer, comp output should value or at least acknowledge the
    equity/option component (base + grant + strike), the core of my offer.
  got: >
    company_modifier_effects.equity.factor_delta = 0.0 ("no cash-band adjustment");
    the offer page renders only a salary number (currency ?? "CZK"); offers-store /
    offer-finalize carry no equity/option-grant field. Equity — half my offer — is
    structurally absent.
  evidence:
    - 'data/taxonomy.json:179'
    - 'app/offer/[token]/page.tsx:185-191'
    - 'app/_lib/offer-finalize.ts:156-165'   # offerView returns currency+salary only
  code_check: confirmed-absent
  l2_priority: med
  verdict: 'Reads half the deal; a startup offer is base + equity.'

- id: HR20-MAYA-04
  journey: full-onboarding-lifecycle
  character: hr-tech-startup-founder
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Default onboarding tasks + questionnaire are generic-office, missing remote/IP/equity day-one
  expected: >
    A startup default that fits remote day-one: ship laptop to home address, sign
    IP-assignment + equity/option grant, add to Slack/GitHub. A shipping-address field.
  got: >
    DEFAULT_ONBOARDING_TASKS = contract/ID+tax+bank/equipment/accounts/buddy/
    firstday/intro — no IP assignment, no equity grant, no ship-to-home. Entry
    questionnaire has tshirtSize/dietary/emergencyContact but NO shipping address.
    Mitigant: templates ARE editable (coerceTasks), so the ceiling is soft.
  evidence:
    - 'app/_lib/onboarding.ts:13-21'
    - 'app/_lib/onboarding.ts:25-32'
    - 'app/_lib/onboarding.ts:41-56'   # editable — downgrades severity
  code_check: by-design   # editable per template; default just isn't startup-shaped
  l2_priority: low
  verdict: 'Editable, so minor — but the out-of-box default costs me a full rebuild.'

- id: HR20-MAYA-05
  journey: full-onboarding-lifecycle
  character: hr-tech-startup-founder
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: med }
  dimension: trust
  title: Compliance/consent framing is EU-AI-Act / GDPR only — no US at-will / EEOC framing
  expected: >
    A US employer needs framing for her regime (EEOC, at-will, IP assignment), or
    at least neutral framing — not copy that implies an EU-bank consent/anonymize regime.
  got: >
    Consent defaults are GDPR (CONSENT_TTL 365d, anonymize-on-expiry) citing Czech
    ATSs (Recruitis/Sloneek); the screening audit/fairness story is framed to EU AI
    Act. Strong machinery, single-jurisdiction framing. (Not a blocker: the human-
    in-the-loop + audit + AI-disclosure substance is real and travels.)
  evidence:
    - 'app/_lib/consent.ts:8-10'
    - 'app/_lib/screen-wave.ts:8-13'
    - 'app/_lib/decision-attribution.ts:81-87'
  code_check: by-design
  l2_priority: low
  verdict: 'Substance is sound and portable; framing is mono-jurisdiction.'

- id: HR20-MAYA-06
  journey: full-onboarding-lifecycle
  character: hr-tech-startup-founder
  cert_level: L1
  type: confusion
  severity: minor
  impact: { frequency: med, reachability: high, trust_erosion: low }
  dimension: trust
  title: Offer page defaults compensation currency to CZK
  expected: 'Offer comp shows my market currency (USD), or forces an explicit choice.'
  got: 'Offer page falls back to "CZK" when currency is unset (currency ?? "CZK").'
  evidence:
    - 'app/offer/[token]/page.tsx:189'
    - 'app/_lib/offer-finalize.ts:163'
  code_check: present-but-missed   # a currency field exists; only the DEFAULT is CZK
  l2_priority: low
  verdict: 'Currency is settable; the CZK default is the wrong default for my market.'
```

## Strengths (what NOT to touch)
- **Human-in-the-loop screening that earns founder trust** — dry-run preview commits
  nothing, fairness gate fails closed, every auto-decision sealed + attributed
  (three-state, never silently AUTO). This directly answers my "no recruiter in the
  loop?" fear: it proposes, I commit. (`screen-wave.ts:111-223`,
  `decision-attribution.ts:81-87`)
- **Taxonomy isn't bank-locked** — carries startup/equity/remote/scaleup company
  tags out of the box (`taxonomy.json:151-156`).
- **Accept → onboarding is a real next-step, not a dead-end** — accepted token
  doubles as the onboarding link with an inline CTA; questionnaire answers round-trip
  to the recruiter tab (`offer/[token]/page.tsx:194-209`, `onboarding.ts`).
- **Onboarding templates are editable** — `coerceTasks` bounds + cleans custom tasks,
  so I *can* build my IP/equity/ship-laptop day-one (`onboarding.ts:41-56`).
- **Blind-screening fails closed** — refuses to upload an un-redactable CV rather than
  leak identity (`gemini.py:405-413`). Tasteful.

## Per-journey verdict: **L1-conditional**
The thread completes end-to-end with no dead-end or silent success, and the
human-in-the-loop / onboarding plumbing is genuinely good. But two **majors**
(CZK-only comp prompt; SF comp rejected by the plausibility ceiling) plus a major on
invisible equity mean the *headline AI output does not fit my market* as shipped.
Completes, but below my senior bar → conditional, majors carry to L2.

## Grounding score per AI surface
(of {real CV, real JD, role/industry taxonomy, market/industry comp, company size,
jurisdiction, prior pipeline history, this Character's own data})

- **Match / shortlist reasoning** — ~5/8: gets real CV + JD + taxonomy + pipeline
  history; **missing** market/industry comp framing, US jurisdiction. (L2 to confirm
  prose names CV facts.)
- **CV analysis / comp read** — **3/8**: real CV + JD + (Czech) taxonomy; **missing**
  her market comp, company size, jurisdiction, equity, and her own data — comp is
  hard-coded Czech/CZK. The weakest surface for this Character.
- **Screening decisions** — ~6/8: solid pipeline/audit/fairness grounding; **missing**
  US jurisdiction framing and her own data (seed is bank).
- **Onboarding (deterministic, not AI)** — n/a for grounding; default content is
  generic-office but editable.

**Overall grounding: ~4.5/8.** Good machinery, but for *my* world the comp surface
is fed the wrong domain — exactly the "good machinery fed wrong-domain context"
defect the journey predicts.

## Estimated time saved + adopt?
- **If I could override market/currency/equity:** plausibly **15–25 hrs saved per
  early hire** — reasoned shortlist + human-gated screen + a reusable onboarding
  template — well past my <2-hrs-per-hire adoption line. *Confidence: medium* (L1;
  prose quality + latency unverified at L2).
- **As shipped, for my world:** comp output in CZK is *negative* value — I'd redo it,
  so net time-saved on the analysis surface is near zero until market is settable.
  *Confidence: medium-high* (hard-coded prompt, confirmed in code).
- **Adopt? Not yet — conditional.** I'd pilot the shortlist + screening tomorrow if
  the comp read spoke USD and the onboarding default were startup-shaped. The
  no-recruiter-in-the-loop trust question is *answered* (human-gated, audited). The
  blocker to adoption isn't trust — it's market fit and (unverified) pricing.

## First-person Character review (Maya's voice)
"Okay — the bones are better than I expected. The screening actually keeps me in the
loop instead of black-boxing a reject, and it shows its work, which is the thing I'd
need to not get sued and to sleep at night. The onboarding hand-off is a real link to
a real next step, not 'our People team will be in touch' — and I *am* the People team,
so I noticed. I could even edit the checklist into my world.

But the comp read is built for a Czech bank, full stop. It quotes me koruna per month,
it treats a normal SF engineer salary as a data-entry error, and it pretends equity
doesn't exist — when equity *is* my offer. That's not a polish gap; that's the tool
telling me it wasn't built for me. Same with the compliance copy: GDPR and EU AI Act
everywhere, nothing about at-will or my IP-assignment day-one.

Would I adopt? For shortlisting and screening — the moment it lets me set USD and my
market, yes, and I'd tell another founder. As shipped, I'd use the screening, ignore
the salary number entirely, and rebuild the onboarding default by hand. What's missing
for my world: a market/currency switch on comp, an equity field on the offer, a
ship-laptop + IP/option-grant onboarding default, and — the thing I can't even see yet
— a price that isn't per-seat. If there's a 'contact sales' wall behind this, I'm out
before I start."
