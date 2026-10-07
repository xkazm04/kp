# KO-decline contact retention

Date: 2026-10-07 · Charter: accepted-idea-delivery · Branch: `autopilot/accepted-idea-delivery-cfa1b976`
· Feature: candidate-application-intake · Source: intake lite r2, must-address craft-1

## The defect

A declined applicant has no pipeline entry. `dispatchKnockoutDecline` still wrote a ref-less
`ko_decline` outbox row holding their address, name and role, and `recordKnockoutDecline`
kept their name in the entry-less `ko_declined` event. The only outbox scrub is keyed by
entry id, so no erasure or retention path reached either row.

## Reconcile

Main had no sweep that blanks ref-less `ko_decline` rows (checked `dev_outbox` writers and
`anonymizeEntry`). Nothing to report as already done.

## What changed

- `KO_DECLINE_CONTACT_RETENTION_DAYS = 30` in `app/_lib/db/pipeline.ts`, no env override.
- `sweepKoDeclineContacts` (same file): blanks recipient/subject/body of ref-less `ko_decline`
  rows and `candidate_label` of entry-less `ko_declined` events older than the window. Global,
  tagged `-- tenancy:global`, idempotent. Kind, status, channel, job title, detail, created_at and
  workspace stay, so the funnel and "turned away at the gate" counts do not move.
- `instrumentation-node.ts`: called from `sweepExpiredConsents` in its own try/catch, outside the
  autonomy pause (statutory, like the consent sweep).
- `anonymizeEntry` (erasure and expiry): also blanks ref-less `ko_decline` rows in the entry's own
  workspace whose recipient equals the entry's contact (trimmed, case-insensitive).
- `comms.koDecline.body` in en/cs/de/fr states the retention; `{days}` is passed from the constant.
  It promises no other deletion route (Reply-To / inbound read are R-26).
- ADR 0019: the "what it does not store" bullet now states the window, the erasure by address and
  the sweep. Nothing else in the ADR changed.
- Pinned by `app/_lib/ko-decline-retention.test.ts`.

## Second commit

`bbb327b18` fixes the two style-ratchet breaks: `ApplyDeclineDetail.tsx` `text-base` → `text-body`;
`MatchCard.tsx` rerun button composes `BTN_GHOST`. `style-debt.json` untouched.

## Left alone

The letter still says "reply to this message", with no Reply-To; that is R-26. A recruiter-visible
ko_declined activity row now shows no name after 30 days.
