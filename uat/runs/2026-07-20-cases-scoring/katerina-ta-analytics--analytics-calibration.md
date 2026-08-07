---
run: 2026-07-20-cases-scoring
character: katerina-ta-analytics
journey: analytics-calibration
cert_level: L1
verdict: L1-fail
language: cs
grounding: 4/10 (calibration-as-selection-quality) · 4/4 (calibration-as-process-consistency)
time_saved_min: 300
time_saved_confidence: medium
surface_binding: authed workspace — Analytics, Matrix, Decisions, Billing
date: 2026-07-20
---

# Kateřina Svobodová × Analytics & calibration — L1 (theoretical, code-grounded)

> READ-ONLY pass. No source touched. Every claim below carries `file:line`.

## Surface model

Import chain followed from each affordance to the code that backs it.

### Entry / navigation
- `app/features/tabs.ts:27` — `analytics` is an unconditional member of `WORKSPACE_TAB_IDS`;
  `:139` places it in the "Insights" nav group. `:13` `decisions`, `:26` `matrix`.
  **No per-role gating anywhere in the tab definition** — reachability reduces to
  "dev gate on + seeded data".
- Dev gate: `kp_dev_authed = "1"` (`uat/env.md` §Auth).

### Analytics tab — the affordance inventory
`app/features/sub_analytics/AnalyticsTab.tsx`

| Affordance | Line | Backing code |
|---|---|---|
| Cohort window (all / 30 / 90) | `:83`, `:132-146` | swaps fetch URL `:92-95` |
| Funnel bars (stage, reached, current, conv %) | `:210-259` | `/api/analytics` → `app/_lib/db/analytics.ts` |
| Funnel bar → board deep link (cohort drill) | `:101-102`, `:214` | `buildUrl` + `clearedTabScopedParams` (`tabs.ts`) |
| Bottleneck banner + "view candidates" | `:261-277` | `data.bottleneck` |
| Per-stage dwell | `:281-295` | `data.stageDwell` |
| Offer leg (extended/accepted/declined/expired) | `:1051-1096` | `analytics-offer.ts`, honesty-gated `:1059-1060` |
| Goals editor (conversion % + TTH goal) | `:300-305`, `:1167+` | `/api/analytics/targets` |
| Forecast panel | `:1103-1155` | pure `forecastHires` (`analytics-forecast.ts`) |
| Automation split (auto vs human) | `:454-510` | `decision-attribution.ts` |
| **ROI ledger (hours + CZK + % of manual baseline)** | `:515-622` | **`automation-roi.ts`** |
| Leadership readout tile (time saved % / CPH / TTH) | `:574-592` | same |
| ROI CSV export | `:531-550` | `export-utils.ts` |
| Channel economics (spend, CPA, CPH per channel) | `:767-927` | `analytics.ts:486-506` |
| Inline spend entry | `:1013-1043` | `POST /api/analytics/spend` |
| Compute-cost panel (USD LLM ledger) | `:631-700` | `llm_usage` ledger |
| By-role table + CSV | `:374-444` | `data.byJob` |
| **Calibration panel** | **`:353`** | **`CalibrationPanel.tsx`** |
| Decision records panel | `:355` | `DecisionRecordsPanel.tsx` |
| Decision log | `:446` | `DecisionLog.tsx` |
| Org benchmark | `:351` | `OrgBenchmarkPanel.tsx` |

### The calibration chain (the journey's crux) — followed end to end

1. **Affordance** — `CalibrationPanel.tsx:578-764`. Source selector `:619-632`
   (`pipeline` default `:588` | `analysis`), role-family selector `:633-642`,
   reliability diagram `:63-129`, Brier readout `:682-684`, drift strip `:135-175`,
   clickable score bands `:185-310`, threshold suggestion `:323-405`, sealed
   threshold-history strip `:425-576`.
2. **Fetch** — `:589` `/api/analytics/calibration?source=…&roleFamily=…`.
3. **Route** — `app/api/analytics/calibration/route.ts:35-83`. Workspace-scoped
   `:43` (`currentWorkspace()`); TTL-memoized `:45`; picks the pair producer `:46`.
4. **Pair producers** — the load-bearing definition of "outcome":
   - `app/_lib/db/pipeline.ts:326-344` (`pipelineCalibrationPairs`, the **default**):
     `SELECT match_score, stage, status …` `:330-331`; **`outcome = 1` if
     `CALIBRATION_ADVANCED_STAGES.has(stage)` `:337`**, where that set is
     **`new Set(["Interview", "Offer", "Hired"])` `:324`**; **`outcome = 0` if
     `status === "rejected"` `:339`**.
   - `app/_lib/db/analyses.ts:217-236` (`calibrationPairs`, opt-in): outcome is the
     **recruiter's own `disposition`** — `advance` → 1, `pass` → 0 `:232`.
5. **Computation** — `app/_lib/calibration.ts:62-99` (`computeCalibration`): score/100
   read as a probability `:39-47`, 10 fixed bins `:49-53`, Brier `:94`, honesty gate
   `calibrated: n >= minOutcomes` `:96` with `MIN_CALIBRATION_OUTCOMES = 20` `:15`.
   Drift cohorts `:141-170`; threshold recommender `:211-268`; threshold effect
   `:317-342`.
