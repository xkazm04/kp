# Automation quality gating

The LLM HR-automation tasks (see `docs/features/pipeline/README.md`) are
graded by a scripted eval harness, not by spot-checking.
`pipeline/jobfit/eval/automation_eval.py` runs every automation step over a
fixed scenario set and scores two independent axes.

## What it measures

**Reliability** *(deterministic, always on — gate: 100%)*
Did the task return a well-formed result, and do the hard fairness
invariants hold?

- screening never auto-rejects or auto-advances an early-career candidate;
- a rejection draft contains no protected-characteristic language (age,
  gender, race, … incl. Czech);
- re-match never proposes a role below the score floor.

These are pass/fail. A single violation fails the gate. The same invariants
are pinned in CI by `pipeline/jobfit/tests/test_automation_eval.py`
(deterministic path, no network).

**Quality** *(`--judge`, LLM-as-judge — gate: mean ≥ 3.5 / 5)*
An independent Claude CLI judge rates each output 1–5 on task-specific
criteria (grounded / specific / right tone / right language / non-leading /
fair). Judge calls are batched via `ClaudeCliProvider.map`.

## Scenarios

Six scripted candidate×job cases spanning the archetypes and the failure
modes we care about: `bau_strong`, `bau_weak`, `student_learnable`,
`student_weak_fairness`, `switcher`, `czech_outreach` (defined in
`automation_eval.py`'s `SCENARIOS`). Every task runs over every scenario (6
tasks × 6 = 36 task-runs).

## Engine

Claude Code CLI only. `--no-llm` forces each task's deterministic fallback
(offline, CI-safe); the default runs the real LLM and records, per output,
whether the LLM or the fallback produced it — so the report doubles as an
LLM-availability/robustness check.

## Running it

```bash
python -m pipeline.jobfit.eval.automation_eval               # LLM gen + reliability
python -m pipeline.jobfit.eval.automation_eval --no-llm      # deterministic reliability (CI)
python -m pipeline.jobfit.eval.automation_eval --judge       # + LLM quality scoring
python -m pipeline.jobfit.eval.automation_eval --judge --strict --json   # gate (non-zero on fail)
```

## Snapshot

Illustrative full `--judge` run (LLM outputs + judge are non-deterministic —
expect variation):

| task | reliable | llm-produced | quality (mean) |
|---|---|---|---|
| screen | 6/6 | 6/6 | 3.33 |
| outreach | 6/6 | 6/6 | 3.67 |
| rejection | 6/6 | 6/6 | 4.33 |
| prep | 6/6 | 6/6 | 3.83 |
| scorecard | 6/6 | 5/6 | 3.33 |
| rematch | 6/6 | 2/6 | 2.50 |

**Reliability 100% · quality mean 3.5 → gate passes.**

What the gate told us, honestly:

- **rematch is the weakest task (2.5).** Most of that is an artifact of the
  harness, not the code: the eval's alternative-job pool is only two roles,
  so several scenarios correctly return "no alternative above the floor" —
  which the judge rates low because there's nothing useful to act on. It also
  shows `llm=2/6`: when there's no candidate role, the rationale never runs
  and the deterministic `found:false` is returned. Re-match needs a rich open
  role corpus to be useful; it shines against the full seeded DB, not this
  micro-pool.
- **rejection scores highest (4.33)** and is fairness-clean across all six
  scenarios.
- A few `screen`/`scorecard` outputs land at 2 on the strongest BAU case — a
  prompt-tuning target, not a safety issue (reliability/fairness still 100%).
