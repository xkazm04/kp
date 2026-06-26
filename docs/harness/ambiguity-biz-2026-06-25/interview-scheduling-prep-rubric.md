# Interview Scheduling, Prep & Rubric — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C1/H2/M2/L0

## 1. The whole company shares one global pool of 2 fixed slots/day — the assigned interviewer is ignored
- **Lens**: 🚀 Business
- **Severity**: Critical
- **Category**: scheduling-capacity / competitive-gap
- **File**: app/_lib/schedule-slots.ts:18 (and app/_lib/schedule-store.ts:366)
- **Observation**: Offered times are hardcoded `TIMES = ["10:00", "14:00"]` (two/day, business days, anchored to one fixed `INTERVIEW_TZ`). Collision identity is the global ISO `slot_at` (`bookedSlots()` selects across the *entire* `schedule_invites` table — schedule-store.ts:366-371), with no `entry_id`/`job_id`/interviewer dimension. So once Candidate A (job X, interviewer Alice) books Mon 10:00, Candidate B (job Y, interviewer Bob) is refused Mon 10:00 even though Bob is free — and the assigned interviewer captured in PREP5 (`interview-prep.ts:87`) is never consulted by the slot logic at all. There is no availability model, no per-interviewer calendar, and no check against any external (Google/Outlook) calendar for real conflicts. Net throughput ceiling: **2 interviews/day across the whole org.**
- **Why it matters**: This directly caps the product's core promise and is undermined by adjacent features that assume scale — there is already a bulk cohort-invite path "for high-volume hiring" (`app/api/schedule/invite/bulk/route.ts:13`) that can mint 50 invites that all contend for the same 2 daily slots. Calendly/GoodTime's entire value is per-host availability + real-calendar conflict avoidance; kp offers neither. A recruiter can double-book an interviewer's real calendar with zero warning.
- **Recommendation**: Introduce a per-interviewer (or per-job) availability model: configurable working windows + a `host` dimension on slot-collision so two free hosts can hold the same wall-clock time. Phase 1 (low effort): make `TIMES` config-driven and scope `bookedSlots()` by host/job. Phase 2: optional Google/Outlook free-busy sync to suppress conflicted slots.
- **Effort**: L

## 2. Assigned interviewer gets nothing — no prep pack, no calendar hold, no reminder
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: dark-capability / workflow-gap
- **File**: app/_lib/interview-prep.ts:87 (PREP5 interviewer); app/_lib/comms-dispatch.ts:250-324
- **Observation**: The recruiter assigns an `interviewer` (free-text) and generates a rich, archetype-correct prep pack + BARS rubric, but that interviewer is only ever *displayed* on a schedule card (grep confirms the field has no other consumer). `comms-dispatch.ts` has dispatchers for the candidate's invite, confirmation, and reminder — but **none targeting the interviewer**. The interviewer who actually runs the round receives no `.ics` calendar hold, no prep guide, and no reminder. The only sharing path is the manual `copyPrep()` clipboard dump (`InterviewPrepModal.tsx:170`) the recruiter must paste into an email out-of-band.
- **Why it matters**: The most valuable artifact in the context (timed run-of-show + rubric) never reaches the person who needs it, and the actual interviewer can no-show because nothing landed on their calendar. All the plumbing already exists — `buildIcs()` (used for the candidate at `SchedulePicker.tsx:138`) and the comms channel — so this is value left on the table, not new infrastructure.
- **Recommendation**: Change `interviewer` from a free-text name to a name+email, add `dispatchInterviewerBrief()` that emails the prep pack + an `.ics` hold for the confirmed slot, and include the interviewer in the reminder sweep.
- **Effort**: M

