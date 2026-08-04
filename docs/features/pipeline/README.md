# Hiring Pipeline & Automation

The candidate funnel from a sourced/applied CV to a hire, plus the automation
layer that assists recruiters at every stage without ever silently rejecting
or advancing a candidate on its own. Local-first: the only runtime LLM is the
Claude Code CLI (`pipeline/jobfit/claude_cli.py`); every automated task has a
deterministic fallback so the pipeline never blocks when the CLI is missing.

## Entry points

- `/?tab=pipeline` — the pipeline board (`app/features/hiring/pipeline/PipelineTab.tsx`).
- `/?tab=decisions` — the Decisions queue, where AI holds/recommendations land for
  a human to approve or reject (`app/features/hiring/decisions/DecisionsTab.tsx`).
- Per-candidate drawer — `app/features/hiring/pipeline/PipelineCandidateDrawer.tsx`.

## Stage model

Five canonical stages, defined once in `app/_lib/pipeline-stages.ts`:

```
Accepted → Screened → Interview → Offer → Hired
```

`Accepted` is the real funnel entry — a CV received either inbound (apply /
quick-apply / channel webhook) or proactively sourced/rediscovered. This
replaced an earlier `Sourced` → `AI-matched` → `Screening` naming (see
"Corrections" below); legacy stage names are no longer used in code.

## Flows

1. **Screening (LLM-assisted, fairness-gated).** `screen_candidate()` in
   `pipeline/jobfit/automation.py` scores a fresh `Accepted` entry. A **pre-LLM
   fairness gate** forces `hold` for a learnable-gap early-career candidate
   before the prompt ever runs. The LLM/fallback then returns a
   `recommendation` (`advance` | `hold` | `reject`) + `confidence`; only
   `advance` + `confidence ≥ 80` + a non-early-career archetype auto-advances
   to `Screened` — everything else lands in the Decisions queue. Never an
   automatic reject.
2. **Policy pass (deterministic, no LLM).** `evaluate_entry()` in
   `automation.py` batch-evaluates active entries ("Run automation pass" button
   or `/api/automation/run`) against a `POLICY` dict (advance/hold/reject
   thresholds, aging windows). An unscored entry (no match score yet) always
   holds — it is never coerced into a fabricated zero. Applied server-side by
   `app/_lib/automation-pass.ts` / `app/_lib/automation-run.ts`.
3. **Screen wave — configurable bulk auto-reject.** `app/_lib/screen-wave.ts`
   auto-rejects the bottom X% of a role's matched cohort that are *also* below
   a configurable match floor — the one Phase-3 capability the original spec
   only sketched. Thresholds are no longer hard-coded: they live in a
   per-workspace decision-config store (`app/_lib/decision-config-store.ts`,
   schema in `decision-config-schema.ts`), editable from the Decisions Rules
   modal. The fairness gate is preserved and **fails closed**
   (`isFairnessProtected`): early-career, unknown-archetype, and unscored
   candidates are excluded from the rejectable cohort entirely, not silently
   coerced to a rejectable score. An optional recruiter-audited holdout sample
   (`screen-wave-holdout.ts`) is carved out of every auto-reject batch for
   quality review.
4. **On-demand tasks.** Outreach draft, rejection draft, interview prep pack,
   interview scorecard synthesis, and re-match alternatives are all
   recruiter-triggered, never automatic. One consolidated route dispatches all
   of them (see Surface below); `app/_lib/automation-fairness.ts` re-asserts
   the auto-reject invariant at the TS boundary (`assertAutoRejectFair`) as a
   defense-in-depth check independent of the Python gate.
5. **Offer-stage group evaluation.** `GroupEvalModal` /
   `app/_lib/group-eval-run.ts` compares a role's candidates (incorporating the
   interview scorecard, not just match score) before a recruiter extends an
   offer.
6. **Automation ROI ledger.** `app/_lib/automation-roi.ts` attaches a
   per-action "minutes a recruiter would have spent doing this by hand"
   estimate to each automated event kind and aggregates hours/CZK saved from
   the real `pipeline_events` trail — a measurement layer added after the
   original spec, answering "what is this automation actually worth."

## Surface

