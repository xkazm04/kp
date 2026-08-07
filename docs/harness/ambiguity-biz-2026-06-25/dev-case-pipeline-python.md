# Dev Case Pipeline (Python) — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀3 / 🚀2 | Severity: C1/H3/M1/L0

## 1. Observed "Live Work Surface" path can never credit a probe — judgment silently suppressed at 0.8 confidence
- **Lens**: 🌀 Ambiguity
- **Severity**: Critical
- **Category**: silent wrong outcome / undocumented trade-off
- **File**: pipeline/jobfit/devcase/process_events.py:100
- **Observation**: `tooling_from_events` hardcodes `handledWell: False` for **every** probe (line 100) and returns `confidence: 0.8` (line 118). `reflect.assess_tooling` makes this the PREFERRED path whenever `events` are present (reflect.py:202-206, "higher confidence (0.8)"). Downstream, `evaluate.evaluate_submission`'s deterministic judgment is `0.5*verif + 0.5*handled` (evaluate.py:144); with `handled` always 0 the in-product candidate's judgment is *halved* versus the no-probe branch (`_pct(verif)`), and the LLM eval path is fed the same all-`False` booleans as if they were a real assessment. The comment notes only that "handled well" can't be judged deterministically — it never records that this systematically biases the fairness-critical `judgment` dimension downward.
- **Why it matters**: Two identical candidates get different hiring scores purely because one used the premium Live Work Surface: their `judgment` is capped (~50 max) while the system reports HIGH confidence (0.8), so a reviewer is told to *trust* a number that is structurally suppressed. That is exactly the "silent wrong hiring outcome" the engine exists to avoid, and it penalizes the flagship in-product flow.
- **Recommendation**: Stop emitting a definitive `handledWell: False` when handling is unknown — make it tri-state (`null`/unknown) and have `evaluate` treat unknown probes as no-signal (drop them from the `handled` mean, mirroring `MISSING_DIMENSION_SCORE`), not as a failure. Cap observed-path confidence to reflect that probe handling was not assessed.
- **Effort**: M

## 2. Undocumented deterministic scoring coefficients — architecture is scored entirely from tooling fluency
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: magic numbers / scoring model
- **File**: pipeline/jobfit/devcase/evaluate.py:138
- **Observation**: In an otherwise exhaustively documented file (the MIN confidence-propagation, `MISSING_DIMENSION_SCORE`, the canonical-score contract are all spelled out), the actual fallback scoring math has zero rationale: `framing = _pct(0.55*rbw + 0.45*0.5)` (half-anchored to a constant 0.5), `architecture = _pct(0.4 + 0.35*fluency)` (architecture is purely a function of tooling fluency, floored at 40, capped ~75), `transfer = _pct(0.5*fluency + 0.5*verif)` (lines 138-146). No comment explains why these weights/floors, or why "architecture" (structure & trade-offs) is computed from how the candidate drove tools.
- **Why it matters**: This is the live scorer whenever the LLM is down. A candidate can be handed a 40 on architecture for using few tools, with no recorded basis — a conflation of two unrelated capabilities that produces a real, defensible-looking hiring number. The missing reasoning is also tribal knowledge: nobody can safely tune these without guessing intent.
- **Recommendation**: Add a comment block (matching the file's own standard) justifying each coefficient/floor, or replace the architecture proxy with something not derived from fluency. Pull the constants into named module-level values so the model is inspectable and tunable.
- **Effort**: S

## 3. The engine is fully domain-general but boxed as "Dev" — a whole AI work-sample market left on the table
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: monetization / market expansion
- **File**: pipeline/jobfit/devcase/design.py:227
- **Observation**: Enormous, deliberate work has de-industry-locked this engine: `design_case` instructs the LLM to author cases for marketing, finance, sales, design, HR, legal, ops in each role's own vocabulary (design.py:227-242), `models.CaseScenario.repo_seed` is explicitly "domain-neutral starting materials … NOT necessarily a repository" (models.py:159-177), `analyze_need` handles roles with "NO codebase and no tech stack" (analyze.py:72-77), and the rubric descriptions were rewritten to be domain-neutral (models.py:138-149). Yet the context, CLI, prompts and product framing all say "Dev".
- **Why it matters**: The differentiator (AI-authored, ambiguity-probed, authenticity-scored work samples that assume 100% AI-generated output) is already general-purpose. "Authentic work-sample hiring for ANY role in the LLM era" is a far larger TAM than dev hiring, and the build cost is mostly already paid — this is value computed and then hidden behind a narrow name.
- **Recommendation**: Productize a non-dev pilot (e.g. marketing or finance work samples) on the existing engine; rename the surface area away from "Dev" or expose a role-family picker. Price it as a premium "verified work sample" tier.
- **Effort**: M

## 4. The fairness/authenticity QA judge runs only offline on synthetic data — never on the real evaluation a recruiter sees
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / trust differentiator
- **File**: pipeline/jobfit/devcase/submission_eval.py:368
- **Observation**: An LLM-as-judge that explicitly asks "does this evaluation unfairly penalise AI use?" (`fairToAiUse`, submission_eval.py:368-384) and a quality/lever judge (lifecycle_audits.py:28-52) exist — but they are wired ONLY into the `--judge` eval harnesses. The production `devcase_cli` `evaluate-submission` command (devcase_cli.py:342-356) mints scores, transfer and followups but never runs any per-candidate fairness/quality self-check.
- **Why it matters**: kp's core promise is "fair to AI use," yet that guarantee is certified only on synthetic scenarios offline, never on the actual evaluation shown to a recruiter or candidate. A per-evaluation "fairness verified" / quality-confidence certificate is a concrete trust + differentiation lever (and a plausibly monetizable "verified" badge) built almost entirely from code that already exists.
- **Recommendation**: Add an optional `--judge`-style QA pass to `evaluate-submission` that attaches a per-evaluation fairness verdict + note to the envelope, and surface it in the eval UI as a trust signal.
- **Effort**: M

## 5. Sourcing shortlist floor (45) and top-N (8) are unexplained cutoffs that decide who a recruiter sees
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: magic numbers / band cutoff
- **File**: pipeline/jobfit/devcase/source.py:35
- **Observation**: `source_candidates(..., top_n: int = 8, floor: int = 45)` silently drops every candidate scoring below 45 on the 0-100 match scale (source.py:35, 63-64), and the CLI ships these as the production defaults (`--top-n 8`, `--floor 45`, devcase_cli.py:188-189). Unlike most constants in this codebase, neither value carries any rationale — why 45 and not 40 or 50, and why is a candidate at 44 invisible to the recruiter?
- **Why it matters**: This cutoff governs who even enters the funnel, so an unjustified threshold is a hidden hiring-policy decision (and a fairness/coverage risk) with no recorded reasoning — exactly the tribal-knowledge constant that should be documented or made explicit per role.
- **Recommendation**: Document the basis for the 45 floor (and the 8 cap), or make the floor role-/seniority-relative; at minimum surface "N candidates were below the floor" so a recruiter knows the shortlist was trimmed.
- **Effort**: S
