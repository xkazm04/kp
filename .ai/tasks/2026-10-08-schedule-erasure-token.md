# Schedule erasure: revoke the token, refuse at the door

**Must-address (candidate-self-scheduling full r1, run bb1defa7, head c6a7cc8d):**
1. "robustness: Erased candidate's schedule token stays live: GET 200, POST can
   book/withdraw/propose." 2. "craft: Unparseable created_at throws RangeError on the public
   status path." 3. "economics is unmeasured" (measurement gap, not code; see Questions).

**How line 1 is met** (`app/_lib/db/pipeline.ts`, schedule_invites block, same synchronous
transaction): every invite row of the erased entry gets
`token = 'erased-' || lower(hex(randomblob(16)))` — still a non-null unique string (the
recruiter Schedule UI and calendar sync key on it) but never sent or shown as a link, so the
old URL resolves to nothing. `meeting_url` is nulled. No status is invented: the row keeps
`pending`/`confirmed` as the retained record (the candidate declined nothing; `expired` is
derived). Instead `dueReminders` (`schedule-store.ts`) excludes rows whose entry is
anonymized, so the sweep never acts on them. Defence in depth: `api/schedule/[token]/route.ts`
answers GET and every POST (book, withdraw, propose, RSVP) with `SCHEDULE_LINK_NOT_FOUND`/404
when the linked entry has `anonymizedAt`. No outbound call was added to the erasure.

**Line 2:** `candidate-next-action.ts` emits `expiresAt: null` when the expiry anchor is NaN.
`candidate-timeline.ts` has the same shape but is unreachable (`isScheduleInviteExpired` is
false for NaN), so it was left alone.

**Also:** `createScheduleInvite` reads and inserts under one `.immediate()` transaction
(craft-4); the expiry docblock now sits on `isScheduleInviteExpired` and
`parseInterviewTimes` has its own back (craft-2).

**Tests:** `app/_lib/schedule-erasure.test.ts` (new, through the token route),
`erasure-full-scrub.test.ts`, `candidate-next-action.test.ts`, `schedule-store.test.ts`.

**Questions left open:** a confirmed invite's Google Calendar event survives the erasure
(it carries the candidate's address as attendee); only an outbound delete can remove it, which
the synchronous erasure must not make. robustness-3 (route-level proposal clock test) not done:
reaching the propose door needs a fully booked horizon. Outbound calls on this path: Google
free/busy reads (GET picker, propose, slotStillFree at booking), Google event create/update/
delete per booking, reschedule, withdraw or RSVP cancel, and the confirmation + interviewer
brief + reminder emails via the comms relay.
