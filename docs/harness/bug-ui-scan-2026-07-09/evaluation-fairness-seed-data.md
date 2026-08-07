# Evaluation, Fairness & Seed Data — bug-hunter + ui-perfectionist scan

> Context: Offline eval harness (thresholds, matching/automation/interview eval, fixtures) and the deterministic seed datasets — the gate that certifies the matching + interviewer engines aren't biased.
> Files reviewed: 9 of 23
> Total: 5

Prior-report Highs #1 (`_probe_pedigree` delta<=3) and #2 (`entry_precision` defaults to 1.0) are **fixed** on `main` (probe now requires `delta == 0`; `aggregate()` omits an unmeasured `entry_precision` and `passes()` fails on the missing axis). Focus below is the four never-scanned interview-eval files.

## 1. Offline `--no-llm` reliability gate certifies PASS while silently skipping 11 of 13 scenarios

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / vacuous-gate
- **File**: `pipeline/jobfit/eval/interview_eval.py:725-742` (`run_golden`), gated by `_passes` at `932-939` and `main` at `1122-1126`
- **Scenario**: CI runs `python -m pipeline.jobfit.eval.interview_eval --no-llm --strict`. `run_golden` does `g = golden.get(s.name); if not g: continue` — any scenario without a bundled golden transcript produces **no Row at all**. `interview_golden.json` contains only `swe_senior_strong` and `adversarial_asks_score`; `interview_scenarios.json` curates 13 (including `adversarial_injection`, `adversarial_hostile`, `adversarial_silent`, `adversarial_czech_switch`, both `grounded_*`). So the offline gate validates **2 scenarios**, reports `reliability 2/2 = 100%`, and `_passes` returns True. `main` only bails (`return 2`) when **zero** goldens match — one is enough to go green.
- **Root cause**: Reliability is computed as `reliable/total` where `total` is "rows that happened to have a golden", not "scenarios that must be covered". Coverage collapse is folded into a 100% accuracy pass. Adding a new curated adversarial scenario without a golden silently shrinks the CI gate while it stays green.
- **Impact**: The interviewer safety gate (no-decision / no-leak / not-stuck / disclosure) that CI relies on offline exercises 15% of the hand-written adversarial suite; a regression in injection/hostile/Czech handling ships green.
- **Fix sketch**: Assert a coverage floor — every scenario selected for `--no-llm` must have a golden, else FAIL (not skip) with the missing names; or gate on `covered/selected` and require it to equal 1.0. Never let a missing fixture reduce the denominator.

## 2. `interview_optimize` trains and validates on the same scenarios — accepted "improvements" are in-sample and can be judge-noise

- **Severity**: High
- **Lens**: bug-hunter
- **Category**: eval-methodology / overfitting
- **File**: `pipeline/jobfit/eval/interview_optimize.py:69-74` (`_score`), `85-87` (`_accept`), `125-158` (`optimize`)
- **Scenario**: `optimize()` evaluates the current brief over `scenarios`, feeds the **failing transcripts** to `propose_patches`, then re-evaluates the proposed rules over the **same `scenarios`** and accepts iff `cand_score > best`. There is no held-out set: rules are fit to the exact cases they are then scored on. Worse, `_score` returns `(reliable, quality_sum)` where `quality_sum` is a sum of `--judge` LLM scores (non-deterministic), and base vs candidate are measured in **separate** LLM runs, not paired — so `cand_score > best` conflates the rule's effect with sim/judge sampling variance. On a reliability tie, the noisy quality sum decides acceptance.
- **Root cause**: A hill-climb that uses its evaluation set as its training set, comparing two independent noisy measurements and attributing the delta to the rule.
- **Impact**: The reported `reliability X → Y` and the "accepted rules" a human folds into the production interviewer brief are optimized-to-the-test and may not generalize — or may be pure noise. The tool that's supposed to *harden* the interviewer can launder overfit rules into the real prompt.
- **Fix sketch**: Split scenarios into propose/validate folds (fit rules on one, accept only if they improve the held-out fold); require the reliability component to strictly improve (deterministic) and treat the judge sum as advisory; re-measure base and candidate with paired runs / a fixed golden set before accepting.

