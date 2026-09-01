# App master — the P3 longevity soak

**Status: RUNNING from 2026-09-01.** Night 1 ran supervised the same day: authored 7 (business-strategist + ux-reviewer), 36 holder-era proposals, 0 pre-tenure on the wire, one taxonomy entry (`memory-unreported`). **Cost, one definition:**
`budgetSettledUsd` on the record is the persona's CUMULATIVE settled ledger, so
a night's cost is the DELTA against the previous record. Measured deltas so
far: $0.49, $1.82, $0.00 — scans on the CLI's subscription auth often settle
$0, keyed API calls do not. The abort criterion below keys on that delta. Note: the driver exits 1 whenever rankVsBacklog misses — for the SOAK that exit code is a datapoint, not a failure; the runner records and moves on, by design. Subject: tenure `kp-owner`
(`agent-mtfmew8s-q4o36c` / persona `6f585135…`), hired 2026-08-30, three exam
nights of history (P2 passed — `app-master-c1-exam.md` §8c). This document is
the protocol and the taxonomy; the per-night record is
`bench/app-master/soak/log.jsonl` (one JSON line per night, misses included).

**What it measures** (close-out §9 gap 5, registry `agent-memory`): what breaks
when an App master runs for weeks, not rings — memory that decays wrongly, recall
that injects the wrong thing, beliefs without provenance, and the bench-machine
fragility the program already named (sleep, limit windows, services down).
**The gate: a failure taxonomy with ≥14 distinct CALENDAR DATES recorded, of which ≥10 actually RAN** (`ran: true`; `backfilled` rows count toward the record — the miss taxonomy is real data — but never toward the ran-quota, or a machine asleep for two weeks would "meet" the gate with zero longevity observations). The record carries `date`; `night` is only a log index. Not
uptime; a soak with ten recorded misses and honest reasons passes; a soak with a
gap in the log does not.

## Mechanics

- **Scheduler:** Windows Task Scheduler, task `kp-app-master-soak`, nightly
  02:47 local → `scripts/app-master-bench/soak/soak-night.cmd` →
  `soak/night.mjs`. **Registered by the committed installer**
  `soak/install.cmd` (idempotent, paths derived from its own location, prints
  the task back for verification) — run it once per machine; the teardown
  command is in its header. **The task runs LATE rather than not at all**
  (`StartWhenAvailable`, both battery guards off) — patched in PREVENTIVELY from
  measured host behaviour (2026-09-01: this host sleeps through 02:47 —
  Power-Troubleshooter shows awake 01:13, next wake 06:26 — and the default task
  would have skipped that firing outright). *Correction:* an earlier version of
  this line said the first firing had been lost; it had never been due (the task
  was registered after that day's 02:47, and `LastTaskResult 0x41303` reads
  "never run" for both cases). It does NOT wake the machine
  (`WakeToRun` off, deliberately), so a host asleep all day still produces a
  `no-record` row at the next firing — which is the honest outcome, not a bug. (Deliberately NOT the Claude session's cron — that is
  session-bound and 7-day-capped; a 14–30 night soak needs an OS-level job.)
- **One night =** the C1 ideation night exactly as the exam ran it:
  `run.mjs --scenario kp-c1-night --tenure kp-owner --nights 1` against the
  current operator backlog (`uat/value/backlog-2026-08-31.json` — update the
  env `SOAK_BACKLOG` when the deck moves). Rung 0, `autopilot: suggest`, no
  branches, probation declined.
- **The kp bench server** is the runner's: booted if down, on the
  session-independent DB `%LOCALAPPDATA%\kp-bench\kp-soak.sqlite` (the tenure's
  kp-side roster row lives THERE — moved out of a session scratchpad
  2026-09-01; losing this file orphans the kp half of the tenure).
- **The soak shares `dev:empty`'s build dir.** `KP_EMPTY=1` puts the bench
  server on `.next-empty` (next.config.ts:82), so its dev lock contends with
  `npm run dev:empty` — not with `npm run dev`. A `dev:empty` server left up at
  02:47 turns the night into a `kp-boot-failed` miss (recorded, with the lock
  named); a soak survivor blocks the next `dev:empty`, never plain `dev`.
  Giving the soak its own distDir needs a `next.config.ts` change — a named
  future item, deliberately not smuggled into the soak kit.
