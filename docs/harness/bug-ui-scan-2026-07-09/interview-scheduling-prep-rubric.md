# Interview Scheduling, Prep & Rubric — bug-hunter + ui-perfectionist scan

> Context: Send self-scheduling invites, pick slots across timezones, generate interview prep packs and rubrics, and track invite lifecycle and reminders.
> Files reviewed: 18 of 38
> Total: 5

## 1. Auth gate serves the bulk-invite route as a public candidate endpoint

- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: trust-boundary / auth-bypass
- **File**: `proxy.ts:33` (route: `app/api/schedule/invite/bulk/route.ts`)
- **Scenario**: With the operator gate ENFORCED (`KP_OPERATOR_PASSWORD` set, or fail-closed prod), an unauthenticated attacker POSTs `{ "entryIds": [...] }` to `/api/schedule/invite/bulk`. No session cookie. It succeeds — minting up to 100 scheduling tokens per call (10 calls/min via the per-IP limit) and firing a real candidate email per entry.
- **Root cause**: `isPublic()` classifies candidate schedule-token routes as public with `p.startsWith("/api/schedule/") && p !== "/api/schedule/invite"`. The exclusion is an EXACT-string match against the parent route only; the child path `/api/schedule/invite/bulk` starts with `/api/schedule/` and is `!== "/api/schedule/invite"`, so the guard returns `true` and the proxy waves it through with no `verifySessionEdge`. The single `/api/schedule/invite` is correctly gated — its new `/bulk` sibling inherited none of that protection. The bulk route itself has zero auth check (only a rate limit).
- **Impact**: Security breach. Unauthenticated cohort invite-minting + candidate-email dispatch (comms-provider abuse / spam), pipeline-entry-ID probing (`getPipelineEntry` per id, distinguishing valid ids by outcome), and minting working public `/schedule/<token>` pages that expose `candidateLabel`/`jobTitle`.
- **Fix sketch**: Exclude the whole invite subtree, not one literal: `p.startsWith("/api/schedule/") && !(p === "/api/schedule/invite" || p.startsWith("/api/schedule/invite/"))`. Better: invert the model — publish an explicit public token-route allow-list (`/api/schedule/{token}`) instead of "everything under /api/schedule/ except one string", so a new recruiter sub-route defaults to gated.

## 2. Bulk (and single) invite mint has no one-active-invite-per-entry guard

- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-corruption / idempotency-gap
- **File**: `app/_lib/schedule-store.ts:192-226` (callers: `app/api/schedule/invite/bulk/route.ts:36-68`)
- **Scenario**: A recruiter bulk-invites a cohort that overlaps candidates already invited (the bulk path exists precisely so they don't hand-check each one). `coerceBulkEntryIds` dedupes only WITHIN one request, so re-including an entry — or a second bulk/single call — mints another live token for the same `entry_id`.
- **Root cause**: `createScheduleInvite` unconditionally `INSERT`s a new row; nothing reconciles against an existing pending/confirmed invite for that entry. Each token is independently confirmable, and `bookedSlots()`/collision is keyed on `slot_at`, not on the entry — so one candidate can confirm two different slots on two tokens.
- **Impact**: The same candidate occupies two slots in the scarce global pool, `actOnPipelineEntry(id, "approve_event")` runs twice, the reminder sweep sends two "see you at your interview" emails, and the lifecycle agenda shows two upcoming rows for one person.
- **Fix sketch**: Before insert, look up an existing non-terminal invite for `entry_id`; return/refresh it instead of minting a duplicate (or add a partial unique index on `(entry_id)` where `status IN ('pending','confirmed')`). Makes "invite this cohort" idempotent regardless of overlap.

## 3. Confirmed interviews vanish from the lifecycle panel the moment their start passes

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing-ui-state
- **File**: `app/features/sub_schedule/InviteLifecyclePanel.tsx:78-83`
- **Scenario**: It's 10:05 and a candidate is confirmed for 10:00 (in progress, or just finished and needing a no-show/next-step follow-up). The recruiter opens the Schedule tab.
- **Root cause**: `upcoming` requires `Date.parse(i.slotAt) >= loadedAt`, so any confirmed slot at-or-before "now" is filtered out. It also can't land in `awaiting` (that bucket is `status !== "confirmed"`) or `attention` (only flagged rows). There is no "today / in-progress / completed" bucket — a confirmed interview simply disappears from the entire panel once its instant passes.
- **Impact**: The recruiter loses sight of the interview they are about to run and of just-completed ones (attendance/no-show, meeting link, add-to-calendar) exactly when they matter; the data is still in the DB but has no surface. `>=` also means a slot equal to `loadedAt` flickers based on load timing.
- **Fix sketch**: Add a "Today / recent" bucket for confirmed slots within, say, the last few hours (or `slotAt + durationMin >= now`), keeping the in-progress and just-past rows visible with their RSVP/no-show state, rather than hiding on a strict future-only comparison.

## 4. Add-to-calendar & meeting-link popovers lack menu semantics, Escape-to-close, and trap the first outside click

- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / component-architecture
- **File**: `app/features/sub_schedule/AddToCalendar.tsx:44-73` (same pattern: `app/features/sub_schedule/MeetingLinkCell.tsx:69-102`)
- **Scenario**: A keyboard/screen-reader recruiter opens "Add to calendar ▾" on an agenda row, then wants to dismiss it or reach another control.
- **Root cause**: The trigger sets `aria-expanded` but no `aria-haspopup`; the panel is a plain `<div>` with no `role="menu"`/`menuitem`, so AT announces loose links/buttons, not a menu. There is no Escape handler and no focus management (focus stays on the trigger; nothing returns focus on close). The dismissal mechanism is a `fixed inset-0 z-40` invisible `<button>` covering the whole viewport — so a mouse user's first click anywhere else only closes the menu instead of activating the thing they clicked (a two-click trap), and there are two near-identical hand-rolled copies of this popover.
- **Impact**: Degraded, non-standard keyboard/AT interaction on a repeated control, plus the "click elsewhere eats my click" surprise for everyone.
- **Fix sketch**: Extract one shared `Popover`/menu primitive: `role="menu"` + `aria-haspopup`, Escape-to-close, focus-return, and outside-click via a document listener (or `onBlur` within a relative container) instead of a viewport-blanket button that swallows the next click.

## 5. Candidate .ics and recruiter .ics for the same interview block different lengths and locations

- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case / consistency
- **File**: `app/schedule/[token]/SchedulePicker.tsx:158-169` vs `app/_lib/calendar-links.ts:66,94`
- **Scenario**: An invite was minted with no planned length (`plannedInterviewMinutes` returned null, so `durationMin` is null). The candidate adds the event from their booked card; the recruiter adds it from the agenda.
- **Root cause**: The two "add to calendar" builders are independent and disagree on defaults. SchedulePicker builds its event inline with `invite.durationMin ?? 30` and `location: meetingUrl ?? undefined`; `interviewCalendarEvent` (recruiter side) uses `DEFAULT_DURATION_MIN = 45` and `location: meetingUrl ?? "Online interview"`. Same interview, two source-of-truth event shapes.
- **Impact**: When duration is unknown, the candidate's calendar blocks 30 min while the recruiter's blocks 45 for the same slot; the location text differs too — a small but avoidable "our calendars don't match" discrepancy on the highest-stakes artifact (the slot on the calendar).
- **Fix sketch**: Have SchedulePicker call `interviewCalendarEvent(...)` (or share one `DEFAULT_DURATION_MIN` constant and location fallback) so both sides derive identical duration/location from one place.
