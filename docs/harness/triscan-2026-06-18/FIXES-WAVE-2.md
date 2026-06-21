# Tri-Lens Fix Wave 2 — Workspace Tenancy (theme T1, fail-safe lock)

> 3 atomic fix commits. Closes the **exploitability** of 4 criticals (#1–#4) via a single-tenant lock.
> Baseline preserved: tsc 0 → 0 · unit tests 947 → 951 (+4) · i18n 2416 keys in parity · 0 regressions.
> Branch: `vibeman/triscan-fixes-2026-06-18`.

## Scope decision (escalated to the user first)

The naive plan — "thread `workspace_id` through the unscoped stores" — is a **50+ file, multi-wave refactor**: 30 tables exist, only `analyses` + `profiles` are scoped; the rest (candidate pipeline + PII, events, jobs, interviews/transcripts, decisions, devcase, channels, billing, skill-profiles, analytics) need a migration + ~13 store files + every caller + a tenancy test each. A *half*-threaded state is arguably worse than none.

All four tenancy criticals share one precondition — **"the moment a 2nd workspace exists"** — and the shipped UI lets a user create one in two clicks. So per the auth scan's own recommended **option (a)**, this wave makes the app **fail-safe single-tenant** until the data layer is finished. This closes the *exploitability* of #1–#4 now (small, low-risk); the real per-table threading is deferred to future per-domain waves.

## Commits

| # | Commit | Finding | Severity | Files |
|---|---|---|---|---|
| 1 | `94cc0d0` | auth-sessions-tenancy #1; candidate-profile-matching #1; cv-analysis-workspace #1 | Critical ×3 | workspace-lock.ts (+test), api/workspaces/route.ts, api/auth/switch-workspace/route.ts |
| 2 | `6e20d91` | auth-sessions-tenancy #1 (UI half) | — | WorkspaceTab.tsx, messages/en.json, messages/cs.json |
| 3 | `ad0a404` | auth-sessions-tenancy #2 | Critical | BackupCard.tsx, api/workspace/{export,import}/route.ts |

## What was fixed

1. **Single-tenant lock (closes #1, #3, #4 exploitability).** New pure `workspace-lock.ts`: `multiWorkspaceEnabled()` (default OFF; `KP_MULTI_WORKSPACE=1` opts in) + `canSwitchWorkspace()`. `POST /api/workspaces` returns 403 while locked; `/api/auth/switch-workspace` refuses any non-default target. With only the default workspace reachable, the unscoped reads/writes in match/pool (#3) and label-matched analyses (#4) can't cross a tenant boundary — there's only one. `GET /api/workspaces` reports the flag.

2. **UI matches the lock.** `WorkspaceTab` hides the create form + Switch buttons and shows a `lockedNote` banner when `multiWorkspace=false` (defaults to locked while loading). Reworded the misleading "each is a separate tenant" intro in both locales; added `lockedNote` (en + cs, parity preserved).

3. **Backup/export-import relabelled (closes #2 exploitability + labeling).** The whole-DB dump/restore was called a "workspace" backup. The lock makes whole-DB == the one workspace today (so no cross-tenant exfil/clobber now); the UI + route comments now say "full database — all data across every workspace," and both routes carry a **SCOPE NOTE** spelling out the rework required (filter/restore by `workspace_id`, never `DROP TABLE`) *before* `KP_MULTI_WORKSPACE` is enabled.

## Verification

| Gate | Before | After |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `node --test app/**/*.test.ts` | 947 pass | 951 pass (+4) |
| `node scripts/i18n-check.mjs` | parity | 2416 keys, parity |

New tests: `workspace-lock.test.ts` (4 — lock default-off, opt-in truthy values, switch refused to non-default when locked, allowed when unlocked).

## Patterns established (catalogue, continued)

6. **Fail-safe over half-built.** When a security boundary is half-implemented and the *trigger* is a user action, gate the trigger (keep the safe state) rather than ship a partial, inconsistent version of the boundary. A pure policy module (env flag + decision fn) makes it testable and trivially reversible.
7. **Stop the name lying.** A "workspace export" that dumps the whole DB is a latent cross-tenant bug; even before the real fix, relabel + comment the true scope so nobody builds on the false assumption.

## What remains

- **The real refactor (future waves):** thread `workspace_id` per domain — recommended order: pipeline (+events, PII) → jobs → interviews → decisions → devcase → channels → billing → analytics → skill-profiles. Each = migration (backfill `'workspace'`) + store + callers + a `*-tenancy.test.ts` mirroring `analyses-tenancy.test.ts`. Only after all land should `KP_MULTI_WORKSPACE` be enabled (and export/import reworked per the SCOPE NOTEs).
- **Related auth findings (separate, not this theme):** #3 auth fail-open by default (proxy gates only when `KP_OPERATOR_PASSWORD` set), #4 no session revocation, #5 no workspace-membership check. These belong in a dedicated auth-hardening wave.
- **Next themes per INDEX:** T3 Billing integrity, T5/T6 pipeline-state + unwired, T4 AI quality, T7/T8/T10 durability/XSS/timezone, T9/T11 conversion + UI.
