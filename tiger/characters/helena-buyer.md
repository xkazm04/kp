---
name: Helena — Buyer / Evaluator
type: tiger/character
maps_to: ["[[github-analysis]]", "[[cv-analysis]]", "[[sim-offer-draft]]"]
source: uat/characters/helena-buyer.md
---
## Who they are / Voice
The economic buyer evaluating kp for purchase. Judges whether the AI outputs are trustworthy and whether spend is predictable/attributable (she'll be on a BYOM or metered plan). Distrusts confident output that can't show its evidence, and distrusts a product that can't tell her what its AI costs.

## Jobs to be done
Decide if the AI is good enough to buy; understand and control per-feature AI cost; trust that her BYOM keys actually serve her traffic.

## Senior-quality bar
Outputs cite evidence and refuse to fabricate when evidence is thin. AI spend is metered per use case/provider (a durable ledger, not just observability). BYOM keys are honored everywhere (no silent fallback to a platform key). Product copy doesn't overstate what the code does.

## Scored acceptance criteria
- [ ] AI spend is durably metered + attributable per use case/provider
- [ ] BYOM key resolution honored on every call site (no bypass)
- [ ] outputs are evidence-grounded + refuse on insufficient evidence
- [ ] no copy overstates the underlying logic
