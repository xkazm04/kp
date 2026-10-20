---
id: "0029"
title: The unit-test launcher runs one suite per machine at a time
status: accepted
date: 2026-10-18
supersedes: []
superseded-by: null
tags: [testing, gates, concurrency]
sources:
  - scripts/run-unit-tests.mjs
  - app/_lib/testing/unit-db.test.ts
---

# The unit-test launcher runs one suite per machine at a time

## Context

The python-runner, templates-isolation and devcase comms gate failures of
2026-10-17/18 each passed alone and failed only beside another lane's gate
(one run's gate overlapped another's at 13:34Z). They read as flakes in
whichever file lost.

`node --test` sizes itself to `availableParallelism()-1` as if the suite had the
machine to itself, and many test files spawn children of their own. Reproduced
on the 16-core dev box: three full suites started together put about 45 test
processes on 16 cores and went red 3/3, every time in the python-runner files
("Python process timed out after 4s" in option-injection, the 80 ms background
bound in lanes). One or two suites at a time stayed green. The tests that lost
are the ones that assert on wall-clock bounds.

## Decision

`scripts/run-unit-tests.mjs` takes a machine-wide slot for the whole run: an
atomic `mkdir` of a lock directory in `os.tmpdir()`, with an `owner.json`
recording the launcher's pid, cwd and start time.

- A second run waits and names the run it waits for ("another suite is running
  on this machine (pid … in …); waiting for it…").
- A launcher started by a test of the holding suite inherits
  `KP_TEST_SLOT_HELD` and does not wait on its own parent, nor release a slot
  it does not own.
- A slot whose owner is dead, or that is older than 45 minutes, is taken over.
- `KP_TEST_SLOT=0` opts out; `KP_TEST_SLOT_DIR` moves the lock (the fixture in
  `unit-db.test.ts` uses it so it never touches the real slot).

After the change the same three concurrent suites ran in turn, 3/3 green,
13532 tests each, nothing re-run.

## Alternatives considered

- **Shared state between suites (the four isolation hypotheses).** All came
  back clean, so the fix is not an isolation fix: the sweep needs a dead owner
  and 15 minutes of staleness; the db-path guard throws deterministically;
  both DB files import `unit-db` first; 384 hammered runs of the three files
  beside a full suite failed 0 times. Nothing was shared but the CPU.
- **Lowering per-suite concurrency, or raising the timeouts in the failing
  tests.** Not chosen. The commit does not evaluate either; it records only
  that the failure is the sizing assumption (each suite assumes the whole
  machine), which a slot removes at the source without touching any test.

## Consequences

Concurrent gates (two autopilot builders, or a builder beside a developer)
now serialise their unit suites, so wall time grows with the queue. Flake-shaped
gate failures beside another lane are no longer expected; one that appears is a
new bug, not this one. `unit-db.test.ts` pins the guarantee from outside: two
real launchers started together must not overlap (against the old launcher it
fails: "the second suite started 1373 ms before the first finished"), a nested
launcher never waits, and a dead owner's slot is taken over.

## What would change our mind

A gate that fails beside another suite again with the slot held, or a wait
long enough that the 45-minute takeover starts firing on live runs.

Commits: `589a514f2` (fix(test): run one unit suite per machine at a time) and
`8dbe8ddfe` (test(unit-db): type the slot fixture's child env).
