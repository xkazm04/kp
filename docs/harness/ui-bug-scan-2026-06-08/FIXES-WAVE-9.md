# UI+Bug Scan — Fix Wave 9: UI states & polish (final wave)

> 6 findings closed (1 High, 5 Medium/Low) across 5 atomic commits. The remaining UI-polish long tail is deferred (listed below).
> Baseline preserved: tsc 0 → 0, next build ✓, unit 638 → 638, lint clean.
> One mental model: **complete the state matrix — recover gracefully, confirm the irreversible, never show a dead/misleading state.**

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `9e45a90` | mistyped email forces a full restart | High | ConversationalApply.tsx |
| 2 | `8204992` | terminal decline fires on one click, no confirm/label | Medium | ScheduleTab.tsx |
| 3 | `458dd11` | empty pipeline shows a populated-looking zero funnel | Medium | AnalyticsTab.tsx |
| 4 | `366642e` | "Invalid Date" + non-array repos response | Medium + Low | GithubAnalysisPanel.tsx, github-analysis/route.ts |
| 5 | `771216c` | recruiter CandidateCard header can't wrap | Medium | RecruiterCandidates.tsx |

## What was fixed

1. **email validate-at-step (High)** — the email is now validated inline at its step (same regex the server uses), so a typo is fixed in place instead of rejected only at the final submit, which forced a full "Start over" wiping every answer on a public funnel.
2. **decline confirm + label** — the terminal one-click X decline is gated behind a confirm and given an aria-label (decorative icon `aria-hidden`).
3. **analytics empty funnel** — shows an explicit empty state when the pipeline is empty instead of all-zero bars that read as real data.
4. **github guards** — a malformed `updatedAt` renders an em-dash (not "Invalid Date"), and a non-array `repos` response throws a clear "unexpected shape" error instead of an opaque `repos.filter is not a function`.
5. **CandidateCard wrap** — the header row now wraps so action buttons don't overflow on narrow widths.

## Deferred — UI-polish long tail (open in INDEX)

These remaining Medium/Low items were not in this wave; they're pure visual/UX polish and are tracked for a follow-up:
- cv-analysis saved-JD picker has no loading/failure feedback (Med)
- decision cached group-eval that fails to load shows "No evaluation yet" (Med)
- scheduling reschedule into a fully-booked horizon renders a blank list (Med)
- demo-sim eval/wave Modal (z-50) covers the SimBar controls (z-47) (Med)
- dev-case-studio fit chip vs rank disagree during the eval→reload gap (Med)
- jd template manager flashes an empty list with no loading/empty state (Low)
- voice transcript empty-state copy contradicts the connecting phase (Low)
- workspace Markdown drops nested bold/italic (Low)
- DecisionRulesModal returns to a stale view on a 400 (Low)
- (earlier waves) sim reset re-orphans rows mid-run (Med); conversational-apply per-step focus management (Med); interview-prep coverage counter math (Low)

## Verification (before / after)

| Gate | Baseline (B2) | After Wave 9 |
|---|---|---|
| tsc --noEmit | 0 errors | 0 errors |
| next build | ✓ | ✓ (Compiled successfully) |
| test:unit | 638 pass | 638 pass |
| eslint (touched files) | — | clean |

## Cumulative status — all 9 waves

| Wave | Theme | Closed |
|---|---|---|
| 1 | Trust-boundary & validation (security) | 8 |
| 2 | Data integrity (lost-updates & dropped writes) | 7 |
| 3 | Identity-by-label / wrong-record | 5 |
| 4 | Concurrency & idempotency | 6 |
| 5 | Stale UI / fetch-state | 8 |
| 6 | Silent failures & opaque errors | 6 |
| 7 | Score / number / label consistency | 8 |
| 8 | Accessibility | 10 |
| 9 | UI states & polish | 6 |
| | **Total closed** | **64 of 83** |

**All 3 criticals + all 27 highs of the audited themes are closed.** The 19 open are the Medium/Low UI-polish tail above. Baseline preserved across every wave (tsc 0, next build ✓, unit 638, lint clean). Pattern catalogue: 21 durable items across FIXES-WAVE-1..9.
