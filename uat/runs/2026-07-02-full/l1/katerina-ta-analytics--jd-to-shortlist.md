# L1 theoretical — Kateřina Svobodová (TA Ops & Analytics) × jd-to-shortlist

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1** (no browser)
- **Verdict: L1-conditional** — the score's basis is genuinely legible where the engine
  renders it (weight-aware breakdown, confidence drivers, fairness audit CSV, an honest
  calibration panel exists on my Analytics tab), but the shortlist surface itself drops the
  per-dimension breakdown it already receives, the two job-side surfaces (Jobs candidates vs
  Matrix) rank **different populations**, and nothing connects a shortlist score to outcome
  calibration — so "is 78 actually 78?" still needs my own spreadsheet.
- **Journey grounding score:** ranking **4.5/6** · reasoning **6/8 profile / 4/8 analysis**
  (shared audit — see petra report §2); **score-basis legibility: 3/5 surfaces render it.**
- **Estimated time-saved-if-it-all-worked:** ≈ **30–60 min per shortlist review/defense**
  (fairness CSV + breakdown replace my own re-scoring spreadsheet) · confidence **low** —
  my main value (calibration, spend, funnel) lives in other journeys; here I'm the auditor.

## 1 Surface model (my lens: where does the number come from, and can I audit it?)

Shared chain with Petra §1. What matters to me:

- **The score's construction is server-side and single-sourced:** archetype weights from a
  registry (`matching.py:43-51`), weight-aware breakdown computed in Python
  (`matching.py:432,623-640` → `MatchResult.score_breakdown`, `matching.py:193`) and rendered
  with zero client math on the Match tab (`MatchShared.tsx:160-198` — contribution widths,
  per-dim percent + weight). Confidence bands are constructed with named drivers
  (`matching.py:548-591`). This is auditable design, not decoration. ✓
- **Jobs-side shortlist card** (`RecruiterCandidates.tsx:412-553`): renders ScoreBadge,
  confidence range + band badge, fit tier, skills chips — but **not** the per-dimension
  breakdown, although `recruiter.py:84` ships it in every row (`result.model_dump`) and the
  client type simply omits it (`JobsTypes.ts:100-109` `CandResult` has no `scoreBreakdown`).
  Basis data on the wire, dropped at render. → JTS-L1-06.
- **Fairness matrix** — every candidate re-scored under every candidate's bounded weight
  scheme, robust mean + delta + full per-scheme CSV export
  (`recruiter.py:28-47`, `RecruiterCandidates.tsx:281-345`). This is the bias-defensible
  artifact a compliance review asks me for, generated per role. ✓ (strength JTS-S3)
- **Matrix tab** (in MY binding): candidate × position grid, per-cell reasoning popover
  (`MatrixTab.tsx:237-270`), localized KO keys (`MatrixTab.tsx:77-87`), CSV export of the
  grid as shown (`MatrixTab.tsx:344-356`). BUT its population is `listMatrixProfiles`
  (v2 profiles only, `app/api/matrix/route.ts:42`) × open positions from pipeline entries,
  while the Jobs shortlist ranks profiles + analyses (`candidate-pool.ts:46-66`) × any job.
  Same question ("who fits this role"), two surfaces, two populations. → JTS-L1-11.
- **Calibration:** `CalibrationPanel` exists on Analytics — reliability diagram + Brier
  score, honest below-minimum-outcomes gate (`app/features/sub_analytics/CalibrationPanel.tsx:10-14`).
  Nothing on the shortlist links a score to it. → part of JTS-L1-06's suggested acceptance.
- **Tenancy (ship-bar):** `/api/matrix` threads the session workspace
  (`app/api/matrix/route.ts:42` `await currentWorkspace()`), but the shortlist chain does
  not: `buildCandidatePool()` uses default-workspace reads (`candidate-pool.ts:49,57`),
  `writeMatchInput` → `getProfileRecord(id)` default (`match-input.ts:37`), and the jobs
  table has **no workspace column in its queries at all**
  (`app/_lib/db/jobs.ts:230-236,275-282`). In the multi-workspace product (`env.md` names
  multi-workspace tenancy) every tenant's shortlist would rank the DEFAULT workspace's
  candidates. → JTS-L1-04.

