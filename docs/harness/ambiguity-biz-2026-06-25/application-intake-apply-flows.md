# Application Intake & Apply Flows — Ambiguity 🌀 + Business 🚀 scan
> Total: 5 | Lens: 🌀2 / 🚀3 | Severity: C0/H1/M3/L1

## 1. Status-tracking link never reaches the candidate's inbox
- **Lens**: 🚀 Business
- **Severity**: High
- **Category**: candidate-experience / shipped-feature half-delivered
- **File**: app/api/apply/[id]/route.ts:474
- **Observation**: The whole premise of the status feature (idea-e76a6fb2) is stated in app/_lib/application-status.ts:1-5 — "kp captures the application then goes dark — the candidate can't see where they stand without emailing the recruiter." Yet the unguessable `statusToken` is only minted for the POST JSON (route.ts:487) and rendered as an in-page "Track status" button (ConversationalApply.tsx:443-450). The durable touchpoint — the acknowledgement email built in `dispatchApplicationReceived` — carries only the `enrichLink`, never the status link (comms-dispatch.ts:138-139, called at route.ts:474). Close the tab and the token is gone forever: it isn't in any email and there is no "email me my status link" / lookup-by-email recovery path.
- **Why it matters**: The single most-cited candidate-experience complaint in recruiting ("I applied and heard nothing") is exactly what this feature was built to fix, and the fix only survives as long as the candidate keeps the tab open. The built infrastructure (token store, public page, friendly status projection) delivers almost none of its value.
- **Recommendation**: Append `${publicBaseUrl}/status/${statusToken}` to the ack email body (a `bodyWithStatus` variant, mirroring `bodyEnrich`). Optionally add a "resend my status link to my email" action on the token route.
- **Effort**: S

## 2. Quick-apply enrichment CTA is hidden for returning leads — and the leadToken minted for them is dead
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / wiring-intent mismatch
- **File**: app/apply/[id]/quick/QuickApplyForm.tsx:110
- **Observation**: The quick-apply route deliberately returns `leadToken` on the duplicate branch, commented "lets the success screen's 'complete your profile' CTA carry the same identity as the emailed link" (app/api/apply/[id]/quick/route.ts:132-138). But the form only renders the "complete your profile" CTA when `fresh = accepted && !duplicate` (QuickApplyForm.tsx:102, gate at :110). So a returning lead — precisely the thin, intake-degraded stub that most needs enrichment — sees no in-screen path to finish their profile, and the token the backend prepared for that exact case is never used.
- **Why it matters**: The enrichment loop is how a 30-second ad-traffic lead becomes a matchable candidate. Suppressing the CTA for repeat visitors throws away conversions from the warmest possible audience (someone who came back) and leaves backend code that looks intentional but is unreachable.
- **Recommendation**: Show the enrich CTA for any `accepted` outcome that returned a `leadToken` (drop the `!duplicate` condition); word it as "finish your profile" for the duplicate case.
- **Effort**: S

## 3. The completeness follow-up engine is recruiter-only — the candidate apply flow never uses it
- **Lens**: 🚀 Business
- **Severity**: Medium
- **Category**: dark capability / value left on the table
- **File**: app/_lib/completeness-followup.ts:33
- **Observation**: `GAP_FIELDS` (8 targeted, archetype-aware prompts) and `mergeGapAnswers` are battle-tested intake-completion machinery, but the only consumer is the recruiter-side `app/_components/results/ArchetypeBanner.tsx:7` ("lets the recruiter promote the analyzed CV into a real, matchable profile"). The candidate apply path imports none of it. The apply route already computes a `completeness` score at intake (route.ts:131, `validation.value.completeness`) yet acts on it nowhere: a thin or `intakeDegraded` application files as a stub and goes dark to the candidate, waiting on a recruiter or a future re-apply.
- **Why it matters**: This context's own charter lists "completeness follow-ups," but the candidate never gets one in-session. Asking the 1-2 highest-weight missing items right after an accept — while the candidate is still present and motivated — would lift profile quality at the cheapest possible moment and cut recruiter manual-capture work. The capability is fully built and simply unsurfaced on the top-of-funnel surface.
- **Recommendation**: When `built.ok` but `completeness` is below a threshold (or `!built.ok`), surface the relevant `GAP_FIELDS` questions as a short optional post-accept step in ConversationalApply, folding answers via `mergeGapAnswers` → /api/profile.
- **Effort**: M

## 4. 64 KB CV head-sampling silently truncates long résumés on an unstated bet
- **Lens**: 🌀 Ambiguity
- **Severity**: Medium
- **Category**: hidden assumption / unhandled edge case
- **File**: app/api/apply/[id]/route.ts:275
- **Observation**: Extracted CV text is `.slice(0, MAX_CV_TEXT_LENGTH)` where `MAX_CV_TEXT_LENGTH = 64 * 1024` (route.ts:56), justified by the comment "the most relevant content sits at the top of a CV." That is a contestable assumption baked directly into a hiring outcome, and it is applied *silently* — unlike the free-text answers, which are **rejected** with a "please shorten it" 400 so the candidate can fix them (route.ts:289). A multi-page senior CV, or one whose skills/certifications/summary block sits at the end, loses its tail with no signal to the candidate or the recruiter that anything was dropped.
- **Why it matters**: A truncated CV feeds the Python normalizer and scoring engine, so a silent cut can quietly change match/seniority results for exactly the highest-value (most experienced, longest-CV) candidates — and nobody can tell it happened.
- **Recommendation**: When truncation occurs, flag it on the entry (recruiter-visible, like `intakeDegradedReason`) and/or prefer extracting the skills/experience sections rather than a blind head slice. Document the assumption as a revisit-able decision.
- **Effort**: S

## 5. Years-of-experience parsing silently rounds a stated range UP to its upper bound
- **Lens**: 🌀 Ambiguity
- **Severity**: Low
- **Category**: undocumented trade-off / directional bias
- **File**: app/_lib/apply-intake.ts:57
- **Observation**: `parseYearsExperience` uses `/\b(\d{1,2})\s*\+?\s*(?:years|yrs|let|roky|rok)/i` and returns "the integer adjacent to the unit," so "5 to 8 years" → 8 and "3-5 years" → 5 (documented at apply-intake.ts:47). The *contract* is recorded, but its directional consequence is not: when a candidate hedges with a range, the system always credits the high end as fact, then feeds `yearsExperience` into profile scoring/matching.
- **Why it matters**: Self-reported ranges systematically resolve in the candidate's favor for seniority — an undisclosed optimistic bias in a fairness-sensitive hiring pipeline. It is invisible because it reads as "just the parser's contract."
- **Recommendation**: Decide and document the intended rule (lower bound is the conservative/defensible choice for unverified self-report), or capture both bounds; either way, state the directional choice and its reasoning next to the contract.
- **Effort**: S
