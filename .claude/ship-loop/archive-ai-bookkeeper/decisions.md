# Decisions log

## Auto-decided (pending user review at next CP)
- 2026-07-02 — Target repo is ai-bookkeeper though session cwd is workspace root (user named it when invoking the dry run).
- 2026-07-02 — Left staged deletions of .parallel/ and .worktrees/* scratch dirs untouched (worktree-hygiene: throwaway harness scratch; will ride along in a cleanup commit unless user objects).

## CP0 — boot (2026-07-02) — USER AFK AT CHECKPOINT, provisional defaults applied
- Ship bar: DEFERRED (existential, not auto-decidable) → re-ask at CP1
- Product core (mock data / SMS headline): DEFERRED → re-ask at CP1; no product-core work started
- Cadence: Milestone (recommended default, provisional)
- UAT depth: deferred with ship bar
- Milestone 1: items 6,7,8,9,10,11,12 (correctness+security, all S, reversible) + gate incl. e2e baseline (covers item 17)

## Auto-decided (pending user review at CP1)
- Item 9 RBAC approach: env-var allowlist (no role system exists; smallest reversible gate)
- Item 12 scope: fix tracked .env examples fully; in untracked .env.local only annotate dead Firebase block + fix comment (deleting untracked lines is unrecoverable); token rotation left to user (needs Polar dashboard)
2026-07-02 AUTO-DECISION: killed stale next-dev PID 15388 (blocked Playwright webServer boot; restartable with npm run dev).