6. **The score's own causal role** — `app/_lib/screen-wave.ts:254-257`:
   `const belowThreshold = e.matchScore < effectiveFloor(cfg, e.roleFamily);`
   `if (cfg.autoRejectEnabled && inBottom && belowThreshold && !isFairnessProtected(…))
   wouldReject.add(e.id);`

### Copy actually shown (cs — `messages/cs.json`)
- `analytics.calibration.title` = "Jak jsme přesní?"
- `analytics.calibration.blurb` = "Zda skóre shody skutečně předpovídá **rozhodnutí náboráře**."
- `analytics.calibration.measuresPipeline` = "Měří skóre shody v pipeline — číslo, podle
  kterého rozhoduje automatický screening — proti tomu, **zda kandidát prošel screeningem,
  nebo v něm byl zamítnut**."
- `analytics.calibration.axisObserved` = "**Skutečná míra postupu**"
- `analytics.calibration.exclusionPipeline` = names exactly what is and isn't counted.
- `analytics.roi.perHire` = "≈ {hours} h ušetřeno na nábor — zhruba {pct} % z ~{baseline} h,
  které nábor zabere ručně."

---

## Grounding audit

The AI/analytical surface here is the **calibration engine**. The question it exists to
answer is "is our scoring any good?". Enumerate the real context that answer needs, and
score how many sources actually reach the computation.

| # | Context the answer needs | Reaches the computation? | Evidence |
|---|---|---|---|
| 1 | The emitted score | ✅ real, tenant-scoped | `pipeline.ts:330-331`, route `:43` |
| 2 | The screening disposition | ✅ | `pipeline.ts:337-341` |
| 3 | Decision timestamps (drift) | ✅ | `calibration.ts:141-170` |
| 4 | Role family (segment) | ✅ | `route.ts:50-51` |
| 5 | **Post-hire performance of the hire** | ⚠️ **exists but unreachable for real candidates** | `dev-outcomes.ts:23-26,71-81` — see amendment below |
| 6 | **Retention / probation / tenure** | ❌ absent | no table |
| 7 | **Outcome for a REJECTED candidate** | ❌ structurally impossible | `pipeline.ts:339` |
| 8 | **Hiring-manager satisfaction with the hire** | ❌ absent | no table |
| 9 | **Independent/blind human re-rating (inter-rater)** | ❌ absent | — |
| 10 | **Leakage control (the score causes the label)** | ❌ none | `screen-wave.ts:254-257` |

