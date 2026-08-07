> Total: 4 findings (0c critical, 0h high, 1m medium, 3l low)

## 1. Stale/misleading comment claims the recruiter calendar covers candidate self-scheduled slots
- **Severity**: Medium
- **Category**: cleanup
- **File**: app/features/sub_schedule/ScheduleTypes.ts:18-21
- **Scenario**: The `TIMES` constant comment reads: *"Full working day, hourly (08:00–17:00). Covers the server-proposed slots (schedule-store proposes within this window) so a proposed chip always lands on a visible row."* This is false on two counts. (1) `schedule-store`/`schedule-slots.ts` proposes only **10:00 and 14:00** (`const TIMES = ["10:00", "14:00"]`, schedule-slots.ts:18), not the hourly 08:00–17:00 grid here. (2) The candidate self-scheduling flow and this recruiter calendar are entirely separate vocabularies: candidate slots are ISO `slotAt` with labels like `"Tue 10 Jun · 10:00"` (slotLabel, schedule-slots.ts:88-91); this recruiter calendar works only on `approve_event`/`approvalDetail` "Day HH:MM" strings. Confirmed by grep: `ScheduleCalendar.tsx`/`ScheduleTab.tsx` never import `schedule-store`, `ScheduleInvite`, or reference `slotAt` (grep for `slotAt|schedule-store|listScheduleInvites|ScheduleInvite` in both files returned zero hits). A "proposed chip" from self-scheduling is never rendered in this grid.
- **Root cause**: The comment predates the idea-e05aedfb extraction that split candidate self-scheduling (10:00/14:00, ISO, Europe/Prague) out of the older recruiter `approve_event` calendar model; the comment was never updated when the two flows diverged.
- **Impact**: A maintainer reading this will believe the recruiter grid and the candidate self-schedule picker share a slot window and that widening `TIMES` here affects what candidates are offered — it does not. Risks a wrong "fix" (e.g. editing this array expecting candidate-side effect) or wasted investigation.
- **Fix sketch**: Rewrite the comment to state the truth: this is the recruiter `approve_event` calendar-approval grid (8am–5pm hourly working day for the "Day HH:MM" `approvalDetail` model), independent of the candidate self-scheduling flow in `schedule-slots.ts` (which offers only 10:00/14:00 in the interview zone). Do NOT touch the values.

## 2. `DEFAULT_SLOT` magic string risks silent drift from the calendar grid
- **Severity**: Low
- **Category**: structure
- **File**: app/features/sub_schedule/ScheduleTypes.ts:22 (used ScheduleTab.tsx:93)
- **Scenario**: `DEFAULT_SLOT = "Tue 14:00"` is the fallback slot for a calendar entry with no `approvalDetail`. It's a hand-typed string that must be a valid `"<DAY> <TIME>"` pair from `DAYS` (Mon–Fri) × `TIMES` (08:00–17:00). It currently is (`"Tue"` ∈ DAYS, `"14:00"` ∈ TIMES), so the proposed chip lands on a real cell. But nothing enforces the relationship — editing `DAYS`/`TIMES` (e.g. dropping the 14:00 row) would silently push the default chip into a non-existent cell where it renders nowhere. Verified single use at ScheduleTab.tsx:93 (`e.approvalDetail || DEFAULT_SLOT`).
- **Root cause**: Convenience constant authored independently of the grid arrays it must agree with.
- **Impact**: Low today; a latent footgun if the grid is re-gridded. Pure-string coupling that the type system can't catch.
- **Fix sketch**: Either derive it (`` `${DAYS[1]} ${TIMES[6]}` ``) or leave as-is and add a one-line comment noting it must be a `DAYS × TIMES` member. Optional; no functional change needed now.

## 3. Two near-identical day-prefixed slot-label formatters
- **Severity**: Low
- **Category**: duplication
- **File**: app/features/sub_schedule/ScheduleTab.tsx:54-57; app/features/sub_schedule/ScheduleCalendar.tsx:97
- **Scenario**: ScheduleTab defines a local `slotLabel(slot)` that splits a `"Day HH:MM"` string, localizes the day via `enumLabel("day", d)`, and rejoins (`` `${enumLabel("day", d)} ${rest.join(" ")}` ``). ScheduleCalendar does the same day-localization inline for its `assignAria` label (`` `${enumLabel("day", d)} ${t}` ``). Both turn a recruiter "Day HH:MM" token into a localized display string. The logic is tiny and the two call sites differ slightly (one parses a combined string, the other already has `d`/`t` split), so this is minor.
- **Root cause**: Two components in the same folder each localizing the same slot vocabulary independently; never consolidated because each is a one-liner.
- **Impact**: Very low — a day-label change must be remembered in two spots, but `enumLabel("day", …)` already centralizes the actual translation.
- **Fix sketch**: Optional. If touched, a shared `formatRecruiterSlot(day, time, enumLabel)` helper in `ScheduleTypes.ts` would single-source it. Not worth a dedicated change.

## 4. Repeated try/catch slotAt/confirmedAt → short-notice ms parsing
- **Severity**: Low
- **Category**: duplication
- **File**: app/api/schedule/[token]/route.ts:181-184; app/_lib/schedule-store.ts:412-413 (dueReminders)
- **Scenario**: The "parse `slotAt` and `confirmedAt` to ms, guard NaN, then call `isShortNoticeBooking`/`isReminderDue`" sequence appears twice: the confirm route (route.ts:181-184) computes `slotAtMs`/`bookedAtMs` and calls `isShortNoticeBooking`; `dueReminders` (schedule-store.ts:412-433) computes the same two ms values and feeds `isReminderDue`. The downstream policy is already single-sourced in `interview-reminder-policy.ts` (good), but the ISO→ms→NaN-guard plumbing is hand-repeated at each boundary.
- **Root cause**: Each caller does its own `Date.parse` + `Number.isNaN` glue around the shared pure policy functions.
- **Impact**: Minimal — the *decision* is centralized; only the boilerplate parse is duplicated. A small NaN-handling inconsistency could creep in if one site is edited.
- **Fix sketch**: Optional. A tiny helper in `interview-reminder-policy.ts` accepting `(slotAtIso, bookedAtIso)` and returning the parsed/guarded ms (or null) would dedupe the glue. Low value; the current split is already safe.
