# L1 — Kateřina Svobodová (TA Operations & Analytics) × analytics-calibration

- **Run:** 2026-07-02-full · main @ 3395b4c · cert level: **L1 (theoretical, code-derived)**
- **Verdict:** **L1-conditional** — the designed dashboard is genuinely decision-anchored (every chart drills to a board cohort, calibration is measured not asserted, the UAT-M7 leadership readout closed both of my 06-19 majors), but two majors stand: the funnel/ROI aggregates are not tenant-scoped (a demo/sim run pollutes the numbers I'd defend to leadership) and the AI's own compute cost never reaches the ROI readout (and the new llm_usage ledger it would come from is only partially fed).
- **Grounding score:** **5/7** (pipeline entries/events ✓ · decision-attribution map ✓ · recruiter-set targets/rate/baseline ✓ · channel spend ✓ manual-lifetime · ROI minutes = stated estimates ✓ · AI compute cost ✗ unjoined · tenant scoping ✗)
- **Time saved (designed):** funnel + spend + ROI reconciliation goes from "a day or two per reporting cycle stitched from ATS export + spreadsheet + memory" to minutes on one tab with per-panel CSVs — est. **~8–14 h saved per reporting cycle** · confidence **medium** (conditioned on AC-L1-001: if demo/sim rows can sit inside my funnel, I re-audit every number by hand and the saving collapses; and on AC-L1-003: the net-ROI slide still needs a manual AI-cost join)

## Reachability (resolved before judging)

Internal user, dev gate on; my binding is **Analytics (funnel/calibration/spend/targets), Matrix, Decisions (records), Billing**. Analytics tab `app/features/tabs.ts:137`, Matrix `:138`, Decisions `:103` — no per-role nav gating, so reachability = "is there seeded data behind the tab". Fixture dependency: calibration needs **≥20 decided analyses** (`app/_lib/calibration.ts:15`, `uat/env.md` fixture #3) — below that the panel honestly says "not yet calibrated", which is a fixture gap at L2, not a code bug. One caveat inside my set: the **Models** tab's usage panel is operator-gated (`app/api/llm/usage/route.ts:25-28` → `app/_lib/auth/require-operator.ts:22-38`) — open-mode dev passes, but in a gated deploy a TA-ops manager may not hold the operator session; findings on it carry reachability **med**. No out-of-set findings.

## Surface model (affordance → code, import chains followed)

**1. Funnel & headline stats — real rows, honest math, one tenancy hole.**
- `/api/analytics` (`app/api/analytics/route.ts:23-38`) → `pipelineAnalytics()` reads `pipeline_entries` snapshot-style (`app/_lib/db/analytics.ts:129-138`): reached/current per canonical stage (`:173-186`), TTH as arithmetic mean of created→Hired (`:188-192`), dwell + small-sample-guarded bottleneck (`:200-215`), KO-gate loss surfaced as top-of-funnel line (`:231-241`), momentum from events (`:284-296`), source/channel/variant economics (`:335-466`), recruiter goals (`:498,507-547`), period deltas only when a window gives a well-defined previous period (`route.ts:33-37`).
- **But the SELECT has no `workspace_id` filter** (`:132-138`) although the column + index exist (`app/_lib/db/core.ts:672,688`) and inserts default to `'workspace'` (`app/_lib/db/pipeline.ts:583`) — while the sibling calibration route IS tenant-scoped (`app/api/analytics/calibration/route.ts:18`). `/api/demo` documents the seam itself: "~28 unscoped tables" (`app/api/demo/route.ts:29-34`) → **AC-L1-001**.

**2. Calibration — the crux — measured, gated, filterable (strength).**
- `calibrationPairs()` reads every workspace-scoped saved analysis with a decided disposition (`app/_lib/db/analyses.ts:100-126`; `hold`/undecided excluded by design) → `computeCalibration()` bins into a 10-bin reliability curve + Brier score, `calibrated` only at n≥20 (`app/_lib/calibration.ts:62-99`). The panel refuses to draw under-data curves and says exactly how many outcomes are missing (`CalibrationPanel.tsx:134-142`, `messages/cs.json:2764-2765`); `?roleFamily` + a data-driven family selector answer "how accurate for backend?" (`calibration/route.ts:22-23`, `CalibrationPanel.tsx:109-123`). No hardcoded confidence anywhere on the path.
- Ceiling: the outcome is the **recruiter's screen disposition**, not hire/retention — honestly labeled ("zda skóre předpovídá rozhodnutí náboráře", `cs.json:2759`) → **AC-L1-006**.

**3. Spend & ROI — attribution real, the AI's own cost missing.**
- Channel CPA/CPH divide recruiter-entered spend by real cohort counts with honest nulls (no spend / zero hires / windowed-vs-lifetime → "—", `db/analytics.ts:424-431`); blended cost-per-hire same rule (`:468-473`). Spend is one lifetime figure per channel → no per-period cost trend (**AC-L1-005**).
- Automation ROI: real event-kind counts × stated per-action minute estimates (`app/_lib/automation-roi.ts:14-29`), override-able rate (`:34`, editable in-UI `AnalyticsTab.tsx:559-565`), and — **new since 06-19, closes kat-ac-01/02** — per-hire framing vs a stated 42h manual baseline with `pctOfManualBaseline` capped at 100 (`automation-roi.ts:41,93-104`) rendered as the three-figure leadership readout + one CSV (`AnalyticsTab.tsx:489-548`) → **AC-L1-S1**.
- **The llm_usage ledger now exists** (`core.ts:513-528`, insert/ingest `app/_lib/db/llm.ts:111-159`, Models UsagePanel `app/features/sub_models/UsagePanel.tsx:11-16`) — the 06-20 tiger finding "~100% traffic unmetered" is structurally answered **for Python-spawned calls only**: it is written solely by the spawn sidecar ingest (`usage/route.ts:12-13`, `python-runner.ts:113-116`); the TS-side GitHub deep-dive calls Gemini directly with no meter (`app/api/github-analysis/route.ts:4,20`) and voice (OpenAI Realtime / ElevenLabs) is billed in minutes, never costed into the ledger → **AC-L1-002**. And nothing joins that USD cost to hires/roles on Analytics → **AC-L1-003**.

**4. Decision anchoring — the "so what" is wired (strength).** Funnel bars, dwell rows and the bottleneck banner deep-link into the board pre-filtered to exactly that cohort with tab-scoped params cleared (`AnalyticsTab.tsx:80-81,190-196,249-254,266-268`; `tabs.ts:210-240`); holds link to the Decisions queue (`:451-462`); goals set the thresholds the funnel flags against (`:276-281,941-989`). DecisionLog (paginated, auto/human-attributed, CSV) and the sealed DecisionRecordsPanel are siblings on this tab (`:410,327`).

**5. One number, two labels.** The TTH stat says "průměr" (`AnalyticsTab.tsx:153-155`) while the leadership readout labels the same `avgTimeToHireDays` "medián" (`:544-546`, `cs.json:2816`); the computation is a mean (`db/analytics.ts:188-192`) → **AC-L1-004**. Exactly my pet peeve: numbers that don't reconcile across views — here it's one number whose *labels* don't reconcile.

## Scored acceptance criteria (applied identically every run)

| Criterion | Verdict |
|---|---|
| completion — funnel all stages, drop-off per stage, reconciled | **pass** — reached/current/conversion per stage + KO-loss line + dwell; all panels feed off one payload |
| trust — confidence scores shown with a calibration basis | **pass** — measured reliability curve + Brier + honest n≥20 gate (AC-L1-006 ceiling: disposition proxy, not hire/stay) |
| missing — spend with per-hire attribution | **pass** — per-channel CPA/CPH + blended CPH, honest nulls (AC-L1-005: lifetime-only; AC-L1-003: AI cost absent) |
| time-saved — measured vs manual baseline | **pass (structurally, new)** — % of 42h stated baseline per hire, pending L2 (AC-L1-S1); per-action minutes are stated estimates, not measurements |
| clarity — every metric actionable / drills down | **pass** — chart→board cohort deep links throughout (AC-L1-S3) |
| missing — decision logs accessible from analytics | **pass** — DecisionLog + sealed records on the same tab |
| senior-quality — leadership-ready ROI readout I'd sign | **conditional** — the readout exists and exports, but AC-L1-001 (tenancy) undermines every number in it, AC-L1-003 leaves net-ROI uncomputable, AC-L1-004 mislabels a statistic in it |

## Findings (mine — full schema in `analytics-calibration.findings.json`)

AC-L1-001 (major), AC-L1-002 (major), AC-L1-003 (major), AC-L1-004 (minor), AC-L1-005 (minor), AC-L1-006 (minor), AC-L1-007 (minor, carried forward from kat-ac-03). Strengths AC-L1-S1..S3.

## Character feedback (first person, Kateřina)

„Řeknu to narovinu: tohle je poprvé, co mi kalibrační panel neukázal ‚AI confidence 87 %' jako dekoraci. Spolehlivostní křivka z reálných párů skóre→rozhodnutí, Brierovo skóre, a pod dvaceti výsledky mi řekne ‚ještě nejsme kalibrovaní' místo falešné křivky — to je přesně ta poctivost, kterou od dodavatele chci. A konečně mám čtení pro vedení: ušetřený čas jako procento z uvedených 42 hodin na nábor, náklad na nábor, doba do náboru — v jednom bloku, s jedním CSV. Loni v červnu jsem tu psala, že to musím skládat z pěti panelů; někdo to četl.

Proč tedy podmíněně? Protože čísla, která nesou moje jméno, musí být MOJE čísla. Funnel se sčítá přes všechny workspace — když si obchodník pustí demo simulaci, jeho fiktivní kandidát mi přistane v konverzích, zatímco kalibrace o patro níž se filtruje správně. Dva panely na jedné stránce, dvě pravidla — to na QBR neustojím. A návratnost: ukazujete mi, kolik hodin náborářů AI ušetřila, ale ne kolik ta AI stála — ledger nákladů už existuje, jenže sedí v dolarech na operátorské záložce Models, půlka volání (GitHub deep-dive, hlasové pohovory) do něj vůbec nepíše, a do nákladu na nábor se nepromítá. ‚AI se zaplatila' bez nákladové strany je přesně ten slide, který mi CFO roztrhá. A maličkost, která mě píchla do oka: stejné číslo je nahoře ‚průměr' a dole ‚medián' — a je to průměr. Jednořádková oprava, ale auditor si jí všimne.

Kolegyni z jiné banky bych řekla: struktura je tu výborná — každé číslo končí v akci, kalibrace je měřená, poctivé pomlčky místo vymyšlených čísel. Až mi zaručí, že v datech jsou jen moji kandidáti, a přidají nákladovou stranu AI, podepíšu se pod to."
