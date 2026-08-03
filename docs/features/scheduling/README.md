# Interview scheduling — self-booking + calendar free/busy

A candidate books their own interview from a tokenized link; the recruiter sees
and steers every invite from the Schedule tab. Since W1.4 the offered times are
also checked against the team's **connected Google calendar**, so a candidate
cannot pick an hour the interviewer is already busy for.

## Entry points

- Candidate: `app/schedule/[token]/page.tsx` → `SchedulePicker.tsx` (+
  `error.tsx`, `loading.tsx`).
- Recruiter: the Schedule tab's invite lifecycle panel —
  `app/features/hiring/schedule/ScheduleInviteLifecyclePanel.tsx`,
  `ScheduleInviteAgendaRow.tsx`, `ScheduleInviteRecruiterControls.tsx`,
  `useScheduleInviteLifecycle.ts`.
- Calendar connection (operator): `app/api/calendar/google/**` +
  `app/_lib/calendar/token-store.ts`.

## Flows

1. **Mint.** `POST /api/schedule/invite` creates a `schedule_invites` row with
   `durationMin = plannedInterviewMinutes(entry)` and mails the link.
   `POST /api/schedule/invite/bulk` does the same for a cohort (deduped and
   capped at `BULK_INVITE_CAP` = 100 by `app/_lib/bulk-invite.ts`), with
   per-entry isolation — one bad/terminal/comms-failed entry never aborts the
   batch and the response reports each outcome.
2. **Offer.** `GET /api/schedule/[token]` proposes times via
   `proposeFreeSlots` — `proposeSlots` (kp's own booked slots, business days,
   `KP_INTERVIEW_TIMES` in `KP_INTERVIEW_TZ`) filtered by the connected
   calendar's free/busy.
3. **Book.** `POST /api/schedule/[token]` re-derives the label server-side
   (`offeredSlotFor`), **re-checks free/busy at the moment of booking**
   (`slotStillFree`), collision-checks in the store transaction, advances the
   pipeline entry (`approve_event`), and dispatches confirmation + interviewer
   brief.
4. **Steer.** `POST /api/schedule` gives the recruiter cancel / no-show /
   reschedule / accept-proposal / resolve-reconcile / week-grid book, all on the
   same store primitives. `GET /api/schedule?slots=1` serves the reschedule
   picker's offered times.
5. **Escalate.** A fully-booked horizon or an exhausted reschedule cap lets the
   candidate propose their own times (`validateProposedSlots`), which the
   recruiter accepts or declines.

## Free/busy — and saying whether it was actually checked

`app/_lib/calendar/free-busy.ts` is pure (overlap maths, busy-span merging,
query-window derivation); `google-calendar.ts` is the network edge;
`available-slots.ts` joins them.

**The degradation contract:** `fetchBusy` returns `null` for *"we do not know"*
and `[]` for *"checked, nothing in the way"*. They are never conflated —
treating an outage as an empty calendar would confidently offer busy times.
Whenever the answer is unknown the caller gets exactly the list kp proposed
before this integration existed. Scheduling worked without Google and must keep
working when Google is down, the grant is revoked, or nobody ever connected an
account.

`proposeFreeSlots` reports that honestly, as three states
(`CALENDAR_STATUSES` in `free-busy.ts`):

| Status | Meaning | Where it comes from |
| --- | --- | --- |
| `checked` | A connected calendar answered; the offered times are conflict-free | `fetchBusy` returned an array |
| `not_connected` | No calendar integration for this workspace — the recruiter can fix this | `isCalendarConnected` false (no OAuth client configured, or no connection row) |
| `unavailable` | A calendar **is** connected but the lookup produced no answer (outage, revoked grant, per-calendar error) | `fetchBusy` returned `null` while connected |

Only `checked` ever claims a calendar was consulted. `calendarChecked` (the
boolean) is exactly `status === "checked"`.

### Duration, and re-checking at booking

The conflict window is the interview's **real** length — `invite.durationMin`
on both read sites (`plannedInterviewMinutes(entry)` at mint time), falling back
to `DEFAULT_SLOT_MINUTES` (45) only for a legacy invite with no stored duration.
A 90-minute interview is checked across all 90 minutes; the recruiter's
`?slots=1` request names its invite via `&token=` so it gets the same treatment.

Suggestion-time filtering is not enough on its own: the offer is rendered when
the candidate opens the page and the click can land days later. `slotStillFree`
(`available-slots.ts`) re-asks the calendar at confirm time and refuses a
definite conflict with the same 409 the picker already handles, so the candidate
is re-offered instead of double-booked. It is **three-valued** — `null` means
unknown (no calendar, or the lookup failed) and MUST proceed. An outage never
blocks a booking.

A longer conflict window legitimately removes more slots, so a fully-conflicted
horizon reaches the existing `noSlots` escalation more often — that path is
unchanged and covered by `app/api/schedule/calendar-conflict.test.ts` (which also
pins the 90-minute span, the confirm-time refusal, both unknown paths, and a null
`durationMin`).