## 3. "Across timezones" really means Prague-wall-clock for everyone — remote candidates are offered 4 a.m.
- **Lens**: 🌀 Ambiguity
- **Severity**: High
- **Category**: hidden-tradeoff / cross-tz-correctness
- **File**: app/_lib/schedule-slots.ts:18,22-30
- **Observation**: The offered hours are anchored to a single `INTERVIEW_TZ` (default `Europe/Prague`), and the picker renders them in the candidate's browser zone with a zone label (`SchedulePicker.tsx:36`). A comment defers "showing both zones" as "a separate UI follow-up" (schedule-slots.ts:29) — but the deeper, undocumented trade-off is that the *times themselves* are not candidate-aware: 10:00/14:00 Prague (summer) resolve to **04:00 / 08:00 for a US-East candidate**. The candidate is shown those local times with no explanation that they are fixed Prague business hours and no candidate-business-hours alternative.
- **Why it matters**: The context gist explicitly promises "pick slots across timezones," yet the implementation offers unworkable hours to anyone outside Central Europe — a silent contradiction of the stated capability and a hard blocker for any international/remote hiring. The decision (Prague-only anchor) is recorded for `INTERVIEW_TZ` but the *consequence* for distant candidates is undocumented and unhandled.
- **Why it matters / Recommendation**: Document the single-anchor trade-off explicitly, and either (a) widen `TIMES` to span enough hours that some land in the candidate's working day, or (b) derive candidate-friendly slots from the captured `candidate_tz`. At minimum, label the picker "All times shown in your zone; interviews are held during CET business hours."
- **Effort**: M

## 4. No defined no-show / actual-attendance outcome — the loop is happy-path only
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: happy-path-only / undocumented-outcome
- **File**: app/_lib/schedule-store.ts:307-339 (RSVP); app/features/sub_schedule/InviteLifecyclePanel.tsx:118-123
- **Observation**: The RSVP flow captures the candidate's *intent* ("I'll be there" → `attendance_status='confirmed'`, surfaced as a positive chip) but there is no path to record what actually happened. A grep for no-show/absence handling across `app`, `pipeline` finds nothing. After the reminder fires, a candidate who RSVP-confirmed and then doesn't appear leaves the invite parked at `attendance_status='confirmed'` forever; the recruiter has no "mark no-show" affordance and there is no recorded reasoning for what the next step should be.
- **Why it matters**: No-show management is a core recruiting-ops pain point, and here it is simply undefined — the system optimistically treats an RSVP as attendance. The data shape (`attendance_status`, `attendance_at`) already exists but encodes only the candidate's promise, not reality, so downstream metrics (and any future automation) can't distinguish "attended" from "ghosted."
- **Recommendation**: Add a terminal `attended | no_show` outcome the recruiter sets post-interview (or that's inferred when no scorecard lands within N hours of the slot), and document the intended no-show follow-up (auto-reopen invite vs. flag for human).
- **Effort**: M

## 5. Scheduling funnel + no-show-rate data is captured but never aggregated
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark-capability / retention-metric
- **File**: app/_lib/schedule-store.ts:204-213 (listScheduleInvites); app/api/schedule/route.ts:13
- **Observation**: Every signal needed for a scheduling-health dashboard is persisted per invite — `created_at`, `confirmed_at`, `attendance_status`, `reminder_sent_at`, `needs_more_slots`, `reschedule_count` — but the only reader is `listScheduleInvites()`, a flat per-row agenda rendered by `InviteLifecyclePanel`. There is no aggregate surface for invite→book conversion, median time-to-schedule, slot utilization, reschedule rate, or no-show rate (grep for funnel/utilization/no-show-rate metrics finds only pipeline-stage analytics, nothing scheduling-specific).
- **Why it matters**: For a recruiting SaaS these are exactly the operational KPIs buyers evaluate and recruiters live by; surfacing them is a low-cost retention/expansion lever and a competitive talking point against Calendly/GoodTime, which lead with such analytics. The expensive part (data capture) is already done.
- **Recommendation**: Add a small aggregate endpoint + card: invites sent / booked / attended, conversion %, median time-to-book, and reschedule/no-show rates over a window — sourced from the existing columns.
- **Effort**: M
