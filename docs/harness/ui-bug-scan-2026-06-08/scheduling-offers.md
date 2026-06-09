# Scheduling & Offers — UI+Bug combined scan
> Total: 4 findings (0 crit / 1 high / 3 med / 0 low)
> Group: Recruitment Pipeline & Scheduling | Lens mix: 2 bug / 2 ui | Files read: 14

Hardened paths verified and NOT re-flagged: slot double-booking is serialized inside `confirmScheduleInvite`/`rescheduleScheduleInvite` transactions on ISO `slot_at` identity (schedule-store.ts:178-253); reminder claim is an optimistic CAS with bounded retry + backoff (`claimReminderAttempt` schedule-store.ts:360-378, interview-reminders.ts:25-75); the offer accept/decline CAS gates the terminal side effects to the single claimer (`markOfferResponded` offers-store.ts:169-183, offer-finalize.ts:35-74); the public confirm route validates the submitted time structurally and re-mints the label server-side, ignoring `body.slot` (`offeredSlotFor` schedule-slots.ts:71-85, route.ts:106-117); stale-token decline/confirm against a Hired/terminal entry is guarded (`markEntryStatus` offers-store.ts:206-221, db.ts:3192-3217, route.ts:99-104). All confirmed sound.

## 1. Onboarding dispatch failure after Accept is silent and never retried
- **Severity**: High
- **Lens**: 🐛 Bug
- **Category**: Silent failure / unrecoverable side effect
- **File**: `app/_lib/offer-finalize.ts:45-50`
- **Scenario**: Candidate clicks Accept. `markOfferResponded` CAS wins → offer is now `accepted`, `actOnPipelineEntry(entryId,"accept")` moves the entry to **Hired** (both committed). Then `await dispatchOnboarding(hired)` runs; `dispatchOnboarding` awaits `sendComm` BEFORE recording `onboarding_started` (comms-dispatch.ts:218-219), so a comms-provider blip throws. The throw propagates through `respondToOffer` → `safeJsonError` → HTTP 500. The candidate page shows an error and retries — but on retry `offer.status !== "extended"` (line 19), so `respondToOffer` early-returns `alreadyResponded:true, status:"accepted"`. The success card renders; onboarding is **never re-attempted**.
- **Root cause**: The terminal side effects after the CAS are not atomic with it, and — unlike the schedule confirm flow, which catches dispatch failure and calls `markScheduleInviteNeedsReconcile` + logs (route.ts:148-153) — the offer flow has no reconcile flag, no catch, and no `onboarding_started` audit row on the failed path. The accept commit and the onboarding dispatch share no compensation.
- **Impact**: A Hired candidate gets no onboarding email, `onboarding_started` is never recorded, and there is zero operator signal — the divergence (Hired on the board, never onboarded) is invisible and the retry path masks it as success.
- **Fix sketch**: Wrap the `dispatchOnboarding` await in try/catch (mirror `recordBooking`): on failure, persist a reconcile/needs-onboarding flag on the offer or entry and log it, then still return `ok:true` (the accept legitimately happened). Surface the flag where the schedule reconcile flag is surfaced so an operator can re-trigger onboarding.

## 2. Reschedule into a fully-booked horizon renders a blank screen (missing empty state)
- **Severity**: Medium
- **Lens**: 🎨 UI
- **Category**: Missing state (empty)
- **File**: `app/schedule/[token]/SchedulePicker.tsx:203-229` (with `app/api/schedule/[token]/route.ts:61`)
- **Scenario**: A confirmed candidate clicks "Need a different time?" The picker enters `rescheduling` and renders the slot list. But the GET computes `noSlots = invite.status !== "confirmed" && slots.length === 0` — for a **confirmed** invite `noSlots` is hard-coded false. If every other slot is already booked, `proposeSlots(bookedSlots())` returns `[]`, so the picker takes the `else` branch and maps an empty `slots` array: the candidate sees the "Pick a new time…" header and "Keep current time" link above an **empty grid** with no explanation.
- **Root cause**: The zero-slots empty state is gated on `!confirmed`, so it never covers the reschedule path even though reschedule can legitimately yield zero offerable slots.
- **Impact**: A candidate trying to move a booked interview hits a silent dead-end (blank list) with no guidance and no recruiter signal — and unlike the first-booking path, no `needs_more_slots` flag is raised, so the recruiter never learns more times are needed.
- **Fix sketch**: In the route, compute `noSlots` for the reschedule case too (`canReschedule && slots.length === 0`); in the picker, render the existing "All current times are taken" card when `rescheduling && slots.length === 0`, with copy framed as "no other times open — keep your current slot."

## 3. SchedulePicker booking outcome is not announced to assistive tech (no aria-live on success)
- **Severity**: Medium
- **Lens**: 🎨 UI
- **Category**: Accessibility
- **File**: `app/schedule/[token]/SchedulePicker.tsx:135-176`
- **Scenario**: A screen-reader user tabs to a slot button and activates it. On success the component swaps the slot `<ul>` for the "You're booked" card. The card is a plain `<div>` (no `role="status"`/`aria-live`), and focus is not moved to it. Nothing is announced — the user gets silence after activating the control, with no confirmation that the interview was booked. (The error path correctly uses `role="alert"` at line 129; the `noSlots` card uses `role="status"` at line 204 — the success card is the gap.)
- **Root cause**: Success state relies on a visual-only DOM swap; no live region and no focus management on the confirmation card.
- **Impact**: Non-sighted candidates cannot tell a slot was booked vs. nothing happening; they may re-activate or abandon. This is the primary action of the page failing silently for AT users.
- **Fix sketch**: Add `role="status" aria-live="polite"` to the booked card wrapper (and to the per-button busy text), and move focus to the card heading after a successful confirm/reschedule. Pure additive; no a11y regression.

## 4. Recruiter "decline" (X) is terminal but fires with no confirmation step
- **Severity**: Medium
- **Lens**: 🐛 Bug (irreversible-action UX defect)
- **File**: `app/features/sub_schedule/ScheduleTab.tsx:281-289` (handler `act` lines 145-165)
- **Scenario**: On each pending-interview card, the small icon-only `X` button calls `act(e, "reject")` directly on click. `reject` writes `status='rejected'` (db.ts:3189-3191) — a **terminal** entry state with no undo — and the card is optimistically removed from the list. A single misclick on the compact `X` (sitting flush beside the larger Confirm button) permanently rejects the candidate.
- **Root cause**: A destructive, irreversible action is wired to a one-click control with no confirm gate, no undo, and no aria-label on the icon-only button — notably inconsistent with the offer page, where the equally-terminal Decline routes through a deliberate `role="alertdialog"` confirm step (offer/[token]/page.tsx:146-187).
- **Impact**: Accidental, unrecoverable candidate rejection from a mis-tap; the icon-only button is also unlabeled for screen readers (announces as "button"). High blast radius for a trivial slip.
- **Fix sketch**: Gate `reject` behind a lightweight inline confirm (reuse the offer page's alertdialog pattern) or an undo toast, and add `aria-label="Decline candidate"` to the `X` button.
