---
id: "0018"
title: A Match verdict is sealed in the decision chain as facts, before the add files the entry
status: accepted
date: 2026-10-07
supersedes: []
superseded-by: null
tags: [matching, decisions, audit, pipeline, reasons]
sources:
  - app/_lib/match-verdict.ts
  - app/features/insights/matrix/focus/matchReasons.ts
  - app/api/pipeline/route.ts
  - app/_lib/decision-attribution.ts
  - app/_lib/reasons-coverage.ts
  - scripts/kpi/reasons-coverage.mjs
  - app/api/pipeline/pipeline-routes.test.ts
  - app/api/pipeline/match-add-not-sealed.test.ts
  - app/_lib/kpi-reasons-meter.test.ts
---

## Context

The full council on `candidate-job-matching` left one must-address, verbatim:

- "craft: The Match reasons snapshot is stored as locale-bound prose in a mutable
  gate-payload slot, so it is neither a snapshot nor a record"

The architecture review of 2026-10-07
([`reviews/2026-10-07-architecture-review.md`](../reviews/2026-10-07-architecture-review.md),
finding #1, rated **compete now**) traced it:

- The Match screen composed a sentence in the recruiter's language and the add sent it
  (`reasons`, plus matched and missing skill names). The unproven skills, the locale and
  any scorer version were dropped on the way.
- `POST /api/pipeline` stored the sentence as `pipeline_entries.approval_detail`. That
  column holds five other payload shapes keyed by `approval_kind`, and most transitions
  clear or overwrite it: reinstate, every `setApproval`, a confirmed schedule, an accept,
  a board drag, a rematch.
- The reasons meter (`kpi:reasons`) read the live column, so the first accept turned an
  explained ranking into a miss.

Key goal 4 is that every automated step can be explained to the candidate. A verdict
that disappears at its first transition cannot meet it.

## Decision

**A Match add carries the verdict's FACTS, not a sentence. The route validates them and
seals them into the decision chain before it inserts the entry. Every surface renders the
sealed facts in its reader's language.**

- **Facts, split from the renderer.** `matchReasonFacts(m)` in
  `app/features/insights/matrix/focus/matchReasons.ts` produces `MatchReasonFacts` with
  these fields:
  - `fitTier`;
  - the strongest and weakest dimension as `{labelCode, percent}`;
  - at most three trimmed matched, unproven and missing skill names, each ≤ 40 characters;
  - `matchScore`;
  - `scorerVersion`.

  `renderMatchReasons(facts, t)` is the only renderer. The Match card, the CSV, the
  Decisions cohort, the records panel and the meter all use it. The closed vocabularies
  (`FIT_TIERS`, `DIMENSION_LABEL_CODES`) and the strict validator `coerceMatchReasonFacts`
  live in the dependency-free `app/_lib/match-verdict.ts`, and a test pins them to
  `matching.py` and to all four catalogs.
- **Validate, then seal first, as [ADR 0017](0017-a-human-adverse-decision-is-sealed-before-it-commits.md) does.**
  Every `source: "match"` add must carry `matchFacts`, and no other add may.
  - The facts must be in-vocabulary and within bounds, with no unknown key, and they must
    name the score being filed.
  - The retired prose fields are refused.
  - Any failure here is a 400 `PIPELINE_ADD_REASONS_INVALID`, with nothing sealed and
    nothing inserted.

  The route then seals **one** `match_verdict` record:
  - `candidateRef`: the entry id the insert will use (`pipelineEntryIdFor`). A re-add
    lands on the same id and seals its own record.
  - `actor`: the filing recruiter (`humanActor()`), not `auto:match`.
  - `policyVersion`: the scorer version.
  - `reasonCode`: `match_fit`.
  - `inputs`: the facts.
  - `rationale`: a byte-stable code string (`matchVerdictRationale`), never prose.
  - The workspace is passed explicitly.

  A failed seal is 503 `PIPELINE_ADD_NOT_SEALED` and files nothing. There is no `await`
  between the seal and the insert.
- **No add writes `approval_detail`.** `createPipelineEntry` no longer takes it.
- **Readers resolve, they do not parse the slot.** `matchVerdictReasons` /
  `sealedMatchVerdictOf` (`app/_lib/decision-attribution.ts`) re-validate the record's
  facts and render them. `GET /api/pipeline/[id]` hands the Decisions modal the newest
  verdict.
- **The meter resolves too.** `matchFiledRanking` takes the sealed record, looked up by
  `candidate_ref`, instead of the raw column.

**Legacy rows are not backfilled.** The facts cannot be recovered from a localized
sentence, and re-running the match today would seal, with today's date, a verdict nobody
was shown. The meter therefore reports Match-filed entries with no record in two buckets:
*legacy prose snapshot* and *legacy, snapshot cleared before the record existed*. They
are outside every arm and outside the headline figure, and they can only shrink.

## Alternatives considered

The review weighed three homes, scored on what the must-address and key goal 4 need.

1. **(a) A dedicated record at insert: a column or a table on the entry.** It can hold
   any shape, and it shares the insert's transaction. It lost because it is immutable
   only by convention plus a source guard, and `approval_detail` already shows how a
   convention on that row ends. It would also need its own resolver to render in the
   reader's locale, a fill-only rule for re-adds, and a new path to the candidate. Nothing
   in the codebase sets a precedent for it.
2. **(b) The `added` pipeline event.** It also shares the insert's transaction. It lost
   because `pipeline_events` has only `detail TEXT`, so it cannot hold codes plus params
   without a payload column on a table every activity surface reads, plus another prefix
   protocol like `approval:`. It has no write-once rule, and erasure rewrites event rows.
   A re-add onto an existing row writes no `added` event at all, so a re-filed verdict
   would leave nothing behind.
3. **(c) The sealed decision chain: chosen.** It is the only home that already has four
   properties:
   - immutable by construction (hash-chained, and `verifyDecisionChain` detects an edit);
   - already shaped as codes plus params (`reasonCode` plus `inputs`);
   - already rendered in the reader's language through a shared resolver (the
     `waveReasonText` precedent);
   - already able to reach the candidate through `/status/[token]`'s allowlist.

   It also has precedent: `group_eval_lead` already seals a ranking verdict.

