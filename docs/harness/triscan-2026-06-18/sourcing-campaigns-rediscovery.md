# Sourcing, Campaigns & Rediscovery — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 1 ui / 2 biz

## 1. Outreach re-contacts candidates with no opt-out / do-not-contact suppression
- **Lens**: 🚀 Business Visionary (primary) · 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Compliance / outreach trust boundary
- **Value**: impact 9/10 · effort 4/10 · risk 4/10
- **File**: `app/_lib/comms-dispatch.ts:147` (dispatchOutreach) → `app/_lib/comms-dispatch.ts:100` (sendCandidateComm); entered from `app/api/jobs/[id]/candidates/outreach/route.ts:54`
- **Scenario**: A recruiter clicks "Reach out" on a silver medalist in RediscoverPanel/RecruiterCandidates. The candidate was *rejected* from a past role (that's exactly the rediscovery selector, `rediscover.ts:44`). They may have asked not to be contacted, or their GDPR consent has expired/been anonymized-pending. `dispatchOutreach` builds and sends the message; `sendCandidateComm` only skips a fully-anonymized entry — there is no opt-out / suppression / consent-state gate before the send.
- **Root cause**: The consent system (`consent.ts`, `consentStatus`, `ConsentPanel`) governs retention/anonymization but is never consulted on the outbound outreach path. Rediscovery is precisely the surface that re-contacts previously-rejected people, so the gap is most exposed here.
- **Impact**: Unsolicited contact to opted-out/expired-consent candidates — a CAN-SPAM/GDPR-class violation on a revenue-adjacent feature, and reputational/legal exposure recruiters will not tolerate. It is also the table-stakes capability (suppression lists) recruiters expect from any sourcing/sequencing tool.
- **Fix sketch**: Before `sendCandidateComm` in `dispatchOutreach`, read the entry's `consentStatus`; if `expired`/`anonymized`/explicit do-not-contact, return without sending and set `applied="suppressed"` so the UI shows "Cannot contact — consent expired" instead of a false "reached out". Add a per-candidate suppression flag and check it here.

## 2. Pool caps silently exclude candidates from ranking AND rediscovery
- **Lens**: 🐛 Bug Hunter (primary) · 🚀 Business Visionary
- **Severity**: High
- **Category**: Data loss / silent truncation
- **Value**: impact 7/10 · effort 3/10 · risk 3/10
- **File**: `app/_lib/candidate-pool.ts:17-18,49-60`
- **Scenario**: With >100 saved profiles or >60 saved analyses, `buildCandidatePool` returns only the most-recent `PROFILE_POOL_CAP + ANALYSIS_POOL_CAP` (ordered `created_at DESC`). The overflow is never scored by the candidates tab, never rediscovered, and never raises a silver-medalist alert. The only signal is a `console.warn` the recruiter never sees.
- **Root cause**: Hard `LIMIT` in `listProfileRecords`/`listAnalysisRecords` with a server-only log. Oldest candidates — exactly the dormant talent rediscovery promises to resurface ("we won't let strong past candidates fall through the cracks", `rediscover.ts:14-16`) — are the ones dropped.
- **Impact**: The feature's core promise is silently violated at scale; a strong rejected candidate from 8 months ago is invisible with no in-product indication the pool was truncated.
- **Fix sketch**: Thread a `poolTruncated`/`poolTotal` count from the cap check into `/candidates`, `/rediscover`, and the alert sweep responses; render a visible banner ("ranking newest 160 of 240 — older candidates excluded"). Longer term, page or score in batches instead of dropping.

## 3. Rediscovery never surfaces the `more` count — dropped silver medalists are invisible
- **Lens**: 🎨 UI Perfectionist (primary) · 🐛 Bug Hunter
- **Severity**: High
- **Category**: Truncation not surfaced / honesty gap
- **Value**: impact 6/10 · effort 2/10 · risk 1/10
- **File**: `app/features/sub_jobs/RediscoverPanel.tsx:23-28` (vs `app/_lib/rediscover.ts:21-23,93-98`)
- **Scenario**: `rediscoverForJob` ranks all eligible silver medalists, shows the top 20 (`REDISCOVER_LIMIT`), and returns `more` = the number of eligible candidates dropped — specifically so "the cap never reads as 'this is everyone'" (`rediscover.ts:21-23`). The route forwards `more` (`rediscover/route.ts:28`), but `RediscoverPanel` destructures only `{ rediscovered, skipped }` and never reads or renders `more`.
- **Root cause**: The component's `useJsonFetch` generic omits `more`; the deliberately-built signal is dropped on the floor at the render boundary.
- **Impact**: A role with 35 qualified rediscoveries looks like it has exactly 20 — the recruiter assumes they've seen everyone and stops sourcing. The backend honesty contract is defeated by the UI.
- **Fix sketch**: Add `more?: number` to the fetch type; when `> 0`, render a footer line ("+N more past candidates clear the bar — refine the role or widen the pool"). One-line type change plus a conditional `<p>`.

## 4. RediscoveryFeed shows "no alerts" when the fetch actually failed
- **Lens**: 🎨 UI Perfectionist (primary)
- **Severity**: Medium
- **Category**: Error state collapsed into empty state
- **Value**: impact 5/10 · effort 2/10 · risk 1/10
- **File**: `app/features/sub_jobs/RediscoveryFeed.tsx:45-54,152-153`
- **Scenario**: The initial `GET /api/rediscovery/alerts` throws or returns non-OK. The catch/else both `setAlerts([])`, so the feed renders the calm empty state ("No silver medalists right now") — identical to a genuinely empty feed. A recruiter with real pending rediscoveries sees nothing and never knows the load failed.
- **Root cause**: No `error` state on the initial load; failure and emptiness are conflated (the sweep path *does* distinguish `sweepFailed`, but first load does not).
- **Impact**: Silent failure on a revenue-adjacent surface; the recruiter loses standing alerts with no cue to retry, eroding trust in the feature's reliability.
- **Fix sketch**: Add an `error` state; on a failed initial fetch set it and render a distinct "Couldn't load rediscovery alerts — Retry" row (reuse the sweep button) rather than the empty copy.

## 5. Silver-medalist alerts never expire on a stale match — only on relevance death
- **Lens**: 🚀 Business Visionary (primary) · 🐛 Bug Hunter
- **Severity**: Medium
- **Category**: Stale data / sourcing journey decay
- **Value**: impact 5/10 · effort 4/10 · risk 3/10
- **File**: `app/_lib/rediscovery-alert-store.ts:70-103` + `app/api/rediscovery/alerts/route.ts:22-31`
- **Scenario**: An alert is raised at publish with a captured `score` and `job_title`. `INSERT OR IGNORE` means a later sweep never updates an existing row (`rediscovery-alert-store.ts:78-82,98`). If the candidate's profile is later enriched (or the role's must-haves tightened) so they'd now score *below* `SCORE_FLOOR`, or the role is renamed, the feed keeps showing the original stale score/title indefinitely. `filterRelevantAlerts` only drops on unpublish or being-pipelined — not on the match going stale.
- **Root cause**: Alerts are write-once snapshots with no re-validation of the underlying score/title; relevance filtering checks pipeline/publish state but not current fit.
- **Impact**: Recruiter acts on a stale "82 — clears the bar" that no longer holds, or sees an old role name — small but corrosive trust hits on a standing feed meant to be authoritative.
- **Fix sketch**: On sweep, `UPDATE` the score/job_title for still-active (non-dismissed) rows and DELETE rows that now fall below `SCORE_FLOOR`; or re-validate score at read time in `relevantAlerts()` against the live ranking already computed by the sweep.
