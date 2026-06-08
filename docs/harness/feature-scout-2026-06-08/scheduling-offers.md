# Feature Scout — Scheduling & Offers (kp)

> Total: 6 opportunities (High: 3, Medium: 2, Low: 1)
> Files read: ~13

## 1. Attach a calendar invite (.ics) to interview confirmations
- **Value**: High
- **Category**: integration
- **Effort**: M
- **Where it slots in**: `app/_lib/comms-dispatch.ts:93` — `dispatchInterviewConfirmation` (and the reminder at `:127`); slot identity already exists as ISO in `app/_lib/schedule-store.ts:119` (`slotAt`) and the planned length at `durationMin`.
- **Gap**: The confirmation/reminder are plain-text bodies. Nothing in kp `app/` emits an `.ics`, an "Add to Google/Outlook calendar" link, or any structured event — the candidate has to hand-copy "Tue 10:00" into their own calendar. The data needed (ISO start `slotAt`, `durationMin`, role, company) is already captured at confirm time.
- **Opportunity**: Generate a minimal `VEVENT` (DTSTART from `slotAt`, DTEND = start + `durationMin`, SUMMARY = "Interview — {role}", a UID = the invite token for idempotent updates) and attach it to the confirmation, plus inline `calendar.google.com`/Outlook deep-links as a fallback.
- **Why it matters**: A confirmed interview that never lands on the candidate's calendar is the #1 cause of no-shows — the highest-leverage drop-off the whole scheduling flow exists to prevent.
- **Sketch**: New pure `app/_lib/ics.ts` (`buildVevent(slotAtIso, durationMin, summary, uid)`, fully unit-testable like `schedule-slots.ts`); pass its output as a `sendComm` attachment/part from `dispatchInterviewConfirmation`. Same UID lets a future reschedule emit an update, not a duplicate.

