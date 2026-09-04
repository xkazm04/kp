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

### What resolves through roles now

Every rule that used to read a stage NAME to ask a question about MEANING:

| Consumer | Was | Now |
|---|---|---|
| `pipeline-entry-action.ts` | `to === "Hired"`, `stage === "Offer"`, `indexOf("Offer")` | terminal / offer roles on the workspace's axis; `set_stage` validates against that axis |
| `db/pipeline.ts` — `setPipelineEntryStage` | rejected anything outside `PIPELINE_STAGES` | accepts any stage the workspace's axis knows (retired included, so a migration can move somebody OFF one) |
| `db/pipeline.ts` — creation default, reinstate, `approve_event`, rematch guard, calibration cohort, job stats | `"Screened"` / `"Interview"` / `"Hired"` literals | `screenedLandingStage`, first `interview` stage, terminal role, `screeningGateIndex` |
| `db/analytics.ts` | funnel indexed the five canonical names | funnel IS the workspace's columns; `hired`/`active`/`reachedInterview` by role |
| `attention.ts` | `!== "Hired"`, `=== "Accepted"` | terminal / entry roles |
| `automation-run.ts` | rematch guard on `"Hired"`, redirect landed on `"Screened"` | terminal role, `screenedLandingStage` |
| `db/org-benchmarks.ts` | one shared axis across a cross-TEAM aggregate | each row judged against **its own team's** axis (resolved once per team) |
| `application-status.ts` | name→status map only | role→status map when the caller can resolve one; the name map remains the shipped-axis fallback |
| `analytics-momentum.ts`, `pipeline-command.ts`, `ats/field-map.ts` | literals | an injected terminal stage / axis / allowlist, defaulting to the shipped one |
| `cv-intake.ts`, `lead-intake.ts` | filed at `"Accepted"` | filed at the axis's `entry` column |
| `PipelineAiActionsGrid.tsx` — the drawer's AI actions | each action gated on literal stage names (`"Screened"`, `"Interview"`, `"Offer"`) | `pipelineDrawerActions.ts` resolves the gate from roles: screening columns for **Screen**, the pre-gate column + interview rounds for **Prep**, interview rounds for **Scorecard**, the offer column for **Draft offer**, every non-terminal column for **Rejection**, every non-terminal non-entry column for **Rematch** |

`analytics-custom-axis.test.ts` is the proof: it stores a fully renamed six-column
axis and asserts the funnel reports *those* columns, that candidates on renamed
columns are counted rather than silently dropped (the old `idxOf === -1` skip),
and that `hired` / `reachedInterview` follow roles. Writing it is what surfaced
the `setPipelineEntryStage` guard above — the store was still refusing stages the
board itself rendered.

**Still name-coupled**, and deliberately left: `devcase-run.ts` (now via the named
`DEVCASE_PROMOTE_STAGE`, `app/_lib/devcase-identity.ts` — the coupling is unchanged,
but it is greppable and has one place for the eventual per-workspace resolution),
`useAddToPipeline.ts`, `apply/[id]/route.ts`, `rediscover.ts`, `screen-wave.ts`,
`tasks.ts` and `interview-prep/scorecard` still pass or compare stage literals.
All are *creation defaults* or *cohort filters* that are correct on the shipped
axis and degrade to "files the candidate in the wrong column" rather than to a
wrong number — and each needs its own workspace plumbing. `pipeline-status.ts`
keeps its literal by design (an import-free module, documented in place).

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

Each group is **capped like a stage cell** — the first `CELL_LIMIT` (6) chips,
then the same `+N more` / `Show fewer` toggle, expandable per group so revealing
one retired column's overflow leaves the others capped. Both caps share one
arithmetic (`cappedWithOverflow` in `pipelineBoardLayout.ts`, over `CELL_LIMIT`
from `pipelineBoardGrid.ts`), so the board cannot grow a third, differently
behaved ceiling. Retiring a busy column is precisely when the list is longest,
and it used to render every stranded card at once.

In normal operation the strip should stay empty: Settings → Hiring refuses to
remove an occupied column without a destination, and applies the moves in the
same request as the removal (`POST /api/pipeline/stage-migration` — see
[../hiring-pipeline/README.md](../hiring-pipeline/README.md)). The strip is the
backstop for what that gate cannot cover: a legacy row, an ATS sync replaying an
older mapping, or a config edited outside the UI.

### `stage_migrated`

