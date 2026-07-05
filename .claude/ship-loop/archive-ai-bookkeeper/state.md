# Ship Loop — state

## Context refresher
- App: ai-bookkeeper — AI bookkeeping for trades ("Ledgerline/Trader Desk"). Stack: NextJS 16 + Supabase auth (NOT Firebase — memory corrected) + Postgres-dialect getDb() over PGlite/pg/CloudSQL + token ledger + Polar. Branch dev-clone/adr0048-perf-gaps (ahead 7 now, unpushed).
- Ship bar: DEFERRED (user AFK at CP0). Cadence: Milestone (provisional). UAT depth: deferred.
- Scorecard: 1.Build 🟢 2.Func 🔴 3.Tests 🟡 4.UAT 🟡 5.Billing 🟡 6.Sec 🟡 7.UX 🟡 8.Ops 🟡 9.Value 🔴 (lens not yet run — items 31-32)
- Milestone 1 "correctness+security" ☑ COMPLETE: items 6,7,8,9,10,11,12 all done+committed; gate ran (see below).
- NEXT ACTION: CP1 — present milestone results + re-ask deferred CP0 questions (ship bar, product core) + confirm auto-decisions; then Milestone 2.

## Scorecard (post-Milestone-1 gate, 2026-07-02)
| # | Dimension | Score | Evidence | Top gaps |
|---|-----------|-------|----------|----------|
| 1 | Build & types | 🟢 | typecheck 0 · lint 0 · build 0 (22 routes) — all this gate | — |
| 2 | Functional completeness | 🔴 | routes audit | "text a receipt" NO backend (fake number); business data = shared mock fixture; 4 orphaned landing widgets (→ e2e reds); FAQ overpromises; wealth placeholders. ALL awaiting CP1 product decisions (items 1-5) |
| 3 | Tests | 🟡 | npm test exit 0: 1079/1079 (was 1069/1070 at boot) | Money-in holes remain: checkout route, polar/client, auth/db, db drivers, forecast route, settle wiring (items 13-16) |
| 4 | Simulated UAT | 🟡 | full run: 88/107 passed, exit 1 (6.3m, gemini-fallback mode) | 19 fails, 3 roots: (A) tour overlay blocked clicks → FIXED via storageState pre-seed, subset rerun pending; (B) orphaned-landing specs (item 3 decision); (C) zz-paywall drain hits 429 before 402 (item 29). Missing journeys: items 18-20 |
| 5 | Billing value | 🟡 | benchmarks overcharge FIXED (ctx.reclaim, tested); charge-then-reclaim + idempotent credits + webhook all tested | Rate-card omits forecast+export (25); A2 per-op assertions (21); mock-books value question (inherits dim 2); auto-reload placeholder |
| 6 | Auth & security | 🟡 | /admin RBAC ✓ (ADMIN_EMAILS, fail-closed, 4 tests) · ask/export requireUser-first ✓ (19 tests) · middleware backstop ✓ (2 tests) · env docs fixed ✓ | No DB-level RLS backstop (matters when real per-owner data lands, item 1); sandbox tokens in plaintext .env.local (user: rotate if tree was shared) |
| 7 | UX/UI polish | 🟡 | static survey only | Boundaries (22), mobile top-bar + chart (23), auto-reload feedback (24), drift (27); no screenshot sweep yet |
| 8 | Ops readiness | 🟡 | CI green ladder exists; POLAR_PRODUCT_* discovered already set in .env.local | Deploy story unverified; e2e not in CI (deliberate); .claude/CLAUDE.md boilerplate (28); docs for Polar envs (26, shrunk) |

## Milestone 1 — commits
7f53e38 lint clean · 403e080 relocate teardown (PGlite/libuv race) · +ctx.reclaim benchmarks fix · 37333ce ask/export envelope · middleware backstop · admin RBAC · 3fd4b35 env docs
Gate: typecheck ✓ lint ✓ tests 1079/1079 ✓ build ✓ e2e 88/107 (3 failure roots, none caused by Milestone 1 — verified: wealth route answers in 2.6s via direct probe; failures pre-date loop)

## Price table (unchanged from boot — see journal for source)
categorize 1 · ask-ledger 3 · benchmarks 3+fee · export 3 · tax-credits 5+fee · wealth 5 (no fee, uncalibrated) · forecast 5. Signup 150. Bundles $5-$150. Pro $29/mo.

## Checkpoint history
- CP0 (2026-07-02): USER AFK → provisional: cadence=milestone; ship bar + product core DEFERRED; M1 = items 6-12.
- CP1: PENDING (trigger: M1 complete). Must present: deferred CP0 questions, 4 auto-decisions, product-decision cluster 1-5, new item 29.
