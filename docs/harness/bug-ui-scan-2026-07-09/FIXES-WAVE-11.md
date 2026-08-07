# Fix Wave 11 — UI & accessibility (6 Highs) — the final wave

> 6 commits (`980ab85` i18n + `20b82be`, `2cd31e0`, `2a47bd5`, `300e38b`, `8638384`), **6 Highs closed**.
> Baseline preserved: tsc 0 · node unit 1530 → **1560** · python 878 OK · i18n 3240 → **3249** × 4 · `next build` ✓.
>
> **This wave closes the last open High. All 9 Criticals and all 66 Highs from the 2026-07-09 scan are now remediated.**

## Commits

| Commit | Finding(s) | Fix |
|---|---|---|
| `980ab85` | (i18n) | The wave's message keys, landed first so each `t()` type-checks. |
| `20b82be` | app-shell-navigation #1 | Collapsed mobile drawer goes `inert` (gated on `isMobile`); open drawer traps focus via `useDialogA11y`. |
| `2cd31e0` | branding-white-label #1 | Reject an accent that fails 3:1 contrast against white and the paper canvas. |
| `2a47bd5` | landing-marketing #1, #2 | Choropleth region values reach SR/keyboard; a mobile hamburger exposes Sign In. |
| `300e38b` | candidate-profile #2, job-postings #2 | A failed re-rank keeps the prior ranking; the Jobs table refreshes after a lifecycle action. |
| `8638384` | pipeline-board #1 | A per-card "Move to…" combobox gives drag-to-move a keyboard twin. |

## The theme

Every fix here made an invisible or unreachable thing reachable: a nav drawer that lied to
assistive tech about being closed, an accent that made its own text disappear, a map whose
data only existed in color, a re-rank error that erased the data behind it, a drag gesture with
no keyboard path. Five of the six extracted a **pure `.ts` decision** — the truth table for
`inert`, the contrast ratio, the region label, the keep-prior-results choice, the move-target
list — because the bare `node --test` runner can't load a `.tsx`, so a pure helper is the only
unit-testable seam (pattern 28). Each was proven non-vacuous, several against a *naive* version
of the fix (a `inert={!open}` that would disable the desktop rail; a `PIPELINE_STAGES.slice()`
that ignores the Hired-exclusion), not just against pre-fix code.

## Verification

| Gate | Before | After |
|---|---|---|
| tsc | 0 | 0 |
| node unit | 1530 | **1560** |
| python | 878 OK | 878 OK |
| i18n | 3240 × 4 | 3249 × 4 |
| `next build` | ✓ | ✓ |

## Run complete — cumulative

| Severity | Found | Closed |
|---|---:|---:|
| Critical | 9 | **9** |
| High | 66 | **66** |
| Medium | 125 | (open) |
| Low | 30 | (open) |

**11 fix waves, ~75 findings closed, ~90 fix commits + per-wave docs, 0 regressions.** Gates end
at tsc 0 · node unit 1355 → 1560 · python 781 → 878 · i18n 3233 → 3249 × 4 · `next build` ✓ ·
`matching_eval --strict` 8/8. The 155 Medium + Low findings remain, catalogued in the INDEX.

See `harness-learnings.md` for the 28-item pattern catalogue and the cumulative deploy checklist
(the new `KP_DECISION_HMAC_KEY` / `KP_SKILL_PROFILE_KEY` / `KP_ATS_SECRET_KEY` env vars, the
billing behavior changes, the operator re-login, and `test:eval:strict`'s intended new failure).
