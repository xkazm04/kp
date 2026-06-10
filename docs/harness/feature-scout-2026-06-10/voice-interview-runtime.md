# Feature Scout — Voice Interview Runtime (2026-06-10, re-scan of mined context)

> Total: 3 (1H/2M/0L)
> Prior scan 2026-06-08: 6 findings, VOX1/VOX3 shipped, VOX2/4/5/6 retired. This re-scan reports only net-new gaps.

## 1. Give the delivered interview link a lifecycle — expiry, revoke, and clean reissue
- **Value**: High
- **Category**: functionality
- **Effort**: M
- **Where**: `app/api/interview/connect/route.ts:66` (only `completed` is refused), `app/api/interview/create/route.ts:33-67`, `app/_lib/db.ts:2835-2899` (+ `app/features/sub_pipeline/TokenLink.tsx`)
- **Gap**: New seam opened by shipped VOX1: interview links now leave the building (auto-emailed on create), but the session token never expires, cannot be revoked, and reissue has no semantics. Grep confirms no expiry column/check and no revoke/cancel function for `interview_sessions`; clicking "Create link"/"Start AI interview" again simply mints a second live session **and emails a second invite** while the first link stays valid forever — and `latestInterviewByEntry` (created_at DESC) means an old link completed after a reissue isn't even the surfaced session. A candidate whose entry went terminal (rejected/declined) can still take the screen: W7 added `isTerminalEntryStatus` to schedule-confirm/approve_event but `/connect` never checks the linked entry.
- **Proposal**: Add an expiry window (e.g. N days, stamped at create) enforced in `/connect` exactly like the completed-session 409; a `revokeInterviewSession` (status `revoked`, refused by `/connect`, friendly portal copy); reissue = revoke prior open sessions for the entry inside `/create`; auto-revoke open sessions when the entry transitions terminal. Surface "Revoke link" in `TokenLinkPanel`/drawer.
- **Why users need it**: A recruiter who sent the wrong candidate a link, re-sent a fresh one, or rejected the candidate currently has zero control over a live, indefinitely-valid AI-interview credential in someone's inbox.

## 2. Show the invite funnel state on recruiter surfaces and make resend a deliberate action
- **Value**: Medium
- **Category**: user_benefit
- **Effort**: M
- **Where**: `app/features/sub_schedule/ScheduleTab.tsx:261-279`, `app/features/sub_pipeline/CandidateDrawer.tsx:529-546`, `app/api/interview/by-entry/route.ts` (+ `app/_lib/interview-reminders.ts` pattern)
- **Gap**: After VOX1, an invite can be out for days — but a sent-but-untaken screen renders as a plain "Start AI interview" button (status `created` is returned by `/by-entry` yet only `hasTranscript`/`in_progress` are used), and clicking it silently mints a NEW session + emails ANOTHER invite. The drawer's "invite sent" note is ephemeral per-click hook state (`voice.data`), not persisted status; the `interview_invite_sent` automation event (comms-dispatch.ts:200) exists but no surface reads it here. The reminder loop (`interview-reminders.ts`) covers scheduled slots only, not un-taken voice screens.
- **Proposal**: Render an "Invite sent <relative time> — awaiting candidate" state on the schedule card and drawer (data is one `createdAt` field away in `/by-entry`); turn the button into an explicit "Resend invite" with confirm; optionally add an aging nudge (one reminder after N days) reusing the gate-on-event + bounded-retry conventions from outreach/reminders.
- **Why users need it**: The recruiter can't tell "never invited" from "invited and ghosting" — the most common failure of an async screen — and the only available action quietly spams the candidate.

