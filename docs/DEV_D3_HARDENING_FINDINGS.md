# D3 hardening — lifecycle scenario findings

Evidence from running the **need → reality-reflection → role + case** pipeline over a
synthetic IT landscape via `pipeline/jobfit/devcase/lifecycle_eval.py`:

- **120 scenarios `--no-llm`** (structure/invariants) + **24 scenarios real-LLM, judged**
  (`--count 24 --judge`). Landscape = 6 role families × stacks × 4 seniorities × 6 codebase
  archetypes, with planted defects (stack mismatch / ungrounded / ambiguous).

## What's already healthy (don't touch)

| Signal | LLM run (n=24) |
|---|---|
| Reliability (well-formed + fairness/integrity invariants) | **100%** |
| Gap caught on planted MISMATCH | **100%** |
| Clarify-probe present on AMBIGUOUS needs | **100%** |
| Probe-kind diversity (4 kinds, balanced) | **1.0** |
| Case-title uniqueness | **1.0** |
| Judge quality — **analysis** | **3.96 / 5** |

The reality-reflection step is strong and the artifacts are well-formed, varied, and fair.
(The deterministic fallback is templated — 3 fixed probe kinds, title-uniqueness 0.10 — fine
as a fallback; variety rides the LLM path.)

## The one real weakness — case quality 3.21 vs analysis 3.96

**Finding 1 — design_case drifts to the CODEBASE's domain instead of the ROLE (highest priority).**
Every low-scoring case (score ≤2: **9/9**) is a role↔codebase **incongruence** — 7 planted stack
mismatches + 2 where a security need sits on a data-pipeline-shaped repo. The judge's words:
*"Strong craft, wrong role"*, *"hard domain mismatch"*, *"asks for a lead AppSec Engineer but the
artifact is a Senior Data Pipeline take-home."* The analysis **correctly flags** the gap (gap-catch
100%), but `design_case` then grounds in the repo and silently designs for the *code's* domain.
→ The case must be **anchored to the role being hired**, using the codebase as context, and when
analysis reports a stated-vs-real conflict it must reconcile it (design for the role's intent, or
explicitly treat the repo as a brownfield/bridge) rather than follow the code.

**Finding 2 — seniority is under-calibrated.** The most-requested improvement lever, by far, was
**seniority calibration (31×)**. A junior and a lead case currently look too alike (fixed ~4h
timebox, same probe depth). Scope, difficulty, probe depth, and timebox should scale with seniority.

## Do we need more? — evidence-backed verdict

### Prompts — YES, two targeted edits (not a rewrite)
1. **Role-anchoring** in `design_case` (case-design-v1 → v2): anchor to the RoleSpec; on a flagged
   gap, reconcile explicitly. This alone should lift most of the score-2 cases.
2. **Seniority calibration**: instruct scope/difficulty/probe-depth/timebox to scale with seniority.

### App-data involvement — YES, by requested lever (each maps to something the app already has)
| Lever (judge votes) | Wire in |
|---|---|
| seniority calibration (31) | **jobs corpus + `role_band`** seniority/scope norms feed design |
| deeper repo signals (25) | extend the **GitHub fetch** (contents/deps/tests/issues; D5 added the commit trace) into analysis+design |
| skill taxonomy (18) | the app's **taxonomy graph** to normalize stack + detect *partial transfer* (e.g. Django↔Flask are both Python-web) — directly improves mismatch reasoning |
| company/team context (13) | new intake fields (see UI) |
| example assignments (7) | a small **few-shot library** of good cases to lift craft |
| comparable roles (6) | benchmark the role against the **150-job seed corpus** |

### UI-configurable items — YES
- **Seniority-scaled timebox & difficulty** (auto, overridable).
- **Probe count / kinds** (currently fixed at 4) — recruiter toggle.
- **Rubric weights** per role family (the 5 dims) — like the automation `POLICY`.
- **Data-source toggles**: taxonomy / jobs-corpus / deeper-repo / company-context on/off.
- **Company / team / product** context fields in the need intake.
- **Anchor choice** when a mismatch is detected: design *for the role* vs *for the codebase*.

## Harness caveat (honest)

The generator pairs stack × archetype freely, so some incongruence (e.g. a security stack in a
data-pipeline-shaped repo) is synthetic. That's a realistic stressor — real repos *are* often
incongruent with the role being opened — and it's exactly what exposed Finding 1. A future refinement
can also add archetype-coherent scenarios to separate "model drift" from "planted incongruence."

## Next

Land the two prompt edits + taxonomy/seniority grounding, then re-run the judged sample to confirm
the score-2 cases lift. After the pipeline is tightened, extend this same harness with **simulated
assignment distribution** and **assignment-evaluation** scoring (the evaluate_submission side) so the
*whole* lifecycle is quality-gated end-to-end — and generalize the landscape to non-IT.