- **The Personas app is the operator's** and stays running for the soak. The
  runner never boots it: down ⇒ a recorded `bridge-down` miss. That is a
  measurement, not a failure of the runner — bench-machine fragility is half
  the taxonomy.
- **The feedback loop is live:** the operator's P2 ranking correction was
  written into the idea lane 2026-09-01 (the corrected top-5 `accepted`), so
  every soak night's triage and recall run over real Director feedback.

## The per-night record

`{at, date, night, ran, miss, exitCode, runDir, ideation{ran,lens,authored,blocked},
c1{proposals,declines,preTenure,undated}, dispatched, budgetSettledUsd,
memory{core,active,working,archived}, anomalies[], ms}` — plus `backfilled:
true` on retrospective miss rows, which count toward the recorded window and
NEVER as observations (the gate's ran-quota reads `ran: true` only). `memory` is the
longevity axis (the persona's tier counts off the roster; the registry's
coverage-instrumentation applied at the cheapest honest altitude). A `null`
memory on a night the reporter sent none is recorded as exactly that.

## The taxonomy (grows; every entry cites nights)

Seed classes, from the program's own history — an entry is only real once a
soak night exhibits it:

| class | meaning | nights |
| --- | --- | --- |
| `bridge-down` | Personas not running / bridge off when the night fired | — |
| `kp-boot-failed` | bench server would not answer health in 240s | — |
| `tick-died` | the overnight tick errored (transport, timeout, 500) | — |
| `ideation-blocked` | scanner refused (quota, scope) — reason recorded | — |
| `authored-zero` | scanner ran, wrote nothing (backpressure, dedup, drained repo) | — |
| `dispatch-on-ideation` | the suggest override failed and a branch was authored (exam §6 — CRITICAL) | — |
| `memory-unreported` | roster carried no tier counts for the window | **1** — and the suspected mechanism makes it structural: episodic write-back is keyed to branch/build events, which rung-0 ideation nights never produce, so an ideation-only soak measures nothing about memory. Personas-side candidate fix: night outcomes (the ideation summary) write a `learned` persona memory even when no branch was authored (§8 already specifies "night outcomes … → persona learned"). Watch nights 2–3 before filing. (Night 1 pre-dated the runner fix that resolves the roster row via the tenure file; from night 2 the three cases — no handle, no row, reporter-sent-none — are recorded apart, per the 2026-09-01 review finding.) |
| `memory-nonmonotonic` | tier counts moved in a way no night explains (wrong decay / wrong consolidation) | — |
| `recall-wrong` | a night's output contradicts something the memory should have carried (requires reading the proposals — the weekly human pass) | — |
| `driver-timeout` | the driver exceeded the runner's 40-min ceiling — observed directly, distinct from a crash | — |
| `record-unreadable` | a fresh run dir whose result.json carries no `tickOk` — partial write or driver shape change; the night may even have run | — |
| `unclassified` | no code path recorded a reason — the record-keeping itself failed; classify by hand at the weekly pass and fix the silent path | — |
| `no-record` | BACKFILLED at the next firing for any calendar day with no row (`backfilled: true`): the task never fired OR it fired and the runner died before writing — the row states both hypotheses and names the evidence (runner.log, Task Scheduler history); the weekly pass hand-classifies it to `machine` or `unclassified` | — |
| `machine` | host asleep, node/npm broken, disk, clock — assigned by HAND from a `no-record` row once the evidence says so; never auto-asserted | — |

## The weekly human pass (~15 min)

Once a week: read the week's `log.jsonl` rows and the newest proposals; move
anything real from `anomalies[]` into the taxonomy table with its night numbers;
accept/reject ideas on the deck (that IS the feedback channel); check the
memory counts trend. The soak ends at THE GATE — ≥14 distinct dates recorded,
≥10 with `ran: true`; count `date` values, never `night` indices, and a
`backfilled` row is a recorded miss, never an observation — with the taxonomy
written. Then P4 (the responsibilities layer) is authored FROM it.

## Abort criteria

Stop the task (`schtasks /delete /tn kp-app-master-soak`) if: a
`dispatch-on-ideation` night ever appears (mandate enforcement failed — that is
a program-stopping finding, not a datapoint), or the night-over-night DELTA of
`budgetSettledUsd` exceeds $2 on two nights without an explaining anomaly, or
the operator says so.
