# Hiring Pipeline & Automation

The candidate funnel from a sourced/applied CV to a hire, plus the automation
layer that assists recruiters at every stage without ever silently rejecting
or advancing a candidate on its own. Local-first: the only runtime LLM is the
Claude Code CLI (`pipeline/jobfit/claude_cli.py`); every automated task has a
deterministic fallback so the pipeline never blocks when the CLI is missing.

## Entry points

- `/?tab=pipeline` — the pipeline board (`app/features/hiring/pipeline/PipelineTab.tsx`).
  It is the default tab, so a bare `/` lands here; the sidebar calls it **Overview**
  (`nav.tabs.pipeline`, all four locales) because the surface is the workspace's
  landing page — attention queues, today's work, then the board. The tab id, the
  catalog key and the page's own eyebrow/title stay "pipeline".
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

### Stage roles — meaning does not live on the name

The board's columns are becoming workspace-editable (Settings → Hiring composes
them), which is only survivable if no rule reads a stage's *name*. Almost every
rule used to: the fairness metric was literally
`indexOf(stage) >= indexOf("Interview")`, the move menu excluded the string
`"Hired"`, org benchmarks indexed off `"Interview"`. Rename or reorder a column
under those and they quietly answer a different question.

Each stage therefore carries a **role**, and the rules read that instead:

```ts
StageDef = { id, label, role }
StageRole = "entry" | "screening" | "interview" | "offer" | "terminal" | "custom"
```

| | |
|---|---|
| `id` | What is **stored** (`pipeline_entries.stage`, both `pipeline_events` stage columns). Never shown. |
| `label` | What is **shown**. Editable once the axis is per-workspace; renaming then touches no rows. |
| `role` | What the stage **means**. Every ordinal rule resolves through this. |

`DEFAULT_STAGE_AXIS` is the one literal both the board and the composer read.
Ids are deliberately the stages' existing canonical names, so introducing the
layer required **no data migration** — minting fresh slugs would have forced one
across entries, events, analytics history and the ATS field map for zero
behavioural gain.

The gate the fairness metric measures against is `screeningGateIndex()`: the
first `interview` stage, falling back to `offer`, then `terminal`, then "nobody
is past it". So `hasAdvancedPastScreening` keeps meaning "got a real look" on an
axis with three interview rounds, none at all, or five renamed columns.
`SCREENING_STAGES` (the positions where a manual AI screen is meaningful) is now
*everything before that gate*, so the two can no longer drift apart — they are
computed from the same index. Pinned by `app/_lib/pipeline-stage-roles.test.ts`,
which asserts both that the role layer reproduces today's answers byte-for-byte
on the default axis and that it stays correct on axes the default one cannot
express.

**Still name-coupled** (owed by a later phase): `automation-run.ts` and
`pipeline-entry-action.ts` advance to literal `"Offer"` / `"Hired"`, and
`application-status.ts` keeps its own inlined stage→candidate-status map.

### The axis is per-workspace data

The five columns are the *default*, not the definition. A workspace's own axis is
stored as the **`pipelineStages`** phase of the tiered decision-config store —
the same store the interview plan uses, so no new table and the tenancy manifest
is untouched. Its code default is built from `DEFAULT_STAGE_AXIS`
(`PIPELINE_STAGES_DEFAULT` in `decision-config-schema.ts`), so a workspace that
has never touched Settings renders exactly what it always did.

```
GET /api/pipeline → { entries, stages: StageDef[], retiredStages: StageDef[] }
```

`app/_lib/pipeline-axis.ts` holds the pure resolution (client-safe: the board
resolves retired labels and detects off-axis entries in the browser);
`pipeline-axis-server.ts` is the only DB-touching half. The board takes `axis`
from that payload instead of importing the constant — the field already existed
and was ignored, which is why the two could never disagree. Grid geometry
(`boardGrid` / `boardMinWidth`) is a function of the column count, and
`moveTargetStages` / `bulkMoveTargetStages` / `moveStageSelectValues` all take
the axis (defaulting to the shipped one, so untouched call sites keep working).

The validator enforces only what the rest of the product resolves through: an
axis opens with its single `entry` stage, ends with its single `terminal` stage,
carries at most one `offer`, and has unique, bounded ids. Everything else is
open — any number of screening stages, interview rounds or `custom` columns, in
any order, under any name.