**What each audience sees.** The recruiter's reschedule picker
(`ScheduleInviteRecruiterControls.tsx`) renders all three states plus
"N times hidden as busy" from `droppedForConflict` — an unexplained short list
otherwise reads as a broken feature rather than a busy week. The candidate page
gets **one bit only** — "free on the interviewer's calendar" vs "not confirmed
against it, we'll confirm by email". `calendarStatus` and `droppedForConflict`
are statements about the *interviewer's* calendar and stay off the public token
wire, alongside `entryId` and `reconcileReason`.

Copy lives under `scheduleTab.lifecycle.calendarStatus.*` (recruiter) and
`schedule.calendarCheckedNote` / `calendarUncheckedNote` (candidate), in all
four locales. `app/_lib/calendar/calendar-status-i18n.test.ts` set-equality
guards the recruiter catalog against `CALENDAR_STATUSES`.

## API / lib surface

| Surface | File | Notes |
| --- | --- | --- |
| Candidate read/book | `app/api/schedule/[token]/route.ts` | Public token route; `publicInviteView` is the leak boundary |
| Recruiter lifecycle + actions | `app/api/schedule/route.ts` | Workspace-authenticated; `?slots=1` serves reschedule times |
| Invite minting | `app/api/schedule/invite/route.ts` | Operator-gated + workspace-scoped |
| Bulk invite minting | `app/api/schedule/invite/bulk/route.ts` | Same gate; per-entry isolation, `BULK_INVITE_CAP` = 100 |
| Slot maths (pure) | `app/_lib/schedule-slots.ts` | `proposeSlots`, `offeredSlotFor`, `validateProposedSlots`, TTL |
| Store + collision authority | `app/_lib/schedule-store.ts` | Confirm/reschedule transactions, operator flags |
| Free/busy (pure) | `app/_lib/calendar/free-busy.ts` | `isSlotFree`, `filterFreeSlots`, `busyQueryWindow`, `CALENDAR_STATUSES` |
| Google edge | `app/_lib/calendar/google-calendar.ts` | `fetchBusy`, `createInterviewEvent`, `isCalendarConnected` |
| Join | `app/_lib/calendar/available-slots.ts` | `proposeFreeSlots` (offer-time filter), `slotStillFree` (booking-time re-check) |

## Data model

`schedule_invites` (`schedule-store.ts`): token, `entry_id`, `workspace_id`,
status (`pending` / `confirmed` / `declined` / `no_show`), `slot` + `slot_at`,
`duration_min`, `candidate_tz`, `attendance_status`, `reschedule_count`,
`meeting_url`, `proposals` + `proposal_status`, and the operator flags
`needs_more_slots` / `needs_reconcile`.

`calendar_connections` (`app/_lib/calendar/token-store.ts`): one Google
connection per workspace; the refresh token is encrypted at rest and never
crosses the API boundary.

## Gating / keyless behaviour

**Who may mint an invite.** Both invite routes email candidates, so both are
operator-gated: `requireOperator()` runs **first**, before any rate-limit budget
is spent, in lock-step with `app/api/pipeline/batch/route.ts`. Semantics are the
shared ones — open mode (no `KP_OPERATOR_PASSWORD`) is a no-op, so local dev and
the keyless demo are unaffected; a valid operator session is allowed; the
anonymous demo-workspace cookie the proxy waves through gets a `401`. The guided
simulation's interview step already falls back to a manual recruiter confirm when
the mint does not return a token, so a gated deployment degrades rather than
stalls. The per-IP throttle (30/min single, 10/min bulk) stays as the second line
of defence.

**Which rows they may reach.** Both routes resolve `currentWorkspace()` once and
thread it into every `getPipelineEntry` lookup. The candidate token route is
token-authenticated (no session to read), so it scopes its entry lookups to
`invite.workspaceId` instead. Pinned end-to-end by
`app/api/schedule/invite/invite-gate-tenancy.test.ts`, which drives the real
handlers with a signed session cookie: an ungated (and a demo) session is refused
with zero links minted, workspace B cannot invite workspace A's entry, and a
non-default workspace can invite its own cohort — the last of which was broken
outright while the routes relied on `getPipelineEntry`'s default workspace.

The calendar integration is entirely optional. Without
`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`, or with no connected
account, every offer reports `not_connected` and the pre-integration slot list
is served unchanged. Scopes are deliberately narrow (`calendar.freebusy`,
`calendar.events`) — kp can learn *that* someone is busy, never *why*.

## Known gaps

- The slot pool is **host-blind**: `KP_INTERVIEW_TIMES` (default 10:00 + 14:00)
  is a single global pool, so collisions are workspace-wide rather than
  per-interviewer.
- Only Google is supported; there is no Microsoft 365 provider.
- `POST /api/schedule` (the recruiter lifecycle actions — book, cancel, no-show,
  reschedule) is workspace-scoped but **not** operator-gated, unlike the invite
  routes. `getPipelineEntry`'s `workspaceId` parameter also still defaults to
  `DEFAULT_WORKSPACE_ID`, so an omission stays a silent fallback rather than a
  compile error; ~18 production call sites outside this feature still omit it.
- The recruiter-side reschedule / accept-proposal **writes** do not re-check
  free/busy at confirm time the way the candidate confirm does — the recruiter is
  assumed to be looking at their own calendar. (Their offered list *is* filtered.)
