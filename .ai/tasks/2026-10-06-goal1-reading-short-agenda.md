# Goal-1 reading on the short demo agenda

Stewardship run, 2026-10-06, branch `autopilot/project-kpi-stewardship-5f1d9ccf`, read at the
commit `559cebaa0` (the short demo agenda, ADR 0011 amendment "Short agenda, same spend"). The
script copies the database to a temp directory and never opened `data/kp.sqlite` itself; neither
did this task. The raw JSON is not committed. ONE run; every figure below is from it. Limits are
unchanged: 8 candidate turns, 48 calls, 2 interviews.

## Command

From the worktree root, `KP_DB_PATH=C:\Users\kazda\kiro\kp\data\kp.sqlite`, default job
(`job-001`), default cap (`--sim-interviews` 2):

```
node --import ./scripts/test-alias-loader.mjs --experimental-transform-types --disable-warning=ExperimentalWarning scripts/kpi/role-demo-run.mjs --approve-gates --json
```

Exit 0, empty stderr.

## Headline, verbatim

> goal 1: met on a SIMULATED interview on a short demo agenda (candidate played by the model from the CV on the entry), gates by the demo stand-in: 2 offers approved on a recorded basis, 2 on an interview that ended by protocol; run end state: running; 16 branches held for a person at rejection

`--json` carries the same fact beside it: `simulatedAgenda: "short-demo"`,
`simulatedAgendaBlocks: 3`. The run did not finish: status `running` after 4 passes, stopped
`awaiting approval at rejection (16)`.

This `met` is on a short agenda: one scored block (the kit's first topic) plus role questions and
the close. It is a weaker basis than a protocol end on the full kit agenda, and the label says so.

## The four clauses

| Clause | Result | Counts |
| --- | --- | --- |
| (i) an offer approved on a recorded basis | **pass** | 2 offers approved (`pe-011`, `pe-030`), both scorecard `advance` |
| (ii) an approved offer rests on an interview that ended by protocol | **pass** | 2 protocol-ended bases (both `end_interview`); 0 harness-ended |
| (iii) every branch at a defined end state | **pass** | 0 open branches; 16 holds left at rejection (a person's call) |
| (iv) no seed branch kept out by the cap | **pass** | 0 capped seed branches |

Gates: rejection approved 4 · declined 0 · left 16 (score below floor); interview_invite approved
4 · declined 0 · left 0; offer approved 2 · declined 2 (scorecard unrated: no interview session —
the two invited branches the cap of 2 did not play). Stages reached: role_spec 1 · slate 1 ·
screen 20 · case_assignment 4 · interview 4 · scorecard 4 · offer_draft 4.

## Simulated-interview rows (cap 2)

| Branch | Session | Recommendation | Source | Turns | End | Agenda blocks |
| --- | --- | --- | --- | --- | --- | --- |
| `pe-011` | `iv-muwx0pnz-f5um29` | advance | llm | 13 | end_interview | 3 (short-demo) |
| `pe-030` | `iv-muwx2t87-1uocn1` | advance | llm | 13 | end_interview | 3 (short-demo) |

Both scorecards came back from the model (`verdictSource llm`); neither was a template this time.
No transcript text is recorded here. `turns` counts both parties' spoken turns (13 = 7 interviewer + 6 candidate
turns), inside the 8-candidate-turn limit.

## Refused as not seed data: 2

Both with the reason "not simulated: not seed data (CV not sent to the provider): the pipeline
seed holds no entry with this id"; both spent nothing and neither fails clause (iv):

- `m-rzi9yqw9-job-001`
- `m-fvkptapa-job-001`

## Delta against `2026-10-06-goal1-reading-end-state.md`

| | end-state reading | this reading |
| --- | --- | --- |
| goal-1 headline | **not met** (clause ii) | **met**, on a short demo agenda |
| clause (ii) | fail: 0 protocol-ended bases | pass: 2 protocol-ended bases |
| interviews ended | 2 x `max_turns` (17 turns each) | 2 x `end_interview` (13 turns each) |
| offers approved | 1 (`pe-030`; `pe-011` template verdict, declined) | 2 (`pe-011`, `pe-030`; both llm `advance`) |
| agenda | the full kit agenda, uncoverable in 8 turns | 3 blocks, one scored |
| refused as not seed data | 2 | 2 |
| held at rejection | 16 | 16 |
| run status | running | running |

The change is the agenda, not the spend: same limits, same 2 interviews. The simulator is
non-deterministic (the previous reading's `pe-011` scored as a template), so one run is one
sample: that both scorecards were llm this time is not evidence the template path is gone.

## Next gap the reading names

The `met` rests on a one-block agenda. What it proves is that a simulated call on the demo path
can reach `end_interview` with its scored block covered and an llm scorecard behind an offer; it
does not show a full kit agenda can be completed, and a real interview is not 8 turns. The other
open items are unchanged: 16 holds are a person's call under the fairness rule, the run stops
`running` at the rejection gate, and the stand-in's offer approvals still depend on a model scorer
that can return a template. Widening the agenda (more scored blocks inside a higher turn limit)
would be a spend decision for the operator, not taken here.

## Gates

`npm run typecheck`, `npm run lint` (0 errors), `npm run test:unit` (12748/12748) and the
`scripts/kpi` fixture tests (81/81) pass; `check-adrs` passes. Not run, and red on `main` before
this change per the brief: the `test:perf` import-graph budget, and `test:docs` on the operator's
untracked `docs/design/app-contest-kit.md`.
