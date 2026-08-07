# Backlog  (☐ todo · ◐ in progress · ☑ done · ✕ cut)  — numbering append-only, never renumber

| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 1 | ☐ | 2-Func | L | DECISION+work: real per-owner transactions data layer (getTransactions ignores ownerId, serves shared mock — transactions.ts:52-58) + ingestion path; or explicitly scope v1 as demo-books product |
| 2 | ☐ | 2-Func | L/S | DECISION+work: "text a receipt" headline — implement SMS/MMS intake (no backend exists; fake number empty-state.ts:20) OR reframe/remove promise across landing/FAQ/dashboard |
| 3 | ☐ | 2-Func | S-M | DECISION: orphaned widgets (SavingsAuditPanel, CategorizePanel, LedgerDemo, HeroCta) — remount on landing or delete; restore telemetry feeding /admin funnel |
| 4 | ☐ | 2-Func | S | DECISION: FAQ overpromises (human 2-min concierge, CPA referral) — reword or implement |
| 5 | ☐ | 2-Func | M | DECISION: wealth-score placeholder numbers (flagged SCAFFOLD in data.ts) — calibrate, disclaim, or hide card for v1 |
| 6 | ☑ | 5-Bill | S | BUG: benchmarks charges 3 tokens for canned no-trade reply, no reclaim (benchmarks/route.ts:59-66) |
| 7 | ☑ | 3-Test | S | BUG: relocate.test.ts file-level teardown failure (tests pass individually; likely leaked handle) |
| 8 | ☑ | 1-Build | S | Fix 3 lint errors (safe-next control-regex, originHost, CoachMarkTour immutability) |
| 9 | ☑ | 6-Sec | S | /admin RBAC — any onboarded user can read funnel/experiment data (admin/page.tsx:44) |
| 10 | ☑ | 6-Sec | S | Migrate /api/ask + /api/export to withMeteredRoute (requireUser-first, match insight routes) |
| 11 | ☑ | 6-Sec | S | Extend middleware matcher to backstop /admin /firm /developers (now only /dashboard) |
| 12 | ☑ | 6-Sec | S | Env hygiene: delete dead Firebase block, fix NEXT_PUBLIC_DEV_AUTH→DEV_AUTH comment (.env.local + examples); rotate sandbox Polar/LightTrack tokens if tree ever shared |
| 13 | ☐ | 3-Test | M | Tests for /api/checkout (plan/bundle branches, metadata trust, 401/400/502/503) — money-in path, currently ZERO |
| 14 | ☐ | 3-Test | S | Tests for polar/client isPolarConfigured + auth/db profile coercion (feeds tax math) |
| 15 | ☐ | 3-Test | M | Forecast route auth+charge coverage (missing from auth-guard set) + settle wiring tests (benchmarks/tax-credits) |
| 16 | ☐ | 3-Test | M | Tests for dev/grant-tokens guard + access-db / firm-clients-db / keys-db stores |
| 17 | ☐ | 4-UAT | S | Run existing e2e suite in-loop (deterministic fallback or Gemini) → baseline evidence |
| 18 | ☐ | 4-UAT | M | New journey: signup→/welcome consent→/dashboard (onboarding path untested e2e) |
| 19 | ☐ | 4-UAT | M | New journey: purchase — checkout + simulated Polar webhook → balance credited → op unblocked (billing A3) |
| 20 | ☐ | 4-UAT | M | New journeys: firm/CPA delegation; developers API-key mint→v1/categorize use |
| 21 | ☐ | 5-Bill | M | Billing A2 assertions for all 7 charged ops: exact debit, artifact persists, failure=net-zero |
| 22 | ☐ | 7-UX | M | Route-level boundaries: root error/global-error/not-found + per-segment loading+error for billing/firm/developers/admin/demo |
| 23 | ☐ | 7-UX | S | Mobile: DashboardTopBar wrap/truncate (7 actions overflow); RevenueChart overflow-x-auto |
| 24 | ☐ | 7-UX | S | AutoReloadPanel: pending state + success/error feedback + double-submit guard (match InviteCpaForm pattern) |
| 25 | ☐ | 5-Bill | S | Rate card: add insight-forecast (5) + export-books (3) rows; disclose wealth has no success fee |
| 26 | ☐ | 8-Ops | S | (shrunk: already SET in .env.local) Document POLAR_PRODUCT_* sandbox envs so checkout works end-to-end |
| 27 | ☐ | 7-UX | M | Design-system drift: migrate hand-rolled buttons (19×/15 files) and cards (18×/13) to Button/Card |
| 28 | ☐ | 8-Ops | S | Replace .claude/CLAUDE.md scaffold boilerplate with real project docs |
| 29 | ☐ | 4-UAT | S | zz-paywall drain loop hits 429 before 402 — add backoff/Retry-After handling to the drain (flaky by design of rate limiter) |
| 30 | ☐ | 4-UAT | M | 4 spec drifts after tour fix: 03-insights debit spec (balance-pill read races reload; needs poll), tax-credits "three federal programs", wealth-score upside pill, merge-candidates row — content assertions vs seeded dev profile need individual diagnosis |
| 31 | ☐ | 9-Value | M | Run value & market lens (skill v2, references/value-validation.md): web-researched competitor map + per-op ROI table + production-reality checklist → value-case.md; verdicts to CP as product decisions |
| 32 | ☐ | 9-Value | M | Cold-start journey: brand-new user, zero seeds, real personally-relevant artifact in first session (mock demo books ≠ cold-start value — ties to item 1 decision) |
