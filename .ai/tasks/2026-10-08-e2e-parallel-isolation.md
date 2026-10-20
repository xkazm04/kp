# E2E keyless subset at Playwright's local default of 8 workers

Goal 7cb22f7a (CI e2e deterministic green). Follow-up to `2026-10-08-release-build-client-boundary.md` ("Caveat, measured"). Scope: `e2e/` only; `playwright.config.ts`, the worker count, retries, timeouts-as-fix and all product code untouched.

**Result:** the 14 keyless specs (77 tests) failed 1-3 tests in 5 of 5 baseline runs at `--workers=8`, a different set each time. After seven commits all 8 proof runs pass 77/77: 5 fresh DBs at 8 workers, 2 more at 8 workers on the last DB, 1 at 2 workers.

## Method

- Throwaway tree T = `%TEMP%\kp-par-1791491246072`, `git archive 4cce38fbe | tar -x`. `npm ci` there (T/node_modules a real directory), `npm run build` in T passed. Standalone server (`node .next/standalone/server.js`, `.next/static`, `public`, `pipeline`, `data` copied in as ci.yml does), `HOSTNAME=127.0.0.1`, a free port per run, `KP_ALLOW_OPEN=1 KP_OFFLINE=1 NEXT_TELEMETRY_DISABLED=1`, a fresh temp `KP_DB_PATH`, no provider key. Server restarted for every run and stopped by its own PID.
- Runner: `KP_E2E_BASE_URL=<url> npx playwright test <14 names> --project=chromium --workers=<n> --reporter=json` from T. The failing runs' `test-results/` (trace + snapshot) were copied out per run.
- **After-runs did not rebuild.** Only `e2e/` changed, so T's `e2e/` was refreshed from the branch HEAD with `git archive HEAD e2e | tar -x -C T` (`diff -r e2e T/e2e` empty) and the same server build served it. The proof batch ran from HEAD `9cb4c3358`.
- Free memory (MB, `os.freemem()` before each run) is in the tables. It fell from ~30 GB to ~13 GB over the session as other builders started on this box; the elapsed time per run (48-59 s in the proof) shows no starvation.

## Step 1 - before (base `4cce38fbe`, 8 workers, fresh DB each)

| Run | Free MB | Passed | Failed | Did not run | Failures: spec:line - test - first error line |
| --- | --- | --- | --- | --- | --- |
| 1 | 30116 | 72 | 1 | 4 | quality-tables:100 - renders a paged table with sortable headers (beforeAll) - the fixture must leave at least one link in the chain |
| 2 | 29877 | 75 | 2 | 0 | profile-builder:179 - Student intake routes to student… - expect(locator).toBeVisible() failed (heading "Build a candidate profile"); profile-roster:125 - the pager windows the roster at 20 rows a page - expect(locator).toBeVisible() failed (`1–20 of 67`) |
| 3 | 32158 | 65 | 3 | 9 | journey-role-to-schedule:154 - first-run wizard… saves the board - the wizard's finish should save the renamed column; profile-roster:95 - lists saved profiles… - toBeVisible() failed (`1 of 68 profiles`); quality-tables:100 - same as run 1 |
| 4 | 28018 | 71 | 2 | 4 | profile-roster:95 (as run 3); quality-tables:100 |
| 5 | 27799 | 65 | 3 | 9 | journey-role-to-schedule:154; profile-builder:131 - Experienced intake… - toBeVisible() failed (heading); quality-tables:100 |

Four more runs with traces kept (label diag) and intermediate-fix runs (d2-d4) showed the same sites plus quality-tables:123/:141 (pager), profile-roster:141 / profile-builder:131 (`apiRequestContext.get: read ECONNRESET`), profile-roster:95 (`Test timeout of 120000ms exceeded`) and journey-board:97 (dialog not found). None of the failures was a product 4xx/5xx on the request under test.

## Steps 2-3 - mechanisms and fixes (one commit per mechanism, ids may change on rebase; the subjects identify them)

