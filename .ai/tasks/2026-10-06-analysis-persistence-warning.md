# 2026-10-06 - the analysis that finished but was not saved says so

Charter `accepted-idea-delivery`. Ideas c8940649 (built), 49acea3a and f68c6fbc (reconciled, not built).

## Reconcile verdicts

### 49acea3a - SSE error frame in the apply route / ConversationalApply: OBSOLETE, not built

- `app/api/apply/[id]/` holds `route.ts`, `followup/`, `quick/`, `session/` and tests. A grep for
  `event-stream` over `app/` finds no apply route; `route.ts` answers plain JSON.
- `ConversationalApply.tsx` still exists (`app/apply/[id]/`) but is a client form posting to the JSON
  routes; there is no stream for an error frame to ride.
- The premise (an SSE frame that can be lost or malformed) has no code to land on. Nothing to deliver.

### f68c6fbc - candidate scheduling-confirmation email silently loses its .ics: NOT APPLICABLE AS WRITTEN, not built

- `buildIcs` is imported in exactly two production places: `app/_lib/comms-dispatch.ts` (line 14, one call
  at ~816) and `app/features/hiring/schedule/ScheduleAddToCalendar.tsx` (client-side download).
- The single server-side call builds the **interviewer brief** (`sendInterviewerBrief`). Its
  `catch { /* unparseable slot - skip the hold */ }` is documented and the brief still delivers; the
  comment at ~811 states "the candidate gets one client-side".
- Candidate side: `app/schedule/[token]/BookedCard.tsx` offers Google / Outlook / .ics from the booked
  card, built in the browser from the slot. No candidate-facing email attaches or inlines an .ics, so
  none can drop one silently. `grep -l "text/calendar|BEGIN:VCALENDAR|icalEvent"` over app, packages,
  edge and pipeline finds only the calendar helpers and the interviewer brief.
- If the product wants an .ics in the candidate email, that is a new feature, not this defect. No schema
  column added (per the brief).

### c8940649 - persistence failure invisible on the live result: LIVE on main, BUILT

Main carried only `analyzePipelineRef.ts` disabling "Add to pipeline" with reason `unsaved`; the result
itself looked complete. `AnalyzeTab.tsx` at main (4f585e213) has no unsaved notice, and
`persistAnalysis` still logs "Failed to persist analysis" and returns null at both delivery sites.

## What changed

- `app/features/tools/analyze/analyzeUnsavedWarning.ts` - `shouldWarnUnsaved(analysis)`: true only for a
  delivered analysis whose `persistence === null`. Derived from the existing field; **no new response
  field**, the contract is unchanged. An absent `persistence` (a body that predates the receipt) does not
  warn. A restored result always rebuilds a receipt from its row (`analyzeSession.ts`), so it never warns.
- `AnalyzeTab.tsx` - an amber `NOTICE` (`role="alert"`) above the result: "Analysis finished, but it
  wasn't saved. Reloading or leaving this page will lose it. ..." with a Dismiss button. The dismissal is
  keyed to the result object, so the next delivery that also fails to save warns again. Hidden while a run
  is in flight. Composed from `NOTICE` and `BTN_GHOST` and the `text-meta` token, so the style ratchets do
  not move.
- `messages/{en,cs,de,fr}.json` - `analyze.unsavedWarningTitle|Body|Dismiss` in all four locales.
- `docs/features/candidates/README.md` - the live warning and the no-retry decision.

## Decisions

- **No retry-save endpoint.** The idea suggested a POST persisting a client-held payload. That would let a
  client store an analysis and a score the engine never produced, in a table History and the board trust.
  Left out on purpose; the honest remedy for a lost save is to run the analysis again.
- **`debitDeliveredAnalysis` untouched.** Billing still follows the row: a failed save charges nothing.

## Acceptance

- (a) "A saveAnalysis that throws yields a delivered result whose persistence is null" is **already pinned**
  by `app/_lib/analyze-run.test.ts` "a PERSIST FAILURE charges nothing" (drops the `analyses` table, asserts
  `persistence === null`, the log line, and no charge). It could not "fail first": the behaviour is the
  existing one and this change deliberately does not alter it. I did not duplicate it; the new work is the
  UI half, which did fail first (`analyzeUnsavedWarning.test.ts` failed on the unwired AnalyzeTab before
  the edit).
- (b) `analyzeUnsavedWarning.test.ts`: warns for `persistence: null`; not for a real receipt (with or
  without a JD); not for no analysis; not for an absent field; plus a source guard that AnalyzeTab wires
  the helper, the three keys and a per-result dismissal. No React renderer exists in this suite, so the
  wiring is read off the source, as in `ResultPanel.contract.test.ts`.
- (c) `npm run typecheck`, `npm run lint` (0 errors, 49 pre-existing warnings) and `npm run i18n:check` green. 
`npm run test:unit` (12643 tests) ends with 8 BROKEN files, none in code this change touches: style-debt, 
loading-gap-debt and recipes-literals name `DocketSurface`, `SelectCell`, `ScheduleInterviewTranscriptModal`, 
`ScheduleTabInterviewedList`, `JobsPostingModalFooter`, `AnalyzePriorRunsStrip` (the one AnalyzeTab ratchet 
hit I caused, 6>4 raw text-sm, was fixed with `text-meta`); `erasure-full-scrub` names `job_golive_receipts`; 
`jobseeker/enabled` cannot resolve `next/server` through the worktree's `node_modules` junction; 
`analyzeCvIntake` pins a `restoreDraftValue(prev, jd)` call in `useAnalyzeForm.ts`, which this change does not 
touch; `task-outcome-summary` and `unit-db` are likewise untouched. The 39 tests in the analyze-run, 
ResultPanel-contract, pipeline-ref and new warning files pass. No existing assertion  touched or weakened.

## Not done / notes

- A visual check in both themes was not possible in a headless run; the notice reuses `NOTICE("amber")`,
  which is themed in both.
