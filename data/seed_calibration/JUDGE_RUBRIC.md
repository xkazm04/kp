# Case-generation judge rubric (Part 1 calibration)

The rubric the **calibration judge** (Claude Opus, a higher vantage than the
sonnet-class generator — so it doesn't self-grade) applies to each generated
`case` in `cases/<id>.json`. The automated `--judge` in `calibrate.py` is a cheap
breadth signal that runs on the *same* engine that generated the case; this rubric
is the real bar.

Each case probes **judgment in the LLM era** — it assumes the candidate's work may
be 100% AI-generated, so it grades durable capability (framing, tooling fluency,
judgment/verification, architecture, transfer), never raw output. The instrument is
the `coverProbes`: covert ambiguities/traps, each with an internal `reveals` and a
`decisionSpace` (the 2–3 defensible options the ambiguity admits). One task must
require a visible DECISIONS log.

## Dimensions

| # | Dimension | Type | What "pass / 5" means |
|---|-----------|------|-----------------------|
| 1 | **Role fidelity** | pass/fail | The case TASKS match what THIS role actually does — not a drifted, generic, or software-default domain. |
| 2 | **Domain vocabulary** | pass/fail | Candidate-facing text uses the role's own terms; no leaked `codebase / repo / commit / PR / refactor` for a non-software role. |
| 3 | **Probe quality** | 1–5 | 2–4 *real* ambiguities; each `decisionSpace` is genuinely 2–3 defensible trade-offs (NOT one-right-answer + distractors); `reveals` is meaningful. |
| 4 | **Seniority calibration** | 1–5 | Scope/ambiguity fit `role.seniority` AND `timeboxHours` (≤2h hard cap). Senior = more ambiguity/depth, not more deliverables. |
| 5 | **Concreteness** | 1–5 | Names concrete materials/artifacts with specific embedded issues; avoids template phrasing. |
| 6 | **Discrimination power** | 1–5 | Would actually separate a strong candidate from a naive one for THIS role. |
| 7 | **Verdict** | good / weak / broken | + a `failure_mode` tag and a one-line note. |

Common `failure_mode` tags: `domain-drift`, `vocab-leak`, `fake-decisionspace`
(one correct answer dressed as a trade-off), `generic-tasks`, `weak-probes`,
`too-long` (deliverables over-scoped for the timebox), `wrong-seniority`.

## Acceptance bar (enforced by `calibrate.py --strict`, plus this rubric out of band)

- structural reliability = 100% (`_check_*` clean)
- `error_fallbacks` = 0 (the LLM actually ran + returned parseable JSON)
- role-fit rate ≥ 0.95 (the industry-lock metric)
- automated **case** judge mean ≥ 4.0 (analysis is intermediate + inherently ungrounded for repo-less roles, so it's not gated)
- case-title uniqueness ≥ 0.95 (catches template collapse)
- calibration judge: **0 "broken"**, role-fidelity pass ≥ 95%, probe-quality mean ≥ 4/5