## 3. Rehearse an entry's grounded interview without burning the candidate's link
- **Value**: Medium
- **Category**: feature
- **Effort**: S
- **Where**: `app/api/interview/simulate/route.ts:41-58` (canned demo briefs only), `app/interview-lab/page.tsx:18-30` (ungrounded + prod-disabled), `app/api/interview/create/route.ts:53` (+ `app/api/interview/complete/route.ts:142`)
- **Gap**: Emerged from VOX1 + the single-use hardening: there is now no safe way for a recruiter to QA the actual agent a specific candidate will meet. The sim tab runs only the three canned demo personas; the lab is ungrounded and disabled in production; `/create` always emails the candidate when the provider is configured; and taking the candidate's real link completes the single-use session (`/connect` then 409s the candidate).
- **Proposal**: A "Rehearse this interview" action (prep modal / drawer) that mints a session from `buildGroundedInterview(entryId)` but with `entryId` left null on the row (plus a rehearsal label) and NO invite dispatch — `/complete` already stores transcripts without scorecard/approval for entry-less sessions, so the existing semantics do the isolation for free.
- **Why users need it**: Briefs are LLM-composed from prep artifacts (debrief questions, case scenarios, chronology); the first human to hear a bad one should be the recruiter in a 3-minute rehearsal, not the candidate in the real screen.

---
## Cross-checks performed
- Read prior report + INDEX + harness-learnings (W4 voice hardening, VOX1/W1, VOX3/W7, W14 human-scorecard cross-surface, 2026-06-07 voice-architecture facts) before scanning; confirmed VOX1's shipped shape (`dispatchInterviewInvite`, `delivered` flag) and VOX3's (`findEvidenceTurn` in InterviewTranscriptModal).
- Retired VOX2/VOX4/VOX5/VOX6 NOT re-proposed. Finding 2 is invite-funnel state (post-VOX1 seam), not the in-call live transcript of VOX2; finding 3 is recruiter QA of the brief, not the candidate accommodations of VOX6.
- i18n seam checked end-to-end (per the re-scan hint): portal page is fully localized (`getTranslations` in `app/interview/[token]/page.tsx`, commit 7922fbe); locale resolves cookie → Accept-Language → default with a `?lang` proxy (`proxy.ts`) built for candidate links; the agent language hint is already seeded from the candidate's UI locale on the locked portal (`VoiceInterview.tsx:87-92`) and a cs/en/auto toggle remains in unlocked mode. `coerceLanguage` callers: `/create` (accepts `language` but NO caller sends it — ScheduleTab.tsx:138 and CandidateDrawer `voice.create` post `entryId`/`provider` only) and `/connect` (candidate's hint). Residuals are either retired VOX5 (per-role language config) or the sim-channels scout's comm-template localization (appending `?lang` to the emailed link belongs with the localized invite) → no finding claimed.
- Dedup vs. other scouts this run: comm-template localization incl. interview invites (sim-channels) — dropped the `?lang`-on-link angle into their lane; human-scorecard→Decisions gate (decision-workflow) and prep-modal seams (interview-prep) untouched; `simulate/route.ts` missing safeJsonError is a known bug-fix follow-up, not reported.
- VOX3-for-CompareInterviews (documented W7 "smaller" deferral) verified still absent (`sub_jobs/CompareInterviews.tsx:204-237` renders evidence as plain text) — deliberately NOT reported: it is a sub-item of shipped VOX3 in a retired backlog, and re-warming it would violate the re-scan bar.
- Greps run: `coerceLanguage`, `api/interview/create` callers, `dispatchInterviewInvite`, `delivered`, `revoke|reissue|cancelInterview|expire` (no interview-session hits), `rehears|preview` (none on this surface), `interview/simulate` callers, `InterviewSession|interview_sessions` in db.ts, `?lang` sites. Reads: create/connect/complete/by-entry/simulate routes, interview-run.ts, interview-reminders.ts, ScheduleTab, CandidateDrawer (voice panel), TokenLink usage, interview-lab page, portal page, i18n/{request,locales,actions,server}.ts, proxy.ts, db.ts session layer. Git log since 2026-06-08 on the surface: 7922fbe (i18n), 47eb7ca, c7e6fea, 922fca5 (provider pinned/picker hidden on portal), d26aef6 (W14), f58778a (VOX1) — no lifecycle/rehearsal capability shipped meanwhile.
