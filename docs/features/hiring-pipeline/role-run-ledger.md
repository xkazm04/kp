# The role run: a ledger of stage artifacts

The durable thread that carries **one role from a job description to an offer
draft**, pausing only where a decision is felt by a person.

Implements ADR-0011 (*A role runs end to end as a ledger of stage artifacts; only
person-affecting decisions gate*), accepted by the operator on 2026-09-14. This
document describes **what is built**; the ADR carries *why*, the three rejected
alternatives, and what would change our mind.

> **Status: the sequencer and the gates are built and tested. The stage runners are
> the deterministic, keyless floor.** Every stage below persists a real artifact and
> consumes the previous one, and the three gates really do block. The LLM/Python
> engines that produce richer stage content (`jd-build-run`, `automation-pass`,
> `devcase-orchestrator`, `interview-scorecard`) are attached one stage at a time by
> passing a runner for that kind — see *Attaching a real engine* below. Until a stage
> is attached, its artifact says honestly what it does and does not know.

## The pieces

| File | What it owns |
| --- | --- |
| `app/_lib/role-run-stages.ts` | The seven artifact kinds, their order, which stages gate, the transition table, the resume read (`nextStageFor`), and the PII rule. Pure, DB-free. |
| `app/_lib/role-run-gates.ts` | The three gates, as the screen-wave approval protocol scoped to a run. Pure, DB-free. |
| `app/_lib/db/role-runs.ts` | `role_runs` + `role_run_stages`: the append-only ledger. Owns its own DDL. |
| `app/_lib/role-run-engine.ts` | The resumable pass, the per-candidate fan-out, the default stage runners, and the gate commit. |

## The seven stages

| # | Kind | Produces | Gated? |
| --- | --- | --- | --- |
| S0 | `role_spec` | the job's rubric keys + a role hash, and what the JD does **not** say (`lintFindings`) | no |
| S1 | `slate` | the run's branch list, capped at `SLATE_CAP` (20) with `truncated` told honestly | no |
| S2 | `screen` | a per-candidate route (`advance` / `hold` / `reject_proposed`) with a reason code | **rejection** |
| S3 | `case_assignment` | the work sample, its timebox and its seed | no |
| S4 | `interview` | a **drafted** invite — the token is not minted here | **interview invite** |
| S5 | `scorecard` | a recommendation against S0's rubric version and keys | no |
| S6 | `offer_draft` | drafted terms and a TTL from `offer-policy` — never a minted offer | **offer** |

S0 and S1 are run-wide. Everything from S2 on belongs to **one candidate branch**.

## Why a ledger and not a function that calls seven things

A run must survive a process restart, the 20-minute execution ceiling, and a
candidate who answers on Thursday. A call stack survives none of them. So the run is
**state**: each stage appends one immutable artifact, and *resuming is re-reading the
last artifact per branch*. There is no cursor column and no in-memory progress —
`advanceRoleRun()` works out what each branch is owed from the ledger alone, produces
at most `maxStages` artifacts, and returns. Call it again and it picks up exactly
where it stopped.

### The resume read and the transition table

"What runs next" has exactly one answer, and it is a pure function of the rows:
`nextStageFor(artifacts, branchRef)` in `role-run-stages.ts`. Given every artifact of
the run, it replays one chain (`branchRef` null for the run-wide chain, an entry id for a
candidate's branch) in `seq` order and answers `produce <kind>`, `await_gate` (with the
approval kind), `await_fan_out` (a branch asked about before the slate), `done` (run
terminal, fanned out, branch terminal, or offer approved), or `invalid`. The engine
calls nothing else to decide a pass, and reports where the run stands through the same
read, so "where a branch stands" and "what it is owed" cannot disagree.

The replay is held to `ROLE_RUN_TRANSITIONS`, a written-out table of which
`kind:status` may follow which. It encodes three rules:

- a **gated** stage enters only as `awaiting_approval` and is resolved only from its own
  proposal — a gated stage written straight to `complete` is the gate skipped;
- an **ungated** per-candidate stage is only ever `complete` — ending a candidacy
  happens at a gate, never as a side effect of a case or a scorecard;
- a **run-wide** stage may be `terminal` (the job is gone), which ends the run.

A row the table forbids makes its chain `invalid`, and nothing is advanced over it
(`findRoleRunTransitionViolations` names each one). The engine checks every runner's
outcome against the table before the append and throws `RoleRunTransitionError` — so a
richer engine attached through the runner seam cannot skip a gate — and a gate commit
checks the branch's head is that gate *before* spending the approval token.