`migratePipelineStages(migrations, workspaceId)` moves everyone off the removed
columns in ONE `IMMEDIATE` transaction and writes a `stage_migrated` event per
moved candidate, carrying from/to. The moves run BEFORE the axis write and the two
sit behind separate SQLite connections, so no transaction spans them: a failure
after the moves is reachable and benign, and `STAGE_MIGRATION_FAILED` says so
("candidates may already have been moved") rather than the "nothing was saved" it
used to claim. Its own event kind rather than `moved`:
nobody chose to advance *this* candidate — the board changed shape — and a
recruiter reading the trail weeks later needs that distinction. Terminal
(`rejected` / `declined`) rows are excluded, matching `listPipeline` and
`countPipelineByStage`: they are not on the board, so removing their column
strands nobody, and moving them would rewrite closed history.

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
   quality review. `POST /api/decisions/screen-wave` — preview and commit — is
   operator-gated and then throttled per IP (`screen-wave:<ip>`, 60/10min,
   pinned in `app/api/rate-limit-contract.test.ts`), after the cheap 400s so a
   malformed request costs no budget: it is the only door in the tab that
   queues real adverse-action email, and open mode makes the operator gate a
   no-op. The Rules modal never substitutes the DEFAULT thresholds for a failed
   config read — `readScreeningRule` (`decisionsRulesLoad.ts`) refuses a payload
   that carries no screening rule, and the modal then shows "couldn't load the
   live rules" with a retry and a disabled save rather than offering to
   overwrite the workspace's policy with defaults.
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
   (`_generate`'s truthful-source rule), and — since `source` alone cannot say
   *why* the template served — `_generate` also records the descent reason
   (`automation.DEGRADATION_REASONS`: `provider_timeout`, `unparseable_output`,
   `unusable_output`, `provider_error`). `automation_cli` passes
   `descent or automation.take_degradation_reason()` to `emit_deterministic`, so
   an operator reading the usage ledger can tell a keyless install from a
   provider that answered badly — two zero-cost lines that used to look
   identical. The vocabulary is disjoint from the availability gate's
   (`offline_policy` / `not_installed` / `unavailable` / `disabled`) on purpose,
   and which fault must record which reason is gated by
   [`fault_eval`](../../development/fault-injection.md#what-the-operator-reads-back).

   **That verdict provenance now reaches the recruiter, not just the ledger.**
   `automation-run.ts` reads the CLI's `source` once per run and stamps
   `verdictSource` (`"llm" | "template"`) plus `verdictProvider` onto every
   approval payload it writes (screening / scorecard / offer), and passes the
   engine as the pipeline event's **actor** (`auto:automation-llm` /
   `auto:automation-template`) rather than into a `detail` several kinds already
   parse. The Decisions review card
   (`DecisionsAiReviewCard` + `decisionsAiReviewCardLogic`) discloses a template
   verdict in amber above the body and names the provider beside a model one; an
   approval persisted before this shipped carries no provenance and discloses
   **nothing**, never a guessed engine. Until this, a keyless or
   allowance-exhausted install rendered a deterministic template's verdict in
   exactly the grammar it renders the model's, under the same "AI review" tag.

   **The letter locale is resolved in the entry's own team.** `letterLang` is
   `resolveCommsLocale(entry.locale, entry.workspaceId)` — omitting the workspace
   read the DEFAULT team's `default_locale`, so a NULL-locale candidate filed into
   a team with its own language had the letter *body* drafted in one language and
   wrapped by `comms-dispatch` in another. The resolved locale is a cache-key axis,
   so the fix self-invalidates the wrongly-keyed entries. The recruiter-narrative
   locale (`uiLang`, for screen / prep / scorecard) has the same scope: with no caller
   UI locale, a background pass falls back to `getWorkspaceDefaultLocale(entry.workspaceId)`,
   the entry's OWN team, not the default tenant's. Both are cache-key axes, so a
   non-default team re-keys once and its wrongly-shared entries self-invalidate; the
   default team's keys are byte-identical.

   **Three hard-coded English sentences became codes.** The `offer_auto_extended`
   event detail is now `reason:offerAutoExtended` (rendered through
   `pipeline.eventReasons.*` by `useEventVerb`; the prefix is duplicated in
   `pipelineEventCatalog.ts` because that client module cannot import the
   SQLite-backed writer, and `automation-run.test.ts` pins both sides), the
   skipped-rematch result carries `reasonCode: "rematchSkippedHired"` beside its
   canonical English (`pipeline.result.reasons.*`), and the auto-ratify seal's
   `reasonCode` is `autoRatifiedScreening`, which `waveReasonText` resolves through
   `decisions.wave.reasons.*` like every other sealed reason. Legacy rows keep
   rendering their stored prose.
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
| `pipeline/jobfit/automation.py` | Task functions: `screen_candidate`, `draft_outreach`, `draft_rejection`, `interview_prep`, `interview_scorecard`, `rematch_candidate`, `evaluate_entry` (Task 7, deterministic). `POLICY` dict holds the hard-coded defaults. `interview_scorecard` additionally fences its transcript, pins its parse on `ratings`, drops evidence quotes that do not occur in the sampled transcript (`ground_scorecard_evidence`) and stamps `narrativeLang` — scorecard-v7, written up in [docs/features/interviews/README.md](../interviews/README.md#the-scorecard-fences-the-transcript-and-cites-only-what-was-said-scorecard-v7). |
| `pipeline/jobfit/automation_cli.py` | Sub-command CLI entry point (`screen`, `outreach`, `rejection`, `prep`, `scorecard`, `rematch`, `policy-pass`); UTF-8 stdio, JSON out, `{error,status,code}` on stderr. |
| `app/api/automation/[task]/route.ts` | **Consolidated** per-entry task route (`POST {entryId, notes?}`) — replaced the one-route-per-task layout the original spec proposed. Operator-only (`requireOperator`). |
| `app/api/automation/run/route.ts` | Task 7 policy pass over active entries. |
| `app/api/automation/schedule/route.ts` | The automation clock's control surface: `GET` returns the schedule, the reminders job, recent runs (decision rows workspace-filtered), `scheduleScope: "global"`, and — since /perfect 2026-09-03 — the clock's **liveness** (`liveness`/`livenessReason`/`lastTickAt`, from `schedulerLiveness()` over the `scheduler_heartbeat` row, the same verdict `/api/health` and `/api/ops` render). `POST` toggles the clock, sets the cadence, pauses reminders, or forces a tick. Operator-only. The malformed-interval 400 answers `jsonRefusal("SCHEDULE_INTERVAL_INVALID")` and the catch answers `safeJsonError(..., "SCHEDULE_UPDATE_FAILED")`, so the dock renders both in the reader's language. `{"tick": true}` — a full policy pass — is throttled per IP (`schedule-tick:<ip>`, 10/10min, pinned in `app/api/rate-limit-contract.test.ts`); the GET and the cheap config writes are not. |
| `app/features/hiring/pipeline/Scheduler*.tsx` + `useSchedulerControlState.ts` | The dock's clock control. The ON/OFF pill renders the stored **armed** flag; a chip beside it renders **liveness** (ticking / starting / not ticking) and an armed-but-stalled clock tones the pill amber instead of moss — the pure mapping (`livenessChip`, `enabledPillTone`) plus `describeTick`, `clampInterval` and the poll's backoff curve live in `schedulerRunState.ts` and are unit-pinned by `schedulerRunState.test.ts`. The 30s poll skips a hidden tab, refreshes once on becoming visible, and backs off 30s → 60s → 2m → 4m → 5m on consecutive read failures. Run-history actions render through `useEnumLabel("recommendation")` rather than the raw wire enum. |
| `app/api/tasks` (kind `"automation"`) | Hardened/background path sharing `runAutomationTask` with the synchronous route above — tracked, deduped, refresh-safe. |
| `app/_lib/automation-run.ts` | `runAutomationTask` — shared dispatcher both routes call into. |
| `app/_lib/automation-pass.ts` | Applies Task 7 policy-pass decisions to the DB in one transaction. |
| `app/_lib/automation-fairness.ts` | `assertAutoRejectFair` — TS-side defense-in-depth fairness re-check before any reject is applied. |
| `app/_lib/decision-config-store.ts` / `decision-config-schema.ts` | Per-workspace, data-driven screening/compliance rules (Phase 3). |
| `app/_lib/screen-wave.ts`, `screen-wave-holdout.ts`, `screen-wave-approval.ts` | Configurable bulk auto-reject wave + audited holdout + approval token. |
| `app/_lib/interview-recommendation.ts` | Single-sourced `recommendation`/`route` vocabulary + coercion (TS side). |
| `app/_lib/automation-roi.ts` | Minutes/CZK-saved ledger over the automation event trail. |
| `app/api/pipeline/outcomes/route.ts` | The on-the-job outcome of a hire (UAT `KAT-L1-002`). `GET ?entry=<id>` returns that hire's 1..5 rating (`performance: null` = unrated) plus whether the entry stands on the terminal-role stage; `GET` with no params returns the workspace accrual counter `{ rated, hires, minOutcomes }`. `POST {entryId, performance}` records or corrects the rating. Both handlers `requireOperator()` first and scope every store call to `currentWorkspace()`. |
| Board refusals: `[id]/route.ts`, `pipeline-entry-action.ts`, `batch/route.ts`, `stage-migration/route.ts` | Every refusal on these four answers a `REFUSAL_ERRORS` **code**, never English prose (`docs/architecture/api-contracts.md` §1.1). The shared helper's chokepoint `err(status, code, extra)` takes a code, the batch route copies that code onto each per-id row beside the canonical English, and data a localized sentence needs rides alongside as fields (`stages`, `max`, `unmapped`, `detail`) instead of being interpolated into a sentence. `usePipelineBulk` keeps the codes (`reasonCodes`) and `PipelineBulkActionBar` resolves them through `useErrorMessage`, so a Czech, German or French board no longer reads its hottest refusals in English. Pinned by `app/api/pipeline/pipeline-refusals-coded.test.ts`. |
| `app/_lib/pipeline-entry-action.ts` | The shared move/decide action behind `/api/pipeline/[id]` and `/api/pipeline/batch`. Both approval writes that land AFTER an await are compare-and-swapped on `setApproval(..., { expectedApprovalKind })` read from the pre-write snapshot: the offer clear (after `dispatchOffer`) answers 409 when the gate moved while the offer went out, and the hybrid handoff's calendar arm answers the same stale 409. A `dispatchOffer` that THROWS is caught and compensated by LEAVING the approval open: the offer row is idempotent, so approving again re-sends the SAME link, the un-sent token is pending rather than orphaned, and the attempt is recorded as an `offer_comms_failed` event (the route answers 502). |
| `app/api/pipeline/[id]/consent/route.ts` | The drawer's GDPR consent snapshot + append-only audit trail. `requireOperator()` first, like every other pipeline PII surface, and pinned in `app/api/pipeline/batch/authz-parity.test.ts`. |
| `app/api/pipeline/command/route.ts` + `command/execute.ts` | The natural-language command bar. `POST {text}` previews (nothing runs); `POST {text, confirm:true}` executes. An execute answers `{ count, failed, commsFailed }` always — `failed` is every target the guarded write refused (a lost `expectedStage` CAS) or that threw, `commsFailed` is applied rejections the candidate was not notified about — plus `heldAtOffer` / `droppedOut` when non-zero; the counting loop lives in `execute.ts` so each target lands in exactly one bucket. `run policy` runs the same global sweep as `POST /api/automation/run`: operator-gated, then throttled per IP (`pipeline-command-policy:<ip>`, 6/10min, pinned in `app/api/rate-limit-contract.test.ts`), recorded through `recordRun` the same way, and answered with the workspace-scoped `decisions` beside a `summary` explicitly labelled `summaryScope: "global"`. |
| `app/features/hiring/pipeline/PipelineHireOutcomeCard.tsx` | The drawer card that writes it — a 1..5 button rail, mounted only for a candidate on the terminal-role stage. |
| `app/features/hiring/decisions/**` | Decisions queue UI, screen-wave modal, group-eval. The wave modal's lifecycle (debounced preview → confirm → commit → 409 → re-preview, with the "the set changed" notice consumed on exactly one preview settle) is the pure reducer `decisionsScreenWaveMachine.ts`; `useDecisionsScreenWave` is only the network around it. Reinstate (the reconsider queue's safety valve) folds every path through `decisionsReinstateOutcome.ts` — a refused or never-landed reinstate keeps the row and prints its `{ code, status }` on it via `useErrorMessage`, instead of the old silent no-else. |
| `app/features/hiring/pipeline/**` | Pipeline board UI, activity feed, candidate drawer. |
| `app/features/hiring/pipeline/usePipelineTabState.ts` | Composes the tab's state from six single-concern hooks and hands `PipelineTab` one flat object. Owns only the cross-concern derivations (stat counts, `filteredEntries`, the drawer cohort). Hook-call order is load-bearing — it reproduces the effect-registration order the concerns had as one body. |
| `usePipelineSla.ts` / `usePipelineBoardData.ts` / `usePipelineFilters.ts` | Per-stage aging overrides (PIPE4, workspace-keyed) · the entries/events fetch, its 30s poll and the optimistic drag move (sole owner of `setEntries`) · the compound filters, their two-way URL sync and the `visibleScope` signature. |
| `pipelineBoardStorage.ts` / `usePipelineTenant.ts` | The board's `localStorage` memories keyed per workspace, and the once-per-document tenant resolve they wait on. Pure half pinned by `pipelineBoardStorage.test.ts`. |
| `pipelineBoardMove.ts` / `pipelineDrawerNote.ts` | The two densest state machines, extracted pure: the drag move's apply / reconcile / roll-back decision plus its field-selective merge, and the drawer note's dirty / flush / hydrate bookkeeping. Pinned by their own `*.test.ts`. |
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

The facets are now `PipelineFilterMenu` dropdowns (they replaced
`PipelineFacetRow`, whose chip-grid file has since been deleted — it had no
importers left): a closed trigger says only the
dimension and what is currently on (`State · Interview +1`), the vocabulary opens
on click. State/Score/Source are multi-select (menu stays open, coral when
anything is on); Sort is single-select (commits and closes, and stays neutral —
it always has a value and never hides a row, so a permanently coral control would
cry wolf). The deep-linked funnel-stage filter (ANA1) rides inside the **State**
menu as an already-checked row that unchecking clears. Like `Select`, the menu is
portalled to `<body>` and `fixed` to the trigger's measured rect — the bar is the
top layer of an `overflow-hidden` panel, so an absolute menu would be clipped by
its own header.

#### The stage deep link is validated against the workspace's own axis, not the shipped five

The funnel that mints `?stage=` reads `getPipelineAxis(workspaceId).stages` — the
columns the workspace composed in Settings → Hiring — so validating the incoming
value against the hardcoded `PIPELINE_STAGES` dropped every custom or renamed
stage on the floor and rendered the board **unfiltered**, which is
indistinguishable from "nothing was filtered out". `usePipelineFilters` now
carries the parameter verbatim (`readStageParam`; it is only ever an equality key
against `entry.stage`), and `resolveStageFilter(stage, axis, retired)` answers
whether the board can honour it — against the axis that arrives with the board
payload (`GET /api/pipeline`), the only list that can answer.

A stage that resolves to no column renders an explicit notice above the lanes
(`pipeline.tab.stageOffBoard`, in `PipelineFilterBar`) with a one-click way out,
and the filter **stays applied**: candidates still standing on a dropped column
then surface in the off-axis strip, which is exactly what the stale link was
pointing at. The notice waits for the board fetch (`PipelineTab` passes
`stageResolved` only once `entries != null`), so it cannot flash during load and
then retract. Labels follow the off-axis strip's rule — the workspace's own label
wins when it authored one, otherwise the `enums.stage.*` catalog translates the
id. Pinned by `pipelineStageFilter.test.ts` (8 checks).

### Who the board counts

The stat header and the Today rail sit one above the other and answer the same
question, so they derive it from ONE module —
`app/features/hiring/pipeline/pipelineBoardPopulation.ts`
(`pipelineBoardPopulation.test.ts`, 10 checks):

- **`boardPopulation(entries)`** → `{ real, active }`. `real` drops the guided
  demo's `(SIM)`-marked rows (`isSimTitle`, gsim-l2-105) — the board still *renders*
  them, visibly marked, so a running simulation sees itself, but they are never
  counted or narrated as real hiring work. `active` is `real` narrowed to
  `status === "active"`: a rejected or withdrawn candidate is real history, not live
  work, whichever column their card is still parked on.
- **`deriveRailRows(entries, axis, now)`** buckets that population into the rail's
  six queues (inbound / scorecards / offer reviews / awaiting slot / offers out /
  hired-this-week), resolving every stage question by **role** on the workspace's own
  axis. `PipelineTodayRail` supplies only the glyph, tone and catalog sentence.

`usePipelineTabState`'s `activeCount`, `interviewCount` and `staleCount` (and
therefore the aging chip) now read `boardPopulation(...).active`. They previously
counted every row not standing on a terminal-role stage — sim residue included,
un-tidied rejections included — so the header read "Active 14" over a rail naming
four people. `approvals` and `degradedCount` deliberately keep their own predicates:
an approval is real work waiting on the Decisions gate whoever created it, and a
degraded stub is a recoverability signal rather than a funnel count.

