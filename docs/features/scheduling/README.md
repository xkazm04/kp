# Interview scheduling — self-booking + calendar free/busy

A candidate books their own interview from a tokenized link; the recruiter sees
and steers every invite from the Schedule tab. Since W1.4 the offered times are
also checked against the team's **connected Google calendar**, so a candidate
cannot pick an hour the interviewer is already busy for.

## Entry points

- Candidate: `app/schedule/[token]/page.tsx` → `SchedulePicker.tsx` (+
  `error.tsx`, `loading.tsx`). `SchedulePicker` only orders the states; the
  fetch/mutation state lives in `use-schedule-invite.ts` and each state renders
  from its own component — `DeadLinkCard.tsx` (expired/closed link),
  `BookedCard.tsx` (confirmed booking, RSVP, add-to-calendar, withdraw),
  `SlotPicker.tsx` (the slot grid) and `ProposeSection.tsx` (the "propose your
  own times" escalation, shared by the two stuck states).
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
   pipeline entry (`approve_event`), dispatches confirmation + interviewer
   brief, and **writes the event onto the connected calendar**
   (`syncInterviewEvent`).
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

## Write-back — the interview on the real calendar

The other half of W1.4's acceptance criterion: *a confirmed slot writes a real
event*. `app/_lib/calendar/event-sync.ts` is the seam; `google-calendar.ts`
carries the three verbs (`createInterviewEvent` POST, `updateInterviewEvent`
PATCH, `deleteInterviewEvent` DELETE) and the `calendar.events` scope that was
already being granted at consent time.

The event's **body is not invented** there: `interviewCalendarEvent`
(`app/_lib/calendar-links.ts`) already composes the title, description (stage,
join link, reschedule URL) and location for the `.ics` and the "add to calendar"
template URL, and the written event is that same event — so the real calendar
entry and the link-only fallback can never disagree. The candidate is added as
an attendee when the entry holds a plausible email; `sendUpdates` is deliberately
**not** set, because kp owns the candidate's confirmation mail and Google would
otherwise send a second, un-branded invite for one interview.

**One event, for the whole life of the interview.** The provider event id is
persisted on the invite, so:

| Lifecycle event | What happens on the calendar |
| --- | --- |
| First confirm (candidate, recruiter grid book, accepted proposal) | CREATE |
| Reschedule (candidate self-serve or recruiter) | PATCH the same event — never a second one at the new time |
| Meeting link attached/changed (`PATCH /api/schedule`) | PATCH the existing event's location; never creates one |
| Candidate withdraws / RSVPs "can't make it" | DELETE, and the stored id is cleared so a re-booking creates a fresh event |
| Recruiter cancel / no-show | DELETE |
| kp's event deleted in Google by hand (404/410 on PATCH) | re-created, not reported as a failure |

**A calendar failure never blocks or half-commits the booking.** The booking is
the source of truth; the write is best-effort and records its outcome on the
invite as one of `CALENDAR_EVENT_STATES` (`free-busy.ts`) — a second axis from
the free/busy `CALENDAR_STATUSES`, sharing only the `not_connected` spelling:

| State | Meaning |
| --- | --- |
| `written` | The event exists; its id + `htmlLink` are on the invite |
| `not_connected` | No calendar integration for this workspace — link-only behaviour, exactly as before this integration |
| `failed` | A calendar is connected and the write did not land. The booking still stands |
| `removed` | The interview closed and its event was deleted — nothing orphaned |
| `orphaned` | The interview closed but the delete did not land: a stale entry is still on someone's calendar. The id is KEPT so a retry can find it |

`ScheduleCalendarEventChip.tsx` renders this on the recruiter's agenda / awaiting
/ closed rows — `failed` and `orphaned` as chips (the two a human can act on),
the rest as quiet single-line facts, with `written` linking straight to the
event. Copy lives under `scheduleTab.lifecycle.calendarEvent.*` in all four
locales, set-equality guarded against `CALENDAR_EVENT_STATES` by
`calendar-status-i18n.test.ts`. Tenancy: the event is written to
`invite.workspaceId`'s connection only.

End-to-end coverage (real routes, stubbed Google edge):
`app/api/schedule/calendar-writeback.test.ts`.

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
| Google edge | `app/_lib/calendar/google-calendar.ts` | `fetchBusy`, `isCalendarConnected`, and the event verbs `createInterviewEvent` / `updateInterviewEvent` / `deleteInterviewEvent` |
| Event write-back | `app/_lib/calendar/event-sync.ts` | `syncInterviewEvent` (create-or-update), `removeInterviewEvent` (delete). Best-effort, never throws |
| Join | `app/_lib/calendar/available-slots.ts` | `proposeFreeSlots` (offer-time filter), `slotStillFree` (booking-time re-check) |

## Data model

`schedule_invites` (`schedule-store.ts`): token, `entry_id`, `workspace_id`,
status (`pending` / `confirmed` / `declined` / `no_show`), `slot` + `slot_at`,
`duration_min`, `candidate_tz`, `attendance_status`, `reschedule_count`,
`meeting_url`, `proposals` + `proposal_status`, the operator flags
`needs_more_slots` / `needs_reconcile`, and the calendar write-back columns
`calendar_event_id` (the provider handle that makes the lifecycle idempotent),
`calendar_event_link`, `calendar_event_state`, `calendar_event_at`.

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
is served unchanged. Every booking then records `not_connected` and no event is written — the `.ics`
and "add to calendar" links remain the whole story, exactly as before the
integration. Scopes are deliberately narrow (`calendar.freebusy`,
`calendar.events`) — kp can learn *that* someone is busy, never *why*.

## 2026-08-10 — display-only calendar, future-events badge, AI-round prototype

- **Operators no longer adjust event times.** The week grid is a DISPLAY of
  where each interview sits: the click-a-cell re-propose affordance
  (`ScheduleCalendarCell` slot-picker) and the recruiter Reschedule picker in
  the invite lifecycle panel (`ScheduleInviteRecruiterControls`) were removed.
  Times are set by the candidate's self-scheduling link (`/schedule/[token]`,
  incl. their capped reschedules and proposals — accepting a proposal remains).
  The server's `reschedule` action still exists (the book path and proposal
  acceptance use the same machinery), but no operator UI drives it directly.