**Grounding: 4/10** measured against *selection quality* (the journey's actual goal).
Measured against the narrower claim the cs copy makes — *process consistency*, i.e.
"does the score predict our own screening decision" — grounding is **4/4** and the
machinery is excellent. **The gap between those two scores is this entire report.**

### ⚠️ Amendment — correcting my own first pass (recorded rather than silently fixed)

My initial enumeration ran `CREATE TABLE` over `app/_lib/db/` only, and concluded no
post-hire outcome field existed anywhere. **That enumeration was incomplete and the
conclusion was wrong in one specific.** ~19 isolated stores declare their own tables
*outside* `app/_lib/db/` (`onboarding-store.ts`, `decision-record-store.ts`,
`offers-store.ts`, `dev-outcomes.ts` …). A full sweep finds **one** post-hire quality
field in the codebase, verified first-hand:

- `app/_lib/dev-outcomes.ts:71-81` — table `dev_outcomes(id, ref, candidate_ref,
  predicted_score, outcome, performance, note, recorded_at)`.
- `:23-26` — `PERFORMANCE_MIN/MAX = 1..5`, commented *"a 1..5 **on-the-job rating**"*.
- `:55-58` — Zod refine: `performance` is legal only when `outcome === "hired"`.

So the concept was understood and built. **It is nonetheless unusable as ground truth for
Kateřina, for four independently disqualifying reasons — each verified:**

1. **Real candidates are excluded by an explicit prefix guard.** `:186` —
   `if (!cid || !cid.startsWith("ds-")) return false;`. The `ds-` prefix is minted only in
   the dev-case simulation lane (`devcase-run.ts:794`). Every ordinary applicant is
   silently skipped.
2. **The automatic path never writes a rating anyway.** `recordPipelineOutcome`
   (`:196-202`) passes `ref`, `candidateRef`, `predictedScore`, `outcome`, `note` — and
   **no `performance`**. What it auto-records is `note: "auto-recorded from pipeline
   hire/rejection"`: a *decision* label, the same circular signal as F1, not an outcome.
3. **Nothing ever asks for the rating.** The only writer is a hand-typed form on the
   internal control room (`app/control/ControlRoom.tsx:317-331`, inline 1–5 buttons
   `:422-441`). No 90-day trigger, no reminder, no task, no email.
4. **No tenancy.** `dev_outcomes` has no `workspace_id` (`:71-81`), unlike every
   comparable store (cf. `onboarding-store.ts:88`, `decision-record-store.ts:134`). Were
   it ever wired to the calibration panel as-is, it would mix tenants' outcomes into one
   workspace's curve.

**This sharpens rather than softens the finding.** The gap is not that nobody thought of
outcome feedback — someone did, specified it carefully, and validated it at the boundary.
The gap is that it was wired to the simulation lane and never to the product. The
remaining rows (6, 7, 8) are confirmed absent against the full ~60-table inventory:
nothing records probation, tenure, attrition, ramp-up or manager satisfaction, and nothing
records any fact about a rejected candidate beyond this system's own word `rejected`.

---

## Reachability

Resolved **before** judging, per the rubric.

- **Analytics tab: REACHABLE.** `tabs.ts:27,139` — unconditional, no role/plan/flag
  gating; dev gate is the only door (`env.md` §Auth).
- **Calibration panel: REACHABLE but data-gated.** `CalibrationPanel.tsx:664-672` renders
  the honest "Zatím nekalibrováno" state until `n >= 20` decided candidates
  (`calibration.ts:15`). Under the canonical ČS seed this is a **fixture** question, not a
  code defect — and the uncalibrated state is itself correct behaviour.
- **Threshold suggestion / history strip: conditionally reachable.** `:707` renders only
  when `recommendation != null`, which requires `source === "pipeline"`
  (`route.ts:63`), `n >= 20` and a band with `n >= 8` (`calibration.ts:216-237`).
  `ThresholdHistoryStrip` returns `null` until an apply has been sealed (`:457`).
- **Decisions / Matrix / Billing: REACHABLE** (`tabs.ts:13,26`).
- **All findings below are on reachable surfaces.** None is tagged `unreachable`.
  F1/F2/F3 are *definitional* — they hold whether or not the curve has enough data,
  because they concern what the curve means, not whether it renders.

---

## Findings

```json
[
  {
    "id": "KAT-L1-001",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "trust",
    "severity": "blocker",
    "dimension": "trust",
    "title": "Calibration validates the match score against outcomes the match score itself causes (label leakage) — the Brier score is self-fulfilling",
    "expected": "The score is validated against a label generated independently of the score.",
    "got": "pipelineCalibrationPairs labels outcome=0 when status='rejected' (pipeline.ts:339). screen-wave.ts:254-257 sets exactly that status by testing `e.matchScore < effectiveFloor(cfg, e.roleFamily)`. The auto-reject floor manufactures the negative labels at precisely the low-score end of the curve, so low-score bins are driven toward observed≈0 by construction. The same applies at the top: a high match_score is what routes a candidate past the screen gate into Interview (outcome=1, pipeline.ts:337). Predictor and label share a cause; the reliability diagram measures the policy's own consistency, not the score's validity, and the Brier score is biased optimistic by an amount nothing in the code estimates or discloses.",
    "evidence": [
      "app/_lib/db/pipeline.ts:337-341",
      "app/_lib/screen-wave.ts:254-257",
      "app/_lib/calibration.ts:62-99",
      "app/features/sub_analytics/CalibrationPanel.tsx:682-684"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "With the seeded corpus, read the rendered Brier + the low bins and check whether any on-screen text warns that the labels are policy-generated. Confirm no disclosure of leakage exists anywhere on the panel.",
    "suggested_acceptance": "State the leakage explicitly on the panel, and/or carve a leakage-free holdout: a random sample of below-floor candidates exempted from auto-reject and screened by a human blind to the score. Without a holdout the curve cannot be de-biased."
  },
  {
    "id": "KAT-L1-002",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "blocker",
    "dimension": "missing",
    "title": "No usable ground truth: the one post-hire rating field that exists is wired to the simulation lane only, never solicited, and never auto-populated — and nothing at all is recorded about a rejected candidate",
    "expected": "Some outcome signal — probation pass, 90-day survival, tenure, manager rating, regretted attrition — so a score can be tested against whether the hire actually worked; and some false-negative signal for people we passed on.",
    "got": "A post-hire quality field DOES exist: dev_outcomes.performance, a 1-5 'on-the-job rating' (dev-outcomes.ts:23-26,71-81), correctly constrained to hired outcomes (:55-58). It is unusable as ground truth for four verified reasons: (a) recordPipelineOutcome hard-guards on `cid.startsWith(\"ds-\")` (:186), the dev-case simulation prefix minted at devcase-run.ts:794 — every real applicant is skipped; (b) that automatic path never passes `performance` at all (:196-202), writing only note:'auto-recorded from pipeline hire/rejection', i.e. the same circular decision label as KAT-L1-001; (c) the sole writer of an actual rating is a hand-typed form on the internal control room (ControlRoom.tsx:317-331,422-441) with no 90-day trigger, reminder or task to prompt it; (d) the table carries no workspace_id (:71-81), unlike every comparable store, so wiring it up as-is would blend tenants' outcomes into one curve. Separately and with no mitigation: for rejected candidates the pipeline records only that WE rejected them (pipeline.ts:339); rediscover.ts:30-42's 'elsewhere' means active on another job IN THIS SYSTEM, not hired by another company. There is no field, route or UI anywhere for 'thrived elsewhere / we were wrong'. The false-negative rate is therefore structurally unmeasurable — the exact failure mode of resume screening. Confirmed against the full ~60-table inventory: no probation, tenure, attrition, ramp-up or manager-satisfaction store exists.",
    "evidence": [
      "app/_lib/dev-outcomes.ts:23-26",
      "app/_lib/dev-outcomes.ts:71-81",
      "app/_lib/dev-outcomes.ts:186",
      "app/_lib/dev-outcomes.ts:196-202",
      "app/control/ControlRoom.tsx:317-331",
      "app/_lib/db/pipeline.ts:324",
      "app/_lib/db/pipeline.ts:339",
      "app/_lib/rediscover.ts:30-42"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Walk the Onboarding tab live after a hire and confirm it captures only process steps, no success signal. Then open /control and confirm the 1-5 performance form is the only rating affordance in the product and that it is unreachable from the normal workspace nav.",
    "suggested_acceptance": "The primitive already exists — promote it instead of rebuilding it: (1) add workspace_id to dev_outcomes and drop the 'ds-' guard so real hires are eligible; (2) solicit the rating — a scheduled 90/180-day task against the hiring manager, since an unsolicited form is never filled; (3) add a 'reconsidered / hired elsewhere' flag on rejected entries; (4) add a calibration source pairing score against THAT label, honesty-gated until N accrue."
  },
  {
    "id": "KAT-L1-003",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "trust",
    "title": "'Reached Interview' scores identically to 'Hired' — the success label cannot distinguish a good hire from a candidate who interviewed and bombed",
    "expected": "Distinguishable outcome grades, or at minimum a hire-only calibration source.",
    "got": "CALIBRATION_ADVANCED_STAGES = new Set([\"Interview\", \"Offer\", \"Hired\"]) — a candidate who reached a first interview and was then rejected is a calibration POSITIVE, indistinguishable from someone hired. For a screening score this makes the top bins close to tautological: a high score is what buys the interview that counts as the success. There is no source=hired option in the route's source switch.",
    "evidence": [
      "app/_lib/db/pipeline.ts:324",
      "app/_lib/db/pipeline.ts:337",
      "app/api/analytics/calibration/route.ts:39"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Open a top score band via ScoreBands and inspect the candidates behind it — count how many of the outcome=1 rows are merely at Interview versus actually Hired.",
    "suggested_acceptance": "Add a third calibration source keyed on hire (outcome=1 only for Hired), gated on its own N — even without post-hire data this is a strictly harder and more honest target than 'advanced'."
  },
  {
    "id": "KAT-L1-004",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "An LLM's self-reported confidence % is rendered as a meter on every decision card — and it is the one number the calibration engine never measures",
    "expected": "Any confidence shown as a number is either calibrated or visibly labelled as uncalibrated self-report.",
    "got": "The screening prompt asks the model to emit its own certainty: '\"confidence\": int 0-100' (automation.py:347), with a hardcoded deterministic fallback of 60/65 when the model is unavailable (automation.py:364-366). AiReviewCard renders it as a filled meter plus a bold percentage, colour-coded green/amber/coral (AiReviewCard.tsx:107,175-182), and DecisionsShared appends it to the recommendation badge (:82-83). The calibration engine measures pipeline_entries.match_score or analyses.score — NOT this field. So the number a recruiter reads at the moment of decision carries zero validation, while the number that IS validated is on a different screen. This is verbatim Kateřina's declared pet peeve ('AI confidence: 87% with nothing behind it').",
    "evidence": [
      "pipeline/jobfit/automation.py:347",
      "pipeline/jobfit/automation.py:364-366",
      "app/features/sub_decisions/AiReviewCard.tsx:107",
      "app/features/sub_decisions/AiReviewCard.tsx:175-182",
      "app/features/sub_decisions/DecisionsShared.tsx:82-83",
      "app/api/analytics/calibration/route.ts:46"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "l2_priority": "Open Decisions live, screenshot the confidence meter, and confirm no tooltip/caption discloses that it is model self-report and uncalibrated.",
    "suggested_acceptance": "Either add this field as a third calibration source, or relabel it in-UI as an uncalibrated self-assessment and drop the precise percentage in favour of a coarse band."
  },
  {
    "id": "KAT-L1-005",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "dimension": "time-saved",
    "title": "The leadership ROI % rests on two hardcoded constants that cannot be re-grounded in Česká spořitelna's own baseline",
    "expected": "Time saved measured against MY org's baseline, defensible line by line to leadership.",
    "got": "The savings figure is a counterfactual built from MINUTES_SAVED_PER_KIND — a hand-authored assumption table (scored=8 min, matched=5 min, auto_rejected=5 min …, automation-roi.ts:14-29) — divided against MANUAL_HOURS_PER_HIRE = 42 (automation-roi.ts:41). Both are stated honestly in code comments and the cs prose line hedges properly ('≈', 'zhruba {pct} % z ~{baseline} h'). But neither constant is settable from the UI: /api/analytics/targets accepts only funnel stage names, time_to_hire and recruiter_hourly_czk (targets/route.ts:11) — the hourly RATE is editable (AnalyticsTab.tsx:603-609), the minutes table and the 42h baseline are not. And the leadership readout tile renders it as a bare '{pct}%' under the label 'Ušetřený čas náboráře' (AnalyticsTab.tsx:574-579) with no 'Odhad' chip — unlike the sibling compute-cost panel, which does carry one (:649-651) — and the CSV export writes the same bare figure as a metric row (:536-543). So the number that leaves the building for a leadership deck has shed the hedging the prose line carried.",
    "evidence": [
      "app/_lib/automation-roi.ts:14-29",
      "app/_lib/automation-roi.ts:41",
      "app/api/analytics/targets/route.ts:11",
      "app/features/sub_analytics/AnalyticsTab.tsx:574-579",
      "app/features/sub_analytics/AnalyticsTab.tsx:536-543",
      "app/features/sub_analytics/AnalyticsTab.tsx:649-651"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "l2_priority": "Export the ROI CSV and confirm the % row carries no estimate qualifier; confirm the readout tile shows no 'Odhad' chip.",
    "suggested_acceptance": "Expose manualBaselineHoursPerHire (already a parameter, automation-roi.ts:75) as a target key alongside recruiter_hourly_czk; add the 'Odhad' chip to the readout tile and an assumptions row to the CSV."
  },
  {
    "id": "KAT-L1-006",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "dimension": "trust",
    "title": "The threshold recommender reads the score bands its own floor contaminates, then measures its effect with the same contaminated labels — a closed loop that never touches reality",
    "expected": "A recommendation to move the auto-reject floor is derived from evidence independent of that floor.",
    "got": "recommendScreeningThreshold examines one band-width below the floor and one above (calibration.ts:231-234) and reads their advance rates. Those two bands are precisely where the floor exerts its effect: candidates below it are auto-reject-eligible (screen-wave.ts:254-257), so their 'did not advance' label is the floor's own doing. The 'lower the floor' branch triggers when below-floor candidates mostly advanced — which can only be observed for the ones the floor happened not to catch (it also requires inBottom), a survivorship-selected subsample. computeThresholdEffect then grades the change using labels generated under the new floor (:317-342). Recommend → apply → measure, with every step reading the policy's own output. The honesty gates (n>=20, band n>=8) bound the NOISE but do nothing about the BIAS.",
    "evidence": [
      "app/_lib/calibration.ts:211-268",
      "app/_lib/calibration.ts:231-234",
      "app/_lib/calibration.ts:317-342",
      "app/_lib/screen-wave.ts:254-257",
      "app/features/sub_analytics/CalibrationPanel.tsx:707-716"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "resolution": "open",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "l2_priority": "Reach a seeded state where a recommendation renders; read the recBasis sentence and confirm it cites only n and the band, with no caveat that the band is policy-shaped.",
    "suggested_acceptance": "Feed the recommender from a randomized holdout band (a small % of below-floor candidates screened by a human regardless of score). That is the only change that makes the suggestion causally meaningful, and it is cheap."
  },
  {
    "id": "KAT-L1-S01",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "trust",
    "title": "STRENGTH — the honesty gating is genuinely first-rate and the cs copy names precisely what is being measured",
    "got": "MIN_CALIBRATION_OUTCOMES=20 with an explicit uncalibrated state that states how many more are needed (calibration.ts:15; CalibrationPanel.tsx:664-672); every drift cohort gated independently so a good year cannot lend its number to a thin quarter (calibration.ts:163-166); a rendered exclusion note saying what does and does not count (CalibrationPanel.tsx:611-616); brier null rather than fabricated at n=0 (calibration.ts:94); the compute-cost panel refusing to sum USD and CZK and suppressing per-hire on a multi-workspace ledger (AnalyticsTab.tsx:672-677); CPA/CPH nulled in windowed views rather than mixing a lifetime numerator with a windowed denominator (analytics.ts:495-503). Critically, the cs axis label is 'Skutečná míra postupu' (actual ADVANCE rate) and measuresPipeline states the outcome is 'zda kandidát prošel screeningem, nebo v něm byl zamítnut'. The product does NOT claim to measure hire quality. That single piece of discipline is what makes this a design limitation rather than a false claim.",
    "evidence": [
      "app/_lib/calibration.ts:15",
      "app/_lib/calibration.ts:163-166",
      "app/features/sub_analytics/CalibrationPanel.tsx:664-672",
      "app/features/sub_analytics/CalibrationPanel.tsx:611-616",
      "messages/cs.json analytics.calibration.measuresPipeline",
      "messages/cs.json analytics.calibration.axisObserved"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "The honesty is about SAMPLE SIZE, not about VALIDITY. Every gate answers 'do we have enough data?' and none answers 'is this data the right data?'. A curve can clear all 20-outcome gates, render a beautiful 0.09 Brier, and still be measuring nothing but the policy agreeing with itself.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" }
  },
  {
    "id": "KAT-L1-S02",
    "journey": "analytics-calibration",
    "character": "katerina-ta-analytics",
    "cert_level": "L1",
    "type": "strength",
    "severity": "polish",
    "dimension": "clarity",
    "title": "STRENGTH — every number on the page ends in a decision (Kateřina's own bar, met)",
    "got": "Funnel bars, bottleneck, stage dwell, by-role rows, offer-pending and automation holds all deep-link into the board or the Decisions queue filtered to exactly that cohort (AnalyticsTab.tsx:101-102,214,270-275,287,420-426,494-500,1082-1088). Each calibration bin opens the candidates behind it via a lazy per-band fetch (CalibrationPanel.tsx:185-310) and a terminal candidate is listed but unlinked rather than dead-linked (:276-286). Decision log and sealed decision records sit on the same surface (:353-355,:446). This is the drill-down discipline Kateřina says most dashboards lack.",
    "evidence": [
      "app/features/sub_analytics/AnalyticsTab.tsx:101-102",
      "app/features/sub_analytics/AnalyticsTab.tsx:353-355",
      "app/features/sub_analytics/AnalyticsTab.tsx:446",
      "app/features/sub_analytics/CalibrationPanel.tsx:185-310"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "resolution": "by-design",
    "ceiling": "Drill-down proves a number's PROVENANCE, not its VALIDITY. I can trace any figure to the rows behind it — but tracing a self-referential label back to its candidates just shows me the same circle at higher resolution.",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" }
  }
]
```

### Scored acceptance criteria (applied identically every run)

| # | Criterion | Result |
|---|---|---|
| 1 | completion — funnel applied→hire, drop-off per stage, reconciled | **PASS** — `AnalyticsTab.tsx:210-259`, offer leg `:1051-1096`, KO-gate loss surfaced `:204-206` |
| 2 | trust — confidence/match scores presented with a calibration basis | **FAIL (blocker)** — a calibration view exists, but it measures the policy against itself (KAT-L1-001/002), and the confidence figure recruiters actually see is uncalibrated (KAT-L1-004) |
| 3 | missing — spend with per-hire attribution, not a lump | **PARTIAL PASS** — per-channel CPA/CPH `analytics.ts:502-503`, blended CPH, compute cost split out. Attribution is channel-level from manually-entered lifetime spend; no per-individual-hire ledger and no recruiter-salary/agency legs |
| 4 | time-saved — MEASURED against the manual baseline | **FAIL (major)** — estimated from hardcoded constants she cannot re-ground (KAT-L1-005) |
| 5 | clarity — every metric actionable / drills down | **PASS** — KAT-L1-S02 |
| 6 | missing — decision logs accessible from analytics | **PASS** — `AnalyticsTab.tsx:353-355,:446` |
| 7 | senior-quality — a leadership-ready ROI readout she'd sign | **FAIL (major)** — the readout exists and is well-built, but its headline % is an unfalsifiable estimate and its companion accuracy story is circular |

**4 pass / 3 fail, and the crux criterion (#2) is one of the failures.**

### Verdict: `L1-fail`

Not because the surface is broken — structurally it is one of the better analytics
builds I have walked. It fails because the journey's stated definition of done —
*"prove the AI's confidence scores actually track real outcomes, not vibes"* — is
**unachievable on this data model at any level of polish**. That is a structural gap
per the rubric, and it must be fixed before L2 can meaningfully certify the crux.
The funnel/spend/decision-log legs are L2-eligible on their own.

**Estimated time saved if it all worked:** ~300 min per reporting cycle (medium
confidence). Her manual baseline is a day or two of ATS-export reconciliation
(~480 min); the live reconciled funnel with drill-down genuinely collapses that to
~35 min of reading. But the calibration and ROI-defense legs return **zero** — worse
than zero, since she would have to spend time writing the caveats that keep her from
over-claiming to leadership.

---

## Headline question

> **Is there any way to know whether the system picked the best candidate rather than
> the best-presenting one?**

**No. Not in principle, not with more data, not with a better model — the instrumentation
that would make the question answerable does not exist.** Three independent code facts,
each sufficient on its own:

**1. There is no usable ground truth — though there is a working prototype of one.** This
is the finding I got wrong on my first pass and want stated precisely. A post-hire quality
field genuinely exists: `dev_outcomes.performance`, a 1–5 *"on-the-job rating"*
(`dev-outcomes.ts:23-26,71-81`), properly constrained so only a hire can carry one
(`:55-58`). Someone understood the problem and built the primitive. But it is wired to the
dev-case simulation lane and not to the product: the auto-recorder refuses any candidate
whose id lacks the `ds-` prefix (`:186`), and even for those it never writes a rating at
all (`:196-202`) — it stamps `note: "auto-recorded from pipeline hire/rejection"`, which is
the same circular decision label as fact 3 below. The only path to a real rating is a
person hand-typing it into an internal control room (`ControlRoom.tsx:317-331`), which
nothing in the system ever prompts them to do. And the table has no `workspace_id`
(`:71-81`), so as built it could not serve a tenant-scoped curve anyway. Beyond that one
field, nothing: no probation result, no tenure, no attrition, no manager satisfaction,
against the full ~60-table inventory. `Hired` is where data capture stops — precisely where
the evidence about hiring quality begins. "Best candidate" is a claim about what happened
*after*, and what happened after is not recorded for anyone real.

**2. There is no counterfactual arm — the false-negative rate is structurally
unmeasurable.** A rejected candidate's record ends at `status = 'rejected'`
(`pipeline.ts:339`). There is no field, route, or affordance anywhere for "hired
elsewhere", "thrived", "we were wrong". Screening's characteristic failure is the strong
candidate with a weak CV, and this system cannot count those even in principle. The
threshold recommender's candidate-protective "lower the floor" branch
(`calibration.ts:237-250`) is the closest thing to a false-negative check, and it can only
see candidates the floor happened not to catch — a survivorship-selected subsample.

**3. What the product calls "calibration" is internal consistency, and it is
circular.** `computeCalibration` (`calibration.ts:62-99`) pairs the score against a label
that reads `outcome = 1` for stage ∈ {Interview, Offer, Hired} (`pipeline.ts:324,337`) and
`outcome = 0` for `status = 'rejected'` (`:339`). Both halves of that label are produced by
a process the score drives: `screen-wave.ts:254-257` auto-rejects exactly when
`e.matchScore < effectiveFloor(...)`. The predictor causes its own label. This is textbook
label leakage: the Brier score is biased optimistic by an amount nothing in the codebase
estimates, bounds, or discloses. The alternative source is worse for this purpose — it
pairs the score against the recruiter's disposition on the very analysis that displayed
that score (`analyses.ts:217-236`), measuring anchoring as much as accuracy. **A system
that scores well here has proven only that it agrees with itself.** A perfectly biased
screener that consistently favours polished CVs would produce a near-perfect reliability
diagram, because the polished CVs are exactly the ones it advanced.

**So: does it "confidently display an unvalidated accuracy figure"?** This is where the
build earns real credit, and I want to be exact about it, because the answer is *almost*
the serious trust finding and then isn't.

- The panel is titled "Jak jsme přesní?" ("How accurate are we?") — an over-claim as a
  headline. But the body immediately narrows it: the y-axis is **"Skutečná míra postupu"**
  (actual *advance* rate), and `measuresPipeline` states the outcome is
  *"zda kandidát prošel screeningem, nebo v něm byl zamítnut"* — whether the candidate
  passed screening or was rejected there. The `blurb` says the score predicts
  *"rozhodnutí náboráře"* — **the recruiter's decision**. A rendered exclusion note
  (`CalibrationPanel.tsx:611-616`) says exactly what counts.
  **The product never claims to measure hire quality.** It says, accurately, that it
  measures agreement with its own screening decisions. That is the difference between a
  design limitation and a false claim, and it is the reason this is not a fraud finding.
- What it does **not** disclose is that predictor and label are *causally coupled* — that
  the floor manufactures the labels the curve grades it against. Both halves of the fact
  are on screen ("the number automatic screening decides by" / "whether they passed
  screening") and the panel never joins them. A TA analyst reading a 0.09 Brier will
  bank it as validation. That is KAT-L1-001, and it is the finding to fix.
- The genuinely uncalibrated number is elsewhere: the **LLM's self-reported
  `confidence` 0–100** (`automation.py:347`, deterministic fallback 60/65 at `:364-366`),
  rendered as a colour-coded meter and a bold percentage on every decision card
  (`AiReviewCard.tsx:175-182`) and appended to the recommendation badge
  (`DecisionsShared.tsx:82-83`). The calibration engine never touches it. So the number a
  recruiter reads *at the moment of the decision* is the one with nothing behind it, and
  the number that gets validated lives on a different tab. That inversion is KAT-L1-004.

**Plain verdict: the product cannot prove its own selection quality, and it does not
claim to.** It proves something much narrower and genuinely useful — that its scoring is
internally consistent and stable over time, honestly gated, per role family, drillable to
the candidates behind every dot. That is real engineering and it is not nothing. But it is
consistency, not validity, and the gap is invisible unless you follow the import chain to
`pipeline.ts:337`.

**Minimum missing instrumentation**, in dependency order:

1. **Promote the post-hire outcome record you already have.** `dev_outcomes.performance`
   is the right primitive, already specified and boundary-validated. It needs three
   changes, none of them research: add `workspace_id`; drop the `ds-` guard at `:186` so
   real hires are eligible; and **solicit it** — a scheduled 90/180-day task against the
   hiring manager, because an unsolicited form on an internal page will never be filled
   in. Extend it with a probation-passed flag and a regretted-attrition flag.
2. **A false-negative channel** — a "reconsidered / hired elsewhere / we were wrong" flag
   on rejected entries, plus the rediscovery loop that already exists
   (`jobs.rediscover.whyNow.closed` shows the concept is understood) feeding it back.
3. **A leakage-free holdout** — a small random sample of below-floor candidates exempted
   from auto-reject and screened by a human blind to the score. **This is the single
   highest-value item**: without it, no amount of outcome data de-biases the curve, because
   the population reaching an outcome is still score-selected. With it, every existing
   piece of machinery — bins, Brier, drift cohorts, threshold recommender — becomes
   causally meaningful overnight.
4. **A third calibration source keyed on hire quality**, gated on its own N, so the panel
   can show "advance-consistency" and "hire-validity" side by side and the honest gap
   between them is visible rather than conflated.
5. **Label the confidence meter** as uncalibrated model self-report, or route it through
   the calibration engine.

Items 1 and 3 are the ones that change the answer from "no" to "yes". The rest is
plumbing that this codebase has already demonstrated it can build well.

---

## Character feedback — Kateřina Svobodová

*(first person, cs-speaker's register, over the designed experience)*

Tak. Someone here can actually build.

I'll say that first because I'm about to be hard on this, and I don't want that read as
dismissal. I open this tab and the first thing I see is a funnel where every bar is a
link. I click "Screened" and I land on the board filtered to exactly that cohort. The
bottleneck banner tells me which stage is eating my days and hands me the candidates
sitting in it. The by-role table exports to CSV. The offer leg — extended, accepted,
declined, expired — is right there, and it goes quiet instead of showing me a percentage
when there aren't enough offers to justify one. Do you know how rare that is? Most tools I
evaluate would print "83% acceptance rate" off five offers and let me embarrass myself in
front of the board. This one says "not enough yet". I trust a build more when it tells me
what it doesn't know, and this build does that in about six different places.

The calibration panel is the reason I agreed to look at this product at all. Every vendor
tells me their AI is accurate. This is the first one that showed me a reliability diagram
and a Brier score and put an honest gate in front of it — "Zatím nekalibrováno, potřebuje
20 rozhodnutých kandidátů, zatím máte 12". I nearly wrote in my notes: finally, someone
who understands that a confidence number without a curve behind it is decoration.

Then I read what the curve is made of, and I had to put my coffee down.

The score is measured against whether the candidate got past screening. And the thing that
decides whether the candidate gets past screening is — the score. Automatic rejection fires
when the match score falls below the floor. So the low scores don't advance, and the panel
draws me a lovely diagram proving that the low scores don't advance. Of course they don't.
We rejected them *because* the score was low. That's not a prediction that came true. That's
a decision we made, played back to us as a measurement, with an error bar on it.

I want to be precise about my complaint, because the copy is honest and I won't pretend
otherwise. The axis says "skutečná míra postupu" — actual *advance* rate. The description
says it measures the score against whether someone passed screening or was rejected there.
Nobody wrote "we predict good hires". Nobody lied to me. If I read every word carefully I
can work out exactly what I'm looking at, and I did, and that's a mark in this product's
favour. But the panel is titled "Jak jsme přesní?", and it hands me a number to three
decimal places, and I know exactly what happens next: someone on my team screenshots that
Brier score into a slide and writes "validated" under it. Both halves of the problem are on
the screen. The sentence joining them is not. Write that sentence.

And here is what I actually can't get past, the thing I'd raise if you put me in a room
with your product lead. Somewhere in Česká spořitelna there is a person we rejected two
years ago on a CV that didn't present well, who is now doing the same job somewhere else
and doing it better than the person we hired instead. That person is my real problem. That
person is what the whole 100-role funnel is *for*. And there is no field in this system
where that fact could ever be written down. Nothing at all about anyone we said no to
beyond the word "rejected" — and before anyone tells me the rediscovery feature covers it,
I checked: "elsewhere" there means *active on another role in this same system*, not hired
by a competitor and flourishing.

I'll give credit where it's due, because I went looking and found something I didn't
expect. There *is* a one-to-five on-the-job performance rating in this codebase. Somebody
thought about this properly — they even wrote the rule that only a hire can carry a score.
And then it was connected to the demo lane and not to the product. Real candidates are
filtered out by a prefix check. The automatic path doesn't even write the rating; it writes
"auto-recorded from pipeline hire" — which is just the system noting its own decision
again, the same circle. The only way a genuine rating gets in is if somebody types it into
an internal admin page that nothing ever asks them to open. So the honest summary is worse
than "they didn't think of it": they thought of it, built it, and left it pointing at the
simulator. The system has perfect memory of its own opinions and complete amnesia about
whether any of them were right.

That also means my ask is smaller than it sounded a moment ago — I'm not asking you to
invent a feedback loop, I'm asking you to plug in the one you already wrote.

That's still not a bug you fix in a sprint, and I'm not pretending otherwise. But it means that
when my HR director asks me the only question she actually cares about — "are we hiring
better people than we were?" — I have to say I don't know, and this tool doesn't know
either, and no amount of it running longer will make it know.

The ROI ledger has the same shape of problem and it's the one that costs me directly. It
tells me we saved X hours and Y crowns, and roughly what percent of the ~42 hours a hire
takes by hand. Fine. Except the 42 isn't ours — it's a research constant somebody hardcoded
— and the minutes-per-action table (8 minutes to read a CV, 5 to shortlist) is somebody's
reasonable guess, not a measurement. I can change the hourly rate. I cannot change either
of the two numbers the percentage actually rests on. The Czech text hedges properly, with
the "≈" and the "zhruba" — and then the leadership readout tile shows a bare percent with
no "Odhad" chip on it, and the CSV export drops the hedge entirely. That's the file that
walks into the board meeting. I'd have to rebuild the whole thing in my spreadsheet with
our own baseline before I'd put my name near it — which is exactly the work this was
supposed to save me.

One more, and it's the one that would bother my recruiters more than me. On the Decisions
screen every card shows "Jistota: 74%" with a little coloured meter. That number is the
language model telling us how sure it feels. When the model is unavailable it's hardcoded
to 60 or 65. It is not calibrated against anything, ever — and it's the number Petra is
looking at when she clicks reject. Meanwhile the number you *did* calibrate is on a
different tab. You validated the one nobody's looking at and put a meter on the one nobody
checked. Swap that around, or take the percent off and give her a band.

So — would I adopt it? For the funnel, the spend, the drill-downs, the decision log: yes,
today, and it would give me most of a day back every reporting cycle. That leg is better
than what I have and I'd fight to keep it. For the thing I actually opened it for — proving
our scoring works — no. Not because it's badly built, but because it's answering a
different question than the one it's titled with, and the question it answers is one I
never doubted. I never worried that our screening was inconsistent. I worried it was
consistently wrong.

Would I tell a peer? I'd tell them this is the most honest analytics build I've seen in
this category, and to read the calibration panel's fine print before they believe the
headline. That's a real compliment and a real warning and I mean both.

What would change my mind — and I want to say this clearly, because it's smaller than you'd
think. Take a random handful of the candidates you'd auto-reject each month, don't reject
them, and have a human screen them blind to the score. That's it. A few dozen people a
month. Then actually use the performance rating you already built — point it at real hires
instead of the demo lane, and have the system *ask* the hiring manager at ninety days
instead of hoping someone wanders into an admin page. One guard removed, one column added,
one scheduled task, and some discipline. Everything you have already built — the bins, the Brier, the quarterly drift, the threshold suggestions —
suddenly starts measuring reality instead of measuring itself. The machine is already here.
It's just wired to the wrong signal.

Fix the signal and I'll take this to leadership myself.