### Aging SLA overrides

`PipelineSlaEditor` declared `[1, 365]` on its number input and did not enforce it —
a native input's `min`/`max` are advisory, so a pasted 5000 persisted to
`localStorage` and silenced that column's amber dot for fourteen years.
`pipelineSla.ts` states the range once (`clampSlaDays`, unit-pinned by
`pipelineSla.test.ts`): empty / 0 / negative / unparseable CLEARS back to the stage
role's default, anything else rounds to whole days and clamps into range. Applied at
the field, again in `usePipelineSla`'s store (so a second caller cannot bypass it),
and once more on hydration, so a value written by an older build is repaired on read.
The range is stated inline beside the inputs (`tab.slaEditorRange`).

Team-shared SLAs remain an **owner decision, not a gap**: these overrides are
per-browser `localStorage` with no schema and no server surface — but they are
per-browser **per workspace**, see below.

### Board storage is keyed by tenant

The board's two `localStorage` memories — saved views (`kp.pipelineViews`) and the
per-stage SLA overrides (`kp.pipelineStageSla`) — were browser-wide, and
`localStorage` is scoped to the ORIGIN, not to the session. So after switching teams
in Settings -> Workspaces, team A's recruiter-authored view NAMES ("Berlin seniors -
waiting on Ada") and the stage ids they encode hydrated onto team B's board, and a
view A had marked DEFAULT auto-applied A's filter combination on B's bare visit.

