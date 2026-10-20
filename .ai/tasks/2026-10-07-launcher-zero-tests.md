# Unit-test launcher: a run of zero tests is red

Date: 2026-10-07 · Charter: codebase-static-analysis-sweep · Branch: `autopilot/codebase-static-analysis-sweep-10ab4e94`

## Finding

On node v24.14.0 `node --test <pattern>` exits 0 when the pattern matches no file, and `scripts/run-unit-tests.mjs` passed its argv straight to node's glob. An explicit path through a bracketed Next.js directory (`app/api/.../[id]/...`) is read as a character class, matches nothing, runs 0 tests and exits 0. 51 tracked test files sit under bracketed directories; builders and reviewers who passed explicit paths got a green that checked nothing. The no-argument run (`**` globs) was never affected.

## Reconcile

main (`b48a0f253`) had no zero-test check in the launcher: it returned node's exit code unchanged. Nothing already failed an empty run.

## Change

- **(a) Existing file → that file.** CHOSEN: escape, not resolve. Each glob metacharacter becomes a one-character class (`[` → `[[]`, `*` → `[*]`, …) because node's `--test` glob has no backslash escape (measured: `\[id\]` fails with "Could not find"). Backslashes become `/` first, so Windows paths still work.
- **(b) Pattern matching no file → red,** naming the pattern (checked with `fs.globSync`, the engine `--test` uses).
- **(c) 0 tests counted → red,** whatever node's code was; exit 0 with no count at all is red too. `scripts/test/flake-reporter.mjs` now yields one `{"summary":{"tests":N}}` line at stream end; `readFailures` ignores it. Counting is by reporter events (`test:pass`/`test:fail`, not suites), never console text. Node reports a file that registers no test as one pass named after the file at line 1 column 1; the reporter does not count that, otherwise an empty file would read as 1 test.
- Untouched: the env scrub, `--test-timeout`, the flake re-run and BROKEN/FLAKE/QUARANTINE classification, and the human reporter's output.

Limit: the check is on the run's total. One testless file among files that do have tests is not caught.

## Pinned

`app/_lib/testing/gate-exit-code.test.ts`, driving the real launcher on temp-dir fixtures: failing test under `[id]` → non-zero; passing test under `[id]` → zero and `tests 1`; pattern matching nothing → non-zero and names it; file with no tests → non-zero.

## Callers (run after the change, none went red for matching nothing)

- `npm run test:unit`: 12931 tests, 12930 pass, 1 fail. The failure is `app/_components/ui/style-debt.test.ts` (style ratchet: `apply/[id]/ApplyDeclineDetail.tsx` undeclared raw-text-size, `MatchCard.tsx` raw-button 3 > 2). It is app code this task does not touch; it is red on the base tree and is reported, not fixed.
- `node scripts/run-unit-tests.mjs "scripts/kpi/**/*.test.mjs"`: 85 tests, all pass.
- `npm run test:bench-driver`: 247 tests, all pass.
- `npm run test:flake`: 21 fixture checks, pass (it does not go through the launcher).
- `gate-exit-code.test.ts` alone: 10 tests, all pass.