## 2 Grounding audit

Shared surfaces audited in petra report §2 (ranking 4.5/6; reasoning 6/8 / 4/8). My addition —
**outcome grounding**: neither the ranking nor the reasoning consumes any prior decision or
hire outcome (no source; `recruiter.py:50-90` inputs are candidate+job only). The confidence
band's drivers explain *input* uncertainty (`matching.py:563-585`), never *predictive*
accuracy. Until the calibration panel's outcomes loop back into how a 78 is presented, the
score is precise but unvalidated — my standing pet peeve, here structural: **0/1** outcome
sources reach the scorer, by design.

## 3 Reachability (before judging)

My binding: **Analytics, Matrix, Decisions, Billing** (`uat/characters/katerina-ta-analytics.md`).
No nav gating (`tabs.ts:98-153`) so I *can* open Jobs/Match, but my findings center Matrix +
Analytics. Matrix is reachable and non-empty **only with seeded v2 profiles + open pipeline
positions** (`/api/matrix/route.ts:42-45` returns empty otherwise) — fixture-gated, per
`env.md`. Analytics calibration needs enough recorded outcomes or it honestly shows the
uncalibrated state (a strength, not a block). Findings I raise on the Jobs-side card
(JTS-L1-06) are on a surface adjacent to my binding — frequency scored from the recruiters'
seat, trust from mine.

## 4 Cognitive walkthrough (in character)

1. *Will I try the right action?* From Pipeline "Rank candidates" deep-links into Matrix
   scoped to the role (`MatrixTab.tsx:90-92`) — that's my natural entry, and it exists. ✓
2. *Notice controls?* Min-fit floor, sort toggles, select mode, CSV — visible and labeled
   (`MatrixTab.tsx:384-419`). ✓
3. *Label→effect?* Blocked cells name their gate ("blocked: language" — `MatrixTab.tsx:77-87`),
   localized. Good: opposite actions for opposite gates.
4. *Feedback?* Bulk add has both aria-live announce AND a visible completion band
   (`MatrixTab.tsx:110-113,326-331`) — the pattern the Match tab lacks. ✓
5. *Does the result advance my job at my bar?* Partially. I can audit HOW a score was built
   (weights, contributions, drivers, per-scheme matrix) — better than my spreadsheet. I
   cannot audit whether it *predicts* anything from any shortlist surface; calibration is a
   separate panel with no thread connecting them. And the two job-side surfaces answering
   "who fits" from different populations means the numbers can't be made to reconcile —
   my funnel-reconciliation pet peeve, one level down.
6. *Trust?* The build is honest about its seams (uncalibrated state shown as uncalibrated,
   fallbacks labeled rule-based and left uncached) — that raises my trust. The population
   fork and the default-tenant reads lower it for the launched product.

## 5 Scored acceptance criteria (as applicable to this journey)

| Criterion | L1 result |
|---|---|
| trust — scores presented with calibration/basis, not bare fact | **~** — construction basis ✓ (breakdown/drivers/weights); predictive basis ✗ (no link from any score to the calibration panel; outcome sources 0/1) |
| clarity — each metric actionable / drill-down | **✓ on Matrix/Match** (breakdown, KO-named cells, popover reasoning); **✗ on the shortlist card** — breakdown shipped but unrendered (JTS-L1-06) |
| missing — reconciliation across views | **✗** — Matrix (v2 profiles × pipeline positions) vs Jobs candidates (profiles+analyses × any job) rank different populations (JTS-L1-11) |
| senior-quality — an artifact I'd put my name on | **✓ conditional** — the fairness per-scheme CSV (`RecruiterCandidates.tsx:152-164`) and the matrix CSV are leadership-grade audit artifacts; the missing outcome link keeps the ROI slide mine to build |
| completion (funnel) / missing (spend, decision logs) / time-saved (measured cut) | **n/a here** — analytics-funnel journey owns these |