`pipelineBoardStorage.ts` keys both under the workspace (`kp.pipelineViews:<ws>`),
and `usePipelineTenant` resolves that workspace ONCE per document from
`GET /api/workspaces` (`current`) - the same door the shell's Recent list uses
(`app/features/shell/recents.ts`), because the session cookie carrying the workspace
is httpOnly. Until it resolves, the board hydrates **nothing**: no views, no
overrides, and no default view auto-applies. The pre-tenancy global keys are adopted
ONCE into whichever workspace resolves first (a single-workspace install keeps its
own configuration) and then removed, so a second tenant can never read them. An
existing tenant value always wins over the legacy one. The cross-tenant invariant is
pinned by `pipelineBoardStorage.test.ts`.

### The board poll backs off, and resumes on visibility

The live poll re-armed at a FLAT 30s whether or not the last tick reached the server,
so a restarting server, a laptop off the network or a 500 loop cost 120 failing round
trips an hour from every open tab, for ever. `load()` now returns a health verdict (an
ABORT is not a failure — it is the hook superseding its own request) and the loop is a
self-rescheduling timeout that backs off on consecutive failures through the same pure
`nextPollDelay` the scheduler bar uses: 30s -> 60s -> 2m -> 4m -> 5m, reset by one
success. A hidden tab still polls not at all, and coming BACK to the tab refreshes once
immediately and resets the counter, rather than waiting out a five-minute backoff.

### A task runner's diagnostic is details, never the line

Two surfaces painted the background-task runner's own stored `error` — English prose
written by the queue, carrying no code (`useTaskResult` passes the polled record's
string through unchanged) — as the sentence the recruiter reads: the bulk bar's failed
drafting run, and the drawer's failed automation task, the latter coalesced OVER its
localized fallback (`actionError ?? t("taskIncomplete")`), so the English won whenever a
diagnostic existed. Both now render the localized line and carry the diagnostic as
details (a `title` on the message), which is the honest shape until the runner mints a
CODE — that is the tasks context's follow-up, since it is the only place that can.

Bulk invite's per-item branch read nothing but `ok`, so a half-refused cohort rendered
"3 invited · 4 couldn't be invited" with no reason at all. It reads a per-item `code`
now, resolved through the bar's existing `errors.<CODE>` fold; until
`/api/schedule/invite/bulk` mints one (it answers per-item English prose today —
"not active", "over the cap" — which is not code-resolvable), a refusal without codes
falls back to one localized line pointing at the candidate.

### Opening a candidate's live link

`TokenLinkPanel`'s "Open as candidate" opens the LIVE capability link, and several
of those surfaces stamp an opened/first-seen mark on first fetch — so a recruiter
peeking burnt the candidate's own first open and the timeline then read as if they
had looked. It now asks once, through the shared `Modal`, and says the link may be
marked opened. **Copy stays one click** — it touches nothing.

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

