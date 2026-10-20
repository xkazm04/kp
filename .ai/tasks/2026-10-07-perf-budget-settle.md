# Perf budget settle (commit 3 of the attribution)

Date: 2026-10-07. Base: 2c95aba47. Follows `.ai/tasks/2026-10-06-perf-budget-attribution.md`
(Fix A 9dee0c619, Fix B ceb23365d, and 2c95aba47's `app/_lib/db/role-rubrics.ts`).

Only `perf-budget.json` changed. Rule applied: module ceiling = measured modules; KB ceiling =
measured KB + 2; the group ceiling for `app/api/**/route.ts` stays 231 modules / 3132 KB, every
failing route has a named override (15 raised, 14 new). Nothing lowered, removed or raised unless
failing; `slackPercent`, `barrels`, `$comment` untouched. All 29 failing routes reach
`role-rubrics.ts` through `agent-hire/transform-run.ts` (verified by walking each graph).

## Readings

The worktree and a `git archive HEAD` extraction read identically for every entry; the higher
of the two was used (they are equal).

| entry | old modules / KB | measured worktree (mod / KB) | measured archive (mod / KB) | new modules / KB |
|---|---|---|---|---|
| app/page.tsx | 1455 / 9294 | 1802 / 11004 | 1802 / 11004 | 1802 / 11006 |
| app/_lib/llm-config.ts | 19 / 330 | - / 361 | - / 361 | 19 / 363 |
| app/_lib/job-ingest.ts | 28 / 423 | 29 / 458 | 29 / 458 | 29 / 460 |
| app/api/agents/hire-from-need/route.ts | 240 / 3219 | 251 / 3411 | 251 / 3411 | 251 / 3413 |
| app/api/analyze/route.ts | 231 / 3148 | 242 / 3337 | 242 / 3337 | 242 / 3339 |
| app/api/companion/[id]/message/route.ts | 231 / 3132 | 241 / 3324 | 241 / 3324 | 241 / 3326 |
| app/api/companion/proposals/[id]/resolve/route.ts | 231 / 3132 | 241 / 3322 | 241 / 3322 | 241 / 3324 |
| app/api/decisions/feedback-letters/[id]/redraft/route.ts | 233 / 3157 | 244 / 3349 | 244 / 3349 | 244 / 3351 |
| app/api/devcase/control/route.ts | 231 / 3139 | 241 / 3332 | 241 / 3332 | 241 / 3334 |
| app/api/devcase/inbound/route.ts | 231 / 3132 | 240 / 3319 | 240 / 3319 | 240 / 3321 |
| app/api/devcase/lifecycle/[id]/approve/route.ts | 234 / 3153 | 245 / 3346 | 245 / 3346 | 245 / 3348 |
| app/api/devcase/lifecycle/route.ts | 232 / 3140 | 243 / 3330 | 243 / 3330 | 243 / 3332 |
| app/api/devcase/session/[id]/submit/route.ts | 231 / 3140 | 242 / 3329 | 242 / 3329 | 242 / 3331 |
| app/api/devcase/submit/route.ts | 231 / 3132 | 240 / 3318 | 240 / 3318 | 240 / 3320 |
| app/api/gigs/[id]/plans/route.ts | 231 / 3132 | 244 / 3401 | 244 / 3401 | 244 / 3403 |
| app/api/gigs/[id]/proposal/route.ts | 231 / 3132 | 245 / 3396 | 245 / 3396 | 245 / 3398 |
| app/api/gigs/[id]/report/route.ts | 231 / 3132 | 244 / 3394 | 244 / 3394 | 244 / 3396 |
| app/api/gigs/plans/route.ts | 231 / 3132 | 240 / 3317 | 240 / 3317 | 240 / 3319 |
| app/api/gigs/scan/route.ts | 231 / 3132 | 242 / 3360 | 242 / 3360 | 242 / 3362 |
| app/api/intake/[id]/promote/route.ts | 232 / 3158 | 245 / 3368 | 245 / 3368 | 245 / 3370 |
| app/api/jds/[slug]/retry-analysis/route.ts | 231 / 3140 | 241 / 3332 | 241 / 3332 | 241 / 3334 |
| app/api/jds/generate/route.ts | 230 / 3143 | 241 / 3334 | 241 / 3334 | 241 / 3336 |
| app/api/jobs/[id]/agent-fit/route.ts | 231 / 3132 | 240 / 3318 | 240 / 3318 | 240 / 3320 |
| app/api/jobs/[id]/interview-kit/route.ts | 232 / 3157 | 243 / 3348 | 243 / 3348 | 243 / 3350 |
| app/api/jobseeker/scan/route.ts | 231 / 3132 | 240 / 3316 | 240 / 3316 | 240 / 3318 |
| app/api/repo-scan/[id]/route.ts | 231 / 3132 | 241 / 3322 | 241 / 3322 | 241 / 3324 |
| app/api/repo-scan/route.ts | 231 / 3132 | 241 / 3324 | 241 / 3324 | 241 / 3326 |
| app/api/status/[token]/letter/route.ts | 233 / 3167 | 244 / 3356 | 244 / 3356 | 244 / 3358 |
| app/api/tasks/[id]/retry/route.ts | 232 / 3151 | 243 / 3342 | 243 / 3342 | 243 / 3344 |
| app/api/tasks/[id]/route.ts | 231 / 3132 | 240 / 3314 | 240 / 3314 | 240 / 3316 |
| app/api/tasks/history/route.ts | 231 / 3139 | 242 / 3329 | 242 / 3329 | 242 / 3331 |
| app/api/tasks/route.ts | 232 / 3151 | 243 / 3342 | 243 / 3342 | 243 / 3344 |

## Findings

- Before: 63 (`node scripts/perf/check-budget.mjs --json` on 2c95aba47, worktree and archive).
- After: 0.

## Going forward

From now on a brief must require that `perf:budget` findings do not rise, or that the builder
records its own share in `perf-budget.json`.
