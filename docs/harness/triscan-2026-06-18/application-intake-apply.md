# Application Intake & Apply Flows — Tri-Lens Scan
> Total: 5
> Severity: 1 Critical / 2 High / 2 Medium / 0 Low
> Lens: 2 bug / 2 ui / 1 biz

## 1. Public apply + quick-apply POSTs have no rate limiting (sibling inbound route does)
- **Lens**: 🐛 Bug Hunter
- **Severity**: Critical
- **Category**: Abuse / lead spam / cost DoS
- **Value**: impact 9/10 · effort 2/10 · risk 2/10
- **File**: `app/api/apply/[id]/route.ts:182` and `app/api/apply/[id]/quick/route.ts:36`
- **Scenario**: A script POSTs `/api/apply/<id>` in a loop. Each conversational request that passes the KO gate spawns a Python `profile_cli` subprocess (`spawnPython`, line 97), writes `intake.json` to temp disk, AND dispatches an acknowledgement email — per request. The quick route fires a candidate email on every accepted lead. Nothing throttles either; a few hundred req/s exhausts CPU/process slots and floods the comms provider with attacker-chosen recipient emails.
- **Root cause**: The team already built `app/_lib/rate-limit.ts` (`rateLimit` + `clientIpFrom`) and wired it into the public `api/channels/inbound/[token]/route.ts` (line 44) and offer/schedule routes — but the two highest-volume public intake routes were never given the same guard. Body caps exist; request-rate caps don't.
- **Impact**: Trivially exploitable subprocess/email-flood DoS on the most exposed candidate surface; provider cost + reputation (spam complaints) damage; pipeline pollution with junk Accepted entries.
- **Fix sketch**: Mirror the inbound route: `if (!rateLimit(\`apply:${id}:${clientIpFrom(request.headers)}\`, { limit: 20, windowMs: 60_000 })) return NextResponse.json({ error: RATE_LIMITED_ERROR }, { status: 429 })` at the top of both POSTs. 429 is already in `isRetryableApplyStatus`, so the client's "Try again" path handles it for free.

