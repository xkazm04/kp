# Release build: client bundle reached better-sqlite3

Follow-up to `2026-10-08-e2e-keyless-subset-check.md` (commit "docs(tasks): record the keyless e2e subset measurement: three drift fixes and a build break on main").

## The chain

`IntegrationsWebhookPanel.tsx:12` ("use client") imports `ATS_SCHEMA_VERSION` from `app/_lib/ats-record.ts`; `ats-record.ts:24` imported `isAgentPopulation` from `./db/core.ts` (better-sqlite3, node:fs). `next build` stopped with `Can't resolve 'fs'`. Introduced by b9f45b1aa "fix(ats): the ATS record refuses an AI agent instead of exporting it as a person". typecheck, lint and test:unit cannot see a bundling boundary.

## The fix

Commit f3e94940b "fix(build): the ATS record no longer reaches better-sqlite3 through db/core". The pure block (`SLATE_POPULATIONS`, `SlatePopulation`, `coerceSlatePopulation`, `isAgentPopulation`, `notAgentSql`) moved verbatim to `app/_lib/slate-population.ts` (no imports). `db/core.ts` imports what it uses and re-exports the same names, so no importer changed; `ats-record.ts` imports `./slate-population.ts`.

## The guard

Commit d319864a0 "test(build): a client bundle may not reach better-sqlite3, fs or app/_lib/db": `app/_lib/testing/client-bundle-boundary.test.ts`. It starts from every `app/` file whose first statement is "use client", follows emitted value imports (typescript `transpileModule`, so type-only imports are elided), `export ... from` and `import()`, resolves `@/` and index files, stops at "use server" files, and fails on better-sqlite3 / fs / child_process (with or without `node:`) or any file under `app/_lib/db/`. Measured 15 s (guardSeconds 15); it passes on the fixed tree with no allowlist.

Failing on base (old import line put back in ats-record.ts, working tree only, never committed), first chain:

```
app/features/settings/integrations/IntegrationsWebhookPanel.tsx ("use client")
  -> app/features/settings/integrations/IntegrationsWebhookPanel.tsx:12 imports "@/app/_lib/ats-record"
  -> app/_lib/ats-record.ts:24 imports "./db/core.ts"
  => app/_lib/db/core.ts is under app/_lib/db/ (server-only)
```

The same breach is also reported from every client file above the panel (IntegrationsTab, tabChunks, Workspace, ...). Restored, the test passes.

## Build and subset (throwaway tree)

T = `%TEMP%\kp-build-1791485142` (`git archive HEAD | tar -x`; `git rev-parse --git-dir` failed there; `node_modules` was a real directory after `npm ci`). Deleted afterwards, with its temp DBs.

- `npm ci`: 63 s. `npm run build` UNPATCHED: **passes, 164 s**.
- Standalone server on a free port, `KP_ALLOW_OPEN=1 KP_OFFLINE=1`, fresh temp DB, no key; GET / answered 200; stopped by its own PID.
- Run with `--workers=2` (CI's count): **77/77 pass, 72 s**.

| Spec | Tests | Result |
| --- | --- | --- |
| modal-escape | 3 | pass |
| profile-builder | 2 | pass |
| profile-roster | 4 | pass |
| landing | 9 | pass |
| public-pages | 10 | pass |
| shell.spec | 11 | pass |
| journey-role-to-schedule | 6 | pass |
| journey-one-thread | 5 | pass |
| activity-detail | 2 | pass |
| analytics-sections | 6 | pass |
| quality-tables | 5 | pass |
| shell-tab-state | 4 | pass |
| locale-smoke | 4 | pass |
| journey-board | 6 | pass |

Caveat, measured: with the config's local default of one worker per core (8 on this 16-core box) four earlier runs on fresh DBs each failed 1-2 specs, a different set each time (journey-role-to-schedule:154 wizard-save poll, quality-tables:100 empty-chain fixture, journey-board:97 dialog not found), and everything after the failure in a serial file did not run. At `--workers=2` it was 77/77. That is contention flake, not the build; not fixed (e2e/ is out of scope).

## Gates (worktree)

typecheck, lint (0 errors), test:unit (13009 pass), scripts/kpi (85 pass), test:docs pass.
