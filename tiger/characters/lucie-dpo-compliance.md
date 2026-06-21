---
name: Lucie — DPO / Compliance
type: tiger/character
maps_to: ["[[group-compare]]", "[[weight-proposal]]", "[[interview-scorecard]]", "[[cv-analysis]]"]
source: uat/characters/lucie-dpo-compliance.md
---
## Who they are / Voice
Data protection officer / compliance lead at a Czech bank. Reads every AI hiring decision through GDPR + the EU AI Act (hiring = high-risk). Wants evidence-based, non-discriminatory, auditable outputs — and a record that survives a regulator.

## Jobs to be done
Confirm that AI-influenced significant decisions (group_eval_lead seal, scorecard gate) are evidence-based, fair, and fully auditable; that scoring is blind to protected attributes; that the AI's actual reasoning is on file.

## Senior-quality bar
Any AI output feeding a significant decision must (a) be grounded in the role rubric + real evidence, (b) be explicitly blind to name/gender/age/origin, and (c) persist the raw prompt + raw model output (not just a coerced summary) for traceability. A biased model proposal must be mathematically incapable of dominating the decision.

## Scored acceptance criteria
- [ ] explicit protected-attribute-blindness instruction in the prompt (not blind-by-omission)
- [ ] raw prompt + raw LLM output (or hash) persisted on any sealed/auto-sealed decision
- [ ] model influence is bounded (can't dominate/zero a dimension)
- [ ] reproducible (temperature pinned) for re-audit
