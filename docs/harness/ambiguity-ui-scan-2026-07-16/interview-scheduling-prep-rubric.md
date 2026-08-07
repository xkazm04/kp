# Interview Scheduling, Prep & Rubric — ambiguity-guardian + ui-perfectionist scan

> Total: 6 findings (0 critical, 2 high, 4 medium, 0 low)

## 1. The candidate's own token can set the interview "Join" link recruiters click
- **Severity**: High
- **Lens**: ambiguity
- **Category**: capability-boundary-drift
- **File**: `app/api/schedule/route.ts:332`
- **Scenario**: A candidate (or anyone holding a leaked `/schedule/<token>` link) sends `PATCH /api/schedule {token, meetingUrl}`. The URL is accepted, then rendered as the coral "Join" button on their own booked card (`SchedulePicker.tsx:420-428`), on the recruiter agenda (`MeetingLinkCell`), and baked into both sides' calendar events as the location (`calendar-links.ts:105`).
- **Root cause**: The PATCH comment asserts "the candidate never reaches this route (they use the token route)" — but the only key the route requires **is** the candidate's token. Unlike the sibling POST on the same file (`route.ts:175-178`), PATCH never calls `currentWorkspace()` and never checks `invite.workspaceId !== ws`, so it is neither recruiter-authenticated nor tenant-scoped. `normalizeMeetingUrl` only enforces http/https, which any phishing URL satisfies.
- **Impact**: A token holder can inject an arbitrary attacker-controlled link into the *trusted* recruiter surface and both calendar events — a recruiter joining "their" interview clicks it without suspicion. Cross-workspace edit of another team's invite is also possible.
- **Fix sketch**: Mirror the POST handler: resolve `ws = await currentWorkspace()`, load the invite, and 404 when `invite.workspaceId !== ws` before writing. That single guard makes the route recruiter-side in fact, not just in comment; the candidate token route keeps its read-only view of `meetingUrl`.

## 2. Single re-invite mails a scheduling link to terminal (rejected/hired) candidates that bulk refuses
- **Severity**: High
- **Lens**: ambiguity
- **Category**: inconsistent-guard
- **File**: `app/api/schedule/invite/route.ts:25`
- **Scenario**: A recruiter (or the drawer's invite button) POSTs `/api/schedule/invite` for an entry that was rejected since screening. The route mints a token and **dispatches the "pick your interview time" email**. The candidate opens a fully live picker — `GET /api/schedule/[token]` never consults the linked entry's status (`[token]/route.ts:64-113` gates only on invite expiry/terminal-status) — picks a slot, and only then hits the confirm-time 409 "This interview is no longer available."
- **Root cause**: The bulk sibling explicitly enforces `entry.status !== "active" → "not active"` (`invite/bulk/route.ts:44-47`), calling it "the same stale-token doctrine the single flows enforce" — but the single route it claims to mirror has no such guard, and neither does the token GET. The doctrine exists only at the last write.
- **Impact**: A rejected candidate receives an invitation email, invests in choosing a time, and is refused at the final click — the worst possible place to learn the interview doesn't exist. (`InviteLifecyclePanel`'s re-invite gates on `canReinvite` client-side only.)
- **Fix sketch**: Add the bulk route's `entry.status !== "active"` refusal to the single invite route (409 with a clear message), and have the token GET treat a terminal linked entry like the existing `closed` card (reuse the POST's `getPipelineEntry` check) so an already-mailed link renders an honest terminal state instead of a bookable picker.

## 3. Every bespoke candidate-facing error collapses into one generic "couldn't confirm"
- **Severity**: Medium
- **Lens**: ui
- **Category**: dead-error-copy
- **File**: `app/schedule/[token]/SchedulePicker.tsx:156`
- **Scenario**: A candidate's slot is sniped between load and submit; the server answers 409 "That time was just taken — please pick another." Or they type three proposal times and the server answers 400 "Please suggest 1–3 future weekday times during working hours." In both cases the page shows only the generic localized `t("confirmFailed")`.
- **Root cause**: `useErrorMessage` (`app/_lib/use-error-message.ts:14-20`) renders only a recognized machine `code`, deliberately never the raw English `error` — but all of the token route's hand-crafted 400/409 responses (`[token]/route.ts:183,187,241,320-331`) are code-less `{error: string}` bodies. The carefully-worded copy is unreachable by design. Meanwhile the recruiter-side `InviteLifecyclePanel.tsx:75` does the opposite: it toasts the raw English `d.error` verbatim, un-localized for a cs recruiter.
- **Impact**: The proposal form (three bare datetime inputs) gives zero guidance about *why* a submission failed — weekend? past? out of hours? — the exact scenario the server message answers. The taken-slot race reads as a mysterious hard failure even though the list silently refreshed. Two surfaces apply two contradictory error policies to the same API.
- **Fix sketch**: Give the distinct candidate-reachable failures stable codes (`SLOT_TAKEN`, `RESCHEDULE_LIMIT`, `PROPOSAL_INVALID`, `LINK_INACTIVE`, `ENTRY_INACTIVE`) alongside the English `error`, add them to the `errors` translation catalog, and let `useErrorMessage` pick them up. On the recruiter panel, route errors through the same hook instead of the raw string.

