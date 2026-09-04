"""``python -m pipeline.jobfit.eval`` — the golden-set extraction eval (runner.main).

THE EXIT-CODE CONTRACT for every entry point in this package — runner,
matching_eval, automation_eval, intake_eval, interview_eval, interview_optimize,
fault_eval and thresholds. Five of them used to use four different conventions
(one could not fail at all), so a script could not tell "the gate failed" from
"the run never happened":

    0   the run happened, and under --strict every gate it could measure passed.
    1   a gate FAILED under --strict, OR the run measured/accepted nothing while
        being asked to certify. A red verdict about real data.
    2   the run could NOT be performed: unusable flags, no engine, an empty
        scenario selection, a judge that was refused. Nothing was scored, so
        neither a pass nor a failure is being claimed.

Two rules keep it readable:

- **--strict is what asks for a verdict.** Every entry point takes it. Without
  it a failing gate still prints FAIL and exits 0, because these reports are read
  by people at least as often as by CI.
- **A data-integrity failure ignores --strict.** A malformed fixture or a corpus
  that will not load is not a soft quality bar; runner exits 1 on it either way.

Keyless behaviour follows from the same rule: a run that cannot reach its
provider measured nothing, so it exits 0 unless you asked it to certify (then 1).
"""
from .runner import main

raise SystemExit(main())