| Module / route | Purpose |
|---|---|
| `pipeline/jobfit/automation.py` | Task functions: `screen_candidate`, `draft_outreach`, `draft_rejection`, `interview_prep`, `interview_scorecard`, `rematch_candidate`, `evaluate_entry` (Task 7, deterministic). `POLICY` dict holds the hard-coded defaults. |
| `pipeline/jobfit/automation_cli.py` | Sub-command CLI entry point (`screen`, `outreach`, `rejection`, `prep`, `scorecard`, `rematch`, `policy-pass`); UTF-8 stdio, JSON out, `{error,status,code}` on stderr. |
| `app/api/automation/[task]/route.ts` | **Consolidated** per-entry task route (`POST {entryId, notes?}`) — replaced the one-route-per-task layout the original spec proposed. Operator-only (`requireOperator`). |
| `app/api/automation/run/route.ts` | Task 7 policy pass over active entries. |
| `app/api/automation/schedule/route.ts` | Scheduling-side automation hook. |
| `app/api/tasks` (kind `"automation"`) | Hardened/background path sharing `runAutomationTask` with the synchronous route above — tracked, deduped, refresh-safe. |
| `app/_lib/automation-run.ts` | `runAutomationTask` — shared dispatcher both routes call into. |
| `app/_lib/automation-pass.ts` | Applies Task 7 policy-pass decisions to the DB in one transaction. |
| `app/_lib/automation-fairness.ts` | `assertAutoRejectFair` — TS-side defense-in-depth fairness re-check before any reject is applied. |
| `app/_lib/decision-config-store.ts` / `decision-config-schema.ts` | Per-workspace, data-driven screening/compliance rules (Phase 3). |
| `app/_lib/screen-wave.ts`, `screen-wave-holdout.ts`, `screen-wave-approval.ts` | Configurable bulk auto-reject wave + audited holdout + approval token. |
| `app/_lib/interview-recommendation.ts` | Single-sourced `recommendation`/`route` vocabulary + coercion (TS side). |
| `app/_lib/automation-roi.ts` | Minutes/CZK-saved ledger over the automation event trail. |
| `app/features/hiring/decisions/**` | Decisions queue UI, screen-wave modal, group-eval. |
| `app/features/hiring/pipeline/**` | Pipeline board UI, activity feed, candidate drawer. |
| `app/features/hiring/pipeline/usePipelineTabState.ts` | Composes the tab's state from six single-concern hooks and hands `PipelineTab` one flat object. Owns only the cross-concern derivations (stat counts, `filteredEntries`, the drawer cohort). Hook-call order is load-bearing — it reproduces the effect-registration order the concerns had as one body. |
| `usePipelineSla.ts` / `usePipelineBoardData.ts` / `usePipelineFilters.ts` | Per-stage aging overrides (PIPE4) · the entries/events fetch, its 30s poll and the optimistic drag move (sole owner of `setEntries`) · the compound filters, their two-way URL sync and the `visibleScope` signature. |
| `usePipelineSavedViews.ts` / `usePipelineBulk.ts` / `usePipelineNavigation.ts` | Saved views + the save/rename dialog and share link (PIPE5) · select mode and the four batch actions (PIPE1 / bdc7fc01 / P2-2) · opening the drawer, profile, job, ranking and Decisions. |

## The board's select-mode bulk bar

`PipelineBulkActionBar.tsx` (state in `usePipelineBulk.ts`) batches move,
scheduling invite, outreach draft and accept/reject over the selected rows. Two
rules keep it honest about **which** rows it is about to touch:

- **The selection survives a filter change; the over-reach is disclosed.** Filtering
  down to review a subset does not abandon the rest, so `selectedIds` is never pruned
  when the filter changes — instead `selectionOutsideVisible`
  (`pipelineSelectionScope.ts`) counts the selected rows the current filter hides and
  the bar states it (`pipeline.tab.selectedOutsideFilter`) before any bulk action can
  run. Acting silently on invisible rows is the failure mode; a silently *shrunk*
  cohort would be the mirror-image one.
