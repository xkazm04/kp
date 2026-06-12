# Biz+UI Scan — Scheduling & Offers (2026-06-12)

> Total: 4 (1H/2M/1L)

## 1. Deliver the self-scheduling link through the comms channel — it is the only candidate token link that never ships
- **Lens**: business_visionary
- **Severity**: High
- **Category**: functionality
- **File**: `app/api/schedule/invite/route.ts:26`
- **Scenario**: A recruiter clicks "Create scheduling link" in the candidate drawer. The server mints the token and the UI shows a copy field (`app/features/sub_pipeline/CandidateDrawer.tsx:697-706` → `TokenLink.tsx:51-54`) — and that's the end of the product's involvement. The recruiter must paste the link into some channel *outside* the app for the candidate to ever see it. The candidate, meanwhile, holds no durable copy: the confirmation email's templates contain no link back (`comms.interviewConfirmation.normal/short` in `messages/en.json` say "just reply" — only the voice screen's `comms.interviewInvite` carries `{link}`), so the shipped self-reschedule affordance (SCH2) is unreachable once they close the tab.
- **Root cause**: `POST /api/schedule/invite` only persists + returns the URL (`app/api/schedule/invite/route.ts:35`); no `dispatchScheduleInvite` exists in `app/_lib/comms-dispatch.ts`. Every sibling token link ships: the voice-screen link is dispatched at `app/api/interview/create/route.ts:67` (added precisely because "the link only ever opened in the recruiter's own browser tab — undeliverable end-to-end"), and the offer link at `app/api/pipeline/[id]/route.ts:41`. The lifecycle panel even claims delivery that never happened: awaiting rows render "sent {time}" (`InviteLifecyclePanel.tsx:142`, `messages/en.json:909`) from `created_at`.
- **Impact**: The flagship self-scheduling flow is undeliverable end-to-end inside the product: manual copy-paste friction on every interview, no Outbox audit row (a dead-lettered or never-sent invite is indistinguishable from a delivered one), and the recruiter promise the lifecycle panel makes ("sent") is false. For inbound applicants whose real address was captured (`contact`, APP2) the system could deliver directly today and simply doesn't.
- **Fix sketch**: Add `dispatchScheduleInvite(entry, link, { durationMin })` to `comms-dispatch.ts` mirroring `dispatchInterviewInvite` (new `comms.scheduleInvite.*` keys in `messages/{en,cs}.json`, locale-pinned via the existing `commsTranslator`); call it from `POST /api/schedule/invite` with the absolute URL resolved through `publicBaseUrl` (the offer route's pattern), record a `schedule_invite_sent` automation event, and return `dispatched` so the drawer copy panel stays as a secondary affordance. Append the same link to the confirmation footer so a booked candidate can always get back to reschedule/.ics.

## 2. Follow up once on invites that were never booked
- **Lens**: business_visionary
- **Severity**: Medium
- **Category**: user_benefit
- **File**: `app/_lib/schedule-store.ts:334`
- **Scenario**: A candidate receives a scheduling link, gets distracted, and never books. Nothing happens — ever. The recruiter eventually notices the row in the lifecycle panel's collapsed "Awaiting booking" section (`InviteLifecyclePanel.tsx:132-147`), which offers no action, and chases the candidate by hand.
- **Root cause**: The entire reminder machinery is gated on `status = 'confirmed'` (`dueReminders`, `schedule-store.ts:334`; partial index at `:68`); a `pending` invite is structurally invisible to the heartbeat. The scheduler infrastructure for a second sweep already exists — `ensureReminderJob`/`claimDueRun`/`recordRun` in `instrumentation.ts:48-70` — and the store already orders pending invites by age (`listScheduleInvites`, `:178`).
- **Impact**: Un-booked invites are the top leak between "interview approved" and "interview happens"; today the system detects them (the panel) but cannot act, so time-to-schedule — the metric self-scheduling exists to compress — silently stretches by days.
- **Fix sketch**: Rides finding 1's dispatcher. Add `nudge_sent_at TEXT` to `schedule_invites` (the existing ALTER-loop migration at `schedule-store.ts:72`), a `dueInviteNudges(olderThanMs)` read (`status='pending' AND nudge_sent_at IS NULL AND created_at < cutoff`, entry-eligibility-joined like `dueReminders`), and a second registered scheduler job in the heartbeat that re-dispatches the invite link exactly once after ~3 days (single nudge, no retry storm — set `nudge_sent_at` on claim, mirroring the bounded-retry lessons in `interview-reminders.ts`). Surface "nudged {time}" on the awaiting row.

## 3. Decide the theme register for candidate token pages — Spark Dark currently reaches the offer letter by OS accident
- **Lens**: ui_perfectionist
- **Severity**: Medium
- **Category**: ui
- **File**: `app/layout.tsx:117`
- **Scenario**: A candidate whose OS prefers dark mode opens their offer link. The "premium letterhead" card the page deliberately stages as an official document (`app/offer/[token]/page.tsx:90`) renders in Spark Dark: Bricolage display type, drawn 2px outline, 16px radius, hard `5px 5px 0` sticker shadow (`globals.css:156,164,181-185`). Same for the schedule picker. The candidate has no toggle — `ThemeToggle` lives only in the workspace sidebars (529f7a0) — so they cannot get back to the studio register.
- **Root cause**: The pre-hydration bootstrap defaults to `prefers-color-scheme` and exempts only `/landing` (`THEME_INIT`, `layout.tsx:117`). `docs/DESIGN.md:13-23` defines Spark Dark as *experimental* ("expect tuning"), aimed at "creative users, early adopters" — i.e., the recruiter persona who opted in — yet candidate-facing token routes (`/offer/[token]`, `/schedule/[token]`) inherited OS-driven activation with no decision. The `/landing` exemption exists precisely because outward-facing surfaces "must look identical for every visitor"; candidate pages are the other outward-facing surface and got no equivalent ruling.
- **Impact**: The two highest-stakes candidate touchpoints — accepting an offer and booking the interview — render in an admittedly experimental, playful register for an audience that never chose it, randomized by device setting. The offer letter's "reads as official" intent (its own comment) is undermined exactly when presentation most affects acceptance; and as the dark register gets "tuned", candidate pages silently churn.
- **Fix sketch**: Extend the proven `/landing` enforcement: add the candidate token paths (`/offer/`, `/schedule/`, and the other public token routes) to the `THEME_INIT` path guard so they stay pinned to Studio Light, and record the decision in `docs/DESIGN.md` next to the landing exemption. If dark for candidates is ever wanted, ship it as a deliberate art direction with a visible toggle — not as OS spillover from an experimental recruiter theme.

## 4. Render lifecycle agenda times through useSlotLabel, not raw toLocaleString()
- **Lens**: ui_perfectionist
- **Severity**: Low
- **Category**: ui
- **File**: `app/features/sub_schedule/InviteLifecyclePanel.tsx:81`
- **Scenario**: The recruiter's "Upcoming" agenda — the one place confirmed interview times are listed — shows `6/12/2026, 10:00:00 AM` (or `12. 6. 2026 10:00:00` on a Czech machine): browser-default format, seconds included, date-first instead of the weekday-led shape every other slot surface uses.
- **Root cause**: `slotLine` calls `new Date(i.slotAt).toLocaleString()` with no locale or options (`InviteLifecyclePanel.tsx:79-82`). The app already owns a formatter for exactly this — `useSlotLabel()` (`app/_lib/use-slot-label.ts`, SCH4) formats an ISO slot as locale-aware `"Wed 17 Jun · 10:00"` following the active next-intl locale — and the panel ignores it, also bypassing the recruiter-locale i18n wave (commits b6ee6b9 et al.) that made the surrounding tab fully bilingual.
- **Impact**: The agenda is the panel's payload; verbose, locale-drifting timestamps with seconds make it harder to scan and visibly inconsistent with the schedule chips (`ScheduleTab.tsx:49-52`) and the candidate-facing picker, eroding the just-shipped bilingual polish.
- **Fix sketch**: `const slotLabel = useSlotLabel();` and `slotLine = (i) => i.slotAt ? `${slotLabel(i.slotAt, i.slot)}${i.durationMin ? ` · ${i.durationMin} min` : ""}` : (i.slot ?? "—")` — fallback to the stored label exactly as SchedulePicker does. No new code paths; `.nums` class already handles the digits.

---
## Cross-checks
- Read both prior reports (2026-06-08, 2026-06-10). Shipped since: SCH1 (.ics download), SCH2 (self-reschedule + cap), SCH4 (locale slot labels on token pages, salary `toLocaleString(locale)`), W6-3 invite lifecycle (`listScheduleInvites` + `GET /api/schedule` + `InviteLifecyclePanel`), SIM3 (locale-pinned comm templates). Not re-flagged: cancel/withdraw (06-10 #2), no-show capture (06-10 #3), offer expiry/counter-offer/structured letter (SCH3/5/6 retired), availability windows (SCH4-deferred), slot-vocabulary + business-TZ rework (known-deferred), auth on the recruiter `GET /api/schedule` (app-wide auth layer is known-deferred).
- Finding 1 is distinct from 06-10 #1: that finding (shipped) made the invite lifecycle *visible*; delivery of the link through `sendComm` was never proposed in either prior report — both treated "mint-link-and-forget" only as evidence for the read path. Templates themselves are localized (SIM3), so this is a missing dispatcher, not localization territory.
- Verified the reminder heartbeat is registered and bounded (`instrumentation.ts`, `interview-reminders.ts`) — no phantom-sweep finding. Verified `window.confirm` in ScheduleTab is an app-wide pattern (3 call sites), not a local inconsistency — skipped.
