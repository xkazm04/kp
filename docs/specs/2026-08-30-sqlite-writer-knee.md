# A method for the stated writer ceiling: the SQLite writer-knee probe

Date: 2026-08-30 · Status: implemented with this spec
Registry technique:
`software-engineering/scale-investment-timing/ceiling-as-deadline-not-trigger`.

## Current state

docs/architecture/postgres-backend.md §2 states the ceiling: "Concurrent
writers, 1–2 users/team — Yes; writers serialize; `busy_timeout=5000` waits
briefly." The figure (1–2), axis (concurrent writers per team) and mechanism
(WAL single-writer serialization behind a 5s busy wait) are all stated — but no
method exists that measures where a third writer actually degrades. Per the
technique, a ceiling without a method is an assertion, not a deadline: nobody
can tell whether the knee is at 3 writers or 30, or re-measure after a pragma
change.

## Target shape

- `scripts/perf/sqlite-writer-knee.mjs` (next to the existing `devbench.mjs`):
  a runnable probe, NOT a CI gate. It creates a throwaway SQLite file, opens it
  with the repo's REAL canonical pragmas (`journal_mode=WAL`,
  `synchronous=NORMAL`, `busy_timeout=5000` — the `openStore()` trio,
  app/_lib/db-path.ts:149-156), and spawns N=1..5 concurrent writer workers
  (worker_threads, one connection each — same shape as the app's
  scheduler-vs-route sibling connections). Each writer commits W small
  single-row transactions (the app's dominant write shape). Reported per N:
  throughput, p50/p95/max commit latency, and SQLITE_BUSY count (a thrown BUSY
  means a writer waited out the full 5s timeout — the user-visible failure).
- The doc's §2 row gains the measured basis: the N at which p95 commit latency
  degrades materially (the knee) and the busy-error onset, stamped
  `basis: measured <date>, scripts/perf/sqlite-writer-knee.mjs` so the claim
  carries its method and can be re-run when pragmas or write shapes change.

## Out of scope

- CI integration or perf regression gating (this is a method, run on demand).
- Multi-process (vs worker-thread) writers, network filesystems, and the
  Postgres comparison — the probe measures the mechanism the doc names.
- Tuning work in response to the measurement (that is precisely the investment
  the technique says NOT to make before the deadline is real).

## Acceptance checks

- `node scripts/perf/sqlite-writer-knee.mjs` runs to completion on a dev
  machine and prints one row per N with the stats above.
- postgres-backend.md §2 carries the measured knee with date + method pointer.