Recomputing the verdict on the server, instead of trusting the browser's facts, was
also considered. It was not taken because it would cost a Python spawn per add. The facts
come from the browser the same way `match_score` always has, so the record attests "what
the recruiter was shown when they filed". The actor field says exactly that.

## Consequences

- **A residue remains, the same one ADR 0017 accepts.** The chain has its own connection
  (architecture review finding #4), so the seal and the insert cannot share one
  `IMMEDIATE` transaction. An insert that fails after the seal leaves a record of a
  verdict that was shown but never filed. A re-add onto a terminal entry whose reopen is
  refused still seals its record, because the recruiter did file it.
- **The kind is internal.** `match_verdict` is not in `status-decisions.ts`'s
  `CANDIDATE_VISIBLE_DECISION_KINDS` / `AI_VERDICT_DECISION_KINDS`, so a candidate does
  not see it. Whether they may see a ranking against a role they never applied for is an
  open owner question.
- **It is labelled where sealed kinds are enumerated:** `RECORD_ONLY_KINDS` plus
  `analytics.decisionRecords.kinds.match_verdict`, and the reasons contract (counts as
  `ranking`).
- **A freshly filed Match entry's latest sealed decision is now its `match_verdict`.**
  `getAtsRecordResult` exports the latest record, so an ATS mirror of such an entry
  carries `kind: "match_verdict"`, `automated: false`. That is true: a recruiter filed it.
- **The drawer's sealed-decision list shows the code-string rationale.** The analytics
  records panel and the Decisions modal render the localized line, and the candidate
  drawer does not do so yet.
- **`MATCH_SCORER_VERSION` is a client constant.** The Python scorer emits no version, so
  `policyVersion` names the facts contract. Generating the label codes and the version
  from the scorer is review finding #6.
- **A stale browser tab** that still sends the retired prose fields gets a 400 on add
  until it reloads.

## What would change our mind

- **The chain and the pipeline store sharing one connection** (finding #4). The seal and
  the insert would then move into one `IMMEDIATE` transaction, which retires the residue.
  This ADR's shape stays.
- **A seal failure rate high enough to block real adds.** That would need a durable
  pending-seal state. It would not be a return to storing prose in the slot.
- **The owner ruling that candidates may see the verdict.** That adds the kind and a fact
  extractor to `status-decisions.ts`. It does not change where the verdict lives.