`pipelineDrawerActions.test.ts` is the same proof for the drawer's action grid: it
runs a fully renamed five-column axis and asserts each column still offers exactly
the actions the literal gates used to offer on the shipped board. Before the role
resolution a renamed axis matched nothing and the grid rendered **Draft outreach**
alone — no error, nothing to notice.

### The grid has a name

Every drag on the board already had a keyboard twin (`moveTargetStages` behind the row
menu) and every move was narrated into a polite live region. The structure those twins
move THROUGH had no name: the lanes were a run of bare `<div>`s, so a screen reader read
a flat list of candidates with no notion of which column any of them stood in.

The roles are layered onto the elements that were already there, so no wrapper was added
and the CSS grid tracks (and therefore the layout) are untouched:

| Element | Role |
|---|---|
| the `minWidth` lane container | `grid`, named `board.gridAria`, with `aria-colcount` / `aria-rowcount` |
| the stage-header strip and each position lane | `row` |
| the position rail label and each stage-header button | `columnheader` |
| a lane's position cell | `rowheader` |
| `StageCell` | `gridcell`, named `board.cellAria` = position, stage, count |

The cell's name uses the **rendered** stage label, not the stored id, so a workspace that
renamed a column hears its own word — the same string the column header shows. What a drop
DOES is one sr-only sentence (`board.dropHint`) referenced by every cell through
`aria-describedby`, rendered only while dragging is possible: `aria-dropeffect` is
deprecated and repeating the sentence into 5 x N labels would be noise. An empty cell used
to be a bare middle dot, decorative to a sighted reader and read as a glyph by everyone
else; the dot is now `aria-hidden` beside an sr-only `board.cellEmpty`.

The toolbar's arrows disable at the scroll extremes. They were always enabled, so at either
end a click did nothing and gave no reason — a keyboard user could not tell "this does
nothing here" from "this is broken". `usePipelineBoardScroll` measures the extents with 1px
of slack (a smooth scroll lands on a fractional `scrollLeft`) and re-measures on resize as
well as on scroll, because the board's width also changes when the workspace adds or
removes a column.

Pinned by `pipelineBoardRoles.test.ts`.

### The board poll carries only what it draws

