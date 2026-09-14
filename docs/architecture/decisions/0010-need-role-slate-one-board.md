---
id: "0010"
title: A need composes a role; the role's slate is one board and one rubric
status: accepted
date: 2026-09-14
supersedes: []
superseded-by: null
tags: [data-model, hiring, agents]
sources:
  - app/_lib/db/intakes.ts
  - app/_lib/db/pipeline-core.ts
  - app/_lib/db/agents.ts
  - app/_lib/rolespec.ts
  - app/_lib/match-score.ts
  - app/_lib/interview-rubric.ts
  - pipeline/jobfit/agentfit.py
  - app/features/agents-workforce/AgentsWorkforceTab.tsx
  - docs/concepts/need-to-role-to-slate.md
---

## Context

The product goal is one sentence: *a stated need becomes a role, the role
becomes a candidate slate (an AI agent or a person), on the same board with the
same evaluation.* Two of those three legs already exist in the codebase, and
they do not meet.

**Need → role exists.** `role_intakes` (`app/_lib/db/intakes.ts`) stores a
dialog-captured `RoleBrief` with graded requirements
(`kind: must_have|nice_to_have` × `hardness: prerequisite|learnable`) and
open-vocabulary facets, per-field provenance included
(`docs/concepts/role-intake-dialog.md`, Phase 1 shipped). `POST
/api/intake/[id]/promote` turns it into a JD plus an ingested, matchable
`Job`, stamping `jd_slug` / `job_id` back onto the intake so a job walks back
to the conversation that defined it.

**Role → slate exists twice, disjointly.**

- A *person* becomes a `pipeline_entries` row (`app/_lib/db/pipeline-core.ts`):
  `job_id`, a stage on the workspace's axis, `match_score` from the Python
  matcher, then an interview scorecard graded against
  `pipeline/jobfit/interview-rubrics.json` — a rubric selected by *archetype*,
  not by the role's own stated requirements.
- An *AI agent* becomes an `agent_fit_specs` row and then a `hired_agents` row
  (`app/_lib/db/agents.ts`), judged by `agentfit.py`: a per-responsibility
  coverage list (`automatable|assisted|human_only`) and a coverage ratio, with
  the verdict `complete|temporary|unassessed`. It is rendered in its own
  surface, `app/features/agents-workforce/`, and never reaches the board.

