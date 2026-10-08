# E2E keyless subset check (BLOCKED, not measured)

Goal: run the 14 keyless specs from ci.yml against today's main, fix only spec drift in e2e/.

Result: no spec was run. All 14 are **unmeasured**, so there is no before/after table, no DRIFT fix and no PRODUCT finding.

- Standalone mode: `npm run build` in the worktree fails at once with
  `TurbopackInternalError: Symlink [project]/node_modules is invalid, it points out of the filesystem root`.
  The worktree's `node_modules` is a junction to `C:\Users\kazda\kiro\kp\node_modules` (prod-build-smoke-isolation trap).
- Dev fallback (`next dev --webpack`, port 3217, `KP_OFFLINE=1`, `KP_ALLOW_OPEN=1`, temp `KP_DB_PATH`) boots, but the first request
  returns 500: `Module not found: Can't resolve 'fs'` in `node_modules/better-sqlite3/lib/binding.js`. The bundler treats the
  package as client code because it resolves outside the project root. `GET /` took 83 s and returned 500.
- Class: ENVIRONMENT (worktree junction), not product or spec drift.
- The server was started by PID and stopped by PID. Port 3217 is free again.

To measure: needs a tree with a real `node_modules` (a second worktree is forbidden here; running from the operator's checkout would write its `.next`).