**`retired` is the half that makes removal safe.** A dropped column is moved
there rather than deleted, so historical `pipeline_events` and a stranded
candidate's stage still resolve to a label instead of a bare id. `POST
/api/pipeline` accepts retired stages too: a candidate standing on one is
somewhere legitimate until a migration moves them, and rejecting the write would
lose the application.

### Off the board

`bucketLaneEntries` used to fold an unknown stage into **column 0**. That was
right while the axis was constant — an unknown stage could only be a legacy row,
and visible-but-wrong beats invisible. Under an editable axis it becomes the
worst option available: remove a column and its candidates silently reappear at
the top of the funnel, indistinguishable from a mass reset.

They now land in no cell and are rendered by `PipelineBoardOffAxisStrip` — named,
grouped by the column they were stranded on, with one "Move all to…" control per
group. `boardVisibleOrder` appends them after the grid so the drawer's prev/next
can still reach them (a card you can see but cannot step to reads as broken).

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
   The candidate-facing letters (outreach v3 / rejection v3 / offer v4, since
   the 2026-08-11 bench round) draw on a shared `_letter_context` evidence
   block (highlights, aspirations, match data, job facts) and are prompted to
   anchor on the strongest candidate-specific hooks; the rejection must name
   the actual decisive gap and its feedback is evidence-checked (never advises
   what the CV already shows). The interview prep pack (v2) anchors every
   question in a named highlight and probes stated aspirations. A result whose
   coercion discarded the model's payload now reports `source=deterministic`
   (`_generate`'s truthful-source rule).
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

## Board layout — one panel, one context menu

The board page is four blocks, in the order the day is worked:

1. `PipelineStatHeader` — **two rows**: eyebrow + title on the left of row one with
   the stat-chip cluster (positions / active / interview / aging / needs-intake /
   awaiting-you) on its right, then the intro across the full width of row two. It
   does *not* use the `PAGE_HEADER` recipe's two-column split — that squeezed the
   lede into a `max-w-2xl` column beside the chips.
2. `PipelineAttentionStrip` — the two queues that outrank the board itself, as one
   ranked list: degraded intakes (red, → *Review*) then awaiting-you approvals
   (coral, → *Open Decisions*). Self-hiding when both are empty. It sits **above**
   `GettingStartedCard`: a stalled application outranks a setup checklist. These
   were previously two separately-styled banners rendered *below* the checklist and
   *between* the filter row and the board.
3. The **board panel** — one `PANEL` holding, top to bottom: `PipelineFilterBar`
   → the select-mode bulk bar and SLA editor when armed → `PipelineSavedViews` →
   `PipelineBoard`. The filter chrome used to float several blocks above the lanes
   it filtered; it is now the board's own header, and `PipelineBoard` no longer
   draws panel chrome of its own.
4. `PipelineActivityFeed`, wrapped in `<Defer strategy="visible">` — history, not
   today's work, so it stays off the first commit until it nears the viewport.

### The board header — two rows, split by job

`PipelineFilterBar` is **narrowing** on top and **the result** underneath:

| Row | Holds |
| --- | --- |
| 1 — narrowing | board title · search · the **State / Score / Source / Sort** dropdowns |
| 2 — the result | `Showing n of m` · *Clear* · *Save view* · *Select* · *Aging SLAs* |

Both changes are about the same failure: row one used to carry the live count, Save
view, Select and Aging SLAs elbowing the search box, *plus* four labelled rows of
always-visible facet chips underneath (~15 pills, most of them off). Everything
about the OUTCOME of filtering moved to row two, so row one is a stable line of
controls whatever the filter state.

The facets are now `PipelineFilterMenu` dropdowns (replacing `PipelineFacetRow`,
whose chip-grid the bar no longer imports): a closed trigger says only the
dimension and what is currently on (`State · Interview +1`), the vocabulary opens
on click. State/Score/Source are multi-select (menu stays open, coral when
anything is on); Sort is single-select (commits and closes, and stays neutral —
it always has a value and never hides a row, so a permanently coral control would
cry wolf). The deep-linked funnel-stage filter (ANA1) rides inside the **State**
menu as an already-checked row that unchecking clears. Like `Select`, the menu is
portalled to `<body>` and `fixed` to the trigger's measured rect — the bar is the
top layer of an `overflow-hidden` panel, so an absolute menu would be clipped by
its own header.

### Typography and presence motion

One scale across the page: `text-meta` for the ruled section headers, `text-base`
for every row of content and every control, `text-sm` only for genuinely ancillary
metadata (activity timestamps, board hints). The Today rail was the outlier at
`text-sm` with a loose coral eyebrow; it and `PipelineActivityFeed` now use the
attention strip's ruled-panel-header idiom, so the three list sections read as one
family instead of three.

`PipelineMotion.tsx` holds the page's presence animations — `Fade` (a section in
the page flow), `Collapse` (a strip that opens inside a panel and pushes the rows
below it), `FadeSwap` (`mode="wait"` crossfade between the board and the no-match
message) and `FadeInline` (a control blinking into a toolbar row). All are
reduced-motion gated via `useReducedMotion`, and all render **no wrapper element
while hidden** — load-bearing, because the tab's column is a `space-y-8` stack
where an always-present empty wrapper would leave a permanent gap. Consequence: a
self-hiding component (`PipelineAttentionStrip`, `TodayRail`,
`PipelineSavedViews`) owns its `Fade`/`Collapse` *internally* — a parent can only
animate out what it can still render during the exit.

**The candidate row spends its width on the name.** A stage column is 280px, and
`PipelineCandidateRow` used to carry a `w-28` "Move to…" combobox plus an
AI-actions button *inside its flex flow* — `opacity-0` hides pixels but still
reserves layout, so ~134px of every row was committed to controls invisible until
hover and the name truncated to about a third of the cell. Those actions now live
in `PipelineCandidateMenu` (portalled to `<body>`, `fixed`-positioned, clamped by
`pipelineMenuPosition.ts` so it can't render off-screen past the board's
`overflow-x-auto`). What remains in flow: status dot, name (`flex-1`), score badge,
and a 20px menu trigger. Three doors to the same menu, one per audience:

- **pointer** — right-click anywhere on the row
- **keyboard** — Shift+F10 / the Menu key (both fire `contextmenu`), or the trigger,
  which is a real focusable button revealed on `focus-visible`
- **touch** — the trigger, always visible under `pointer-coarse` (a tablet has
  neither hover nor a tab order, and HTML5 drag never fires from a touch sequence,
  so this is the only way to move a card there)

The menu's *Move to* section calls the **same** `onMove` the drag-and-drop drop
calls, which keeps the WCAG 2.1.1 keyboard equivalent the old `Move to…` `<Select>`
provided. In select mode the row is a checkbox and the menu is suppressed with the
rest of its actions, matching the existing select-mode grammar.

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
  membership-affecting filter input (query, quick state filters, score bands, sources,
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

## Decisions peer context (comparison data for the review queue)

`GET /api/decisions/peer-context?jobs=<id,…>` (operator-gated, tenant-scoped)
serves the AI-review cards' cross-candidate comparison facts per job: the
role's `salaryBand`, and per active entry the candidate's saved salary
expectation plus verified per-JD skill coverage (`jobFit.matchingSkills` /
`missingSkills` counts) — all read from the freshest stored CV analysis (the
same freshest-per-(label, jd-slug) map the canonical score uses), never a
fresh LLM/ranker run. Score *ranking* is client-side: `/api/pipeline` already
stamps `canonicalScore` on every entry, and
`app/features/hiring/decisions/decisionsPeerCompare.ts` (unit-tested) ranks a
card's candidate among the same-job active entries. The single-candidate
analysis modal additionally retains the full ranked peer rows its existing
`/api/jobs/[id]/candidates` fetch returns (`decisionsAnalysisSummaryData.ts`)
for in-modal peer comparison.

The Full-analysis modal ships the **"Bench" layout** (winner of the /prototype
round, 2026-08-10): a near-fullscreen `Modal size="full"` that treats the
advance/reject as a field question — verdict band (fit + tier + confidence +
fact chips), the AI's screening/scorecard narrative moved in from the cards,
ruled evidence sections, and a sticky ranked bench of the role's other
candidates with the current candidate's row pinned. Layout:
`DecisionsAnalysisModalBench.tsx`; shared section pieces:
`DecisionsAnalysisParts.tsx`; peer viz primitives (score rail, rank chips,
salary band rail, coverage meter): `DecisionsPeerViz.tsx`. All copy is in the
`decisions.summary` catalog (4-locale parity).

The AI-review cards ship the **"Ladder" body** (winner of the same round):
screening/scorecard cards replaced the AI's prose with a ranked
mini-leaderboard of same-job active peers (self row highlighted, stage chips,
canonical scores), the salary expectation plotted against the role band, and —
on scorecards — the rubric dots. The narrative the cards dropped renders in
the Full-analysis modal's "AI review" section. Offer cards are unchanged:
their salary-band + deadline body (`DecisionsAiReviewCardBody.tsx`, now
offer-only) is decision-critical and stays. Ladder body:
`DecisionsAiReviewCardLadder.tsx`; peer wiring: `useDecisionsQueue`'s
`peersOf`/`peerFactsOf`.

## Hybrid handoff (interviewPlan enforcement)

Accepting an AI round's `scorecard_review` — when the workspace's hiring plan
(Settings → Hiring, the `interviewPlan` decision-config phase) runs a HUMAN
round after the AI round — routes the candidate BACK to the `calendar` gate
(human-round scheduling) instead of the generic advance toward Offer:
`runPipelineEntryAction` (`pipeline-entry-action.ts`) checks
`planRoutesAiScorecardToHumanRound(getInterviewPlan(ws))`, keeps the stage,
re-arms the calendar approval, records a `human_round_queued` event and seals
the decision with `policyVersion: "interview-plan"`. Guards: only AI-sourced
scorecards (`approvalDetail.source !== "human"`), only pre-Offer stages. The
Decisions queue narrates the handoff via the "queued on Schedule" banner
(`routedToHumanRound` on the accept response). The plan's other two gates are
enforced at the automation apply boundary (`automation-run.ts`):
`screeningGate: "auto"` auto-ratifies parked ADVANCE screening verdicts (hold/
reject always park); `offerGate: "auto"` auto-extends priced offer drafts via
the shared `extendDraftedOffer` path (unpriced fail-safe drafts always park).
Full plan mechanics: `docs/features/hiring-pipeline/README.md`.

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
