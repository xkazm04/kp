---
id: insights
type: tiger/call-site
modality: none
file: (none — no LLM call site exists)
wrapper: n/a
provider: n/a  model: n/a
schema: n/a
grounding: 0/0 sources
quality_score: "—"  code_score: "—"
recommended_model: "—"
status: assessed
last_scanned: 2026-06-20
characters: ["[[katerina-ta-analytics]]", "[[lucie-dpo-compliance]]"]
---
## What it does
**No analytics-insight LLM call site exists.** `pipeline/jobfit/insights.py` is NOT analytics generation — it is the deterministic salary/company-compensation-context module (build_company_context / apply_company_salary_context / build_evidence_trace, :28-91); it imports no LLM, calls no provider, has no prompt. There is no `insight(s)` use case in capabilities.py and no resolve_provider("insight…") anywhere. The competitive-features "analytics" track is deterministic.

## Prompt & grounding
N/A — no model call. The only LLM-shaped analytics-adjacent surface is [[weight-proposal]] (which feeds the fairness matrix the analytics view consumes).

## Code quality (wrapping · logging · caching)
N/A. The misattribution likely stems from the file name `insights.py`; the real file contains neither a weight_proposal symbol (that's its own file) nor any insight LLM call.

## Findings
- [value] **INFO — no insights LLM call site to audit.** If an LLM analytics-narrative feature is intended, it doesn't yet exist — confirm scope. The deterministic insights.py carries no model risk. The analytics value Kateřina relies on is the deterministic fairness matrix fed by [[weight-proposal]].