## 2. No anti-bot/honeypot on the public lead forms — clean-form spam bypasses the KO gate
- **Lens**: 🐛 Bug Hunter
- **Severity**: High
- **Category**: Lead spam / data quality
- **Value**: impact 7/10 · effort 3/10 · risk 2/10
- **File**: `app/apply/[id]/quick/QuickApplyForm.tsx:56` and `app/api/apply/[id]/quick/route.ts:73`
- **Scenario**: A bot fills `name`, a syntactically-valid `email`, and clicks every KO "Yes". The server's only gate is `failedKoStepIds` (all-true required) — which a bot satisfies by answering true. Each submission files a real Accepted pipeline entry and dispatches an acknowledgement email to the supplied (possibly forged/victim) address. There is no honeypot field, no timing check, and no CAPTCHA.
- **Root cause**: Eligibility (KO) was treated as the spam gate, but KO only filters *ineligible* humans, not *bots*. A reachable-email requirement is not abuse prevention — attackers supply victims' addresses (the app then emails them = unsolicited mail / list-bombing vector).
- **Impact**: Recruiter pipeline polluted with fake candidates; the product becomes an open email-relay for list-bombing third parties; combined with finding #1, amplified.
- **Fix sketch**: Add a hidden honeypot input (e.g. `company_url`) to both forms; reject server-side when filled. Optionally record a client-rendered timestamp and reject sub-2s submits. Cheap, no UX cost, no third-party dependency — and complements (doesn't replace) #1's rate limit.

## 3. Status page never refreshes and has no empty/expired-vs-error distinction
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Loading/refresh state · error clarity
- **File**: `app/status/[token]/page.tsx:33` and `app/api/status/[token]/route.ts:17`
- **Scenario**: A candidate bookmarks `/status/<token>` (the whole point of the feature is returning to check). The page fetches once in a mount-only `useEffect` and never polls or refetches on focus, so a candidate who leaves the tab open sees a stale stage indefinitely. Separately, both a guessed/expired token and a real server fault collapse to the same generic `t("loadFailed")` banner (the API returns 404 "not found" for an unknown token, but the client throws on any `p.error` and shows one message), so a candidate with a typo'd link gets the same scary error as a true outage.
- **Root cause**: `setView` runs once; no visibility/`focus` listener or interval. The catch is a single bucket regardless of HTTP status.
- **Impact**: Candidates perceive the tracker as broken/stale (erodes the transparency promise the feature exists to deliver) and can't tell "bad link" from "try later".
- **Fix sketch**: Refetch on `visibilitychange`/window focus (and/or a slow 60s poll while non-terminal). Branch on `res.status === 404` to render a distinct "link not recognized — check the link from your email" message vs. the generic retryable error.

## 4. Conversational submit error block hides the whole conversation while showing only a "Start over" button
- **Lens**: 🎨 UI Perfectionist
- **Severity**: Medium
- **Category**: Error-recovery UX · data-loss perception
- **File**: `app/apply/[id]/ConversationalApply.tsx:484`
- **Scenario**: On a non-retryable final-submit failure (e.g. 413/400), the step-controls block is gated on `!submitError` (line 484), so the input controls vanish and the candidate sees only the error card with "Start over". The conversation transcript above survives, but every captured answer is about to be discarded by `restartConversation()` (line 274 resets `answers`, `idx`, `msgs`), and the candidate is given no chance to see or edit the specific oversized/invalid field — only to re-walk the entire chat. After investing 6–9 questions, this reads as total data loss.
- **Root cause**: The recovery model is binary (retry-same vs. restart-all) with no "edit the offending field" path; the server's 400/413 reason isn't mapped back to a specific step.
- **Impact**: High-effort applicants (the desirable ones who wrote detailed answers / uploaded a CV) hit a wall and drop off rather than restart — direct conversion loss on the brand surface.
- **Fix sketch**: For the known non-retryable causes (answer-too-long/payload-too-large), keep the answers and jump back to the longest free-text step with an inline "this answer is too long" hint, rather than a full restart. At minimum, change the "Start over" copy to warn answers will be cleared, and surface the server's reason verbatim.

## 5. Contactless conversational applicants get a status link they can never recover
- **Lens**: 🚀 Business Visionary
- **Severity**: High
- **Category**: Candidate experience · status transparency · drop-off
- **File**: `app/api/apply/[id]/route.ts:284` (email optional) + `:474` (statusToken only returned in JSON) and `app/apply/[id]/ConversationalApply.tsx:443`
- **Scenario**: The conversational flow deliberately does NOT require an email (route comment line 283–284: "Apply doesn't HARD-block on a missing email"). A candidate who skips/omits email still gets `statusToken` minted (`safeStatusLink`) and rendered as a "Track status" link on the success screen — but with no email on file, the acknowledgement dead-letters (`dispatchApplicationReceived` has no recipient) and the token exists ONLY in that one ephemeral page render. Close the tab and the only handle to their application is gone forever; they also can never be contacted for interview/offer.
- **Root cause**: Email is optional at intake but is the sole durable channel for both the status token and all downstream comms. The flow optimizes for "never block applying" without flagging the cost to the candidate, and the success UI doesn't prompt them to save/receive the link.
- **Impact**: A silent dead-end for the candidate (no status, no contact, no recovery) and a wasted lead for the employer — the application is effectively unreachable. Undermines the "never go dark on candidates" thesis the status feature was built to deliver.
- **Fix sketch**: When `contact` is null at acceptance, surface a soft prompt on the success screen ("Add your email so we can reach you and you can return to this link"), or make email required-but-late (one last optional capture before the win screen). At minimum, render an explicit "copy/save this link" affordance plus a warning that it's the only way back when no email was given.
