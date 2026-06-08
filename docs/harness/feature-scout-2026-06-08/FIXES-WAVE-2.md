# Feature Scout Fix Wave 2 — Close the candidate loop (Theme B)

> 2 commits, 3 of 5 candidate-loop opportunities shipped (APP2 + APP3 keystone, then APP1).
> Baseline preserved: tsc 0 → 0 · unit 617 → 617 · python 486 → 486 · next build ✓.

Theme B is "close the candidate loop." Its keystone is **reachability** — APP2 closes
the documented "unaddressable recipient" seam, which everything else in the theme
(confirmations, interview invites, offers, rejections to inbound applicants) depends
on. Wave 2 shipped that keystone + the confirmation that immediately rides on it; the
remaining three candidate-loop items are independent surfaces queued for Wave 2b.

## Commit

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `5059861` | **APP2** + **APP3** — capture contact → deliverable comms + application-received ack | `db.ts` (contact column + migration + thread), `comms-dispatch.ts` (candidateRecipient + dispatchApplicationReceived), `apply.ts` (email step), `api/apply/[id]/route.ts` |
| 2 | `47446a4` | **APP1** — optional CV upload at apply, folded in as evidence | `apply.ts` (`file` step type + step), `apply-intake.ts` (cvText → `kind:"cv"` evidence), `apply/[id]/ConversationalApply.tsx` (file-step UI + /api/extract-text), `api/apply/[id]/route.ts` |

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

## Verification (before → after)

| Gate | Baseline | After Wave 2 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 617 / 0 fail | 617 / 0 fail |
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

## What remains (deferred)

- **SCH2 — candidate self-reschedule** from the booked-confirmation page (the email
  promises "just reply" but there's no path). **Deliberately deferred to a focused
  wave**: it's a collision-safe reschedule on a PUBLIC, email-sending token route in a
  flagged-delicate area (the slot machinery carries uncommitted WIP; Scheduling#3/#4
  were deferred for slot-vocabulary rework). Needs a transactional
  `rescheduleScheduleInvite` matching `confirmScheduleInvite`'s discipline, a GET
  slot-pool change (offer slots when confirmed, excluding the candidate's own), a
  reschedule cap, and a store-level concurrency test — best done fresh, not at the tail
  of a long session.
- **JOB3 — "Reach out" from a sourcing result.** Needs an outreach path for a sourced
  candidate not yet in the pipeline (the outreach automation task is entry-keyed) — not
  the small wire it first appears.
- **dedup-by-email** — kept dedup name-based this wave to avoid touching the tested
  `applyDedupeKey` contract; fold email into the dedup key as a follow-up.
- Themes C–G (export, search, decision-record, config, AI-assist) remain in `INDEX.md`.

## Branch

All on `feat/feature-scout-wave1-dark-capabilities` (Waves 1 + 2, unmerged). The
`db.ts` commit carries adjacent uncommitted idea-batch WIP per the agreed mid-WIP-tree
handling.
