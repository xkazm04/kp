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

**The candidate surface never removes the thing it just told you to use.** Two
rules make that hold, and both were once broken:

- `useScheduleInvite`'s `error` carries a *load* failure and an *action* failure
  alike, so `SchedulePicker` may only give it the whole surface in the first case
  — where `invite` is null and there is nothing behind it anyway. Every other
  error renders as a banner **above** the live state, because the message is
  always an instruction (*"that time was just taken — please pick another"*,
  *"please add at least one time"*) whose target is the view it would otherwise
  have replaced. Nothing clears `error` except the next action, and every action
  lives in that view, so replacing it made the page reload-only.
- After a self-reschedule the client re-reads **both** allowance flags from the
  GET. Spending the last reschedule flips `canReschedule` off and
  `rescheduleCapReached` on in the same response; refreshing only the first left
  the booked card with neither the "change time" button nor the propose
  escalation the POST's `stuckCapped` branch would have accepted.

Pinned by `app/schedule/[token]/schedule-picker-recovery.test.ts` (source-level —
the repo's unit runner has no component renderer; same idiom as
`app/api/status/status-rate-limit.test.ts`).

## Flows

1. **Mint.** `POST /api/schedule/invite` creates a `schedule_invites` row with
   `durationMin = plannedInterviewMinutes(entry)` and mails the link.
   `POST /api/schedule/invite/bulk` does the same for a cohort (deduped by
   `app/_lib/bulk-invite.ts`), with per-entry isolation — one bad/terminal/
   comms-failed entry never aborts the batch and the response reports each
   outcome. Only the first `BULK_INVITE_CAP` = 100 entries are processed; the
   **overflow is returned as explicit per-entry refusals** (`ok:false`, an
   error naming the cap) plus a `capped` count, so a cohort larger than the cap
   is never silently truncated into a green "N invited". Each processed entry
   carries the REC-10 three-state `delivery` (`sent` only on a relayed 2xx,
   `queued` when the local Outbox is terminal, `failed` on a dead-letter), and
   `delivered` aggregates only the relay-confirmed ones — `sent` remains the
   count of links MINTED. Both routes are `requireOperator`-gated,
   workspace-scoped, and refuse a **closed-out** entry (`status !== "active"`;
   Hired keeps `active`) — single with a 409, bulk with a per-entry
   `"not active"` — so a rejected candidate is never mailed an interview link
   they could not use.
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
   same store primitives. The two actions that CONFIRM a booking — `book` and
   `accept_proposal` — apply the same closed-out guard as the invite routes and
   the candidate token route (409 on a linked entry whose `status !== "active"`),
   because both consume the slot in the shared pool and write a calendar event;
   their recruiter-side entry lists are client snapshots, so a stale tab could
   otherwise book a candidate rejected in another tab.
   `GET /api/schedule?slots=1` serves the reschedule picker's offered times.
5. **Escalate.** A fully-booked horizon or an exhausted reschedule cap lets the
   candidate propose their own times (`validateProposedSlots`), which the
   recruiter accepts or declines. The POST's "are you actually stuck?" guard
   reads the horizon through the **same** `proposeFreeSlots` call the GET
   renders from (kp bookings *and* the connected calendar, at the invite's real
   `durationMin`) — a horizon emptied by the calendar rather than by kp used to
   be offered the escalation by the GET and then refused by the POST with
   "there are still open times", over an empty picker.

### Link lifecycle — the TTL, and what re-arms it

An invite's stored statuses are `pending` / `confirmed` / `declined` / `no_show`;
**`expired` is derived, never stored** — `isScheduleInviteExpired`
(`schedule-slots.ts`) calls a `pending` invite dead once it has sat un-booked
longer than `INVITE_LINK_TTL_DAYS` (7, the same clock as the voice-interview
link). It is the one derivation the token route's 410 gate, the recruiter
lifecycle panel's `closed` bucket and `createScheduleInvite`'s re-invite reuse
all read, so they cannot drift.

