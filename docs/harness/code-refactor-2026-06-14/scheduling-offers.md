> Total: 4 findings (Crit/High/Med/Low: 0/0/3/1)

## 1. Slot-time display formatting duplicated three ways; the canonical `useSlotLabel()` hook is used in only one of them
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/features/sub_schedule/InviteLifecyclePanel.tsx:81-84` (`slotLine`) and `app/features/sub_schedule/ScheduleTab.tsx:54-57` (`slotLabel`) (+ canonical helper `app/_lib/use-slot-label.ts:13`, already correctly used by `app/schedule/[token]/SchedulePicker.tsx:30`)
- **Evidence**: `use-slot-label.ts` is the deliberately-extracted, locale-aware ISO→label formatter (SCH4: "format a slot's ISO datetime in the candidate's ACTIVE locale … instead of the server-minted English label"). Grep `useSlotLabel` over `C:\Users\mkdol\dolla\kp` returns exactly one live consumer: `SchedulePicker.tsx`. Yet two sibling components in the SAME feature folder roll their own slot rendering from the same ISO `slotAt`:
  - `InviteLifecyclePanel.slotLine` → `new Date(i.slotAt).toLocaleString()` — no locale arg, no NaN guard (an unparsable `slotAt` renders "Invalid Date"), and it ignores the `slot` fallback ordering the hook standardizes.
  - `ScheduleTab.slotLabel` → manually splits the stored `"Day HH:MM"` string and re-localizes only the day via `enumLabel("day", …)`.
  Grep for the literal label shape (`} · ${time}` / `${date} · ${time}`) confirms three independent producers of the same `<date> · <time>` string: `use-slot-label.ts:24`, `schedule-slots.ts:38` (server-canonical, must stay server-side), and `InviteLifecyclePanel.tsx:83`. `ScheduleInvite`/the panel's `Invite` both carry `slotAt`, so the data to call the hook is present.
- **Impact**: Three formatters drift independently; the panel already shows wrong-locale times and an unguarded "Invalid Date" the hook was created to prevent. Each future format/locale tweak must be made in 2-3 spots.
- **Fix sketch**: Replace `InviteLifecyclePanel.slotLine`'s `toLocaleString()` with `useSlotLabel()` (call it at component top: `const slotLabel = useSlotLabel();`, then `slotLabel(i.slotAt, i.slot)` and append the `· {durationMin} min` suffix separately). The panel is already a `"use client"` component, so the hook is usable as-is. `ScheduleTab.slotLabel` works on the stored English-label `picks` map (no ISO available there), so leave it — but the panel and picker should share the one hook.

## 2. CAS-loser ("already responded") handling duplicated verbatim across the accept and decline branches of `respondToOffer`
- **Severity**: Medium
- **Category**: duplication
- **File**: `app/_lib/offer-finalize.ts:47-54` (accept branch) and `app/_lib/offer-finalize.ts:101-105` (decline branch)
- **Evidence**: Both branches call `markOfferResponded(token, …)`, then when `!claimed` run the identical loser recovery:
  ```
  const recorded = claimedOffer ?? getOfferByToken(token);
  const status = recorded?.status === "accepted" ? "accepted" : "declined";
  return { ok: true, status, alreadyResponded: true, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel };
  ```
  The two copies are byte-identical apart from the accept branch's extra explanatory comment. This is application logic in `offer-finalize.ts` (not the intentional store-migration / tx-collision-mirroring patterns the kp conventions carve out), so it's safe dedup. The shared `recordBooking` closure in `schedule/[token]/route.ts:165` is the same project pattern applied correctly — this is the offer-side equivalent that wasn't factored out.
- **Impact**: A change to the loser contract (e.g. adding `expired` to the reported status, or returning the offer object) must be mirrored by hand in both branches; one was already given a richer comment than the other, the classic sign of copy-paste skew.
- **Fix sketch**: Extract a local helper inside `respondToOffer`, e.g. `const reportLoser = (claimedOffer: OfferRow | null): OfferResponseResult => { const recorded = claimedOffer ?? getOfferByToken(token); const status = recorded?.status === "accepted" ? "accepted" : "declined"; return { ok: true, status, alreadyResponded: true, jobTitle: offer.jobTitle, candidateLabel: offer.candidateLabel }; };` and call `return reportLoser(claimedOffer);` from both `if (!claimed)` arms. `offer` is in closure scope, so no new params beyond the claimed offer.

## 3. `InviteLifecyclePanel` re-declares a 17-field `Invite` type that mirrors the exported `ScheduleInvite` wire shape
- **Severity**: Medium
- **Category**: structure
- **File**: `app/features/sub_schedule/InviteLifecyclePanel.tsx:8-26` (+ source of truth `app/_lib/schedule-store.ts:108-132` `ScheduleInvite`, served by `app/api/schedule/route.ts:15` via `listScheduleInvites`)
- **Evidence**: `GET /api/schedule` returns `listScheduleInvites()`, which yields full `ScheduleInvite` rows (no projection — unlike the public token route, which has a deliberate `publicInviteView`). The panel then hand-declares an `Invite` type listing 17 fields (`id`, `entryId`, `candidateLabel`, `jobTitle`, `status`, `slot`, `slotAt`, `reminderSentAt`, `needsReconcile`, `reconcileReason`, `needsMoreSlots`, `durationMin`, `rescheduleCount`, `candidateTz`, `attendanceStatus`, `createdAt`, `confirmedAt`) — every one a name/type match for a `ScheduleInvite` field. `ScheduleInvite` is already `export type` (schedule-store.ts:108). A type-only `import type { ScheduleInvite }` is erased at compile time, so it does NOT drag `better-sqlite3` into the client bundle (verified: the panel is `"use client"`; type imports carry no runtime cost). The local copy silently omits the store's `reminderAttempts`, `reminderLastAttemptAt`, `moreSlotsFlaggedAt`, `attendanceAt`, `locale` fields, so it's a lossy hand-maintained mirror, not an intentional narrowed contract (the route does no narrowing).
- **Impact**: Adding/renaming a `ScheduleInvite` field that the panel needs requires editing two type definitions; the omissions show the copy already lags the source. A genuine public-wire projection (like `publicInviteView`) would be the right pattern, but here the route ships the whole row, so the duplicate type buys nothing.
- **Fix sketch**: Either (a) `import type { ScheduleInvite } from "@/app/_lib/schedule-store"` and use it directly (simplest, zero bundle cost), or (b) if a trimmed recruiter wire shape is desired, add a `recruiterInviteView()` projection in the route and export its return type — but do not keep an unsynced hand-copied interface. No call-site changes needed beyond the type import.

## 4. Stale doc-only `useSlotLabel` reference path differs from the chosen implementation location (cosmetic)
- **Severity**: Low
- **Category**: cleanup
- **File**: `app/_lib/use-slot-label.ts` (helper) vs the historical proposal in `docs/harness/feature-scout-2026-06-10/scheduling-offers.md:39` ("a tiny `useSlotLabel()` next to `use-enum-label.ts`")
- **Evidence**: The shipped hook lives at `app/_lib/use-slot-label.ts` and is correctly co-located beside `app/_lib/use-enum-label.ts` (both in `app/_lib`). The only thing worth noting for a future reader is consistency of the comment trail, not a code problem: the hook's own header is accurate. Grep confirms no second/competing `useSlotLabel` implementation exists anywhere in the repo, so there is no dead duplicate hook to remove. Included only to record that the search for a stray/duplicate formatter helper came back clean.
- **Impact**: None functional. Recording the negative result so a later scanner doesn't re-investigate the same suspected duplicate.
- **Fix sketch**: No code change. (If finding #1 is taken, this hook becomes the single shared formatter, closing the loop.)