- **A destructive confirm cannot outlive the cohort it was armed for.** The two
  two-step confirms (reject — emails N candidates; outreach — with a relay configured,
  a draft *is* a send) are one single-slot reducer state (`pipelineBulkConfirm.ts`).
  Arming stamps the confirm with `visibleScopeSignature` — the identity of every
  membership-affecting filter input (query, quick chips, score bands, source facets,
  funnel stage; **not** sort, which only reorders). `armedConfirm(state, currentScope)`
  reports it armed only while that scope still holds, so any filter, facet, saved-view
  or degraded-cohort change makes the next click **re-arm** rather than fire. This is a
  derivation, not a disarm dispatched from each of the ~9 filter mutators — the
  per-call-site version is what leaked twice already. `bulkDecide("reject")` and
  `bulkOutreach` re-check the same predicate at the fire site.

A third rule keeps it honest about **which stages** it can move rows to:

- **Every move affordance derives its target list from `moveTargetStages`**
  (`pipelineMoveTargets.ts`) — drag, the row menu, the drawer `<Select>`, and now the
  bulk bar via `bulkMoveTargetStages()`. That helper drops `Hired`, which
  `pipeline-entry-action.ts` unconditionally refuses with a 422 (Hired is reached only
  when a candidate *accepts* an offer). The bulk bar previously built its list from the
  raw stage axis, so picking "Hired" and applying returned N × 422 with the whole
  selection still selected. A bulk selection has no single current stage, so only the
  unconditional exclusion applies: `Hired` out, every other canonical stage offered —
  per-row current-stage exclusion is deliberately not attempted (`bulkMove` already
  treats an already-at-target card as moved with no round trip).

Pinned by `pipelineSelectionScope.test.ts` (reproduces select → arm reject → apply a
saved view → confirm), `pipelineBulkConfirm.test.ts`, and `pipelineMoveTargets.test.ts`
(which also pins that the drawer's "open full match" link is gated on `candidateId`
like its "edit profile" sibling, instead of rendering and silently no-opping).

## The activity feed speaks the recruiter's language

The board's activity feed (`PipelineActivityFeed`) renders **every** `pipeline_events`
row, so its vocabulary is the *whole* writer vocabulary — not the board-lifecycle subset.
`EVENT_KINDS` (`pipelineEventCatalog.ts`) is that full list (55 kinds); `EVENT_CATALOG` is
`Record<EventKind, …>`, so a new kind without a glyph is a **compile** error, and
`useEventVerb` resolves `pipeline.events.<kind>` for each one.

Before this, `EVENT_KINDS` held only 16 kinds and `useEventVerb` fell through to
`ev.kind.replace(/_/g, " ")` — **34 of the 50 kinds then reachable rendered in raw English
regardless of locale** (`outreach_sent`, `offer_drafted`, `auto_rejected`, every
dispatched comm, every policy alert). An unrecognized/legacy kind now degrades through a
localized frame, `pipeline.events.unknownKind` ("logged an unrecognized event ({kind})"),
which shows the raw machine token *inside* copy that names it as unrecognized — it must
not be mistakable for a first-class label.

