# L1 — Kateřina Svobodová (TA Operations & Analytics Manager)

Run: l1-2026-06-19 · Cert level: **L1 (theoretical, code-grounded, no browser)**
Surface binding: Analytics (funnel/calibration/spend/targets), Matrix, Decisions (records), Billing.
Language judged: cs (primary internal-user locale).

---

## Per-journey verdicts

| Journey | Verdict | Blocker | Major | Minor | Polish | Strengths |
|---|---|---|---|---|---|---|
| analytics-calibration | **L1-conditional** | 0 | 2 | 1 | 0 | 4 |
| jd-to-shortlist | **L1-pass** | 0 | 0 | 1 | 0 | 2 |

Reachability: both journeys' surfaces are reachable for an internal user once the dev gate (`kp_dev_authed=1`) is on — **no per-role nav gating** (`app/features/tabs.ts`). Reachability reduces to "is there seeded data behind the tab." All required seeders exist (`pipeline/jobfit/seed_jobs_csas.py`, `seed_pipeline.py`, `seed_candidates.py`, `eval/seed_cv_fixtures.py`), so the charts are non-empty given the canonical snapshot. **One reachability caveat carried to L2:** the calibration curve and the leadership-grade time-saved story both need *seeded outcomes* (dispositions) — without ≥20 disposition'd analyses the calibration panel honestly shows "Zatím nekalibrováno" (a strength, not a fail), and the ROI ledger shows only counterfactual estimates. L2 must load outcome pairs to exercise the grounded path.

---

## Journey 1 — analytics-calibration → **L1-conditional**

### Grounding audit (does every number tie to a decision?)

**Calibration is genuinely MEASURED, not asserted — this is the crux and it passes.**
`computeCalibration` (`app/_lib/calibration.ts:62-99`) bins real `(score, outcome)` pairs into a 10-bin reliability curve + Brier score, gated behind `MIN_CALIBRATION_OUTCOMES = 20` (`calibration.ts:15`). The pairs are real outcomes, not vibes: `calibrationPairs` (`app/_lib/db/analyses.ts:108-126`) reads the saved fit `score` as the prediction and the recruiter's `disposition` (`advance`=1 / `pass`=0) as the outcome, **excluding ambiguous `hold`/undecided rows** (`analyses.ts:103-104,114`) so the curve isn't polluted. The panel (`CalibrationPanel.tsx:94-102`) refuses to draw a curve under the gate and says exactly how many more outcomes are needed (`uncalibratedBody`: "Kalibrace potřebuje alespoň {min} … Zatím: {n}."). `?roleFamily` filters per family (`route.ts:17-21`). This is exactly the calibration view her senior-quality bar demands and directly defuses her #1 pet peeve ("AI confidence: 87% with nothing behind it"). **Strength.**

**Confidence/match scores elsewhere are also banded, not bare.** The Match cards carry a confidence band with named drivers, not a false-precision point (`MatchCard.tsx:87-90,167-171`) — consistent with the calibration philosophy.

**Cost-per-hire has real per-hire attribution.** `costPerHireCzk = spendCzk / hired` and `costPerApplicantCzk = spendCzk / total`, computed per inbound channel (`app/_lib/db/analytics.ts:426-427`), and **honestly nulled** when there's no spend, zero hires (no infinity), or a windowed cohort against a lifetime spend figure (`analytics.ts:419-427`). This is precisely "spend with per-hire attribution," not a lump total. **Strength** — clears her "no attribution → major" criterion.

**Decision logs/records are accessible from the analytics surface.** `DecisionLog` (paginated, exportable, auto/human-attributed per `DECISION_META`, `DecisionLog.tsx`) and `DecisionRecordsPanel` (tamper-evident hash chain + verify badge + dossier export, `DecisionRecordsPanel.tsx`) are siblings on the Analytics tab (`AnalyticsTab.tsx:323,406`). Records now seal many decisive kinds — `auto_rejected`, `offer_terms`, `reinstated`, `ai_scorecard`, `human_scorecard`, `group_eval_lead` (`sealDecisionSafe` call sites) — capturing actor, policyVersion, rationale and the decisive inputs (`decision-record-store.ts:79-90`). **Strength** (and satisfies Lucie's audit bar too). *Minor:* the route/panel copy still says "today: the auto-rejections" / "Každé automatické zamítnutí" (`records/route.ts:11`, `decisionRecords.blurb`) — stale now that six kinds seal; under-sells the feature.

### Where it falls short of her bar (the two majors)

1. **Time/cost saved is an ESTIMATE, not MEASURED against her manual baseline.** The ROI ledger headline "≈ {hours} hodin nábořáře · ≈ {czk} Kč" (`analytics.roi.headline`) is `Σ(count × MINUTES_SAVED_PER_KIND[kind]) ÷ 60 × rate` (`automation-roi.ts:55-74`) — a flat, hand-set minutes-per-action table (`automation-roi.ts:14-29`) at a default 600 CZK/h (`:34`). The per-action minutes are *stated and override-able* (honest — a strength), and grounded in the real event trail. **But her core adoption test is the ~23h-screening / ~13h-sourcing manual baseline and the 60–70% screening-time cut**, and nothing computes a *cut against that baseline*. There is no "X% of screening time eliminated" figure; `grep` for any baseline/cut constant in `automation-roi.ts` finds only the rate and the conversions (`:34,72-73`). She'd read the CZK number as plausible but undefendable upward ("where's the 60–70% you promised, against what?"). Per the rubric a time-saved metric that's claimed-but-unmeasured-against-baseline is **major minimum**.

2. **No single leadership-ready ROI readout she'd put her name on.** The pieces she needs for the "the AI paid for itself" slide are scattered: automation %/split + ROI hours/CZK in one panel (`AnalyticsTab.tsx:306-311`), cost-per-hire in the channel-economics table much lower (`:325-332`), calibration in another panel (`:321`), time-to-hire in the top-right stat cluster (`:150-166`). There is no consolidated, exportable "ROI / payback" view that ties *automation savings → cost-per-hire → time-to-fill movement* into one defensible figure. CSV exports exist per-panel (roles, ROI ledger, decision dossier) but not a single board-ready readout. For a senior analytics owner whose JTBD is literally "prove it upward," this is **major** (senior-quality / missing).

3. *(Minor)* Stale decision-records copy (above).

### Cognitive-walkthrough notes
- "Will I notice the control?" — yes; funnel bars, role rows, stage-dwell, and bottleneck all deep-link to the board cohort (`boardHref`, `AnalyticsTab.tsx:78-79,190-193,247-249`), so every chart ends in a click-through. That's exactly her "every number ends in a decision" demand. **Strength.**
- "Do I trust it?" — calibration + banded confidence + tamper-evident records earn trust on the *score* and the *audit*; the *ROI* number is where trust thins (estimate, not measured cut).

---

## Journey 2 — jd-to-shortlist → **L1-pass**

Walked from Kateřina's lens only (the score's basis + calibration), since Petra/Jana own the ranking workflow itself.

