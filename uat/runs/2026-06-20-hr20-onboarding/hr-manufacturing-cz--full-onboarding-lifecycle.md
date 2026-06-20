---
run: 2026-06-20-hr20-onboarding
journey: full-onboarding-lifecycle
character: hr-manufacturing-cz
character_name: Lenka Veselá
role: HR Manager (výrobní závod, ~600 lidí, auto-parts, German parent)
cert_level: L1
method: code-grounded surface walk, no browser
language: cs
---

# L1 — Lenka Veselá vs. full-onboarding-lifecycle

> Lens: jsem personalistka **výrobního závodu** (~600 lidí, díly pro auto, německá
> matka). Ne banka, ne softwarehouse. Testuju jediné: **sedí výstup AI na výrobu a
> český výrobní trh v CZK, na zákoník práce a na nábor cizinců — nebo je to bankovní
> a IT šablona?** Jazyk neřeším (umím cs i de); řeším *obor*.

## Per-stage walkthrough (in-character)

**1. Post / ingest the role.** Otevřu Jobs, chci "Operátor výroby — třísměnný provoz".
Pozici naimportuju, JD builder funguje. Jenže celá role-taxonomie
(`data/taxonomy.json`) zná jen IT: python, react, devops, data, product/project. Žádný
operátor, seřizovač, kvalitář/OTK, údržbář, mistr, technolog, skladník, VZV. Role
families jsou **přesně tři** a všechny IT (`taxonomy.py:78-82`), default
`software_engineering`. Moje dělnická pozice spadne do IT rodiny a od začátku je matching
slepý.

**2. AI match / shortlist (real LLM).** Systémový prompt match-reasoningu je doslova
*"precise technical recruiter for the Czech tech market"* (`match_reasoning.py:22-25`).
Kontext, co dostane, je IT-tvarovaný: programming-language skills, seniority IT, role
family z té samé trojice. Pro operátora to nemá z čeho čerpat — bude to obecné nebo
vymyšlené. Seed je navíc 100 bankovních/IT pozic (`data/seed_jobs/jobs.json`, tři IT
families), takže i kdybych chtěla srovnání, nemám ve fixture jedinou výrobní roli.

**3. CV analysis / job-fit + salary (real LLM — Gemini).** Stroj je dobrý, ale platové
pásmo je **tech-only**: `data/salary_benchmarks.json` má `market: "...technology roles,
2026"` a tři rodiny (software_engineering, data_ai, product_project), CZK měsíčně.
`company_adjustments` jsou laděné na "Prague ICT / multinational R&D centres". Pro
operátora (reálně ~28–40k CZK) mi to nabídne IT junior pásmo 45–70k — číslo, kterým si
u mistra ani u německé matky neškrtnu. Měna CZK *sedí*, ale trh ne.

**4. Applicants in pipeline.** Pipeline board + drawer + consent existují
(`PipelineTab.tsx`, `consent.ts`) — strukturálně OK, neutrální vůči oboru. Bez výhrad
za můj svět.

**5. Screening decisions (real LLM).** Tady mě to mile překvapilo. Screen-wave má
**člověka v rozhodování** (dry-run preview, pak commit — `screen-wave.ts:189-193`),
**fail-closed fairness gate** (`screen-wave.ts:156-162`), a **tamper-evident auditní
záznam** s policy verzí a rationale (`sealDecisionSafe`, `screen-wave.ts:215-223`).
Atribuce auto vs. human je jednoznačná (`decision-attribution.ts:15-58`). Pro audit z
Německa i pro EU AI Act je to obhajitelné. Silná stránka.

**6. Interview schedule + prep + rubric.** Strukturálně přítomné (`schedule-slots.ts`,
`interview-rubric.ts`). Rubrika ale poběží z té samé IT lens; pro třísměnný provoz/OTK
roli L1 jen poznamenává, kvalitu doladí L2.

