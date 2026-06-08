# Feature Scout Fix Wave 15 — Med/Low sweep, batch 1 (dedup-by-email, PIPE5, MAT5)

> 3 commits on `main`, the first three of the recommended Med/Low order.
> Baseline preserved: tsc 0 → 0 · unit 635 → 638 (+3 dedup tests) · python 490 → 490 · next build ✓.

## Commits

| # | Commit | Opportunity | Files |
|---|---|---|---|
| 1 | `6a9325d` | **dedup-by-email** — apply dedup keys on email, not just name | `apply-intake.ts` (+ test), `db.ts`, `api/apply/[id]/route.ts` |
| 2 | `592b795` | **PIPE5** — saved board views | `PipelineTab.tsx` |
| 3 | `bcc4c00` | **MAT5** — compare jobs side-by-side for one candidate | `JobCompare.tsx` (new), `Results.tsx` |

## What was shipped

- **dedup-by-email** (correctness). Apply dedup was name-only — two different people
  sharing a name merged onto one entry, and the identity check ignored the email APP2
  captures. `applyDedupeKey` + `findApplicationByApplicant` now key on the **email**
  when given (the stronger identity), name as the fallback. The email key hyphenates
  non-alphanumerics so `a.b@x.com` and `ab@x.com` survive the slug strip distinctly.
  +3 apply-intake tests.
- **PIPE5** — saved board views. Builds on PIPE2's filter: a "Save view" control
  snapshots the current {search, quick-filter} as a named view in localStorage; views
  render as pills above the board (apply / delete / active-highlight), and the save
  button hides once the current combo already matches one. Client-only, no schema.
- **MAT5** — compare jobs for one candidate. Reuses the match-results selection: tick
  2–4 roles → "Compare N" renders a transposed table (roles as columns; rows = overall
  fit, confidence, each scoreBreakdown dimension aligned by key, matched/missing
  skills, salary band) with the winning cell per row tinted. All data already on each
  MatchResult — no fetch.

## Verification

| Gate | Baseline | After Wave 15 |
|---|---|---|
| `tsc --noEmit` | 0 | 0 |
| `next build` | ✓ | ✓ |
| `npm run test:unit` | 635 | 638 (+3) |
| `npm run test:python` | 490 (4 skip) | 490 (4 skip) |

## Med/Low order — progress

Done: dedup-by-email ✅, PIPE5 ✅, MAT5 ✅. Next, in order: **PREP5** (interviewer
assignment) → **DEC5** (per-role rules + auto-advance) → **PIPE4** (per-stage SLA) →
all-tabs PDF → VOX5 → JOB5 → VOX4 → DEC6 → PREP4 (large) → SCH4 (delicate). Heavyweight
VOX2 deliberately skipped.

## Branch / merge note

Committed on `main` (post-merge). `main` now 51 commits ahead of `origin/main`,
unpushed. Pre-existing idea-batch WIP untouched.