- **Score basis is legible.** Each `MatchCard` renders a per-dimension `ScoreBreakdown` (`MatchCard.tsx:152-153`, `MatchShared` `ScoreBreakdown`) plus a confidence band with named drivers (`:87-90,167-171`), not a bare number. She can see *why* the 90 is a 90 — clears her "a number I can't calibrate" worry, and it ties to the calibration panel's outcome validation. **Strength.**
- **Degrade seam is disclosed.** Past the `ai_candidates` allowance (or a missing key) `runReasoning` pushes `--no-llm` and serves the deterministic template (`reasoning-run.ts:63`), and the UI **labels it** — `source === "llm" ? "LLM" : "pravidlové"` with an optional "z mezipaměti" cached suffix (`MatchShared.tsx:74`, cs keys `sourceLlm`/`sourceRuleBased`/`cachedSuffix`). A template verdict is never passed off as AI-reasoned. **Strength** — exactly the honesty her senior bar requires.
- **Reasoning + score are bound to real inputs.** Cache key content-addresses both the job payload and the candidate keyPart plus a corpus fingerprint (`reasoning-run.ts:73-80`), and an ingested `--job-id` is scored against the live DB corpus, not the stale seed (`reasoning-run.ts:49-57`). Structurally the reasoning *can't* be generic boilerplate disconnected from this CV/JD.
- *(Minor)* The reliability story is split: the *per-candidate* score basis lives on the Match card, while the *aggregate* calibration of those scores lives on the Analytics tab. There's no link from a candidate's confidence band to "here's how calibrated a 90 actually is" (the calibration panel). For her, one cross-link would close the loop between an individual pick and the proven reliability of the score behind it.

L2 priority (for Petra/Jana's run, noted for completeness): assert the reasoning narrative actually names this candidate's skills and JD-specific gaps; confirm an ingested job ranks; budget 30–130s cold, fast on `cached:true`.

---

## First-person feedback — Kateřina's voice (cs/en mixed, as she'd talk)

> Tak za prvé: ta kalibrace mě dostala. Konečně někdo nemává procentem "AISebevědomí 87 %" a nechce, abych tomu věřila — místo toho mi ukáže spolehlivostní křivku z reálných rozhodnutí, Brierovo skóre, a když nemá dost dat, **napíše mi to rovnou** — "Zatím nekalibrováno, potřebuju 20, mám 7." To je přesně poctivost, kterou bych čekala od sebe. To si beru. A cost-per-hire dělený skutečnými nábory, ne paušál — díky bohu. To dashboardy, co jsem viděla, neuměly.
>
> Co mě ale nepustí před vedení: ten řádek "≈ 142 hodin · ≈ 85 200 Kč ušetřeno." Je hezký, je poctivě postavený na sazbě, kterou si můžu přepsat — ale je to **odhad ze sazebníku minut na akci**, ne změřená úspora proti mojí lince. Moje obhajoba nahoru zní "screening dřív žral 23 hodin na nábor, mělo se to seříznout o 60–70 %." Tohle číslo mi na tu větu **neodpovídá**. Nikde nevidím "kolik procent screeningového času jsme reálně ubrali proti baseline." Bez toho je to pořád můj odhad na ubrousku, jen hezčí.
>
> A pak — chci **jeden** list, co vezmu na poradu: úspora automatizace → cost-per-hire → pohyb time-to-fill, jedno číslo, jeden export. Místo toho lovím ROI v jednom panelu, cost-per-hire o tři panely níž, kalibraci jinde. Ta čísla jsou dobrá; jen nejsou **složená do té jedné slajdy, na kterou dám svoje jméno.**
>
> Verdikt: adoptovala bych to — kostra je seniorní, ne dekorace, a každý graf končí proklikem. Ale než to obhájím rozpočtově, potřebuju (1) změřený screeningový seříznutí proti baseline a (2) jeden leadership-ready ROI readout. Dej mi tyhle dvě věci a beru to nahoru bez váhání.

---

## What passed (strengths worth protecting)
- Measured calibration with an honest under-data gate (`calibration.ts`, `analyses.ts:108-126`) — do not water this down to a vanity "accuracy %".
- Per-hire cost attribution with honest nulling (`analytics.ts:419-427`).
- Tamper-evident, exportable decision records + auto/human-attributed decision log on the analytics surface.
- AI-vs-rule-based reasoning provenance disclosed in the UI (`MatchShared.tsx:74`) — never launders a template as AI.
- Every chart deep-links to its cohort on the board (`boardHref`).