## 3. Judge failures are swallowed, inflating `quality_mean` over the transcripts that scored

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `pipeline/jobfit/eval/interview_eval.py:745-772` (`judge_rows`), `861-878` (`_aggregate`), `932-939` (`_passes`)
- **Scenario**: `--judge --strict`. In `judge_rows`, a `ClaudeCliError`, non-JSON reply, or out-of-range score does `continue`, leaving `r.quality = None`. `_aggregate` computes `quality_mean` over `[r.quality for r in rows if r.quality is not None]`, and `_passes` gates on that mean. If the judge times out or errors on the **hardest/longest** transcripts (exactly the low-quality ones), those drop out and the mean is computed over the easy transcripts that scored — pushing it above `QUALITY_THRESHOLD` (3.5). The only signal is a cosmetic `⚠ N un-scored` note in the report; nothing fails the gate.
- **Root cause**: "Unscored" is treated as "excluded from the average" rather than "unmeasured → the gate cannot certify quality".
- **Impact**: The quality half of the interviewer gate passes on a self-selected easy subset; a systematic quality regression that also makes transcripts hard-to-judge hides itself.
- **Fix sketch**: Fail (or refuse to certify quality) when the unscored fraction exceeds a small tolerance; alternatively require `unscored == 0` under `--strict`, mirroring finding 1's coverage-floor principle.

## 4. `--strict --baseline` gate flags LLM sampling variance as a regression and fails the build

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: non-determinism / flaky-gate
- **File**: `pipeline/jobfit/eval/interview_eval.py:914-929` (`diff_baseline`), `1164-1165` + `1200` (`main`)
- **Scenario**: A CI job runs the live sim with `--baseline base.json --strict`. `diff_baseline` marks a scenario a **regression** when it was reliable in the baseline and isn't now (or quality dropped ≥2), and `main` sets `ok = _passes(agg) and not regressed`, returning `1` on any regression. But transcripts come from `ClaudeCliProvider` (both the simulated candidate and interviewer) with no temperature/seed pinning — a single scenario flipping reliable→unreliable between runs is ordinary LLM variance, not a code change. One flip reddens the build.
- **Root cause**: A baseline diff meant for deterministic signals is applied to a stochastic generator; the only reproducible path (`--no-llm` golden) is not what a `--baseline` live run exercises.
- **Impact**: Flaky CI that fails on noise erodes trust in the fairness/reliability gate and trains maintainers to ignore or `--update-baseline` past real regressions.
- **Fix sketch**: Require N repeats and only flag a regression that persists (majority/all runs), or restrict `--strict` regression-gating to the deterministic golden/offline path; document that live `--baseline` diffs are advisory.

## 5. ElevenLabs backend records the agent's own criteria failures to `quality_issues`, which never gate the run

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: `pipeline/jobfit/eval/interview_eval.py:692-722` (`run_scenarios_elevenlabs`); `pipeline/jobfit/eval/elevenlabs_backend.py:118-130` (`failed_criteria`)
- **Scenario**: With `--backend elevenlabs`, each run maps our `must_hold` invariants into EL `extra_evaluation_criteria`, and EL's own LLM analysis grades them. `_one` puts those results into `r.quality_issues = [f"EL criterion failed: {c}" …]`. But `reliable` is `not self.issues` and the gate (`_passes`) keys off `reliability` + numeric `quality_mean` — `quality_issues` feeds neither. So if EL's analysis flags "the interviewer gave a score/leaked the rubric" on a Czech transcript the deterministic regex validators (`_check_no_decision`/`_check_no_leak`) miss, that failure is printed and dropped: the run passes reliability. The more-capable grader's verdict is cosmetic.
- **Root cause**: Two independent judges (our regex validators, EL's LLM criteria) are collected, but only the weaker one gates; EL's findings are report-only.
- **Impact**: The EL-fidelity backend — the one closest to production voice — can certify an interview reliable while EL itself judged a safety criterion failed. False green on the highest-fidelity path.
- **Fix sketch**: Fold EL criterion failures for `must_hold`-derived criteria into `r.issues` (so they count against reliability), keeping only non-safety `handling` criteria advisory.