The TTL is anchored on **when the link last became an un-booked capability**,
which is not always `created_at`. `cancelAttendance` — the candidate's "I can't
make it" RSVP *and* the recruiter's `cancel` action, which reuses it —
deliberately returns a **confirmed** invite to `pending` so the same link can
pick a new time. On the 21-day horizon that cancel routinely lands more than 7
days after the mint, and anchoring on `created_at` alone killed the link at the
exact moment it re-opened: the candidate was told "your booking is released —
pick a new time", the next GET answered `closed: "expired"` over an empty grid,
and every re-book POST got a 410. A cancel-reopened invite therefore restarts
the TTL from its `attendance_at` stamp; the re-opened link still ages out, on
its own clock. Every (re-)booking clears `attendance_status`, so the marker
lives exactly as long as the re-opened window. Pinned by
`schedule-slots.test.ts` (pure) and `schedule-store.test.ts` (behavioural: the
cancel leaves a live capability *and* a re-invite reuses that token instead of
stacking a second one).

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
| `unavailable` | A calendar **is** connected but the lookup produced no answer (outage, revoked grant, per-calendar error, a stored token that no longer decrypts) | `fetchBusy` returned `null` while connected |

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

**Both writers re-check, on the same rule.** `slotStillFree` runs on the
candidate confirm (`app/api/schedule/[token]/route.ts`) *and* on the recruiter's
week-grid book (`POST /api/schedule {action:"book"}`), which refuses a definite
conflict with `SCHEDULE_CALENDAR_BUSY` (409). Until then a candidate could not
book an hour the interviewer's calendar shows busy while a recruiter could, from
the other side of the same app, for the same interviewer. The degradation
contract is identical on both sides — no calendar connected, or a failed lookup,
books exactly as it did before the integration — and there is **no override
affordance**: a recruiter who wants the hour clears it on their own calendar.
The one exception is an entry's own confirmed instant: kp writes a real event for
each booking, so re-confirming the same cell would otherwise be refused by kp's
own event. The recruiter-side *reschedule* and *accept-proposal* writes still do
not re-check (their offered lists are filtered). Pinned by
`app/api/schedule/schedule-book-refusals.test.ts` against the same Google double
`calendar-conflict.test.ts` uses.

A longer conflict window legitimately removes more slots, so a fully-conflicted
horizon reaches the existing `noSlots` escalation more often — that path is
unchanged and covered by `app/api/schedule/calendar-conflict.test.ts` (which also
pins the 90-minute span, the confirm-time refusal, both unknown paths, and a null
`durationMin`).