**The catalog key set is derived, never enumerated by eye.**
`pipelineEventCatalog.test.ts` reads the code that owns the vocabulary — `DECISION_META`
and `AUTOMATION_ALERT_KINDS` (`decision-attribution.ts`) plus `ATS_EXPORT_EVENT_KIND` —
and fails if any of it is missing from `EVENT_KINDS`; then it asserts **set equality**
between `EVENT_KINDS` and the `pipeline.events` keys **per locale**. That per-locale check
is the point: `npm run i18n:check` only proves the four locales agree *with each other*,
so deleting a key from all four leaves it green (measured — 4724 keys, "4 locale(s) in
parity", while the guard test failed).

## The drawer and the Comms Center tell one delivery truth

The candidate drawer's **Messages** list and the Comms Center render the same rows, so
they must not disagree about the same message. Two derivations are shared, not
duplicated — both live in `app/_lib/comms-view.ts`:

| Question | Shared function | Rendered by |
|---|---|---|
| What is this message's delivery state? | `commsVerdict` | `channelsCommsHelpers.statusTone` · `PipelineCommsList` |
| Could a real relay address this recipient at all? | `isUnaddressable` | `ChannelsCommsRows` · `PipelineCommsList` |

`isUnaddressable(m, relayConfigured)` warns only when **all three** hold: the relay is
known-configured (`useDeliveryCapability() === true` — `null`/`false` stay silent,
because with no relay every message is a terminal local-outbox row for everyone and
that is a different, honest situation), `deliverable === false`, and the row is not an
orphaned relay receipt (which has no candidate address by construction). Both surfaces
show the same glyph and the same sentence, `channels.comms.noAddressHint`. A genuinely
queued message *with* a real address still reads neutral.

The drawer also renders the rest of the delivery payload the bundle carries —
`channel` next to the kind chip, and `bouncedAt` / `recoveredAt` appended to the bounce
and recovery lines through the same localized relative-time helper. (`status` remains
deliberately unread: it is audit, not truth — see `candidate-timeline.ts`.)

**Consent panel failure state.** The GDPR "Data & consent" panel rides the one-call
bundle, so `consent` is initialized `null` — which is also what stops `ConsentPanel`
firing a second fetch. `null` therefore cannot mean "still loading", and a failed bundle
fetch used to leave the panel claiming it was working forever. The drawer state hook now
sets `bundleFailed` on **both** give-up paths (a network throw and a non-OK response) and
passes it as `loadFailed`; the panel's existing failed branch renders
`pipeline.drawer.consent.loadFailed`. No second fetch was added.

Pinned by `drawerCommsTruth.test.ts` (the predicate's rules incl. the no-relay and
unknown-capability cases, an over-correction guard that a queued-but-addressable message
does not warn, source guards that neither surface re-derives `deliverable === false`
locally, and that `ConsentPanel` still holds exactly one fetch) and
`comms-delivery-truth.test.ts` (server-side projection parity).

## Recommendation / route vocabulary

A closed, single-sourced vocabulary validated at every parse boundary:

| Concept | Legal values | Emitted by |
|---|---|---|
| `recommendation` (verdict) | `advance` \| `hold` \| `reject` | `screen_candidate`, `interview_scorecard` |
| `route` (screen gate) | `advance` \| `hold` (subset) | `screen_candidate` only |

Canonical fallback for both is **`hold`** — never `advance` (could silently
auto-progress) and never `reject` (the fairness gate forbids a silent
auto-reject). Python side: `RECOMMENDATIONS` / `RECOMMENDATION_FALLBACK` /
`coerce_recommendation()` in `automation.py`. TS side:
`INTERVIEW_RECOMMENDATIONS` / `coerceInterviewRecommendation` /
`coerceScreenRoute` in `interview-recommendation.ts`. Pinned by
`interview-recommendation.test.ts` and `test_automation.py`.

## Data model

`pipeline_entries` (stage, archetype, match score, `approval_kind` /
`approval_detail`), `pipeline_events` (append-only audit: `screening_advance`,
`screening_hold`, `outreach_drafted`, `rejection_drafted`,
`interview_prep_generated`, `interview_scorecard`, `rematched`, `evaluated`,
`advanced`, `stale_alert`, `aging_alert`, `auto_rejected`, `fairness_gate_blocked_reject`,
…), `gemini_cache` (generic LLM prompt cache), plus the new
`decision_config` store and the screen-wave audit records
(`decision-record-store.ts`).

## Known gaps

- The route layer diverged from the original one-route-per-task design in
  favor of a consolidated `/api/automation/[task]` handler — functionally
  equivalent, just fewer files.
- No ground-truth loop yet validates the `confidence ≥ 80` auto-advance band
  against real interview/hire outcomes.

## Fairness gates (why a reject can never happen unattended)

- Task 1's pre-LLM gate forces `hold` for a learnable-gap early-career
  candidate before the prompt runs.
- Task 7 / the policy pass may only auto-reject a **BAU** archetype below the
  reject-score floor; early-career always holds.
- The screen wave (Phase 3 bulk reject) excludes early-career, unknown, and
  unscored candidates from the rejectable cohort — not coerced, excluded.
- `assertAutoRejectFair` (`automation-fairness.ts`) re-checks every reject at
  the TS apply boundary independent of the Python gate; a violation is
  downgraded to `hold` and logged as `fairness_gate_blocked_reject` — audit
  that event kind for any refused (bug-caught) or, worse, missed case.