So the app can already answer "how good is this person for the role?" and "how
much of this role can an agent take?" — but it cannot answer the question the
goal is actually about: **for this need, who is the best candidate, given that
some of them are not people.** The two answers are computed from different
inputs, on different scales, in different languages, and displayed in
different tabs. Nothing reconciles them, and the one existing reconciliation
lesson in this codebase (`match-score.ts`: three producers of "the match
score", never reconciled, three different numbers for the same candidate)
says what happens if we leave it.

There is a second force. The rubric a candidate is judged by is currently
implicit and derived late: from the archetype (scorecard), from prose regex
(`detected_skills()`), from a connector catalog (agent fit). The role's own
stated requirements — the thing the requestor actually said, already
structured and weighted in the brief — are consulted by none of the three.
A rubric that is re-derived per candidate is not a rubric; it is a
coincidence.

## Decision

**The slate is the pipeline, discriminated by population; and the role, at
promotion, freezes one rubric that every population is scored against.**

Three concrete commitments:

### 1. No new funnel. A slate member is a pipeline entry.

`pipeline_entries` gains `population TEXT NOT NULL DEFAULT 'human'`
(`human | agent`) and a nullable `agent_ref` pointing at the agent candidate's
`agent_fit_specs` row. An agent candidate occupies a column on the same board,
moves along the same stage axis, and produces the same pipeline events and
sealed decisions as a person.

The stage axis carries this without renaming anything, because meaning already
lives in `StageRole`, not in the column name (`app/_lib/pipeline-stages.ts`):
a `screening` stage is an agent-fit assessment for an agent and a CV match for
a person; an `interview` stage is a trial devcase run for an agent and a
conversation for a person; `offer` is a dispatch mandate plus a budget
approval for an agent and a salary offer for a person; `terminal` is a hire
either way. The human approval on a `terminal` move remains mandatory for both
populations.

`population` is a NEW column whose default is true of every existing row — no
persisted field changes meaning, and no backfill is required.

**Where this meets the role run.** ADR
[0009](0009-one-role-runs-end-to-end.md) makes a role run an append-only ledger
of stage artifacts and gives stage **S1 (Sourcing)** a `slate` producer whose
artifact is `candidates[]` of
`{ candidateRef, origin: "inbound" | "pool" | "rediscovery" | "agent", priorOutcomeRef? }`.
That `origin: "agent"` value is this decision's agent population, and the two
records must be read as one: S1 is *where* an agent candidate enters a run, and
`population = 'agent'` is *what it is* once it is on the board. Concretely —
an S1 candidate with `origin: "agent"` becomes a `pipeline_entries` row with
`population = 'agent'` and `agent_ref` set to its `agent_fit_specs` row; every
stage after S1 fans out over it on the same terms as a person, scored against
the same frozen rubric (§2, §3) through the agent evidence adapter. ADR-0009's
three gates — rejection, interview invite, offer — gate both populations, which
is the same rule as the mandatory human approval on a `terminal` move above.
Neither record adds a gate the other does not have.

### 2. The role's rubric is a frozen, versioned artifact of the role.

A new workspace-scoped `role_rubrics` store holds, per job, an ordered list of
weighted axes derived from the RoleBrief's graded requirements and its `core`
facets — deterministically, with no provider needed (the grading is already
structured; an LLM only improves the axis prose). The rubric is **frozen at
promotion** and versioned: re-deriving it mints a new version and leaves the
old scores attached to the old version. A candidate scored in week one stays
comparable to one scored in week three, or the difference is visible.

### 3. One score, two evidence adapters.

`pipeline_entries` gains `rubric_score` and `rubric_version`. One resolver
computes it for every entry against the frozen axes; what differs per
population is only the **evidence adapter** feeding each axis:

| Axis evidence | `population: human` | `population: agent` |
| --- | --- | --- |
| Requirement coverage | CV analysis + matcher output | agent-fit coverage class per responsibility |
| Demonstrated work | devcase / work-sample result | trial-run devcase result |
| Conversation | interview scorecard rating | intake/mandate exchange rating |
| Cost | salary band fit | budget suggestion (2%-of-midpoint rule) |

Every axis score carries its basis — `{axis, score, source, evidenceRef}` — so
a verdict is readable back to the artifact that produced it, for both
populations. `match_score` is untouched and keeps its current meaning and
display; the cross-population comparison is made on `rubric_score` only.

The null-score policy of `match-score.ts` governs the new field verbatim: an
unassessed agent (`agentfit.py` is honest about not being able to judge
automatability keylessly) yields `rubric_score = null`, never `0`, and ranks
strictly after every scored candidate.

## Alternatives considered

1. **Keep two surfaces — the board for people, the workforce roster for
   agents (status quo).** Cheapest, and it is what ships today. Rejected: the
   comparison *is* the product goal. Two surfaces can each answer their own
   question well and still make "who do we hire for this need" unanswerable.
2. **One board, two native scores, normalized at display time.** Render a
   coverage ratio and a match score on a common 0–100 axis. Rejected: it
   manufactures comparability rather than establishing it. The normalized
   number would be sealed into the immutable decision chain and fed to the
   fairness metric, which is exactly the "green lie" class ADR
   [0008](0008-row-declares-its-own-outcome.md) forbids — a claim derived from
   a label rather than from the code.
3. **Model an agent as a candidate archetype and reuse `archetype` /
   `role_family`.** No new column. Rejected: `archetype` selects a *scoring
   model within the human population* (`isEarlyCareer`, the BARS rubrics) and
   feeds the archetype-fairness predicate. Overloading it changes the meaning
   of a persisted field silently — forbidden by the repo's own test-quality
   standard — and would make the fairness metric compare people to processes.
4. **Give the slate its own tables (`role_slates` / `slate_members`) beside
   the pipeline.** Clean on paper. Rejected: `pipeline_entries` already owns
   `job_id`, the stage axis, events, comms, consent, calibration and sealed
   decisions. A parallel funnel would duplicate all of it and immediately
   diverge; the slate is a *view over entries for a job*, not a new noun.

## Consequences

- The **Agents workforce tab stops being a hiring surface** and becomes the
  post-hire view: an agent is dispatched (`hired_agents`) when its entry
  reaches a `terminal` stage with the human approval already recorded, instead
  of being dispatched directly from a spec. `POST /api/agents/hire-from-need`
  keeps working as the one-call machine door, but it lands a slate entry on
  the way through rather than bypassing the board.
- **Every board read becomes population-aware.** Counts, the Today rail,
  fairness, calibration, and analytics must each state whether they mean
  people, agents, or both. Silence is a bug here; several of those surfaces
  will read differently on the first mixed board.
- **Comms must refuse, not dead-letter.** An agent-population entry has no
  email; `candidateRecipient()` must return null with a stated reason rather
  than sending to the literal string `"candidate"`.
- **Freezing the rubric costs flexibility we currently have.** Editing the JD
  after promotion will no longer silently change what candidates are judged
  by; it will raise a staleness signal and require an explicit re-score. This
  is the intended cost.
- The rubric becomes a **second consumer of the brief's graded requirements**,
  which raises the price of the RoleSpec-threading debt already recorded in
  `docs/concepts/role-intake-dialog.md` §6.

## What would change our mind

- If agent evaluation comes to be dominated by axes that have no human
  analogue at all — p95 latency, cost per completed task, connector blast
  radius — the shared rubric would become a thin shell around two real ones.
  At that point per-population rubrics plus an explicit, written statement of
  what makes them comparable would be the honest design, and this ADR should
  be superseded rather than stretched.
- If a workspace ever needs two different slates for one role (an internal and
  an agency pool, say) with different rubrics, the "slate is a view over
  entries for a job" identity breaks and `role_slates` (alternative 4) becomes
  right after all.

The increment-by-increment breakdown that enacts this decision lives in
[`docs/concepts/need-to-role-to-slate.md`](../../concepts/need-to-role-to-slate.md).
