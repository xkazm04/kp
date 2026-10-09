# E2E keep-alive and click bounds: 22-run sample

Goal 7cb22f7a (CI e2e deterministic green). Follows `2026-10-08-e2e-parallel-isolation.md`, whose Method (throwaway tree, standalone server, fresh temp `KP_DB_PATH`, free port per run, `KP_E2E_BASE_URL`, the 14 keyless specs, `--project=chromium`, json reporter) is used unchanged. Scope: `e2e/`, `.github/workflows/ci.yml`, this record.

## Reconcile (base `e226970b4`)

All three items were still open: `modal-escape.spec.ts:31` and `journey-role-to-schedule.spec.ts:98` had an unbounded `click()` in a `toPass` loop; `ci.yml` "Start production server (port 3101)" had no `KEEP_ALIVE_TIMEOUT`.

## Commits

| Id | Subject | Mechanism |
| --- | --- | --- |
| `1b957e8b3` | test(e2e): the modal and wizard-step retries bound their clicks | 5: `click({ timeout: 1000 })` under the 1500 ms expect; `click({ timeout: 2000 })` under the 2500 ms waits |
| `efb74772d` | ci(e2e): the release job's server keeps idle sockets for 130 s, not Node's 5 s | 7: `KEEP_ALIVE_TIMEOUT=130000` on that server start only |

## Why 130000 ms

`playwright.config.ts` sets `timeout: 120_000` per test, so no test can leave an API request context idle longer than about 120 s. 130 s is that plus margin. `server.js:17` parses the variable as `keepAliveTimeout`.

## Probe (built standalone server, raw TCP socket, one request, idle, reuse the same socket)

Server restarted per arm, `HOSTNAME=127.0.0.1 KP_ALLOW_OPEN=1 KP_OFFLINE=1`. Request: `GET /api/profile`, or `POST /api/profile` with `{}` (any answered status counts as served).

| Arm | Idle | Method | Result |
| --- | --- | --- | --- |
| unset | 3 s | GET | reused, 200 |
| unset | 7 s | GET | closed by server after 6.02 s idle |
| unset | 7 s | POST | closed by server after 6.01 s idle |
| unset | 10 s | GET | closed by server after 6.01 s idle |
| unset | 10 s | POST | closed by server after 6.01 s idle |
| 130000 | 10 s | GET / POST | reused, 200 / 200 |
| 130000 | 70 s | GET / POST | reused, 200 / 200 |
| 130000 | 125 s | GET / POST | reused, 200 / 200 |

The unset arm's close at ~6 s is Node's 5 s keep-alive plus up to one second of the connection-check sweep. With the value set, headersTimeout (60 s default) did not close the 70 s and 125 s sockets.

**Residual:** a socket idle for more than 130 s can still race the close. A test is bounded at 120 s, but a request context outliving several tests in a worker is not covered by that argument (Playwright's `request` fixture is per test; a manually created context is not). Production (`Dockerfile`) is not changed; see questions in the result.

## Sample (throwaway tree from HEAD `efb74772d`, `npm ci` + `npm run build` there, server started as the new ci.yml line, restarted and stopped by PID per run, fresh DB each run, 77 tests)

| Run | Workers | Free MB | Passed | Failed | Did not run | Secs | ECONNRESET | Failures |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 8 | 31469 | 77 | 0 | 0 | 59 | no |
| 2 | 8 | 29138 | 76 | 1 | 0 | 58 | no | landing.spec.ts:126 the skip link is the first stop and lands on the nine features [unexpected]
| 3 | 8 | 26830 | 77 | 0 | 0 | 53 | no |
| 4 | 8 | 26040 | 77 | 0 | 0 | 52 | no |
| 5 | 8 | 24563 | 77 | 0 | 0 | 61 | no |
| 6 | 8 | 20953 | 77 | 0 | 0 | 54 | no |
| 7 | 8 | 20224 | 77 | 0 | 0 | 58 | no |
| 8 | 8 | 18786 | 77 | 0 | 0 | 121 | no |
| 9 | 8 | 21759 | 77 | 0 | 0 | 52 | no |
| 10 | 8 | 22369 | 77 | 0 | 0 | 57 | no |
| 11 | 8 | 23697 | 77 | 0 | 0 | 173 | no |
| 12 | 8 | 20271 | 77 | 0 | 0 | 147 | no |
| 13 | 8 | 22520 | 77 | 0 | 0 | 119 | no |
| 14 | 8 | 26723 | 77 | 0 | 0 | 158 | no |
| 15 | 8 | 10130 | 77 | 0 | 0 | 122 | no |
| 16 | 8 | 22934 | 77 | 0 | 0 | 55 | no |
| 17 | 8 | 19149 | 77 | 0 | 0 | 56 | no |
| 18 | 8 | 17456 | 77 | 0 | 0 | 52 | no |
| 19 | 8 | 16177 | 77 | 0 | 0 | 58 | no |
| 20 | 8 | 16863 | 77 | 0 | 0 | 50 | no |
| 21 | 2 | 15535 | 77 | 0 | 0 | 150 | no |
| 22 | 2 | 26426 | 77 | 0 | 0 | 85 | no |

Runs 8 and 11-15 were slow (118-173 s against ~55 s) because other builders loaded the box (free memory fell as low as 10 GB); they passed.

**The one failure (run 2):** `landing.spec.ts:126` "the skip link is the first stop…" - `page.goto: net::ERR_NO_BUFFER_SPACE at http://127.0.0.1:<port>/` after 1.3 s. That is the Windows loopback socket-buffer exhaustion error on the client side of a navigation, a host condition, not an assertion, a wrong response or a hang in a click loop. It is not a mechanism inside `e2e/` and not a product fault (the server answered the other 76 tests of that run), so nothing was changed for it, and the 22 were not re-run. The trace was not kept (the next run clears `test-results/`); the diagnosis rests on the json report's error text. It would not occur on the Linux CI runner's network stack.

No run reported an ECONNRESET anywhere in its json report. Test count stayed 77.

## Honest limits

- 19 of 20 runs at 8 workers passed 77/77, and both 2-worker runs. 0 failures in 20 would bound the per-run failure rate below about 15% at 95% confidence (rule of three); with the one host-error failure counted, 1 in 20 bounds it below about 24% (Clopper-Pearson, one-sided 95%). Excluding that failure as environmental, 0 in 19 bounds the e2e-attributable rate below about 16%. That is evidence, not proof.
- The sample is one Windows box, loaded by other builders; CI is a Linux runner at `workers: 2` (`playwright.config.ts:113`). The 2-worker runs are the closer match and there were two.
- The keep-alive arm proves the server no longer closes at 5 s; it does not re-demonstrate the original ECONNRESET, which was seen 3 times in 11 runs before and 0 times in 22 here.

## Gates (worktree)

typecheck pass; lint 0 errors, 49 warnings (as base); test:unit 13014 pass, 0 fail (resend-dedup did not flake); scripts/kpi set 85 pass; test:docs pass (includes the keyless-e2e pin). typecheck rewrote the three `app/_lib/*.generated.ts`; restored.

## Cleanup

The throwaway tree (real `node_modules` directory, deleted as such) and the harness directory (probe, runner, temp DBs, logs, reports) were removed. Probe and run servers were each stopped by their own PID. No `npm ci` or `npm install` in the worktree.