## 2. Candidate self-reschedule from the booked-confirmation page
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where it slots in**: `app/schedule/[token]/SchedulePicker.tsx:94` (the "You're booked" terminal card) and `app/api/schedule/[token]/route.ts:76` (POST short-circuits `confirmed` as idempotent).
- **Gap**: The confirmation copy promises "If you need to change the time, just reply and we'll sort it out" (`comms-dispatch.ts:109`), but there is no reschedule path — `schedule-store.ts` has no cancel/reschedule, and a `confirmed` invite is a dead end. The token works forever yet can never re-pick. "Just reply" routes into a no-reply outbox with no human on the other end.
- **Opportunity**: On the booked card, add "Need a different time?" that re-opens the picker. A reschedule re-runs `offeredSlotFor` validation, frees the old `slot_at` (so it returns to the pool via `bookedSlots`), books the new one, and re-dispatches confirmation (+ the .ics update from #1).
- **Why it matters**: Without it, every change request becomes manual recruiter triage — the exact friction self-scheduling was built to remove — and the promise in the email is currently a lie.
- **Sketch**: Add `rescheduleScheduleInvite(token, newSlotAt)` to schedule-store (transactional: collision-check new, clear old `slot_at`/`reminder_sent_at`, keep status `confirmed`). Surface a "change time" branch in the route's POST; gate by a small reschedule cap to avoid churn.

## 3. Offer expiry / response deadline
- **Value**: High
- **Category**: functionality
- **Effort**: S
- **Where it slots in**: `app/_lib/offers-store.ts:25` (the `offers` table — no expiry column) and the candidate view `app/_lib/offer-finalize.ts:78` (`offerView`).
- **Gap**: Offers never expire — the code comments at `offers-store.ts:46` and `offer-finalize.ts:64` explicitly note "tokens never expire" and treat that as a hazard to defend against, not a feature. The candidate page shows compensation with no "respond by" date, and a stale link stays live indefinitely.
- **Opportunity**: Add `expires_at` to the offer (default e.g. now + 7 days, recruiter-overridable). Show "Please respond by {date}" on `app/offer/[token]/page.tsx`. After expiry, GET renders an "offer expired — contact us" state and POST rejects accept/decline.
- **Why it matters**: A response deadline is standard offer practice; it creates urgency, lets the pipeline reclaim headcount when an offer lapses, and closes the "ancient link suddenly accepted" risk the codebase already worries about.
- **Sketch**: One column + `ALTER TABLE` migration (mirror the schedule-store migration loop at `schedule-store.ts:68`). Add an `expired` branch in `offerView` and a guard at the top of `respondToOffer`. Fold expiry into the markEntryStatus guard so a lapsed offer can auto-transition the entry.

## 4. Recruiter-set interview availability windows
- **Value**: Medium
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/_lib/schedule-slots.ts:18` — `TIMES = ["10:00","14:00"]` and `SLOT_HORIZON_DAYS = 21`, both hardcoded.
- **Gap**: Every candidate is offered the same two fixed times on weekdays for everyone. There's no way for a recruiter to set their own available windows, block out days, or vary slots per job — and the "all slots booked" stall (`needs_more_slots`, `schedule-store.ts:212`) can only be resolved by code, not by the recruiter opening more times.
- **Opportunity**: A lightweight availability config (per recruiter or per job): allowed weekdays, time-of-day windows, horizon. `proposeSlots`/`offeredSlotFor` read it instead of the constants, so opening more times is a UI action — which is exactly what the `needs_more_slots` flag already asks a human to do.
- **Why it matters**: Two fixed slots doesn't survive real recruiting volume; it's the structural cause of the fully-booked dead-end the system already detects but can't self-heal.
- **Sketch**: Add an `availability` row (JSON of windows) keyed by job/recruiter; thread it through the two pure functions in schedule-slots.ts (keep them pure — pass config in, preserving testability). A "Manage availability" panel writes it; resolving `needs_more_slots` becomes "widen the window."

## 5. Counter-offer / one message back to the recruiter
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where it slots in**: `app/offer/[token]/page.tsx:189` (the accept/decline buttons) and `app/_lib/offer-finalize.ts:14` (`respondToOffer` accepts only `accept`/`decline`).
- **Gap**: The offer page is strictly binary — accept or a terminal, irreversible decline. A candidate who'd accept at a higher number, a later start date, or who just has one question has no channel except declining outright. The recruiter never learns *why* a decline happened.
- **Opportunity**: Add a third path — "Respond with a question / request" — that captures a short free-text note + optional desired salary, sets the offer to a non-terminal `negotiating` state, and surfaces it to the recruiter (an automation event + the decisions feed). The recruiter can then re-extend a revised offer (the re-extend machinery already exists in `getOrCreateOpenOffer`).
- **Why it matters**: Turning a binary decline into a conversation directly recovers otherwise-lost hires — and gives the funnel real decline reasons instead of a silent close.
- **Sketch**: New `offers` status `negotiating` + a `candidate_note`/`requested_salary` column; a POST branch in `offer/[token]/route.ts` for `response: "respond"`; show the note on the recruiter side via `recordAutomationEvent`. Keep accept/decline terminal as-is.

## 6. Structured offer letter from job + comp, not free-form draft JSON
- **Value**: Low
- **Category**: feature
- **Effort**: M
- **Where it slots in**: `app/api/pipeline/[id]/route.ts:16` (`extendOffer` parses an opaque `draft` JSON with `subject`/`body`/`recommended`/`currency`) and `app/_lib/comms-dispatch.ts:71` (`dispatchOffer` just concatenates `draft.body` + the link).
- **Gap**: The offer "letter" is whatever free-form `body` string sits in `approvalDetail`. There's no structured letter (title, start date, comp breakdown, manager, location, terms) and no template — so the public offer page (`offer/[token]/page.tsx`) can only render job title + a single salary number.
- **Opportunity**: A deterministic offer-letter template that composes the email body and the public page from structured fields (role, start date, base, currency, location, reporting line) carried on the offer payload — the same template-from-structured-data pattern already used for rejection (`comms-dispatch.ts:44`).
- **Why it matters**: A consistent, professional letter raises offer-acceptance and removes the per-recruiter copy-paste of body text; it's also the foundation any later e-signature step would build on.
- **Sketch**: Define an `OfferLetter` type + `renderOfferLetter(fields)` (pure, testable). Populate it where the offer draft is generated; persist the structured fields in `offers.payload_json` (already a JSON column) and render both the email and the public page from them.
