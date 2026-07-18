# Fix Wave 6 — Single-source-of-truth / magic numbers (Medium/Low tail)

> 6 findings closed in 6 atomic commits (4 Medium, 2 Low). First wave into the M/L tail. Theme: a constant restated in two places that silently drift.
> Baseline preserved: tsc 0 → 0; node suite 2366 → 2371 pass; python 1157 pass. 0 regressions.
> Branch: `vibeman/ambiguity-ui-wave1`. All targets in clean files.

## Commits

| # | Commit | Finding | Sev | Files |
|---|---|---|---|---|
| 1 | `6ac5d91` | pool-fit floor re-hardcodes rediscovery SCORE_FLOOR | M | `fit-thresholds.ts` (new), `rediscover.ts`, `RecruiterCandidates.tsx` (+test) |
| 2 | `ffab8c3` | RECENT_WINDOW_DAYS hand-copied from the server | M | `tasks-window.ts` (new), `tasks.ts`, `TasksTab.tsx` |
| 3 | `68f113e` | min-fit floors [0,55,70] unaligned with the bands | M | `matrix-stats.ts`, `MatrixTab.tsx` (+test) |
| 4 | `24ab9e6` | ScoreBadge renders a raw, unclamped score | L | `ScoreBadge.tsx` (+source-guard) |
| 5 | `52dbec0` | offer-draft salary fallback duplicates SIM_SALARY | M | `sim/offer-draft/route.ts` (+source-guard) |
| 6 | `2eeac88` | MIN_LINKEDIN_TEXT_LEN dead while its call site inlines 5000 | L | `test_pdf_parsing_quality.py` |

## The shared shape

Each was a value restated as a literal in a second place — usually because the canonical module imports `better-sqlite3` and can't load in the client bundle — with the coupling living only in a comment that nothing enforces. The fix pattern: hoist the constant into a tiny **import-free** module (`fit-thresholds.ts`, `tasks-window.ts`) or derive it from the existing single source (`MIN_FIT_FLOORS` from `MATRIX_BANDS`, `SIM_SALARY`, `MIN_LINKEDIN_TEXT_LEN`), and import the runtime value on both sides. ScoreBadge is the same shape one level down — it opted out of the family's `format.ts` round/clamp contract.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc --noEmit | 0 | 0 |
| node suite | 2366 | 2371 pass / 0 fail |
| python suite | 1157 | 1157 pass / 0 fail |

## Pattern established (catalogue item 22)

22. **Client-restated server constant** — a value the server owns but a client component can't import (db-bound module) gets re-declared as a literal, with a comment claiming they're linked. Hoist it to an import-free module both sides import at runtime (a `type`-only import is not enough — the value is needed at runtime); or derive it from the existing single source.

## M/L tail status

190 Medium/Low findings total; 6 closed here. Remaining clusters for future waves: design-system/visual-token drift (~12), i18n/hardcoded strings (blocked on the WIP message files), error-state visual consistency, and assorted per-context papercuts. Many i18n and message-file-touching fixes stay deferred while the user's `messages/*.json` WIP is in flight.
