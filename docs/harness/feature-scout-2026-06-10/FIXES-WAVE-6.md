# Feature Scout #2 — Fix Wave 6: "Comms center & link lifecycle" (Theme E)

> 5 commits (4 features + 1 lint fix-forward), 7 findings closed (4 High + 2 Medium pair-halves + 1 Medium).
> Baseline preserved: tsc 0 → 0 · next build ✓ · unit 646 → 646 · python 500 OK → 500 OK · eslint clean (one render-purity error caught post-commit and fixed forward).

One mental model: the product sends real messages and mints real credentials, but operated
them fire-and-forget — no view of what was sent, no recovery for what failed, no control
over what was still live. This wave gives every outbound artifact an operator.

## Commits

| # | Commit | Finding | Value | Files |
|---|---|---|---|---|
| 1 | `c42ed8c` | SIM2 + DEVO5 + DEVS4 (merged) — dead-letter resend + outbox filter | High + M + M | 4 (+123/−9) |
| 2 | `83e37ad` | SIM1 — recruiter Comms Center + drawer Messages | High | 6 (+246) |
| 3 | `9e910d2` (+fix `e760ef5`) | SCH1 — invite lifecycle surfaced | High | 7 (+216) |
| 4 | `0fdaa4c` | VOX1 — interview-link expiry / revoke / clean reissue | High | 8 (+168/−2) |

## What was fixed

1. **Dead letters are recoverable.** `failed` was terminal-with-no-recovery while the system
   deliberately never auto-resends (event-gated sends skip on re-run). `POST
   /api/comms/[id]/resend` re-dispatches the stored message as a NEW outbox row (append-only
   audit) + a `comm_resent` event; a shared ResendButton lands on failed rows in the Dev
   Outbox and the new center. `getOutboxEntry` + `listOutboxFiltered({ref,status,kind})`.

2. **Comms are visible where recruiters look.** All 8 candidate-facing message kinds were
   readable only in the Dev tab's truncated table. `GET /api/comms` (per-entry and
   dead-letter views, refs resolved server-side) powers a Communications panel on Channels —
   failed-first with a loud filterable dead-letter count, full letters on expand, resend
   in place — and a Messages section in the drawer beside History (events say
   `rejection_sent`; this shows the rejection).

3. **The invite lifecycle reports to its owner.** `needs_more_slots` and `needs_reconcile`
   were persisted "for the recruiter" and read by no one; no agenda of confirmed bookings
   existed. `listScheduleInvites()` + `GET /api/schedule` + an "Interviews & invites" panel:
   attention rows first, the chronological agenda (duration/reschedules/reminder state),
   awaiting-booking collapsed with send age.

4. **Delivered links die when they should.** 7-day expiry on untaken links
   (`isInterviewLinkExpired` — ONE authority shared by `/connect` and the portal), revoke
   functions WHERE-guarded (completed never touched — the transcript is evidence), reissue
   revokes prior open sessions (exactly one live link per entry, the response reports the
   kill count), reject auto-revokes with `/connect`'s terminal-entry guard as the decline
   backstop, a drawer "Revoke interview links" action, and honest portal copy.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 646 | 646 |
| `npm run test:python` | 500 OK (4 skip) | 500 OK (4 skip) |
| eslint | clean | clean (1 purity error fixed forward, see below) |

## Patterns established (catalogue items 14–16)

14. **Append-only recovery: resend mints a new row, never mutates the failed one.** The
    audit trail must show both the failure and the recovery; flipping the original row's
    status would erase the incident.
15. **`Date.now()` during render fails react-hooks/purity even in async server components —
    and the fix is better factoring anyway.** Twice this wave: capture the clock at fetch
    time (client), or hoist the time-dependent predicate into a lib helper that becomes the
    single authority both the page and the API gate share.
16. **A minted credential needs four verbs: expire, revoke, reissue-kills-prior, and
    die-with-the-subject.** VOX1's delivery made the missing verbs urgent; the completed
    guard alone only covers the happy path.

## What remains

Theme E residue: VOX2 (invite funnel state + deliberate resend — partially covered by
reissue semantics), PROF2 (contact capture in the profile builder — intake-shaped, fits
Wave 8), SCH2/SCH3 (booking cancel, no-show capture). Remaining waves per the INDEX:
3/4 (i18n), 8 (lifecycle CRUD), 9 (shell + analytics), 10 (ops) + the Med/Low sweep.
