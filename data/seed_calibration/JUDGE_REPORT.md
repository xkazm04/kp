# Case-generation calibration — real-JD corpus

## ✓ PASS

Jobs: 100 · reliable: 100/100 (100%) · LLM rows: 100 · error-fallbacks: 0

## Health signals

- role-fit rate (tasks match the role's function): **0.99** (100/100 judged)
- probe-kind diversity: 1.0 · counts {'verification_trap': 103, 'ambiguity': 96, 'legacy_trap': 100, 'underspecified': 98}
- probe-count distribution: {4: 97, 3: 3}
- case-title uniqueness: 1.0

## Automated judge (self-grading — a breadth signal only)

- mean by task: {'analysis': 3.95, 'case': 4.06} · overall 4.0
- most-requested app-data levers: [('seniority calibration', 159), ('company/team context', 76), ('comparable roles (jobs corpus)', 55), ('skill taxonomy', 53), ('deeper repo signals', 35), ('salary/market benchmarks', 20), ('example assignments', 14)]

### Low-score notes

- [case/cal-026] Grounding is shallow: the brief echoes the JD's literal materials (shipping dashboard, pre-paid labels, photograph boxes — which are textbook reshipping/package-mule scam markers the generator never f

## Role-fit DRIFT (case left the role's domain)

- **cal-026** medior Administrative Assistant - Remote / Online / Work From Home (PT/FT) · administration · real: The materials are administration-appropriate (shipping dashboard, pre-paid labels, camera for photographing packages), but the tasks are generic dev-case scaffo