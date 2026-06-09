# Analysis Results & Reporting — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 2 med / 1 low)
> Group: Candidate Analysis & Scoring | Lens mix: 2 bug / 2 ui | Files read: 18

## 1. ScoreDial color tiers disagree with scoreTone — dial reads a different tone than badge/bars for the SAME score
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: Visual inconsistency / success theater (comment asserts a guarantee the code doesn't keep)
- **File**: `app/_components/ScoreDial.tsx:35-51` (`bandIndex`/`bandColor`) vs `app/_lib/format.ts:328-342` (`scoreTone`, cutoffs 50/75)
- **Scenario**: Score 45 → `ScoreBadge`/`Meter`/`FactorChart` all use `scoreTone(45)="weak"` (coral), but `ScoreDial` does `bandColor(bandIndex(45)=1)=scoreToneColor("mid")` → the big number + "Developing" render amber. Symmetrically a 72 reads mid/amber on the badge but strong/moss on the dial. The dial is the most prominent score on Extraction and Job-fit.
- **Root cause**: Dial bands break at 40/55/70/85 and `bandColor` collapses them to weak(≤40)/mid(40–70)/strong(>70); the app tone scale breaks at 50/75. Scores in 40–49 and 70–74 tone differently. The comment at lines 43-51 claims the hues are "guaranteed to match the badge and factor bars" — only the token *source* is shared, not the thresholds.
- **Impact**: Same number, two colors across surfaces on a hiring screen; breaks the "color = rank" affordance. No crash.
- **Fix sketch**: Color the central number/label from `scoreToneColor(scoreTone(clamped))` (let the arc keep its five aesthetic bands), or re-cut `bandColor`'s split to align with 50/75.

## 2. Compare table mis-crowns and key-collides when two CV variants share a label
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Edge case (duplicate upload filenames)
- **File**: `app/_components/results/compare/CompareTab.tsx:63,94-108` and `app/_lib/comparison.ts:50-73`
- **Scenario**: Two variants resolve to the same `label` (both `resume.pdf`, or two pastes labeled "CV"). `buildComparison` enforces no label uniqueness. `winnerIndex = variants.findIndex(v => v.label === bestLabel)` returns the *first* match, so if the second same-named variant is the winner, the Crown + `bg-limewash` highlight paint the wrong column. Column headers also use `key={variant.label}` (line 95) → duplicate React keys, dev warning + possible mis-reconcile on re-sort.
- **Root cause**: `bestLabel` is a label string, not a stable index/id, and labels aren't unique.
- **Impact**: Winner highlight points at the wrong variant — directly misleads the "which CV to send" decision. Degraded, not a crash.
- **Fix sketch**: Carry a stable `bestIndex`/unique id from `buildComparison` and key columns by it; or de-dupe/suffix labels ("resume.pdf (2)") so labels are unique.

## 3. History "Score" and the report dial show two different numbers for the same analysis
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Silent cross-surface inconsistency
- **File**: `app/features/sub_history/HistoryTab.tsx:184` and `app/history/[slug]/page.tsx:61` vs `app/_components/results/extraction/ExtractionTab.tsx:24` (`reconcileScoreTotal(analysis.score)`)
- **Scenario**: `analyses.score` (column at `app/_lib/db.ts:138`) stores the pipeline's raw `total`. The report renders `reconcileScoreTotal(score)` — the component *sum* — on the dial and Compare "Overall" row, precisely because the pipeline total can disagree with its parts (`format.ts:354-453`). For any analysis where total ≠ component sum, the History row and detail-page header show the stored total (e.g. 82) while the dial shows the reconciled sum (e.g. 74).
- **Root cause**: The score-breakdown invariant is enforced only at render in the result components, not at the list/summary surfaces, which read the raw persisted total.
- **Impact**: Recruiter sorts/judges history on one score, opens the run, sees another — defeats `reconcileScoreTotal` on the list view. No crash.
- **Fix sketch**: Persist the reconciled sum into `analyses.score` at write time, or run the stored components through `reconcileScoreTotal` before list/header display.

## 4. SalaryGauge "+30%" marker + aria use the raw target; card text shows it rounded to 5 000
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Label inconsistency (same figure, two values)
- **File**: `app/_components/results/salary/SalaryTab.tsx:13,42` vs `app/_components/results/salary/SalaryGauge.tsx:22,66,90-108`
- **Scenario**: `SalaryTab` prints `targetSalary = Math.round((midpoint*1.3)/5000)*5000` (e.g. "95 000"). The gauge independently computes `target = midpoint*1.3` (unrounded, e.g. 93 600), places the dashed "+30%" marker at `pct(93 600)`, and its `aria-label` announces "93 600" — three figures for one target.
- **Root cause**: The +30% target is derived twice with different rounding instead of computed once and passed in.
- **Impact**: Dashed line sits slightly off the stated target; a11y announces a third number. Minor credibility ding on a comp screen.
- **Fix sketch**: Compute the rounded target once in `SalaryTab` and pass it into `SalaryGauge` for both the marker position and aria-label.