- **The Schedule nav badge now counts FUTURE confirmed events**
  (`countFutureConfirmedInvites` in `schedule-store.ts`, wired in
  `app/_lib/attention.ts`) — "how many interviews are on the calendar ahead of
  me", not the due-reminder queue.
- **The tab has a Human round / AI round switcher.** Human = the calendar
  surface described above. AI = the **"Docket"** (winner of the /prototype
  round): three stations — Awaiting link (Generate interview link mints +
  emails the tokenized `/interview/<token>` URL and copies it) → Link out /
  live → Completed, whose cards open the compact `ScheduleAiEvalPreview`
  (verdict + confidence + rubric dots) with the full transcript & scorecard
  modal one click deeper. Files: `ScheduleAiRound.tsx` + `ScheduleAiDocket.tsx`
  + `ScheduleAiEvalPreview.tsx`; fed by `GET /api/interview/sessions`
  (`listRecentInterviewSessions` in `db/interviews.ts`); copy in the
  `scheduleTab.rounds` / `scheduleTab.aiRound` catalogs (4-locale parity). The
  wider AI/Human/Hybrid mechanism design lives in
  `docs/concepts/interview-rounds.md`.

## Known gaps

- The slot pool is **host-blind**: `KP_INTERVIEW_TIMES` (default 10:00 + 14:00)
  is a single global pool, so collisions are workspace-wide rather than
  per-interviewer.
- Only Google is supported; there is no Microsoft 365 provider (the event-sync
  seam is provider-shaped so one can be added, but nothing Outlook-side exists).
- `POST /api/schedule` (the recruiter lifecycle actions — book, cancel, no-show,
  reschedule) is workspace-scoped but **not** operator-gated, unlike the invite
  routes. `getPipelineEntry`'s `workspaceId` parameter also still defaults to
  `DEFAULT_WORKSPACE_ID`, so an omission stays a silent fallback rather than a
  compile error; ~18 production call sites outside this feature still omit it.
- Write-back is **one-way**. Editing or deleting the event in Google does not
  flow back into kp; the next kp-side change re-creates it.
- An `orphaned` event is surfaced but there is no one-click retry — the recruiter
  removes the stale entry by hand.
- `sendUpdates` is deliberately unset, so Google sends no invitation mail of its
  own — the candidate is listed as an attendee, but only kp's own confirmation
  reaches them. Turning it on is a one-flag product decision, not an oversight.
- The calendar write is one synchronous outbound call on the confirm path (bounded
  by the 8s fetch abort). It sits *after* the booking commit and the confirmation
  dispatch, so it can only slow the response, never lose a booking — but it does
  add to the candidate's confirm latency. A background queue is the follow-up.
- The recruiter-side reschedule / accept-proposal **writes** do not re-check
  free/busy at confirm time the way the candidate confirm does — the recruiter is
  assumed to be looking at their own calendar. (Their offered list *is* filtered.)