**7. Group-eval / fair pick.** Fairness + sanity checks přítomny
(`group-eval-run.ts`, `sanity-checks.ts`) — strukturálně OK, neutrální.

**8. Offer.** Accept ladí na konkrétní onboarding krok (`offer/[token]/page.tsx:200-209`),
deadline countdown (`:227-241`), idempotentní CAS (`offer-finalize.ts:40-58`). Offer
ukazuje holou částku + měnu (`page.tsx:185-191`) bez zobrazeného **základu** pásma — ale
flow je solidní. Mzda dědí mis-fit ze stage 3.

**9. Onboarding hand-off (deterministic).** Tady to pro výrobu padá. Default checklist
(`onboarding.ts:13-21`) = contract / ID+tax+bank / laptop / email accounts / buddy /
first-day / team intro — **čistá kancelář**. Pre-boarding dotazník
(`ENTRY_QUESTIONNAIRE_FIELDS`, `onboarding.ts:25-32`) = preferredName, **tshirtSize,
dietaryNeeds**, equipmentPrefs, emergencyContact, startDateConfirm. Žádná **vstupní
lékařská prohlídka**, žádné **BOZP/PO školení**, žádné **pracovní povolení /
zaměstnanecká karta** pro UA/SK, žádné OOPP. Kandidátská stránka renderuje přesně tenhle
fixní set (`onboarding/[token]/page.tsx:21-28`, cs labely "Velikost trička / Stravovací
požadavky" — `messages/cs.json::candidateOnboarding`). Checklist *jde* upravit per
template (`coerceTasks`, `onboarding.ts:41-56`), ale dotazníkové pole jsou **hardcoded
konstanta** bez UI úpravy — člověka na linku bez platné lékařské a BOZP pustit nesmím,
takže fixní kancelářský dotazník je pro mě právně i provozně nepoužitelný as-is.

## L1 findings

```yaml
- id: HRM-ONB-01
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-cz
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: senior-quality
  title: Role taxonomy is IT-only — no manufacturing role families (matching is blind to her whole workforce)
  expected: Taxonomie a role families pokrývají výrobní profese (operátor, seřizovač, kvalitář/OTK, údržbář, mistr, technolog, skladník/VZV), aby dělnický shortlist měl o co matchovat.
  got: Jen tři IT role families (software_engineering, data_ai, product_project); taxonomy.json je samé programming-language/framework/cloud/data/PM. Výrobní role spadne do software_engineering jako default a matchuje na IT skills.
  evidence: ['data/taxonomy.json:4-168', 'pipeline/jobfit/taxonomy.py:78-82', 'data/salary_benchmarks.json:6-28']
  code_check: confirmed-absent
  l2_priority: high
  verdict: blocker-for-her-industry (major on the shared rubric — completes structurally but output is empty/wrong for manufacturing)

- id: HRM-ONB-02
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-cz
  cert_level: L1
  type: quality-gap
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: trust
  title: Salary benchmarks are Prague-tech-only — blue-collar comp is mispriced (right currency, wrong market)
  expected: Platový odhad sedí na český VÝROBNÍ trh v CZK se základem (pásmo/seniorita/trh) — operátor ~28–40k, seřizovač/kvalitář výš, ne IT pásmo.
  got: salary_benchmarks.json = "technology roles, 2026", tři IT rodiny; company_adjustments laděné na Prague ICT / multinational R&D. Dělnická role dostane IT junior pásmo 45–70k. CZK sedí, trh ne; offer pak ukazuje holé číslo bez zobrazeného základu pásma.
  evidence: ['data/salary_benchmarks.json:2-28', 'data/taxonomy.json:170-191', 'app/offer/[token]/page.tsx:185-191', 'pipeline/jobfit/salary_band.py:20-33']
  code_check: confirmed-absent
  l2_priority: high
  verdict: major

- id: HRM-ONB-03
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-cz
  cert_level: L1
  type: missing-feature
  severity: major
  impact: { frequency: high, reachability: high, trust_erosion: high }
  dimension: missing
  title: Onboarding checklist + entry questionnaire are office-only — no entry medical exam, BOZP, or work permit for foreign workers
  expected: Nástup jde upravit (nebo nabízí preset) na výrobu — vstupní lékařská prohlídka, BOZP/PO školení, pracovní povolení/zaměstnanecká karta (UA/SK), OOPP; dotazníková pole upravitelná.
  got: DEFAULT_ONBOARDING_TASKS = contract/ID/laptop/email/buddy/first-day/intro; ENTRY_QUESTIONNAIRE_FIELDS = preferredName/tshirtSize/dietaryNeeds/equipmentPrefs/emergencyContact/startDateConfirm — hardcoded konstanta. Žádná lékařská/BOZP/povolení. Checklist lze přepsat per template (coerceTasks), ale dotazník nemá editaci přes UI.
  evidence: ['app/_lib/onboarding.ts:13-21', 'app/_lib/onboarding.ts:25-32', 'app/onboarding/[token]/page.tsx:21-28', 'messages/cs.json:candidateOnboarding']
  code_check: confirmed-absent
  l2_priority: high
  verdict: major (a worker on the line without vstupní lékařská + BOZP is a legal no-go; the fixed questionnaire is unusable as-is)

- id: HRM-ONB-04
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-cz
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: high, reachability: high, trust_erosion: med }
  dimension: senior-quality
  title: Match-reasoning persona is hardcoded "technical recruiter for the Czech tech market"
  expected: Lens reasoningu se přizpůsobí oboru pozice (výroba) — důvody o třísměnném provozu, CNC/seřizování, OTK, ne o programming languages.
  got: _SYSTEM prompt fixně "precise technical recruiter for the Czech tech market"; reasoning_context plní IT-tvarovaná pole (skills jako programming languages, IT seniorita). Pro výrobní roli generuje IT-rámovaný text.
  evidence: ['pipeline/jobfit/match_reasoning.py:22-25', 'pipeline/jobfit/match_reasoning.py:34-75']
  code_check: present-broken
  l2_priority: med
  verdict: minor at L1 (downstream of HRM-01; quality confirm at L2)

- id: HRM-ONB-05
  journey: full-onboarding-lifecycle
  character: hr-manufacturing-cz
  cert_level: L1
  type: quality-gap
  severity: minor
  impact: { frequency: med, reachability: low, trust_erosion: med }
  dimension: trust
  title: Bank/Czech-tech seed corpus can't represent her industry (no manufacturing fixture; single-tenant lock)
  expected: Mohu přinést/aspoň reprezentovat výrobní data, nebo aplikace přizná, že seed je bankovní a moje data nepokrývá.
  got: 100 seeded jobs, všechny tři IT families (jobs.json); workspace zamčen na default tenant (workspace-lock.ts, per journey out-of-scope). Pro mě nelze ve fixture ukázat jedinou výrobní roli — bank-vs-výroba mis-fit nelze obejít daty.
  evidence: ['data/seed_jobs/jobs.json:role_family (all 3 IT)', 'uat/journeys/full-onboarding-lifecycle.md:140-142']
  code_check: by-design
  l2_priority: low
  verdict: minor (known ceiling; bounds the "my data" fit question, not a fresh defect)
```

## Strengths (keep — do not touch)
- **Screening compliance machinery is genuinely senior-grade and jurisdiction-fit:**
  human-in-the-loop dry-run preview, fail-closed fairness gate, tamper-evident sealed
  decision record with policy version + rationale, clean auto/human attribution. Stands
  up to an EU AI Act / German-parent audit. (`screen-wave.ts:156-223`,
  `decision-attribution.ts:15-58`) — strength, dimension trust/completion.
- **Offer → onboarding hand-off has no dead-end:** accept lands on a concrete next step
  inline, deadline countdown, idempotent CAS so no double-onboarding.
  (`offer/[token]/page.tsx:200-241`, `offer-finalize.ts:40-58`)
- **Salary money invariant is single-sourced and disciplined** (CZK, rounded, plausibility
  ceiling, mirrored TS/Py) — the *machine* is right; only the *market data* is wrong for
  her. (`salary_band.py:20-66`)
- **Onboarding checklist IS editable per template** (`coerceTasks`) — the task list can be
  bent toward manufacturing even though the questionnaire fields can't.
- **cs localization is complete and correct** for her stages — language is not a finding.

## Per-journey verdict
**L1-conditional.** The thread completes end-to-end with no dead-end and strong
compliance, **but** three majors (taxonomy, comp, onboarding) mean every headline AI
output is bank/tech-shaped and would not clear her senior bar for a manufacturing plant.
Structurally sound, industry-fit failing — carry HRM-01/02/03 forward to L2.

## Grounding score per AI surface
Inputs scored: {real CV, real JD, role/industry taxonomy, market/industry comp, company
size, jurisdiction, prior pipeline history, her own data}.
- **Match / shortlist:** grounding **3/8** (real CV, real JD, pipeline history; taxonomy
  wrong-domain, comp wrong-market, no size/jurisdiction/own-data).
- **CV analysis / job-fit + salary:** **3/8** (real CV, real JD, jurisdiction-as-CZK;
  taxonomy + comp wrong-domain, no size, no manufacturing data).
- **Screening decisions:** **6/8** (real cohort, JD, jurisdiction, audit, history, human-
  in-loop; domain-neutral so not penalized — taxonomy bleed only via match score).
- **Interview prep / rubric:** **3/8** (IT lens; L2 to confirm).
- **Group-eval:** **5/8** (domain-neutral fairness; inherits match-score domain bleed).
- **Onboarding (deterministic, not LLM):** **2/8** (generic office defaults; editable
  checklist but fixed questionnaire; no industry/jurisdiction fit).
- **Overall grounding: ~3.5/8** — good machinery, wrong-domain context. Predicted defect
  confirmed.

## Estimated time-saved + adopt?
- If the taxonomy/comp/onboarding fit her industry, the **screening cut is real**: her
  ~15–20 h/week of manual line-hire triage → ~5–7 h (a 60–70% cut), and the compliance
  record would save audit prep. **Confidence: medium** (L1 structural; L2 to confirm
  prose quality + latency).
- **As shipped today: do NOT adopt.** The shortlist matches her workers on IT skills,
  prices an operátor like a junior dev, and onboards him with no vstupní lékařská / BOZP /
  pracovní povolení — she'd redo all three by hand, i.e. **slower than her current
  Excel + agency flow** for the parts that matter. Adoption flips to "yes, pilot" the
  moment manufacturing role families + CZK blue-collar bands + an editable
  medical/BOZP/permit onboarding preset exist.

## Felt verdict — Lenka, první osoba (cs)
"Stroj je chytrej, to se musí nechat — screening s náhledem, fair-gate co padá do bezpečí,
auditní záznam, na kterej se dá ukázat i matce v Německu. To bych brala hned. Jenže ten
mozek krmí banka a ajťáci. Dám mu operátora na třísměnný provoz a on mi z něj dělá juniora
od Pythonu, naceněnýho na pražský IT pásmo — číslo, se kterým bych u mistra propadla.
A nástup? Velikost trička a dietní požadavky. Já potřebuju vstupní lékařskou, BOZP a u
Ukrajinců zaměstnaneckou kartu — bez toho mi člověk na linku ze zákona nesmí. Checklist
si přepíšu, dotazník ne. Takže dneska: **nenasadím** — předělávala bych po AI to
nejdůležitější a byla bych pomalejší než s Excelem. Kámošce do výroby to teď nedoporučím.
Ale řeknu jí: *kdyby přidali výrobní profese, české dělnické mzdy a nástup s lékařskou a
BOZP, ozvi se mi — ten základ je dobrej.*"