**What each audience sees.** The recruiter's `GET /api/schedule?slots=1`
response carries all three states plus `droppedForConflict` ("N times hidden as
busy") — an unexplained short list otherwise reads as a broken feature rather
than a busy week. `droppedForConflict` counts only what the *offer* lost, never
what the over-fetched pool lost: `proposeFreeSlots` asks `proposeSlots` for
`count * OVERFETCH` candidates so a busy week still yields a full list, so a
clash at candidate #20 costs a caller showing six slots nothing at all
(`droppedFromOffer` in `free-busy.ts`, pinned by `free-busy.test.ts`). It is
zero whenever the returned list is full. The candidate page gets **one bit
only** — "free on the interviewer's calendar" vs "not confirmed against it,
we'll confirm by email". `calendarStatus` and `droppedForConflict` are
statements about the *interviewer's* calendar and stay off the public token
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

The chip is kept honest across an in-place edit too: `MeetingLinkCell` hands the
**whole re-read invite** from the meeting-link PATCH up to the panel's
`updateInvite`, not just the saved URL. That PATCH refreshes the calendar event
(the link is its location) *before* re-reading, so the response can carry a
changed `calendarEventState` — adopting only `meetingUrl` left the row asserting
`written` for a refresh that had just failed, until the next full load.

End-to-end coverage (real routes, stubbed Google edge):
`app/api/schedule/calendar-writeback.test.ts`.

## What the week grid says about a time

The recruiter grid (`app/features/hiring/schedule/ScheduleCalendar.tsx`) renders
wall-clock cells in the interview zone. Three things it now states, and used to
leave to inference:

- **Which zone.** A note under the pager reads "All times in the interview
  timezone: Europe/Prague (GMT+2)". `INTERVIEW_TZ` is a *server* value
  (`KP_INTERVIEW_TZ`), so `GET /api/schedule` returns it as `interviewTz` rather
  than letting a client bundle guess — a bundle reading `process.env` would
  silently report the `Europe/Prague` default on an install configured otherwise,
  which is worse than saying nothing. The short label (`GMT+2`) is derived from a
  real instant in the visible week, so it is DST-correct.
- **Whether the time is agreed.** A cell is seeded from a **confirmed invite**,
  else the legacy free-text `approvalDetail`, else a flat `Tue 14:00` guess — and
  all three used to render identically. The provenance now rides with the pick
  (`scheduleGridSeeds.ts`, pinned by `scheduleGridSeeds.test.ts`): a booked slot
  shows a "confirmed" chip in the pending list and a solid grid chip; a guess
  shows a "suggested" chip and a dashed grid chip whose tooltip says it is not
  confirmed. Absence of provenance reads as *suggested*, never as booked.
- **Where the candidate is.** `candidate_tz`, captured at confirm time and until
  now rendered only on the agenda row, appears on the pending card, so "14:00" can
  be read against the candidate's own night.

Two mechanical notes on the same surface: the derived lists in `useScheduleTab.ts`
are memoized on `entries` and `ScheduleCalendar` is wrapped in `memo`, so the
6-second interview-status poll no longer re-renders the whole week grid with
byte-identical data (the lists were rebuilt per render, so the memos below them
could never hit); and the week pager's prev/next buttons are 44x44 rather than
32x32.

## What the recruiter is told when a booking is refused

`POST /api/schedule {action:"book"}` — the week grid's Confirm — answers every
refusal with a **code**, through `jsonRefusal` (`app/_lib/api-response.ts`):

| Code | Status | Means |
| --- | --- | --- |
| `SCHEDULE_SLOT_TAKEN` | 409 | The hour is spoken for (a self-booking, or an accepted off-hour proposal inside it) |
| `SCHEDULE_CANDIDATE_INACTIVE` | 409 | The linked entry is closed out — the grid's entry list is a client-side snapshot |
| `SCHEDULE_BOOK_FAILED` | 409 | The collision-checked transaction refused for another reason; nothing was written |
| `SCHEDULE_SLOT_UNRESOLVED` | 400 | The submitted cell did not resolve to an instant |
| `SCHEDULE_CALENDAR_BUSY` | 409 | The interviewer's connected calendar shows that hour busy (see the free/busy section) |
| `PIPELINE_ENTRY_NOT_FOUND` | 404 | The entry is not on this board (the board's own code, reused) |

The Schedule tab keeps the code and resolves it through `useErrorMessage()`, so
each refusal reads in the operator's own language. It renders **inline, under the
card whose action failed** (`actionError` in `useScheduleTab.ts`, painted by
`ScheduleTabPendingList.tsx`) rather than in the tab-level banner above the grid:
a refusal is about one candidate and names the next action ("pick another"), so it
belongs beside that candidate and must stay on screen while the recruiter takes
it. Before this, all four refusals painted the LOAD banner's `loadFailed` copy —
"Failed to load." — on an action that loaded nothing, and a failed decline set no
error at all. A decline that fails now says so on the card, with the board's own
`PIPELINE_*` code.

Pinned by `app/api/schedule/schedule-book-refusals.test.ts`, which drives the real
handler and also asserts that every code the route emits has an `errors.<CODE>`
entry in all four catalogs — a code with no catalog entry silently degrades back
to the generic fallback.

## API / lib surface

| Surface | File | Notes |
| --- | --- | --- |
| Candidate read/book | `app/api/schedule/[token]/route.ts` | Public token route; `publicInviteView` is the leak boundary |
| Recruiter lifecycle + actions | `app/api/schedule/route.ts` | Workspace-authenticated; `?slots=1` serves reschedule times; the plain GET also returns `interviewTz` |
| Invite minting | `app/api/schedule/invite/route.ts` | Operator-gated + workspace-scoped |
| Bulk invite minting | `app/api/schedule/invite/bulk/route.ts` | Same gate; per-entry isolation, `BULK_INVITE_CAP` = 100 (overflow reported, not dropped), per-entry `delivery` |
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
- **The round switcher is plan-aware** (Settings → Hiring, `interviewPlan`):
  only the rounds the workspace plan runs are offered (a single-surface plan
  renders that surface with no switcher), the plan's first round is the default
  view, and a human-only plan hides the "Start AI interview" launcher on
  pending cards. Best-effort config read — a fetch failure shows both surfaces.
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
  - **A `failed` session lands back in "Awaiting link".** `/api/interview/complete`
    downgrades a silent-mic call to `failed` so it is never scored, and
    `revokeOpenInterviewSessions` treats a failed row as reissuable — so
    `ScheduleAiRound` counts `revoked` *and* `failed` as dead ends (and ignores a
    failed call's interviewer-only transcript). Without that, such a candidate
    matched none of the three stations and vanished from the docket with no card
    to reissue from.
  - The preview's rubric dots run through the same guards as the full modal:
    `cleanRating` (a null/out-of-range stored rating reads "not assessed", never
    five empty dots) and `rubricLabel` (PREP3 — competency names in the reader's
    language, not canonical English).
- **The human interviewer scorecard (PREP1)** is filled in the prep modal
  (`ScheduleHumanScorecardPanel.tsx` → `POST /api/interview-prep/scorecard`) on
  the archetype+role-family rubric. The save carries forward any stored rating
  whose competency is **not** in today's rubric — the write path keeps and flags
  those off-rubric rather than dropping them, so the form must post them back —
  and the "N of M rated" counter counts only competencies the current rubric
  actually renders.

## Known gaps

- **The prep checklist is keyed positionally.** `RunOfShow` / `SignalsToConfirm`
  mint `c-<i>` / `k-<i>` and `useScheduleInterviewPrep` counts the same keys, so a
  Regenerate — which rebuilds the chronology and carries `userProgress` forward —
  re-points the interviewer's ticks at whatever topic now sits at that index. The
  fix is a stable per-topic identity (the PUT caps a key at 64 chars), minted and
  counted in one change across both render files and the hook.
- **The human scorecard is served with no consent gate.** `GET /api/interview-prep`
  returns the stored `humanScorecard` (recruiter evidence quoting the candidate)
  verbatim, while `GET /api/interview/by-entry` redacts the AI half through
  `consentWithholdsPii`. Neither `HumanScorecardSection` nor the prep modal can
  tell "withheld" from "absent" — the payload carries no flag — so a lapsed-consent
  record renders in full, and the AI half's redaction reads as an empty state.
- **The bulk bar still counts minted links, not deliveries.** The route now
  returns a per-entry `delivery` and a `delivered` aggregate, but
  `usePipelineBulk.bulkInvite` counts `results[].ok` (minted) and
  `PipelineBulkActionBar` picks its copy from the relay CAPABILITY
  (`bulkInvited` vs `bulkInvitedQueued`). With a relay configured and the
  webhook dead-lettering, the bar therefore still reads "N invited to
  schedule". The remaining edit is client-side: count `delivery === "sent"`
  and fall back to the queued copy otherwise.
- **`/api/interview-prep` is keyed by entry id with no workspace check.** `GET
  ?entry=`, `POST`, `PATCH` and `POST /api/interview-prep/scorecard` all reach
  `getInterviewPrep` / `saveHumanScorecard`, which are by-`entry_id` point ops.
  `interview_preps` is a deliberate by-id exemption in `app/_lib/tenancy.ts`
  (pinned by `app/_lib/interview-prep-tenancy.test.ts`), so a foreign id
  resolves to the right row rather than the wrong one — but nothing refuses it,
  so an operator holding another team's entry id can read that team's prep
  notes + human scorecard and overwrite the scorecard. Closing it means a
  `getPipelineEntry(entry, ws)` gate on all four handlers, which reverses the
  manifest exemption for this table.
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
  free/busy at confirm time the way the candidate confirm and the week-grid book
  do — the recruiter is assumed to be looking at their own calendar. (Their
  offered list *is* filtered.)
- **A first booking hides the "change time" button until the page is reloaded.**
  The GET on a *pending* invite necessarily answers `canReschedule: false`, and
  the first-confirm POST response carries no allowance flags, so the booked card
  that swaps in has no reschedule affordance even though the server would accept
  one (`rescheduleCount` 0 < `MAX_RESCHEDULES`). Only the reschedule path
  refreshes. The clean fix is to put `canReschedule` / `rescheduleCapReached` on
  the POST response next to `confirmationDelivery`; doing it client-side costs an
  extra free/busy-hitting GET on every booking.
- **The propose form does not say which zone its working-hours window is in.**
  The `datetime-local` inputs are the candidate's *browser* wall clock, but
  `PROPOSAL_HOURS` (08:00–18:00) is fenced in `KP_INTERVIEW_TZ`, so a New York
  candidate proposing 14:00 is refused with "future weekday times during working
  hours" for a time that is squarely in their working day. `SlotPicker` names the
  zone for the offered grid (`schedule.timezoneNote`); the escalation form has no
  equivalent, and adding one needs a new 4-locale key — plus a product call on
  whether to fence the window in the interview zone at all.