An artifact **references** store rows (`entryId`, `devcaseId`, `inviteRef`); it never
copies them. `jobs`, `pipeline_entries`, `dev_cases`, `schedule_invites` and `offers`
stay the single source of truth for their own domain.

## The three gates

A gate is a decision **about a person that the person would feel**. There are three,
and the list is the load-bearing claim: a fourth at the scorecard would change the run
from *three pauses* into *a supervised pipeline*.

All three are the protocol in `app/_lib/screen-wave-approval.ts`, scoped to
`<runId>#<gate>` — preview → token signed over the exact subject set at an issue
time → single-spend commit inside a 15-minute window, with the same five distinct
refusals (`required`, `expired`, `mismatch`, `spent`, `unattributed`). Nothing about
the approval shape is re-invented, so the Art. 22 / EU AI Act argument is made once.

Two properties worth knowing:

- **A gate blocks a candidate, not the run.** One branch parked holds that branch;
  the other nineteen keep moving. A per-stage barrier would let one unreviewed
  rejection stop a slate of twenty.
- **The run drafts; nothing mints yet.** `createOffer` and
  `createScheduleInvite` are never reachable from the engine — a test asserts the
  module does not import them. The gate commit today only verifies and spends the
  approval token and appends the resolution artifact: it mints no invite and creates no
  offer, and no route calls it yet. Whether a gate gets a door that does is open (see the
  [ADR 0011, 2026-10-07 amendment](../../architecture/decisions/0011-one-role-runs-end-to-end.md#amendments)).

## The PII rule

> A `role_run_stage` payload may contain identifiers, scores, codes and hashes. It may
> **not** contain a candidate's name, contact, CV text or transcript.

Enforced at the one write door (`appendStageArtifact`), not documented and hoped for:
a key denylist catches the field names the existing stores actually use, and a value
check catches an address or a phone number hiding in an innocently-named field. The
consequence is that `consentWithholdsPii()` at a read boundary is **sufficient** —
there is no second copy of the candidate's words in the ledger to forget to scrub when
a consent expires mid-run.

The recruiter is covered too: a gate commit records `approverRef` as a hash. Today that
hash is the only trace of the approver — the commit seals no decision record, so no
attributable identity exists anywhere yet. See the [ADR 0011, 2026-10-07 amendment](../../architecture/decisions/0011-one-role-runs-end-to-end.md#amendments).

## Attaching a real engine

`advanceRoleRun(runId, { runners: { screen: myRunner } })` replaces one stage and
leaves the other six alone. A runner receives the run, the branch, and the artifact it
consumes, and returns `{ status, payload }`. That seam is what makes the remaining
stage-wiring increments independent of each other — and it is why the defaults are
keyless: the two-minute keyless start means the run's *sequencing* must be
demonstrable with no provider configured.

### The producer seam (`app/_lib/role-run-producers/`)

`producerRunners(producers)` turns a list of `{ kind, usesLlm, run }` into the `runners`
map, and is the one place that decides which runner a stage gets:

| Situation | The stage runs |
| --- | --- |
| LLM producer, provider available | the producer |
| LLM producer, no provider / `KP_OFFLINE` / `KP_ROLE_RUN_LLM=0` | the keyless default, unchanged |
| any producer throws | the keyless default (logged by error name only - a provider message can echo a prompt) |
| local producer (a policy engine, no model) | the producer |

"Provider available" is `roleRunLlmAvailable()`: the `claude` CLI on PATH or a Gemini key,
and not offline. The LLM layer is the existing Python provider registry (`claude_cli`
adapter included), reached through the existing `*-run.ts` runners with
`env: buildLlmConfigEnv()`; a producer never spawns `claude` itself. The engine opens the
`withLlmRoleRun` scope around each runner, so a producer's metered calls are attributed to
the run and count against its budget. Producers write no PII and resolve no gate.

### The producers wired so far

Compose them with `producerRunners([roleSpecProducer(), slateProducer(), screenProducer()])`
and pass the result as `advanceRoleRun(id, { runners })`. Nothing composes them yet, so the
default stays the keyless floor.

| Stage | Producer | Uses a model? | What it adds over the floor |
| --- | --- | --- | --- |
| S0 `role_spec` | `role-run-producers/role-spec.ts` | yes (JD builder) | When the job states **no** graded requirement but has a description, generates a rubric (`rubric_generated_from_description`). A job that already states requirements is reused as is. Nothing is written back to the job. |
| S1 `slate` | `role-run-producers/slate.ts` | no (local ranker) | Board entries first, then the role's rediscovered silver medalists under `SLATE_CAP`, each with `origin: "rediscovery"` and a `prior:<kind>:<stage>` ref. The consent/opt-out predicate (`withheldCandidateIds`) is asked again right before a board entry is minted for a rediscovered candidate; a candidate who already has an entry for this role is never revived. |
| S2 `screen` | `role-run-producers/screen.ts` | no (policy pass) | The automation policy pass as a **scoped dry run** (`runAutomationPass({ dryRun: true, entryIds })`): read-only, one branch. Its route, score and codes become the parked proposal; the pass's prose is never copied. It can propose `reject_proposed`, still only a proposal for the rejection gate, and the fairness backstop's downgrade-to-hold is preserved (`fairnessAlerts`). |

Not wired: S3 to S6 (no producer yet), and the stale-rubric re-score on the board (it has
no evidence source to re-run until a producer supplies rubric-versioned evaluations).

## The per-run LLM budget

Cost per run is unbounded by construction (S1 fan-out x S2 LLM calls), so `advanceRoleRun`
checks a ceiling **before every stage** (`app/_lib/role-run-budget.ts`). The run's own
spend is read from `llm_usage.role_run_id`, which the engine stamps by opening a
`withLlmRoleRun(run.id, ...)` scope around each stage runner. On a breach the pass stops
cleanly: the stage that was running finishes and writes its artifact, no later stage
starts, and the result carries `budgetExceeded: { dimension, used, ceiling }`. The run is
**parked, not cancelled** - it stays `running`, and a later pass (after the ceiling is
raised) resumes exactly where it stood.

Units are calls and tokens, because the default provider (the Claude Code CLI) is
subscription-billed and has no dollar cost: its rows keep `cost_usd` NULL and are counted
as `unpricedCalls`, never converted into a dollar figure. A dollar ceiling is optional and
compares only against priced spend. Deployment defaults, overridable per call with
`AdvanceOptions.budget`:

| Env var | Default | Meaning |
| --- | --- | --- |
| `KP_ROLE_RUN_MAX_LLM_CALLS` | `400` | metered LLM calls per run (failed attempts count) |
| `KP_ROLE_RUN_MAX_LLM_TOKENS` | `4000000` | input + output tokens per run |
| `KP_ROLE_RUN_MAX_COST_USD` | unset | dollars, priced calls only |

A non-numeric or non-positive value falls back to the default.

## Measuring it

Per ADR-0011's consequences, do **not** report a single "time to hire" over a run.
Wall-clock is dominated by human latency at the three gates, and one number hides
which half is slow. The two honest measures are **autonomous-stage coverage** (how
much of the thread ran without a human step) and **gate dwell** (how long each gate
waited), reported separately.

## Tests

- `app/_lib/role-run-stages.test.ts` — the stage order, the three-gate list, the transition table pinned against both, `nextStageFor` over every position and every forbidden-row shape, the PII rule both directions (including that a hex hash is not read as a phone number)
- `app/_lib/role-run-contract.test.ts` — the ledger contract both directions over real runs: every report a pass makes is backed by a row, every row a run writes (hire, declines at each gate, a cancelled run, one-artifact passes) is reachable; a run reconstructed across a closed-and-reopened connection; a gate-skipping runner refused with nothing written
- `app/_lib/role-run-gates.test.ts` — the signed set, the window, the single spend, and that a rejection token cannot approve an offer
- `app/_lib/db/role-runs-store.test.ts` — the real schema: the unique index, `seq` ordering, tenancy in both directions, append-only history
- `app/_lib/db/role-runs-tenancy.test.ts` — source guard: every ledger query is workspace-scoped, and nothing updates or deletes an artifact
- `app/_lib/role-run-engine.test.ts` — the full JD → offer-draft run against real `jobs` and `pipeline_entries` rows, resume at a ceiling, the fan-out, and that no artifact carries a name the board row does carry

## Known gaps

- **The table is enforced by the engine, not by the store.** `appendStageArtifact` still
  accepts any kind/status a direct caller hands it; the engine and the gate commit are
  the only writers today, and both check. Moving the check to the write door is a
  follow-up.
- **A withdrawn or lapsed candidate has no ungated way to end a branch.** The status
  vocabulary cannot tell "the candidate left" from "we ended it", so the table routes
  every branch end through a gate.