## 6 Findings (this character; full schema in jd-to-shortlist.findings.json)

- **JTS-L1-06 · major(scoped)/minor · quality-gap (clarity/senior-quality)** — per-dimension
  score breakdown is computed and shipped in every ranked row but the shortlist card never
  renders it (`matching.py:623-640`, `recruiter.py:84` vs `JobsTypes.ts:100-109`,
  `RecruiterCandidates.tsx:446-545`); no surface links a score to the calibration panel.
- **JTS-L1-11 · minor · trust (reconciliation)** — Matrix and Jobs-candidates rank different
  populations for the same question (`/api/matrix/route.ts:42-45` v2-profiles-only ×
  pipeline positions vs `candidate-pool.ts:46-66` profiles+analyses × any job).
- **JTS-L1-04 · major (ship-bar) · trust (tenancy)** — shortlist chain reads the default
  workspace; jobs queries are tenant-blind (`candidate-pool.ts:49,57`, `match-input.ts:37`,
  `db/jobs.ts:230-236,275-282`) while `/api/matrix` already threads `currentWorkspace()`
  (`/api/matrix/route.ts:42`). Dormant behind the single-workspace dev gate; live on the
  public product path.
- Strength JTS-S3 (fairness audit CSV) and JTS-S2 (honest degrade/caching) co-signed.

**What passed (protect):** server-computed, zero-client-math score breakdown; named
confidence drivers; localized KO keys on Matrix; the honest uncalibrated state in
`CalibrationPanel` (never a fake curve); grid/fairness CSV exports.

## 7 l2_priority

1. Two workspaces seeded distinctly → run the shortlist + match in workspace B and confirm
   whose candidates rank (JTS-L1-04 — the ship-bar question).
2. Same role through Matrix and Jobs-candidates: do the ranked sets reconcile? Count the
   analysis-only candidates missing from Matrix (JTS-L1-11).
3. Is the breakdown really absent on the live shortlist card (vs hidden/overflowed), and is
   the score → calibration path truly unlinked end to end (JTS-L1-06)?
4. Calibration panel with seeded outcomes: does the minimum-outcomes gate behave as coded?

## 8 Character feedback — Kateřina, first person (cs)

> Ptám se vždycky stejně: co udělám v pondělí jinak? Tady aspoň vidím, JAK číslo vzniklo —
> váhy, příspěvky dimenzí, důvody šířky pásma, a matici „každý pod váhami každého" si
> vyexportuju do CSV. To je poprvé, co mi matching dává auditní stopu místo procenta
> s aureolou. A oceňuji poctivost: kalibrační panel radši ukáže „nekalibrováno" než křivku
> nakreslenou na pěti bodech. Takové přiznání zvyšuje důvěru, ne snižuje.
>
> Ale. Na samotném shortlistu — na obrazovce, kterou Petra pošle manažerovi — se rozpad
> skóre nezobrazuje, přestože ho server v každém řádku posílá. Číslo bez driverů je pro mě
> dekorace. Dál: Matrix a seznam kandidátů u role odpovídají na stejnou otázku nad JINOU
> populací — analýzy bez v2 profilu v Matrixu prostě nejsou. Čísla, která se nedají
> srovnat, přestanu reportovat. A jako vlastník rozpočtu musím říct nahlas: matching čte
> default workspace a tabulka jobů tenant nezná vůbec — v multi-workspace produktu je to
> průšvih dřív, než ho stihne někdo změřit. A hlavně: skóre pořád není spojené s výsledky.
> Dokud 78 % neumím položit vedle skutečných advance-rate, je to přesné, ale neověřené —
> a slajd „AI se nám vyplatila" si dál stavím ručně. Podmíněně: ano, ale ty švy sešijte.