`GET /api/pipeline` used to return `listPipeline()` verbatim, and `rowToEntry` fills
every `PipelineEntry` field whether or not the SELECT asked for the column. So each
30 s poll shipped nine fields **no consumer of this payload reads**: `contact` (the
candidate's email/phone), `locale`, the four consent columns, `anonymizedAt`,
`workspaceId`, and the two devcase ids. Every consumer was checked one at a time —
the board (`pipelineTypes.Entry`), the drawer (`PipelineCandidateDrawerTypes`), the
bulk bar, the off-axis strip, the Decisions queue, the Schedule grid, the Channels
tab, the simulation engine, the jobs lifecycle strip and the interview attach dialog
— and none of them names one of the nine.

`BOARD_ENTRY_FIELDS` in `app/_lib/db/pipeline.ts` is now that allowlist, `PipelineEntryView`
is `Pick<>`ed from it plus the three stamped scores, and the route maps every stamped
row through `boardEntryView`. Direction matters more than bytes here: before this, a
column added to `pipeline_entries` reached the browser **by default**. `contact` was
null on the wire only because `listPipeline`'s SELECT omits the column — an accident
of the query, not a contract.

The expensive fields **stay**, because they have readers: `notes` and `githubEvidence`
hydrate the drawer's scratchpad and evidence card from the board-opened entry, and both
the Decisions queue and the Schedule grid parse `approvalDetail`. Trimming them would
have been a saving paid for with a broken read.

Measured on the seeded demo corpus (83 active entries): **70.5 KiB → 55.5 KiB per poll,
21.2 % smaller**. On a real corpus the gap is larger — the demo rows carry no notes,
no GitHub evidence and no source attribution, so most of what was dropped there was key
names rather than values.

#### The per-tick ceiling, stated

`boardSignature` (`pipelineRenderDiet.ts`) is what decides a poll was a no-op, and it
walks **every** entry on every tick: one identity-cache hit, one aging-bucket
comparison and one string concat each — O(n), with the JSON work paid once per entry
*object*, so a poll's fresh objects are the expensive case and a keystroke re-render
is free. The budget is **a 2000-entry board under 100 ms per cold tick** (measured
~10 ms here), pinned by `boardSignature: stays O(n) …` in `pipelineRenderDiet.test.ts`
— a guard against an accidental O(n²), not a benchmark.

The ceiling is documented rather than raised: the board draws every entry it is handed
(no virtualization), so a workspace far past 2000 open entries meets the DOM before it
meets this loop. If the pin goes red the answer is a narrower payload or virtualization,
never a per-entry `JSON.stringify` creeping back in.

The second half is the drag-move. It used to `await load()` in a `finally`, paying for a
full board re-read on top of the optimistic write to learn the one thing it already knew.
The route answers `set_stage` with the moved row, so the success path applies **that** —
taking only the fields a move can change (`stage`, `stageChangedAt`, `status`,
`approvalKind`, `approvalDetail`), because the response is the raw store row rather than
the score-stamped projection and a whole-object swap would blank the card's badge. The
activity feed still hears about the move through `load({ eventsOnly: true })`, one small
`?since=` delta. A **refusal** still reconciles with a full `load()`: a lost CAS means
somebody else moved the row, so the board's own view is the suspect one.

Pinned by `pipelineBoardProjection.test.ts` (the allowlist and the nine omissions by
name) and `pipelineMovePath.test.ts` (the success branch applies the returned row, the
refusal branch reconciles, the route projects).

### A refused move says why, where it happened

A drag whose `set_stage` is refused rolls the card back into the column it came
from. Two things make that readable rather than a dropped gesture:

- `pipelineActionReason` returns the refusal **payload** (`{ error, code }`), and
  `usePipelineBoardData` resolves it through `useErrorMessage` — so
  `PIPELINE_MOVE_CONFLICT` ("someone moved them while you were deciding") and
  `PIPELINE_TERMINAL_NOT_MANUAL` ("route through the offer flow") read in the
  reader's language. It used to return the server's `error` string, which painted
  the route's canonical English on every localized board.
- The board also names the bounced card (`moveErrorEntryId`), and `StageCell`
  renders the reason directly beneath it. The page-level banner stays — it is the
  `role="alert"` announcement and works when the card has scrolled out of view —
  and one dismissal (`dismissMoveError`) clears both halves.

The command bar's `post()` gained the `catch` it never had: a network-level failure
now shows `pipeline.command.failed` instead of throwing an unhandled rejection and
leaving a submitted command with no outcome. Its `p.error` branch resolves through
`useErrorMessage` for the same reason as the board's.

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

**The event DETAIL is coded too, not just the verb.** A row's `detail` is painted
verbatim beside the localized verb, so an English sentence stored there ships English to
every locale however well the verb is translated. `db/pipeline.ts` used to store seven of
them ("Role closed — candidate withdrawn from the pipeline.", "intake captured manually",
"manual", "added to pipeline", …). They are now `reason:<code>` tokens drawn from
`PIPELINE_REASON_CODES` (`db/pipeline.ts`) and resolved through
`pipeline.eventReasons.*` — the same record-vs-screen split `automation-run.ts` already
used for `reason:offerAutoExtended`.

The prefix is duplicated at both ends rather than imported (the store opens SQLite; the
renderer is a client component), so `pipeline-event-reasons.test.ts` pins the two sides
together: every code localized in all four catalogs, no locale holding the English string
verbatim, the prefix identical to the renderer's, every code letters-only so
`useEventVerb`'s parser accepts it, and **no string literal left in a `detail:` position**
— including inside a ternary, which is where the seventh one was hiding after the first
six were converted. **No migration was needed and none was done:** the coded branch is
taken only on an exact `reason:<letters>` match, so every row already in a deployed
database — English prose, a slot time, a rematch counterpart handle — renders exactly as
it did before.

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

### The on-the-job outcome of a hire

For a candidate standing on the **terminal-role** stage, the drawer leads with the
one question still open about them: how the hire actually worked out
(`PipelineHireOutcomeCard`, UAT `KAT-L1-002`). The card writes a 1..5 `performance`
rating into `dev_outcomes` through `POST /api/pipeline/outcomes` — the same field,
vocabulary and 1..5 bound the dev-case control room has always used
(`app/_lib/dev-outcomes.ts`), not a second rating concept.

Four properties are deliberate and pinned by
`app/api/pipeline/outcomes/outcomes-route.test.ts`:

- **Operator-gated, workspace-scoped.** A rating is a judgement about a named
  person living in the same database as sealed decision records, so both handlers
  take the shared `requireOperator()` gate before any work and every store call is
  handed the caller's workspace. Another tenant's entry id is indistinguishable
  from a deleted one.
- **It never becomes a pipeline event.** `/api/pipeline/events` is served
  unauthenticated and its public projection copies `detail` verbatim, so a rating
  written as an event would be world-readable. The route emits none, and the guard
  derives the public-surface list from `app/_lib/auth/public-routes.ts` — a new
  public prefix extends the guard for free — then asserts no publicly-reachable
  route imports the outcome store.
- **Unrated reads as unrated, never zero.** There is no default and no
  pre-selected value. The write is refused with 409 unless the entry is on the
  terminal role *at the time of the write*, checked against the live stage rather
  than trusted from the client, so a stale drawer cannot record an on-the-job
  outcome for someone who never took the job.
- **Refusals carry a code, not English prose.** `HIRE_RATING_ENTRY_NOT_FOUND`
  (404), `HIRE_RATING_NOT_HIRED` (409) and `HIRE_RATING_INVALID` (400) are declared
  in `REFUSAL_ERRORS` (`app/_lib/api-response.ts`) and resolved through
  `app/_lib/use-error-message.ts`, so a Czech board is told *why* in Czech instead
  of being handed the canonical English sentence.

The card states, at the point of entry, what the rating is for and that it is
**not used to make automated decisions**; it is visible in the workspace only and
never shown to the candidate.

"Hired" is read as the terminal stage **role**, not the literal name `Hired`:
`PipelineTab` passes the board's resolved axis into the drawer, which mounts the
card on `stageHasRole(entry.stage, "terminal", axis)`, and the route re-resolves it
server-side with `getPipelineAxis(ws)` — so a workspace that renames its last
column keeps the card.

The **capture** half is what shipped. There is deliberately no `?source=performance`
calibration arm yet; Analytics → Quality prints an accrual counter off
`GET /api/pipeline/outcomes` instead (see
[`../analytics/README.md`](../analytics/README.md)).

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

`dev_outcomes` (isolated store, `app/_lib/dev-outcomes.ts`, created and migrated by
itself — **no migration in `db/core.ts` was required or written**, since it already
carried `ref`, `candidate_ref`, `predicted_score`, `outcome`, `performance`, `note`,
`recorded_at`, `workspace_id`) now also holds the board's own hires. A board hire is
keyed `pe:<entryId>` (`PIPELINE_OUTCOME_REF_PREFIX`, so the two id spaces are
provably disjoint), while a devcase-promoted hire keeps the bare submission id —
taken from the entry's `dev_submission_id`, or from a legacy `ds-<submissionId>`
candidate id for entries written before that column. So a recruiter's rating
**updates** the row `recordPipelineOutcome` already auto-wrote instead of minting a
second decided outcome, which `calibrate()` would count twice.

### An entry that came from an assignment says so (`dev_case_id` / `dev_submission_id`)

Two nullable columns, NULL on every entry that did not come from a work sample.

They exist because the dev-case path used to encode those two facts **inside the ids**
— `job_id: "dc-<caseId>"`, `candidate_id: "ds-<submissionId>"` — which meant neither
field could hold the real thing. A candidate who applied to a JD's opening and then did
its assignment therefore appeared twice on the board under two job ids, and the
synthetic half was unrankable by Matrix, Match and the automation pass's scoring sweep,
all of which need a `profiles` row. With the links in their own columns, a promoted
entry carries the real `jd-<slug>` job and a real profile id, and **merges** onto the
row the opening already created rather than adding a second one.

Reading them is `devCaseIdForEntry` / `submissionIdForEntry`
(`app/_lib/devcase-identity.ts`), never the columns or the prefixes directly: they take
the column first and fall back to parsing the legacy prefix, permanently, because
pre-milestone entries are real hiring history and no one can recover which profile a
`ds-` id stood for. Writers pass them through `createPipelineEntry`'s `devCaseId` /
`devSubmissionId`, which are **fill-only** on a re-add — the same additive discipline
`github_json` carries, so a later promote can never re-point an entry at different
material. Full rationale in [the dev-case doc](../dev-case/README.md); pinned by
`app/_lib/db/pipeline-devcase-link.test.ts`.

### One score legend: match vs transfer vs interview

Four different 0–100 numbers and one 1..5 rubric were rendered on this board in the
same shape, and the worst of them was structural: a dev-case **transfer score** written
into `pipeline_entries.match_score` by promote and shown as a plain "match" (see [the
dev-case doc](../dev-case/README.md#the-transfer-score-is-not-a-match-score)). The
numbers are separated at the source; the board now states the vocabulary once.

| Kind | What it answers | Where it comes from | Shown as |
| --- | --- | --- | --- |
| **match** | how this profile fits this opening | freshest job-matched `analyses.score`, else the `match_score` snapshot (`canonicalScoreOf`) | the score badge, unlabelled; `MATCH` under the drawer header's number |
| **transfer** | how the skills demonstrated on an assignment carry to the role | `dev_submissions.transfer_score`, reached through the entry's `dev_submission_id` (`pipeline-transfer-score.ts`) | the badge with a `transfer` marker beside it; `TRANSFER` under the drawer number |
| **interview** | rubric ratings from a voice screen | `interview_sessions.scorecard_json`, 1..5 projected to percent (`format.ts::ratingToPercent`) | the drawer's scorecard rows, never the badge |

`displayScoreOf` (`app/_lib/match-score.ts`) picks which of the first two a surface
shows — match first, transfer only when no match score exists — and tags the `kind`.
**Only the match half ranks.** `canonicalScoreOf` / `provenanceOf` are deliberately
match-only, and the board's sort and score bands (`pipelineBoardFilters.ts`), the
decisions peer rank (`decisionsPeerCompare.ts`) and screen-wave all read through them.
Consequence worth knowing: a freshly promoted assignment candidate shows a transfer
number and still sits in the **unscored** score band, which is true — until the
automation sweep computes their real match score. The legend lives in
`PipelineShared.tsx` under the board, beside the archetype/status legend.

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
(`routedToHumanRound` on the accept response). `planRoutesAiScorecardToHumanRound`
reads the plan's rounds flattened in board order, so it behaves the same whether
the human round sits at the same column as the AI one (the stacked default) or at
its own.

The plan's other two gates are enforced at the automation apply boundary
(`automation-run.ts`), now read per board column rather than per role name:
`getPlanGateForRole("screening") === "auto"` auto-ratifies parked ADVANCE
screening verdicts (hold/reject always park); `getPlanGateForRole("offer") ===
"auto"` auto-extends priced offer drafts via the shared `extendDraftedOffer` path
(unpriced fail-safe drafts always park). Both resolve the FIRST column with that
role and fall back to `"human"` when the plan says nothing — the conservative
direction, parking the decision for a person rather than ratifying it unattended.
Routing a specific candidate through the gate of the specific column they stand
on needs a per-entry stage read the automation path does not thread yet.
Full plan mechanics: `docs/features/hiring-pipeline/README.md`.

### Offer terms are validated before a link is minted

`extendDraftedOffer` runs `validateOfferTerms` (`app/_lib/offer-policy.ts`, pure
and unit-tested) over the draft's figure, currency and optional terms note
**before** `getOrCreateOpenOffer`, so an invalid draft mints no token, dispatches
no letter and seals no decision. The rule:

| Field | Accepted | Refused with |
| --- | --- | --- |
| `recommended` | absent / 0 / unparseable → **unpriced** (null, legal — `draft_offer` refuses to invent a figure and the auto gate parks it); otherwise `0 < n ≤ OFFER_SALARY_MAX` (100 000 000), floored to a whole unit | `OFFER_SALARY_INVALID` (400, `max`) |
| `currency` | absent/empty → null (unit-less, P2-1); otherwise trimmed + upper-cased and required to be in `OFFER_CURRENCIES` (`APP_CURRENCY`, EUR, USD, GBP, PLN) | `OFFER_CURRENCY_UNSUPPORTED` (400) |
| `notes` | trimmed; empty → null; `≤ OFFER_NOTES_MAX_CHARS` (2 000) | `OFFER_NOTES_TOO_LONG` (400, `max`) |

A market added to `pipeline/jobfit/market_config.py` whose currency is not on that
closed list makes offers in it *refuse*, not mislabel — add the code to
`OFFER_CURRENCIES` in the same change. The normalization also means `" czk "` and
`"CZK"` are the same terms, so a re-extend cannot read whitespace as a corrected
offer.

**Deadlines are elapsed time, not wall clock.** `ttlDays` is multiplied out to
whole 24-hour days, so a 7-day offer crossing a DST boundary lapses an hour off the
local time it was minted at (`offerExpiresAtMs` states why: the row carries no
timezone, and "seven days" is a promise about duration). The candidate is never left
to infer it — the letter states the deadline **with its timezone**
(`formatOfferDeadline`, `comms-dispatch.ts`) and the accept page counts down from
the same server-side instant.

## Known gaps

- The route layer diverged from the original one-route-per-task design in
  favor of a consolidated `/api/automation/[task]` handler — functionally
  equivalent, just fewer files.
- **Ground truth is captured but not yet measured against.** The drawer records a
  hire's 1..5 on-the-job rating, and Analytics → Quality can now score the
  advance-vs-hire question off stage data (`?outcome=hired`), but no calibration
  producer is paired against the rating itself — nothing yet validates the
  `confidence ≥ 80` auto-advance band against how a hire actually worked out.
  Deliberate: the corpus accrues first.
- **The market salary band in the drawer is role-FAMILY only, never per level.**
  `SalaryBenchmarkHint` (`app/features/hiring/pipeline/PipelineSalaryBenchmarkHint.tsx`)
  accepts a `seniority` and forwards it to `/api/benchmarks/salary`, which bands by
  it — but the drawer's caller (`PipelineCandidateResultView`) can only pass
  `roleFamily`, so a junior and a staff offer are set against the SAME corpus band.
  The data path is the blocker, not the component: `pipeline_entries` has no
  seniority column (`role_family` is the only denormalized job attribute on it), the
  job's `jobs.seniority` is never joined into `listPipeline` / `getPipelineEntry`,
  and the drawer bundle (`app/_lib/candidate-timeline.ts`) does not carry it either.
  Closing it means one job JOIN plus a new field on the board-entry allowlist
  (`BOARD_ENTRY_FIELDS`), the `Entry` client contract in
  `app/features/shared/pipelineTypes.ts`, and the drawer's `Pick` — a projection
  change across three contracts, deliberately not smuggled in behind a hint line.
  The candidate's own analyzed seniority is NOT a substitute: it describes the
  person, and the band describes the role.

- **No free-text note on the recruiting rating, and no way to clear one.**
  `dev_outcomes.note` records fixed provenance ("on-the-job rating recorded in the
  pipeline drawer"); a sentence about a named employee's performance is a different
  artifact from a screening rationale and needs a retention / lawful-basis decision
  first. A correction re-rates in place; there is no delete path. Both wait on the
  same decision.

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

### Which half of the guarantee is Python's, and which is TypeScript's

"A reject can never happen unattended" is **two** guarantees in two languages,
and `automation.py`'s module docstring used to state them as one. That matters
because `automation_cli` is a real integration surface: a caller that spawns the
Python CLI (a self-host script, a bench harness, an embedding integration) gets
the Python half and **nothing else** — no TS pass, no approval queue.

| Guarantee | Enforced in | Reached by a CLI-only caller? |
|---|---|---|
| A screening verdict is narrowed to a **route** in `SCREEN_ROUTES` = {`advance`, `hold`} — a `reject` recommendation never becomes a reject route | `screen_candidate` (`automation.py`) | yes |
| Early-career (`registry.early_career_archetypes()`) is never auto-advanced or auto-rejected; a model's `reject` is rewritten to `hold` **after** the call | `screen_candidate` + `evaluate_entry` | yes |
| `evaluate_entry` emits `action:"reject"` on **one** path only: stage `Screened`, non-early archetype, no pending approval, no recent screening decision, and a *genuine* score (absent/0 = unscored) below `POLICY["bau_reject_score"]` | `evaluate_entry` | yes |
| **No adverse action runs unattended** — AUTO1 retired (UAT M6 / GDPR Art. 22); every fairness-cleared reject is queued as a human `rejection_review` approval, so a committed pass rejects nobody | `app/_lib/automation-pass.ts` | **no** |
| Fail-closed re-check at the apply boundary: `isFairnessProtected` treats an **unknown/renamed** archetype as protected and downgrades the reject to `hold` + `fairness_gate_blocked_reject` | `app/_lib/automation-fairness.ts` | **no** |

One asymmetry is deliberate and now pinned rather than fixed: Python's
early-career gate is a *membership* test, so an unknown archetype scores as BAU
and stays rejectable there; only the TS backstop reads it fail-closed. A
CLI-only integration therefore owns its own approval gate.

Pinned by `test_automation.py::AdverseActionBoundaryTest` (an exhaustive sweep of
the entry snapshot space plus every verdict/confidence a model can return) and,
at the CLI boundary, `test_automation_cli.py::TestAutomationCliAdverseActionBoundary`.

### Constants mirrored across the language boundary

`MAX_SCORECARD_NOTES_CHARS` (`automation.py` ↔ `app/_lib/interview-transcript.ts`)
and `MIN_CALIBRATION_OUTCOMES` / `CALIBRATION_BIN_COUNT`
(`calibration_drift.py` ↔ `app/_lib/calibration.ts`) are hand-copied numbers that
said "must match" in a comment and nothing more. `test_automation_constant_sync.py`
reads the TS source (comments stripped, name word-anchored) and fails when either
side moves alone — the same shape as `test_fit_threshold_sync.py`.

### A reject issued from the group-eval comparison carries its reason

UAT `LUC-GEF-L1-08` (raised twice, built 2026-08-18). A reject taken from inside
the group-eval modal used to call `act(entry, "reject")` with no `detail`, so the
sealed record fell back to `pipeline-entry-action.ts`'s
`"Recruiter reject from <stage>."` — a tautology in the very column an auditor
reads first, while the *same* action taken from the analysis view had always
passed the recruiter's reason. The record's quality depended on which button the
recruiter happened to use.

Now (`DecisionsModals.tsx`, `DecisionsGroupEvalRejectModal.tsx`):

- the click **stages** the reject instead of issuing it, and returns `false`, so
  no outcome pill appears for a decision that has not happened;
- a confirm dialog requires a rationale (four one-click presets fill an editable
  field; ⌘/Ctrl+Enter commits; confirm stays disabled while it is blank);
- on confirm the reason reaches `act()` as `detail` and is what gets sealed;
- the seal is handed back to the comparison through `GroupEvalModal`'s `sealed`
  prop, so the outcome pill is correct on the first confirm rather than on a
  second click, and `useGroupEval` will not let an already-sealed identity be
  acted on twice.

Advance is untouched and still one click — this is a bulk-review surface, and
friction that buys nothing is its own defect.

### The comparison tells the same truth in both of its views

Built /perfect 2026-09-03 (`group-eval-ui`). The modal renders one of two views:
the enriched comparison table when at least one candidate carries a recruiter
score breakdown (`isEnriched`, `groupEval/groupEvalSession.ts`), and the compact
legacy view for everything else — a job-less role, an eval saved before the
breakdown existed, the simulation's loading payload. They had drifted apart:

- **The knock-out is one rule, stated in both.** The enriched header enforces
  "KO takes precedence over the crown"; the legacy view rendered no KO pill at
  all, so a candidate who FAILED a knock-out read there as an ordinary
  contender. Both now call `koFailed()` (`groupEval/groupEvalHelpers.ts`), which
  is explicit-`false` only: an absent flag means "never assessed", not "failed".
- **A failed cache probe is disclosed before it costs anything.**
  `openGroupEval` probes `GET /api/decisions/group-eval?role=<key>` before
  spending. A probe that FAILED (offline, a 500, an unparseable body) used to be
  indistinguishable from a miss and fell straight through to a fresh paid run —
  the full ≤8-process pipeline. It now surfaces
  `decisions.evalCacheProbeFailed` ("we couldn't check whether a saved
  comparison exists — re-running starts a new AI run") and leaves the spend to
  the recruiter, who takes it with the modal's own **Re-run** button.
- **The read route answers with a code**, not with the thrown message:
  `safeJsonError(..., "GROUP_EVAL_READ_FAILED")`, so the modal renders it in the
  reader's language (its row is deleted from the `error-response-contract`
  ceiling).
- **The per-candidate strip is a real tablist.** One tab stop (roving
  `tabindex`), ←/→/↑/↓ + Home/End, `aria-controls`/`aria-labelledby` and a
  focusable panel; the movement rule is the pure reducer
  `groupEval/groupEvalTabKeys.ts`. Before this a keyboard user reached the
  eighth candidate only by tabbing through seven tabs and the advance/reject
  buttons behind each.
- **The weighting matrix's scheme initials are copy, not code**
  (`schemeSkillsShort` / `schemeCareerShort` / `schemePersonalShort` ×4
  locales): "S · C · P" spells skills/career/personal only in English.

The modal's surfaces now compose `app/_components/ui/recipes.ts` (the amber
advisory is one `Notice` primitive instead of four hand-rolled blocks; the quiet
pill is `CHIP_QUIET`, the section titles `META_LABEL`, the AI verdict
`PANEL_SUNKEN`), and the "not measured" dash moved off `text-stone-300`, which
was all but invisible in Spark Dark.
