# Goal-1 reading on the end-state verdict

Stewardship run, 2026-10-06, branch `autopilot/project-kpi-stewardship-cf311e5d`, read at the
commit `9ffc624e5` (the four-clause verdict and the cap-ordering fix). The script copies the
database to a temp directory and never opened `data/kp.sqlite` itself; neither did this task.
The raw JSON is not committed. One run; every figure below is from it.

## Command

From the worktree root, `KP_DB_PATH=C:\Users\kazda\kiro\kp\data\kp.sqlite`, default job
(`job-001`), default cap (`--sim-interviews` 2):

```
node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning scripts/kpi/role-demo-run.mjs --approve-gates --json
```

Exit 0, empty stderr.

## Headline, verbatim

> goal 1: not met: offers approved only on interviews a harness cap cut short (max_turns x1); run end state: running; 16 branches held for a person at rejection (gates approved by demo stand-in)

The ledger's own verdict is still `met` (`humanStepsOutsideGates: 0`); the end-state clauses are
what turn it into `not met`. The run did not finish: status `running` after 4 passes, stopped
`awaiting approval at rejection (16)`.

## The four clauses

| Clause | Result | Counts |
| --- | --- | --- |
| (i) an offer approved on a recorded basis | **pass** | 1 offer approved (`pe-030`, scorecard `advance`) |
| (ii) an approved offer rests on an interview that ended by protocol | **fail** | 0 protocol-ended bases; the 1 approved offer's interview ended `max_turns` |
| (iii) every branch at a defined end state | **pass** | 0 open branches: 4 at `offer_draft` (1 complete, 3 terminal by decline), 16 holds left at rejection |
| (iv) no seed branch kept out by the cap | **pass** | 0 capped seed branches |

`--json` fields beside `goalOneHeadline`: `runEndState: "running; 16 branches held for a person at
rejection"`, `protocolEndedBases: 0`, `harnessEndedBases: {max_turns: 1}`, `cappedSeedBranches: []`,
`heldForPerson` (16 refs), `openBranches: []`, `goalOneClauses`.

Gates: rejection approved 4 · declined 0 · left 16 (score below floor); interview_invite approved
4 · declined 0 · left 0; offer approved 1 · declined 3 (scorecard unrated: no interview session).
Stages reached: role_spec 1 · slate 1 · screen 20 · case_assignment 4 · interview 4 · scorecard 4
· offer_draft 4.

## Refused as not seed data: 2

Both with the same reason, "not simulated: not seed data (CV not sent to the provider): the
pipeline seed holds no entry with this id":

- `m-rzi9yqw9-job-001`
- `m-fvkptapa-job-001`

These are the two branches the previous reading recorded as "not simulated: cap" and "refused: 0".
They were never seed data; the old cap-before-proof order hid it. They are counted, they did not
use the cap, and they do not fail clause (iv).

## Simulated-interview rows (cap 2)

| Branch | Session | Recommendation | Source | Turns | End |
| --- | --- | --- | --- | --- | --- |
| `pe-011` | `iv-muwu9sbe-wfxh4j` | none (not rated: scorecard not accepted, verdictSource template, not llm) | template | 17 | max_turns |
| `pe-030` | `iv-muwuco7v-zg3381` | advance | llm | 17 | max_turns |
| `m-rzi9yqw9-job-001` | none | none | none | 0 | not simulated: not seed data |
| `m-fvkptapa-job-001` | none | none | none | 0 | not simulated: not seed data |

No transcript text is recorded here.

## Delta against `2026-10-06-goal1-reading-seeded-only.md`

| | seeded-only reading | this reading |
| --- | --- | --- |
| goal-1 headline | met on a SIMULATED interview, 2 offers | **not met** (clause ii) |
| offers approved | 2 (`pe-011`, `pe-030`) | 1 (`pe-030`); `pe-011` was declined |
| why `pe-011` changed | scorecard `advance`, source llm | the scorer returned a template verdict this time, so the card stayed unrated (the 'llm'-only rule) |
| interviews ended by protocol | 0 of 2 (both `max_turns`, not looked at) | 0 of 1 rated (`max_turns`) |
| refused as not seed data | 0 (reported) | 2 (`m-rzi9yqw9`, `m-fvkptapa`) |
| "not simulated: cap" rows | 2 | 0 |
| held for a person at rejection | 16 (unstated in the headline) | 16, stated in the headline |
| run status | running (unstated) | running, stated |

The previous `met` is withdrawn on its own evidence: both of its interviews also ended `max_turns`.
The simulator is non-deterministic (a template verdict where the earlier run had an llm one), so
the offer count can move between runs with no code change.

## Next gap the reading names

Clause (ii). The demo's 8-candidate-turn limit (`DEMO_SIM_LIMITS`, `maxCandidateTurns: 8`) ends
every simulated call at `max_turns` (both interviews in both readings, 17 turns each), so no
simulated interview in this demo has ended by protocol, and under the repo's own detectors such a
call is not evaluable. Until a simulated call can reach `end_interview` or `director_end` — a
higher turn limit, or an agenda short enough to finish in 8 turns, which is an engine or limits
decision this change did not take — goal 1 cannot read `met` on this demo. The other two
non-holds are in order: 16 holds are a person's call under the fairness rule, and no seed branch
is capped.
