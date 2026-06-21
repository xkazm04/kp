# Interview Scheduling, Prep & Rubric — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Server proposes/validates slots in SERVER-local time but candidate sees them in BROWSER-local time
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: Critical
- **Category**: Timezone correctness / scheduling
- **Value**: impact 9/10 · effort 5/10 · risk 4/10
- **File**: `app/_lib/schedule-slots.ts:54-57, 71-83` (+ `app/_lib/schedule-slots.test.ts:15-16`)
- **Scenario**: A recruiter on a Prague server (UTC+2) mints an invite. `proposeSlots()` builds the slot with `slot.setHours(h, m)` where `h ∈ {10,14}` — i.e. 10:00/14:00 **server-local**, then `.toISOString()`. A candidate in New York (UTC−4) opens the picker: `use-slot-label.ts` / `SchedulePicker` render that same instant via `Intl` in the *browser* zone, so the "10:00" slot displays as "04:00". The candidate either books a 4am call thinking it's 10am, or — if they manually craft a sensible local time — `offeredSlotFor()` rejects it because `slot.getHours()` (still server-local) must equal exactly 10 or 14.
- **Root cause**: Slot identity is an absolute instant anchored to the *server's* wall clock (`getHours`/`getDay` with no zone), but the entire candidate-facing display layer (`timezone.ts`, `use-slot-label.ts`) was deliberately built to render in the candidate's zone. The two halves were designed independently; nothing pins the offered hours to a recruiter/interview zone. The product is sold as "timezone-aware slot picking" yet the candidate can only ever book the recruiter's two fixed wall-clock times, shown shifted.
- **Impact**: Cross-timezone candidates see wrong/absurd times, book 3am calls, or get legitimate picks rejected as "not an offered slot." The headline scheduling feature is silently broken for any remote candidate — the exact audience self-scheduling exists to serve.
- **Fix sketch**: Anchor the offered hours to an explicit interview IANA zone (config or per-workspace), not the server clock. In `proposeSlots`/`offeredSlotFor` derive the wall-clock hour/day in that zone (e.g. `Intl.DateTimeFormat(undefined,{timeZone, hour})`), keeping `slot_at` an absolute instant. Show both zones in the picker ("10:00 your time / 16:00 interviewer time"). The existing `candidate_tz` capture then becomes display-meaningful.

## 2. Reminder window straddles a server restart / cold heartbeat → confirmed interviews get no reminder
- **Lens**: 🐛 Bug Hunter (primary)
- **Severity**: High
- **Category**: Reminder missed-fire / data loss
- **Value**: impact 7/10 · effort 4/10 · risk 4/10
- **File**: `app/_lib/interview-reminders.ts:25-35`; `app/_lib/schedule-store.ts:382-433`
- **Scenario**: The reminder sweep only runs on the ~60s instrumentation heartbeat and only ever fires once per invite (`reminder_sent_at` is terminal). If the heartbeat process is down (deploy, crash, serverless cold-start gap, scaling to zero) across the entire `REMINDER_LEAD_MS` (24h) window for a given slot, the interview's start passes out of `(now, now+lead]` while no tick observed it. When the heartbeat returns, `isReminderDue` returns false (slot is now in the past), so the candidate is **never reminded** — and nothing flags it.
- **Root cause**: "Due" is a point-in-time check evaluated only when a tick happens; there is no catch-up for a slot whose window opened and closed unobserved, and no terminal "missed" state distinct from "sent." A short serverless deployment gap is enough on Next.js hosting.
- **Impact**: Silent no-shows from missed reminders — the single most expensive failure in a scheduling product, and invisible (no `needs_reconcile`-style flag exists for "reminder window lapsed").
- **Fix sketch**: Treat a confirmed, un-reminded invite whose slot is now within a small past grace (e.g. slot in `[now−2h, now]`) as still due (send a "starting soon"), OR mark it `reminder_missed` and surface it in `InviteLifecyclePanel` attention rows so a human can chase it. Pair with a heartbeat-liveness assertion.

