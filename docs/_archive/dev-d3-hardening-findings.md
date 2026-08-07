# D3 hardening — lifecycle scenario findings

> **Archived 2026-07-30.** Dated evidence from a lifecycle-eval harness run; the
> prompt fixes it drove (role-anchoring, seniority calibration, the incoherence
> escape-hatch, non-IT domain generalization) are already folded into
> `pipeline/jobfit/devcase/design.py` (now `case-design-v6`). Superseded, as living
> spec, by [`docs/features/dev-case/README.md`](../features/dev-case/README.md).
> Kept for the measured findings and methodology lessons (judge-noise, harness bugs).

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

## Iteration & measured outcome (v2)

Two methodology lessons came out of trying to *measure* the fix:

1. **Absolute LLM-judge scores are too noisy to compare across runs.** Re-judging the pipeline moved
   the **analysis** score 3.96 → 3.0 with *unchanged code* — judge variance (±~1) swamps a ~0.2 effect.
   → We measure prompt changes with a **targeted binary** metric (`--audit role-fit`), not 1-5 means.
2. **The role-anchoring prompt alone couldn't fix the planted mismatches — because the pairs were
   incoherent** (an iOS role on a Playwright web repo). No prompt designs a good iOS case from a web repo.

So the real fixes (v2.1):
- **Incoherence escape-hatch** in `design_case`: when the codebase genuinely can't host the role, design
  on a **synthetic fixture in the role's own domain** + flag the misfit — don't drift into the codebase's domain.
- **Fixed a fallback regression** (it leaked `software_engineering` literal + circular "per the brief").
- **Realistic harness**: planted mismatches are now **same-family, different-framework** (a true transfer
  test); a smaller **incoherent** set exercises the synthetic-fixture path.
- **Seniority-scaled timebox** (junior 3h → lead 8h) + **jobs-corpus** market grounding in `design_role`.
- **Taxonomy deferred (evidence)**: it scores Django→Flask / React→Vue at 0.0 — too sparse for transfer;
  the LLM reasons it better unaided. Needs enrichment before it earns a place.

**Measured (binary role-fit audit, mismatch+incoherent subset, n=16):**

| | Baseline (v1) | v2.1 |
|---|---|---|
| Role-fit (tasks match the role's function, not the codebase) | ~0% (all drifted) | **81%** |
| Incoherent / cross-domain (synthetic-fixture path) | drifted | **6/6 (100%)** |
| Same-family mismatch | drifted | 7/10 |

**Residual (well-characterized):** sub-specialty drift *within* a family — a **Frontend** role handed a
backend stack, or **iOS handed Android** — still falls back to "generic engineering." Targeted next nudge:
respect sub-specialty (frontend = client-side; iOS ≠ Android), then re-audit.

## Part 2 — submission evaluation (does the evaluator discriminate?)

The harness now also tests the **evaluation half**. `submissions.py` plants four candidate archetypes as
git traces (newest-first): **strong** (reads-first → tests → recovers), **naive one-shot**,
**AI-over-reliant** (looks productive — *"make the failing tests pass"* — but never reads/verifies), and
**thrasher** (revert loops). `run_submission_eval` runs the full evaluator chain
(`reflect_commits → assess_tooling → evaluate_submission → score_transfer`) per submission against
deterministically-designed cases (to isolate the evaluator) and measures discrimination
(`--audit submission-eval`).

**Measured (LLM evaluator, 6 cases × 4 submissions):**

| | Deterministic | LLM |
|---|---|---|
| Strong ranks #1 | 100% | **100%** |
| Margin (strong − weak) | +9.5 | **+32.8** |
| Strong − AI-over-reliant gap (the gaming test) | +2.8 | **+34.4** (min +26) |
| AI-over-reliant ranked below strong | 100% | **100%** |
| Eval reliability | 100% | 100% |

The key result: the **LLM evaluator is not fooled by the productive-looking-but-never-verifies trace** —
it reads `readBeforeWrite` at **0.88** for the strong candidate vs **0.23** for the AI-over-reliant one,
and the gamer routinely ranks **last**. This is the LLM-aware evaluation the brief called for: it grades
*how they drove the work and whether they verified*, not raw output.

## Non-IT generalization

The harness is now domain-pluggable (`scenarios.py` `DOMAINS`): IT + **marketing / finance / sales /
design**, each with families, skill-sets, and work-context archetypes; submissions carry domain-flavoured
traces; `lifecycle_eval --domain {it|marketing|…|mixed}`.

**Measured (mixed-domain role-fit audit, mismatch+incoherent subset, n=16):**

| domain | role-fit |
|---|---|
| marketing | 4/4 |
| finance | 3/3 · sales 3/3 · design 3/3 · it 3/3 |
| **overall** | **16/16 = 100%** |

The tasks are genuinely domain-native — *"month-end close, balance-sheet reconciliations, posting-ready
adjusting journals"* (finance), *"own a Q3 campaign launch, allocate the ~$50k"* (marketing), *"design a
member booking flow and lay first design-system tokens"* (design). The thesis (grade judgment/verification,
not raw output) and the covert probes transfer cleanly — e.g. a *marketing-native verification trap*: *"did
the A/B test produce a real winner — avoid peeking?"*

**Terminology** — the IT prompts said "codebase". `case-design-v3` generalizes the vocabulary (use the
role's own terms; "repoSeed" is a legacy field name only). A naive **substring** leak-check made this look
worse than it was — it flagged "**repo**rt", "**commit** to a plan", "mail-**merge** field" as software-isms.
A **word-boundary** check across marketing/finance/sales found **zero genuine** software-isms. *(Same
false-positive class as the earlier "age"→"manage" bug in `automation_eval` — substring scanners over-count;
use word boundaries + read the context.)*

**Verdict:** the pipeline generalizes to non-IT with **no structural changes** — 100% role-fit and
domain-clean language. A schema rename `repoSeed → seedMaterials` (coordinate with the co-owned model/UI)
would remove the last legacy framing, but is cosmetic.

## Next

Sub-specialty nudge (Part-1 residual: Frontend→backend, iOS→Android); add more non-IT domains as needed.
