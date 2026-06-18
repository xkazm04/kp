# Tri-Lens Fix — High Wave 6: UI / a11y polish

> 2 atomic fix commits, **2 High findings closed**; 1 High deferred-with-reason.
> Baseline preserved: tsc 0 → 0 · TS unit tests 964 → 964 · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Commits

| Commit | Finding | Severity | Files |
|---|---|---|---|
| `98e7bac` | shared-ui #1 — ScoreDial "NaN · Excellent" | High | _components/ScoreDial.tsx |
| `75d7f93` | shared-ui #4 — SegmentedControl unmatched-value keyboard | High | _components/SegmentedControl.tsx |

## What was fixed

1. **ScoreDial guards a non-finite score.** `clampPercent` passes `NaN` through by design (callers guard separately), but `ScoreDial` didn't — a non-finite score fell through `bandIndex`'s `<=` chain to the final `return 4` ("Excellent"), rendered the literal "NaN", and announced "Score NaN out of 100, Excellent". The hero verdict surface (reused across results / matrix / JD) defaced itself *and* silently upgraded junk to the top band. Now a non-finite score becomes 0 (the "Early"/null floor) — display, band, color, and aria-label all safe.

2. **SegmentedControl first-arrow no longer commits a value silently.** When `value` matches no option (off-taxonomy / stale-enum dev path), the fallback tab stop is option 0 but nothing is aria-checked; the first ArrowRight ran `move(0+1)`, skipping option 0 and silently committing option 1 (announced as "0 of N selected" then a surprise change). Now, when nothing matches, the first directional key explicitly selects option 0; normal radiogroup APG movement resumes once a value matches. Dev warning + normal-case semantics preserved.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `node --test app/**/*.test.ts` | 964 | 964 |

(Both fixes are in client components — outside the codebase's pure-lib test boundary — verified by tsc + the full suite. Each is a small, self-contained guard.)

## Deferred-with-reason (this theme)

- **shared-ui #5 (ErrorBoundary hardcoded English)** — the recoverable fallback ("Something went wrong here" / "Try again") is hardcoded while the rest of the design system is `next-intl` localized. `ErrorBoundary` is a class component (needs `getDerivedStateFromError`), so `useTranslations` can't be used directly; a correct fix adds an `errors` message namespace (en + cs) and threads localized `title`/`body`/`retryLabel` props from a thin client wrapper at every call site. Needs catalog additions + a wrapper pattern — its own small change, not a one-liner.

## Cumulative this session

30/30 criticals + **19 Highs** closed across 14 waves, 0 regressions throughout. TS 935→964, Python 626→634.