## 3. Recruiter calendar grid and candidate self-schedule use two unrelated slot systems
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: High
- **Category**: Data model / UX coherence
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **File**: `app/features/sub_schedule/ScheduleTypes.ts:15-20`; `app/features/sub_schedule/ScheduleCalendar.tsx:75-92`; vs `app/_lib/schedule-slots.ts:18`
- **Scenario**: The recruiter's `ScheduleCalendar` is a Mon–Fri × 08:00–17:00 hourly grid of free-text string slots (`"Tue 14:00"`, `DEFAULT_SLOT`), persisted as the entry's `approvalDetail`. The candidate self-schedule path offers only `["10:00","14:00"]` as ISO instants in `schedule_invites`. A recruiter who drags a candidate to "Wed 09:00" on the grid and a candidate who self-books are writing to two stores with two formats that never reconcile — the grid pick is a display label with no `slot_at`, no collision check against `bookedSlots()`, and no timezone.
- **Root cause**: The board calendar predates the tokenized self-schedule system; they were never unified. `bookedSlots()`/collision authority only guards the invite table, so a recruiter-grid assignment and a candidate self-book can double-book the same wall-clock time with no clash detected.
- **Impact**: Double-bookings between the two paths go undetected; the recruiter's "confirmed" grid slot and the candidate's real booked instant can disagree; timezone awareness is absent on the recruiter side entirely.
- **Fix sketch**: Make the recruiter grid write the same ISO `slot_at` identity (and go through `confirmScheduleInvite`/collision check) as the candidate path, or at minimum cross-check grid picks against `bookedSlots()` and render the candidate's confirmed `slot_at` on the grid so the two surfaces share one source of truth.

## 4. No reschedule-from-recruiter / no-show disposition closes the loop after a cancel
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Lifecycle dead-end
- **Value**: impact 6/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/schedule-store.ts:328-339` (`cancelAttendance`); `app/features/sub_schedule/InviteLifecyclePanel.tsx:133-155`
- **Scenario**: When a candidate taps "I can't make it," `cancelAttendance` frees the slot, returns the invite to `pending`, and the candidate falls back into the awaiting list with a "cancelled" chip. But the recruiter has no action there: no resend-link, no propose-specific-time, no "mark no-show," no "withdraw." A no-show after a confirmed booking has no disposition at all — the invite simply sits in `upcoming` forever (its `slot_at` is in the past so the upcoming filter eventually drops it, leaving it invisible). Reminders that exhaust `REMINDER_MAX_ATTEMPTS` also vanish with only a console log.
- **Root cause**: The lifecycle panel is read-only; the store has rich state (`attendance_status`, `reschedule_count`, `needs_reconcile`) but no recruiter-side write actions beyond minting. The journey ends at "cancelled — back to pending" with nobody driving the next step.
- **Impact**: Recruiters can't recover a cancelled/no-show candidate from the app — they drop to email/manual chase, which is exactly the triage self-scheduling promised to remove. Cancellations leak out of the funnel.
- **Fix sketch**: Add recruiter actions to `InviteLifecyclePanel` rows: "Resend invite," "Mark no-show" (terminal disposition + analytics), and a recruiter-initiated reschedule that reuses the token. Surface gave-up reminders (cap reached) as an attention row, not just a log line.

## 5. Booked confirmation surfaces the slot but never the timezone the candidate actually committed to
- **Lens**: 🚀 Business Visionary (primary)
- **Severity**: Medium
- **Category**: Confirmation clarity / no-show prevention
- **Value**: impact 5/10 · effort 3/10 · risk 2/10
- **File**: `app/schedule/[token]/SchedulePicker.tsx:222-228`; `app/api/schedule/[token]/route.ts:166-199`
- **Scenario**: After booking, the candidate sees the slot in their browser zone plus a soft "All times in (GMT+2)" note (degrades to nothing when `timeZoneShortLabel` returns ""). The .ics carries a correct UTC `DTSTART`, but the **confirmation email** (`dispatchInterviewConfirmation`, fed the server-minted English `slot` label) and the booked card never assert the absolute time both parties agreed on, nor "X hours from now." A candidate who booked while travelling (browser zone ≠ home zone) gets a label with no durable, unambiguous anchor — and the recruiter agenda shows the recruiter's local time with only a tiny `candidate_tz` tag.
- **Root cause**: Display is split across server label (email/feed), browser-local render (card), and an optional ICU short-zone note — none of which is a single unambiguous "this exact instant, in this named zone" statement that survives email clients and timezone moves.
- **Impact**: Timezone confusion is a top self-scheduling no-show cause; the confirmation doesn't fully disarm it, and the email (the part that persists) is the weakest.
- **Fix sketch**: Render the booked time with an explicit named zone on both the card and in `dispatchInterviewConfirmation` (e.g. "Thu 12 Jun, 16:00 CEST (your time)"), add a relative "in 2 days" line, and always emit the .ics in the confirmation so a calendar entry — not a parsed label — is the source of truth.
