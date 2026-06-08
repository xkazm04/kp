# Feature Scout Fix Wave 2 — Close the candidate loop (Theme B) ✅ COMPLETE

> 4 commits, ALL 5 candidate-loop opportunities shipped (APP2 + APP3 keystone, APP1, SCH2, JOB3).
> Baseline preserved: tsc 0 → 0 · unit 617 → 624 (+7 SCH2 store tests) · python 486 → 486 · next build ✓.

Theme B is "close the candidate loop." Its keystone is **reachability** — APP2 closes
the documented "unaddressable recipient" seam, which everything else in the theme
(confirmations, interview invites, offers, rejections to inbound applicants) depends
on. Wave 2 shipped that keystone + the confirmation, then APP1 (CV upload), SCH2
(self-reschedule), and JOB3 (sourcing reach-out) — ALL 5 candidate-loop
opportunities. The theme is complete.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `5059861` | **APP2** + **APP3** — capture contact → deliverable comms + application-received ack | `db.ts` (contact column + migration + thread), `comms-dispatch.ts` (candidateRecipient + dispatchApplicationReceived), `apply.ts` (email step), `api/apply/[id]/route.ts` |
| 2 | `47446a4` | **APP1** — optional CV upload at apply, folded in as evidence | `apply.ts` (`file` step type + step), `apply-intake.ts` (cvText → `kind:"cv"` evidence), `apply/[id]/ConversationalApply.tsx` (file-step UI + /api/extract-text), `api/apply/[id]/route.ts` |
| 3 | `b69dba2` | **SCH2** — candidate self-reschedule of a confirmed interview | `schedule-store.ts` (rescheduleScheduleInvite + reschedule_count + test), `api/schedule/[token]/route.ts` (reschedule branch), `schedule/[token]/SchedulePicker.tsx` |
| 4 | `54830e5` | **JOB3** — one-click "Reach out" from sourcing results | `api/jobs/[id]/candidates/outreach/route.ts` (new), `useReachOut.ts` (new), `api-response.ts` (OUTREACH_FAILED), `RecruiterCandidates.tsx`, `RediscoverPanel.tsx` |

## What was shipped

- **APP2 — capture a reachable contact.** Inbound apply captured no contact field, so
  (a) dedup was name-only and (b) every downstream comm resolved the recipient to the
  literal `"candidate"` and **dead-lettered** — documented in three places
  (`db.ts:1895`, `comms.ts`, `comms-dispatch.ts`). Added an `email` step to the apply
  chat, validated server-side (format-checked when provided; **not** hard-required — a
  blank still files, comms just stay undeliverable), stored on a new migrated
  `pipeline_entries.contact` column, and made `candidateRecipient` **prefer** it. The
  whole comms stack (ack / interview invite / offer / rejection) is now deliverable for
  inbound applicants; recruiter/Match adds carry no contact and resolve to the name
  exactly as before (purely additive).
- **APP3 — application-received acknowledgement.** A passing applicant got only an
  ephemeral in-page "You're in 🎉" bubble. `dispatchApplicationReceived` now fires a
  durable "we received your application" comm through the shared Outbox on a fresh
  acceptance — best-effort (a comms failure never turns a successful application into a
  500), and fires for degraded stubs too. Brings inbound applicants to comms parity
  with the rest of the pipeline; deliverable when APP2 captured an address, traceable
  in the Outbox audit either way.
- **APP1 — optional CV upload.** The chat captured only typed answers; an applicant with
  a polished CV had to hand-summarise their career. A new `file` ApplyStep type adds an
  optional "Attach your CV" step whose client handler extracts text via the existing
  `/api/extract-text` (the recruiter Profile form's endpoint), stores it as the `cv`
  answer, and folds it into `buildIntakeProfile` as high-weight `kind:"cv"` evidence
  (carrying the typed skills) — turning a thin stub into a fully matchable candidate.
  Fully skippable, recoverable on a read failure; the server head-samples an over-long
  extract and the body cap rose to 256 KB to carry it.
- **SCH2 — candidate self-reschedule.** The confirmation email promised "just reply to
  change the time" but there was no path — a confirmed invite was a dead end. Adds
  `rescheduleScheduleInvite` to the store with the SAME synchronous-transaction
  collision authority as `confirmScheduleInvite` (slot_at identity — two concurrent
  moves can't double-book), bounded by `MAX_RESCHEDULES`, freeing the old slot,
  re-anchoring `confirmed_at`, and resetting the reminder cycle so the reminder fires
  for the new time. The route's POST gained a reschedule branch that *shares* the
  entry-record + confirmation-dispatch logic with first-confirm via one local helper
  (so they can't drift); the picker's booked card grew a "Need a different time?"
  affordance. Pinned by a new `schedule-store.test.ts` (7 tests, real store, throwaway
  DB) covering move / taken / not_confirmed / limit / no-op / not_found / reminder-reset.
- **JOB3 — one-click reach-out from sourcing.** The sourcing surfaces could only
  "+ pipeline"; acting on a resurfaced candidate meant hunting them down in the
  pipeline tab to message them. A new `/api/jobs/[id]/candidates/outreach` route does
  `createPipelineEntry` (idempotent) + `runAutomationTask("outreach")` (drafts via the
  cache-keyed `automation_cli`, dispatches through the durable Outbox, gated on the
  per-entry `outreach_sent` marker) — so a "Reach out" click files the candidate AND
  sends a first-touch message at most once. A `useReachOut` hook (mirroring
  `useAddToPipeline`) drives the button in both `RecruiterCandidates` and
  `RediscoverPanel`; a reached candidate collapses to a single "✓ Reached out" badge.

## Verification (before → after)

| Gate | Baseline | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 617 / 0 fail | 624 / 0 fail (+7 SCH2 store tests) |
| `npm run test:python` | 486 (4 skip) | 486 (4 skip) |

The DB schema change (`contact` column) is additive + migrated (ALTER ADD COLUMN in
the existing idempotent try/catch block); legacy rows read `contact` as null. The
unit suite (which exercises `createPipelineEntry`/pipeline tests) stayed green.

## Patterns established (catalogue additions)

4. **Additive recipient enrichment.** Closing an "unaddressable recipient" seam is a
   priority-ordered fallback in one resolver (`candidateRecipient`: contact → label →
   id → literal), not a rewrite — existing call sites keep working, new data just wins
   when present. The column is nullable + migrated so it's safe on every existing row.
5. **Best-effort post-commit comms.** An acknowledgement/notification fired *after* the
   durable write must be try/caught and swallowed — the primary action already
   succeeded, so a comms throw must never surface as a 5xx (mirrors
   `dispatchInterviewReminder`'s post-send audit-swallow).

## What remains (one minor refinement)
- **dedup-by-email** — apply dedup is still name-based (the tested `applyDedupeKey`
  contract was left untouched this wave); now that APP2 captures a contact, folding
  email into the dedup key would distinguish two same-named applicants. A small
  follow-up, not a candidate-loop gap — the theme is complete.
- Themes C–G (export, search, decision-record, config, AI-assist) remain in `INDEX.md`
  for future waves; DEC1 still needs its DEC2 dry-run companion.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1 + 2, unmerged). The
`db.ts` commit carries adjacent uncommitted idea-batch WIP per the agreed mid-WIP-tree
handling.