1. **A stale 20 s memo read by a fixture that waited on the write, not on the condition.** `quality-tables.spec.ts` beforeAll (`fab58f3ba` "test(e2e): quality-tables waits for its own sealed record and for page 2, not for the writes"). Reader: the `GET /api/decisions/records` after the reject. Other writer-of-the-cache: any sibling page that read the chain first (analytics-sections, journey-one-thread's Quality view). `app/api/decisions/records/route.ts` serves `recordsCache` (`createTtlCache`, `DEFAULT_TTL_MS = 20_000`, `app/_lib/ttl-cache.ts:18`) with, by its own comment, no write-path invalidation; a payload cached before the seal says `count: 0` for up to 20 s. The product states that lag as accepted, so not a product defect. Fix: poll until the chain contains a record whose `candidateRef` is the entry this spec just created. Not satisfied by a sibling's record.
2. **A mount-time `setPage(0)` undoes the pager click.** `quality-tables.spec.ts` pager test. `DecisionLogTable.tsx:88-94` arms a 250 ms subject debounce on mount whose callback is `setPage(0)`. Trace (diag-3 and d3-2): `GET …decisions?offset=0`, `?offset=20`, then `?offset=0` ~60-100 ms later, pager "Page 1 of 6". At 8 workers the table's first paint and the Next click coincide. Two commits: `fab58f3ba` (same as above, first attempt: wait for "Page 2 of") was not enough - page 2 was seen for ~60 ms, then reset (d3 runs 1, 2 still failed) - and `ebab7920e` "test(e2e): quality-tables turns the page and reads page 2's row as one retried unit" (click, see page 2, compare the row, as one `toPass` attempt; a torn read retries and the next click is after the debounce). **Deviation from "one commit per mechanism":** `fab58f3ba` carries mechanism 1 and the first, insufficient half of mechanism 2; `ebab7920e` finishes 2.
3. **The roster total is read from the API before the page paints it.** `profile-roster.spec.ts` tests 1 and 3 (`3b15d193c` "test(e2e): profile-roster reads its total off the page and fills the filter box in one retried step"). Writer: `profile-builder.spec.ts` saves profiles into the same workspace and never deletes them; reader: the roster's "1 of N profiles" / "1–20 of N". Evidence: failure message `1 of 68 profiles`, failure snapshot `1 of 69 profiles`. Fix: take N from the page and assert it lies between the API totals read before and after (profiles are only added while this file runs; this file deletes only its own `ZZ` fixtures, serially).
4. **Find-then-fill on a box that can close.** Same commit, `filterByName`: `nameFilterBox` returned the open box, then `fill` waited for a textbox that had been closed (snapshot: trigger present, box closed, list unfiltered, "69 saved profiles"), until the 120 s test timeout. Fix: both in one `toPass` unit.
5. **An unbounded `click()` inside a retry loop hangs the loop.** Three sites, same mechanism:
   - `journey-role-to-schedule.spec.ts` wizard finish poll (`fde2f6ecc` "test(e2e): the wizard's finish poll bounds its click, so the stored-axis read keeps polling"). Trace: the last `click` on "Explore on my own" is still OPEN at the timeout, the poll made two `GET /api/decisions/config` in 120 s, `POST /api/pipeline/stage-migration` had answered 200 and the page behind already showed the renamed axis. The earlier reading "the wizard's save poll" was therefore a poll that stopped polling, not a save that failed. Fix: `click({ timeout: 2_000 })`.
   - `profile-builder.spec.ts` `openBuilder` and `profile-roster.spec.ts` `nameFilterBox` (`9cb4c3358` "test(e2e): the builder and roster open-retries bound their clicks"). Trace: the third click on "Build candidate profile" is OPEN until the 30 s limit; the failure snapshot shows the editor open (the heading arrived after the 1.5 s expect, the retry then clicked a button the editor had replaced). Fix: `click({ timeout: 1_000 })`.
   - Not changed, same class, never seen failing: `modal-escape.spec.ts:31`, `journey-role-to-schedule.spec.ts:98` (`advanceStep`).
6. **A single click on server-rendered markup before hydration.** `journey-board.spec.ts:97` "Escape closes the board…" (`ee12b2321` "test(e2e): the journey board's Escape test retries the rail click until the dialog is up"). Trace: `goto` 2.0 s, the click on the Journeys rail item at 2.2 s, the dialog never opens in 30 s. The suite's convention for this gap is a bounded retry; this click had none. Fix: retry only while the dialog is absent, so it cannot close an open board.
7. **Keep-alive reset.** `profile-roster` `afterEach`/`profileCount` and `profile-builder` record GETs (`24b223df8` "test(e2e): the profile specs retry idempotent API calls that hit a keep-alive reset"). `apiRequestContext.get: read ECONNRESET` on a plain `GET /api/profile` after a long UI step, seen 3 times in 11 runs, no server log line. The standalone server (`server.js:17`, `KEEP_ALIVE_TIMEOUT` unset) closes idle sockets at Node's default 5 s, and the next API call can reuse a socket as it closes. Fix in `e2e/`: Playwright's `maxRetries: 3` (which retries only ECONNRESET) on the idempotent GET and DELETE-by-id calls. POSTs are not retried. Real fix is outside `e2e/` - see questions.

Pairs that can overlap at 8 workers, from grepping the 14 specs for writes (`.post(`, `.delete(`, `/api/me/onboarding`, `onboarding=1`, stage moves): profile-builder x profile-roster (both write `/api/profile`; roster's `ZZ` prefix is its own), quality-tables x analytics-sections / journey-one-thread / activity-detail (chain and decision log read and written), journey-role-to-schedule x everything (the wizard writes the pipeline axis label and org settings; every spec stamps onboarding "skipped" in `seedDevAuth`, which `completed` outranks). `quality-tables`' `runId = Date.now().toString(36)` is unique per file load (one load per worker), and only that file reads it.

## Step 4 - after (HEAD `9cb4c3358`, same server build, e2e refreshed from HEAD)

| Batch | Run | Workers | DB | Free MB | Passed | Failed | Did not run | Secs |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| fresh | 1 | 8 | fresh | 20995 | 77 | 0 | 0 | 48 |
| fresh | 2 | 8 | fresh | 20504 | 77 | 0 | 0 | 54 |
| fresh | 3 | 8 | fresh | 19453 | 77 | 0 | 0 | 56 |
| fresh | 4 | 8 | fresh | 17670 | 77 | 0 | 0 | 59 |
| fresh | 5 | 8 | fresh | 17490 | 77 | 0 | 0 | 50 |
| reuse | 6 | 8 | run 5's DB | 16531 | 77 | 0 | 0 | 50 |
| reuse | 7 | 8 | same DB again | 14348 | 77 | 0 | 0 | 51 |
| workers=2 | 8 | 2 | fresh | 12972 | 77 | 0 | 0 | 86 |

The test count is unchanged at 77: no test added, removed or skipped.

Honest limits. Eight clean runs after seven fixes is evidence, not proof: before the fixes the flake rate per run was 100 % (5/5), and the three intermediate batches (d2-d4, 19 runs on partly-fixed e2e) still failed in 8 of 19 on exactly the sites fixed afterwards, so the fixes were each driven by a trace, and the eight clean runs are the first batch with all of them in. Per-site residual risk: items 5 and the unfixed `modal-escape:31` / `advanceStep:98` are the same unbounded-click class and would show as a 30 s hang, not a wrong assertion.

## PRODUCT findings (not fixed, no spec changed on their account)

- `GET /api/decisions/records` memoizes for 20 s without write-path invalidation (see 1): a client that seals then reads gets the pre-seal chain. Documented as accepted in the route; reported because it is why a read-your-write fixture needs a poll.
- `DecisionLogTable` resets to page 1 250 ms after mount through the subject-search debounce (see 2) even though the reader never typed. A reader who turns the page inside that window loses it. Harmless at human speed; it is the thing the pager test collided with.
- Every server log in the runs carries `[api:jobs/candidates] JOB_CANDIDATES_FAILED SpawnFailure: Python process aborted … status: 500, code: 'engine_error', kind: 'aborted'` - a 500 logged for a request the client aborted (page navigated away). No test depended on it; noted because an aborted request is logged as a server failure.
- No SQLite busy error, no 5xx on a request a spec made, and no wrong-data response was seen in any server log at 8 workers.

## Gates (worktree)

typecheck, lint (0 errors, 49 warnings, as on base), test:docs (includes the keyless-e2e pin), test:unit (13014 pass, 0 fail) and the scripts/kpi set (85 pass) all pass. `typecheck` rewrote `app/_lib/{contract-constants,schemas,taxonomy}.generated.ts`; restored.

## Cleanup

T (`%TEMP%\kp-par-1791491246072`, a real `node_modules` directory, deleted as such, never through the worktree junction), the harness directory `%TEMP%\kp-par-tools` (temp DBs, server logs, reports, traces) and every server started were removed; each server was stopped by its own PID at the end of its run. The operator's `node_modules` was not touched.
