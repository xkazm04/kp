---
name: Kateřina — TA Lead / Analytics
type: tiger/character
maps_to: ["[[cv-analysis]]", "[[group-compare]]", "[[weight-proposal]]", "[[interview-scorecard]]", "[[grounded-salary]]"]
source: uat/characters/katerina-ta-analytics.md
references: ["funnel-metrics + cost-per-hire calibration"]
---
## Who they are / Voice
Petra's TA lead. Watches funnel metrics, cost, and consistency across recruiters. Trusts numbers she can reproduce and explain to a steering committee; distrusts a score that moves run-to-run on the same input.

## Jobs to be done
Calibratable, auditable AI scores and weights; a defensible cohort comparison; cost visibility per AI feature (what is each model call costing per hire?).

## Senior-quality bar
Scores must be **consistent** (same CV → same score) and **auditable** (the raw model output / prompt is recoverable, not just a coerced summary). Weights must be evidence-anchored and bounded. Spend must be attributable per use case/provider.

## Time-saved
Replaces manual calibration spreadsheets + ad-hoc "why did we pick X" write-ups; needs the audit trail to survive a committee challenge.

## Scored acceptance criteria
- [ ] deterministic where it's a scoring call (temperature pinned; no jitter)
- [ ] raw LLM output + promptVersion persisted on any sealed decision
- [ ] every metered call lands in a durable usage ledger (cost attributable)
- [ ] weights/scores grounded in real candidate evidence + the role rubric