## 4. Confirm can book a time nobody chose: the silent "Tue 14:00" default
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: magic-default
- **File**: `app/features/sub_schedule/ScheduleTab.tsx:138`
- **Scenario**: A calendar-stage entry has no invite and no parseable `approvalDetail`. `load()` seeds its grid pick with `weekdayToDateSlot(DEFAULT_SLOT)` — i.e. next Tuesday 14:00. The recruiter clicks the moss Confirm button on the card (one click, no slot ever selected) and `act()` books that fabricated time through `/api/schedule book`, advances the pipeline entry, and seals an `interview_scheduled` decision record for it.
- **Root cause**: `DEFAULT_SLOT = "Tue 14:00"` (`ScheduleTypes.ts:23`) is documented as a "seed for a legacy entry", but nothing distinguishes a recruiter-chosen pick from the system default at confirm time — `picks[e.id]` is always populated, so Confirm is never disabled and never asks. The default's *reason* (why Tuesday? why 14:00?) is undocumented.
- **Impact**: A one-click misfire books, emails, and reminds a candidate for an arbitrary time no human selected, and the sealed decision record asserts a deliberate scheduling choice. The chip does show the slot, but at `text-sm` inside a card whose primary affordance is Confirm.
- **Fix sketch**: Track pick provenance: seed default-slotted entries with `pick: null` (render the chip as a dimmed "no time chosen") and disable Confirm until the recruiter clicks a cell — or, minimally, keep the default but require the same two-step armed confirm the lifecycle panel already uses when the pick came from `DEFAULT_SLOT` rather than a click or an invite.

## 5. The "no silent hour double-book" invariant only holds on one of three booking paths
- **Severity**: Medium
- **Lens**: ambiguity
- **Category**: inconsistent-invariant
- **File**: `app/api/schedule/route.ts:121`
- **Scenario**: A candidate proposed 14:30; the recruiter's week grid shows 14:00 already booked for that day. The recruiter accepts the proposal (`accept_proposal`) — it lands, because that path checks only the exact-instant collision inside `confirmScheduleInvite`, never `hourBucketKey`. The grid now renders two occupants in the 14:00 cell — precisely the "recruiter can't SILENTLY double-book the hour" situation the `book` action's bucket check (route.ts:121-127) exists to refuse.
- **Root cause**: Hour-level occupancy is enforced only in the `book` branch, and even there as a non-transactional read (`bookedSlots(ws).some(...)`) *before* the collision-checked transaction — two concurrent grid books at 14:00 and an accepted 14:30 can interleave past it. Candidate confirm/reschedule and `accept_proposal` never consult the bucket at all. Whether the hour or the instant is the collision identity is decided per-path, undocumented.
- **Impact**: Overlapping interviews the grid visually stacks in one cell, from the exact flows (proposal acceptance, races) most likely to produce off-hour times. The comment on `hourBucketKey` promises a guarantee the system only partially delivers.
- **Fix sketch**: Decide the identity once: either move the hour-bucket check into `confirmScheduleInvite`/`rescheduleScheduleInvite`'s transaction (a `hourBucketKey`-match scan next to the existing `slot_at` clash query) so all three paths share it, or document that only the grid path is hour-exclusive and surface accepted off-hour proposals as a distinct "overlaps 14:00" warning in the lifecycle panel.

## 6. Recruiter reschedule offers only the two fixed offered times, while every other recruiter path allows any working hour
- **Severity**: Medium
- **Lens**: ui
- **Category**: capability-mismatch
- **File**: `app/api/schedule/route.ts:219`
- **Scenario**: A recruiter booked a candidate at 09:00 via the week grid (any business-day hour, `dateSlotToIso`). Later they click "Reschedule" on the lifecycle panel: the sub-flow (`InviteLifecyclePanel.tsx:122-133`, fed by `GET /api/schedule?slots=1`) offers only the next six `proposeSlots` — the fixed `KP_INTERVIEW_TIMES` grid (default 10:00/14:00). The 09:00-capable recruiter suddenly can't move the interview to 09:30, or even back to another 09:00.
- **Root cause**: The `reschedule` action validates with `offeredSlotFor` — the *candidate* trust boundary limited to the two configured times — although the same file trusts the same recruiter with any business-day hour in the `book` branch (`dateSlotToIso`) and any working hour in `accept_proposal` (`proposedSlotFor`). Three recruiter actions, three different notions of what times a recruiter may pick, with no stated reason.
- **Impact**: A dead-end UX for any interview living outside the two offered hours: the panel's reschedule chips can look emptier than the calendar the recruiter just booked on, and the recruiter falls back to cancel + re-book (which resets RSVP/reminder state and emails the candidate twice).
- **Fix sketch**: Validate the recruiter `reschedule` target with `proposedSlotFor` (any weekday working hour — already the trusted-recruiter rule in `accept_proposal`), and let the panel's sub-flow reuse the dated grid picker or at least offer the current booking's hour alongside `proposeSlots`. Keep `offeredSlotFor` for the candidate path only.
