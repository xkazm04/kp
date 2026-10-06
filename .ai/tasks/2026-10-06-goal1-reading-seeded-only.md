# Goal-1 reading on the seeded-only demo

Stewardship run, 2026-10-06, branch `autopilot/project-kpi-stewardship-cc034f1c`.
Read at `HEAD` = `ec4de8147a48edcdae1bc1931c76a0ae6fe940dc` (includes `51041e015`, the
seeded-entries-only guard). No code was changed. The script copies the database to a temp
directory and never opened `data/kp.sqlite` itself; neither did this task.

## Command

From the worktree root, `KP_DB_PATH=C:\Users\kazda\kiro\kp\data\kp.sqlite`, default job
(`job-001`), default `--sim-interviews` (cap 2):

```
node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning scripts/kpi/role-demo-run.mjs --approve-gates --json
```

It was then run a second time without `--json` for the readable reading. **Two runs, so two
sets of session ids** (each run holds its own simulated interviews). Every figure below is
from the readable run; the `--json` run agreed on every count, verdict and reason. The raw
JSON is not committed. Both runs exited 0 with empty stderr.

## Goal-1 verdict

**met — on a SIMULATED interview**, not a plain `met`. The script's own line:

> goal 1: met on a SIMULATED interview (candidate played by the model from the CV on the entry), gates by the demo stand-in: 2 offers approved on a recorded basis

Basis, as stated: 2 offers approved on a recorded basis (the sealed scorecard of a simulated
interview, `advance`, verdict source `llm`); gates passed by the demo stand-in under its
policy, not a person; `human steps outside gates: 0`. The JSON carries `goalOneComplete: 20`
of `total: 50` and `verdict: met`.

What the verdict does not say: the run did not finish. The final run status is `running`
after 4 passes, and the run `stopped: awaiting approval at rejection (16)`.

## Stages reached

`stages reached: role_spec 1 · slate 1 · screen 20 · case_assignment 4 · interview 4 ·
scorecard 4 · offer_draft 4`

`furthest stage per branch: screen 16 · offer_draft 4`. `reached offer_draft; 16 branches
parked at gates rejection`.

Of the four branches that reached `offer_draft`: `pe-011` and `pe-030` ended `complete`;
`m-rzi9yqw9-job-001` and `m-fvkptapa-job-001` ended `terminal`. The 16 parked branches are
`pe-001, pe-020, pe-025, m-yud6qn7b-job-001, m-cand-000-job-001, m-cand-002-job-001,
m-cand-003-job-001, m-cand-004-job-001, m-cand-005-job-001, m-cand-006-job-001,
m-cand-007-job-001, m-cand-008-job-001, m-cand-009-job-001, m-cand-010-job-001,
m-cand-012-job-001, m-cand-013-job-001`.

Autonomous coverage `10/50 (20%)`: role_spec 1/1, slate 1/1, screen 0/24, case_assignment
4/4, interview 0/8, scorecard 4/4, offer_draft 0/8. Gate dwell: 16 open · 12 closed · 0
unmeasurable · median closed 14.5 ms. Stages produced: 50.

## Gates (stand-in policy)

| Gate | Approved | Declined | Left |
| --- | --- | --- | --- |
| rejection | 4 | 0 | 16 |
| interview_invite | 4 | 0 | 0 |
| offer | 2 | 2 | 0 |

Reasons:

- left at rejection ×16: score below floor
- declined at offer ×2: scorecard unrated: no interview session

No decline or leave reason is recorded for any other cell (all zero). The two declined offers
are the two branches the cap kept out of the simulated interview (see below).

Open gates at the end: rejection 16 · interview_invite 0 · offer 0.

## Simulated interviews

Cap 2. Provider line the run prints:

> provider: the CV of every played (seeded) entry goes to the Claude CLI (`claude -p`) on this machine's Claude seat — no other provider, no API key, no service in between

| Branch | Session | Recommendation | Source | Turns | End |
| --- | --- | --- | --- | --- | --- |
| `pe-011` | `iv-muwt920m-6u9g4v` | advance | llm | 17 | max_turns |
| `pe-030` | `iv-muwtd6e5-gqxkb0` | advance | llm | 17 | max_turns |
| `m-rzi9yqw9-job-001` | none | none | none | 0 | not simulated: cap |
| `m-fvkptapa-job-001` | none | none | none | 0 | not simulated: cap |

No transcript text is recorded here or printed by the script.

## Seed-origin proof

`refused as not seed data: 0` (seeded entries only — the CV of a refused entry was never
sent). The seed fixtures were readable and both played entries passed the proof; there are
no refusal reasons to list. The two skips above are the per-run cap, not the proof.

## Human steps that are not one of the three allowed gates

**0** (`human steps outside gates: 0`; JSON `humanStepsOutsideGates: 0`). The claude CLI was
present and KP_OFFLINE was not set, so nothing read unrated for a provider reason.

## Delta against the last goal-1 demo reading

No prior policy reading. Git history holds the demo's code commits (`d9fd41f5c` introduced
`--approve-gates`, `57a8575db` the stand-in policy, `22ece7a71` the simulated interview) but
no committed reading taken under the policy. The only earlier figure, quoted in ADR 0011's
2026-10-06 amendment, is the pre-policy `--approve-gates` run: 20 of 20 branches at an
approved offer on no assessment, which that amendment withdrew as a false basis. It is not
comparable to this reading.

## Next gap the reading names

The `met` rests on 2 offers out of 4 branches that reached the offer stage, and only because
the simulator was allowed to play 2; the other 2 offers were declined as "scorecard
unrated: no interview session". Meanwhile 16 of 20 screened branches stay parked at the
rejection gate ("score below floor") that the stand-in leaves; per ADR 0011 it will not
decide a hold. The gap: the run does not terminate on its own, because a rejection-gate branch
the stand-in leaves needs a person's call, so goal 1 is met on a subset while the run stays
`running` with 16 open rejection gates.
