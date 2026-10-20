---
id: "0015"
title: An AI agent on the role board is not a person; every machine actor refuses or skips it
status: accepted
date: 2026-10-07
supersedes: []
superseded-by: null
tags: [hiring, agents, integrations, candidate-data]
sources:
  - app/_lib/db/core.ts
  - app/_lib/stage-hooks-role-fill.ts
  - app/_lib/stage-hooks.ts
  - app/_lib/stage-hooks-homework.ts
  - app/_lib/comms-dispatch.ts
  - app/_lib/db/analytics.ts
  - app/api/pipeline/outcomes/hire-roster.ts
  - app/_lib/ats-record.ts
  - app/_lib/ats-record.test.ts
  - app/_lib/ats-egress.ts
---

## Context

[ADR-0012](0012-need-role-slate-one-board.md) put an AI agent on the same board
as a person: `pipeline_entries.population` is `human | agent`, and an agent
candidate moves along the same stage axis. That decision said every board read
"becomes population-aware" and that "silence is a bug here". It did not say what
each machine actor must *do* with an agent entry, and the actors were written for
a board that held only people.

The agent-entry scan
(`.ai/tasks/2026-10-07-agent-entry-machine-actors-scan.md`) walked them and found
eight that treat an agent as a person. The root cause was one line: the dispatch
card (`placeAgentOnBoard`) was filed with no population, and
`coerceSlatePopulation` maps every absent value to `"human"` — it cannot tell
"not set" from "a person". The consequences it named:

- the role-fill hook counted an agent activation as the role's hire, closed the
  role and withdrew every in-flight human candidate (`role_closed`);
- the hire roster, the Quality rating queue and analytics counted an agent as a
  hire, which contaminates time-to-hire, cost-per-hire and the sample the match
  score is calibrated against;
- the automation projection did not SELECT `population`, so any guard
  downstream was a silent no-op;
- the interview and homework arrival hooks refused an agent with the wrong
  reason ("no deliverable contact address") and parked it on a human gate;
- the interview and case invites were built from a narrow object literal that
  dropped `population`, so the refusal could not fire;
- the ATS record had no population field, so an agent's LLM-authored name would
  have been exported to the customer's system of record as a person
  (`candidate.hired`, `offer.accepted`).

## Decision

**An agent-population entry is not a person, and every machine actor that would
treat a board entry as one refuses or skips it, through one shared predicate.**

### 1. One predicate

`isAgentPopulation(entry)` and its SQL twin `notAgentSql(alias?)` live in
`app/_lib/db/core.ts` beside `coerceSlatePopulation`. They are pure and add no
import to any consumer's graph. Nobody re-types the comparison.

### 2. Who applies it

| Actor | Behaviour for an agent entry | Commit |
| --- | --- | --- |
| Hire count (`listJobPipelineStats`), role-fill hook, automation projection, analytics, hire roster | not counted as a hire; the hook skips with reason `agent_population`; the projection SELECTs `population`; analytics and the roster exclude it in SQL via `notAgentSql` | 9eeba1f70 |
| Interview and homework arrival hooks (`stage-hooks.ts`, `stage-hooks-homework.ts`) | `skipped` / `agent_population`, nothing parked on a human gate | 849eb78ea |
| Interview and case invites (`comms-dispatch.ts`) | take the whole candidate (`CandidateCommTarget & { locale }`) so the existing recipient refusal sees the population | ed3ff3ea9 |
| ATS export (`buildAtsRecord`) | refuses with `AtsRecordRefusedError("agent_population")` | b9f45b1aa |

`placeAgentOnBoard` now files its card with `population: 'agent'`, and a boot
fixup sets it on existing `agent-bridge` cards.

### 3. The ATS refuses; it does not redact and does not add a field

`AtsRefusalReason` is `"anonymized" | "agent_population"`. The egress path's
handling of a refusal is unchanged (terminal dead-letter, the same as an
erasure). `AtsCandidateRecord` gains no `population` field, so
`ATS_SCHEMA_VERSION` stays `kp.ats.v1` — no schema bump, and nothing a
subscriber's connector has to learn to read.

## Alternatives considered

1. **Export with a `candidate.population` field.** Needs a `kp.ats.v2` bump. The
   scan lists it as one of two options and leans against it: a schema field a
   subscriber's connector has never read is a field it will ignore, so the agent
   would still land in the customer's ATS as a person for any connector that
   does not check it. The scan flagged the choice as an owner call; who made it
   is not recorded beyond the commit that took the refusal path.
2. **Redact the agent, as an anonymized candidate is.** The code comment says
   "Refused, never redacted". A reason beyond that is **not recorded**.
3. **Per-caller checks instead of one predicate.** The scan prefers one shared
   predicate (the `recipientRefusal` precedent), because the same call answers
   the role-fill hook, the projection, analytics, the roster and the ATS record.
   A rejected per-caller design is **not recorded** as a written alternative;
   what is recorded is the failure it would repeat: the projection that dropped
   the column and the invite literal that dropped `population` were both
   per-caller omissions the compiler could not catch.

## Consequences

- **An agent never reaches the customer's ATS.** Not on `candidate.hired`, not on
  `offer.accepted`, not on a hand-reject. The refusal is handled by the existing
  terminal dead-letter path.
- **The agent still counts as on the board.** `listJobPipelineStats` leaves
  `total` and `reachedInterview` unchanged; only "hired", a claim about a person,
  excludes it (`.ai/tasks/2026-10-07-agent-not-a-hire.md`).
- **A new machine actor owes the question.** Anything that counts, mails,
  invites, hooks or exports a board entry must call the predicate or carry a
  stated reason it need not. The population column is only as good as the
  projection that SELECTs it.
- **No test pins the boot fixup** (no existing fixup has one), so the repair of
  pre-existing dispatch cards rests on review.
- **Known open edges, not decided here.** `listJobPipelineStats` has no `status`
  filter, so a rejected human parked on the terminal column still counts as hired
  (adjacent, not agent-specific). `docs/features/integrations/README.md` still
  names only the anonymized refusal
  (`.ai/tasks/2026-10-07-agent-entry-fixes-5-7.md`).

## What would change our mind

- **A `kp.ats.v2`.** If the schema is versioned for another reason, a
  `population` field costs no extra bump and exporting an agent as a labelled
  non-human becomes cheap to reconsider.
- **An ATS that models non-human workers.** If a supported receiver has a first
  class record for an AI agent, refusing stops protecting the customer and starts
  withholding something useful.
- **A person-affecting reason to mirror an agent**, for instance a customer who
  needs the agent's dispatch in their system of record for audit. That would be a
  new event with its own row, per ADR-0008, not a loosened refusal.
