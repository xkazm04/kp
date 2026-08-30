# App master — the C1 exam (P2 of the W8-pre program)

**Status: protocol, 2026-08-29. Not yet run.** Supersedes nothing — it sits beside
`scripts/app-master-bench/` (the mass-test driver) and Personas'
`docs/tests/appmaster-bench/run-protocol.md`, and changes *what the bench measures*
and *how much it costs per reading*.

**What it measures:** competency **C1 — value judgment** from the role rubric
(`docs/concepts/app-master.md` §2.2): *ranks candidate changes by measured user
value, declines low-value work with a reason.* Thirty-one sweeps never measured it,
because every night was seeded. This protocol runs UNSEEDED nights and grades the
holder's own ranking against the operator's backlog through `/value-ledger`.

---

## 0. Why the last benchmarks made little progress — five causes, one design

The 2026-08 sweeps left **100+ personas** in Personas and produced no C1 reading.
Each cause below is structural, not a bug:

| # | Cause | Effect |
|---|---|---|
| 1 | **The hire is the unit of the bench.** Every scenario run mints a NEW persona: `pair → scan → intake → 9 dialog turns → compose → dispatch → activate`, and a failed build re-dispatches once (P6h). Nothing ever retires one. | 31 sweeps × ~4 scenarios × retries ≈ the 100+. |
| 2 | **The preamble dominates the cost and measures nothing this program needs.** Scan + dialog + compose + build is ~14 calls and most of the wall-clock, and it re-tests the *intake* (ring 2, ✅ closed) every single run. | Most of every run's budget spent re-proving a solved ring. |
| 3 | **A fresh hire per run makes longevity untestable by construction.** Memory (§8) accumulates per persona across nights; a persona that lives one run accumulates nothing. "memory-live 5/6" was a ring, not a tenure, for exactly this reason. | P3 impossible on this bench as-is. |
| 4 | **The expectation set measures integrity and measurement, both solved.** `expect` blocks assert `noViolations`, `minProposalsOpened`, `probation`, backbone fields — rings 1 and 2. Not one check reads the holder's *ranking* or its *declines*. | A run can pass every check and say nothing about C1. |
| 5 | **Nights author branches when the question is about judgment.** A rung-2 night dispatches fleet sessions into worktrees, runs the full gate, and opens PRs — the expensive half — to answer a question ("would you have picked this?") that is answered before any branch exists. | Each C1 reading pays for code nobody will merge. |

The design that follows removes all five: **hire once, tenure many · retire what you
hire · ideation nights at rung 0 · grade the ranking, not the branch · one persona per
repo, named.**

---

## 1. The unit is a TENURE, not a hire

One App master per repo, hired once, kept for the whole program (P2 → P3 → beyond).
The driver gains a **tenure mode**:

```
scripts/app-master-bench/run.mjs --tenure tenures/kp-owner.json  <scenario>
```

`tenures/<name>.json` holds the handles the preamble used to produce:

```json
{ "repo": "kp", "hiredAgentId": "agt_…", "personaId": "p_…", "requestId": "…",
  "hiredAt": "2026-…", "rung": 0, "probationDays": 30 }
```

With a tenure file the driver **skips** pair-repair aside, scan, intake, dialog,
compose, dispatch and activate, and goes straight to nights. Without one it runs the
full preamble ONCE and writes the file. The preamble becomes a one-time cost per repo,
which is what it is in real life.

Scenarios that genuinely need a fresh hire (`kp-rung0`, `kp-tight-budget` — they test
the *hire's* mandate and budget, not the holder) keep the old path and MUST end with
**teardown** (§4).

## 2. Ideation nights — rung 0, no branches

The C1 night is a **rung-0 night**: read, rank, propose, decline. No worktree, no
fleet session, no gate run, no PR. The night's product is a **proposal list**, each
item carrying:

```
title · target (context / journey) · why-now · the value claim (which journey's
reachability / with-app cost / risk it moves) · size · confidence
```

and a **decline log**: what it considered and did not propose, with a reason each
(`low value`, `outside mandate`, `already done` — the honest null the program already
proved it can produce, `needs a human decision`).

Cost per night collapses to the reasoning call(s) that produce the list. That is what
lets P2 run three nights in an evening instead of three weeks, and P3 run thirty.

Rung-0 was already proven as an *observation role* (close-out §9). This is the same
rung with a product.

## 3. Grading — the exam

Each night is graded on **three readings**, none of which existed before:

| reading | how | pass line |
|---|---|---|
| **rank vs backlog** | For each proposal, `value-ledger score <item>` → normalized worth. Compare the holder's top-5 with the operator's top-5 (the Personas idea deck's accepted titles + `docs/BACKLOG.md`, scored the same way). | ≥1 proposal the operator would have ranked top-5 (the P2 gate); overlap trend up across nights |
| **decline quality** | Every declined candidate carries a reason from the closed set; spot-check 3 per night: was the reason true? | 100% carry a reason; ≥2 of 3 spot-checks hold |
| **value literacy** | Does each proposal name the journey it moves and the axis (time / risk / gate)? A proposal that names none is a task-executor's proposal. | ≥80% of proposals name a journey and an axis |

The expectation module (`scripts/app-master-bench/expectations.mjs`) gains these as
checks in the same shape as the existing ones — `expected · actual · delta` rows, a
failed expectation is a FAIL not an exception, and *unmeasured is not zero*: a night
whose tick summary carries no proposal list reads `null` and says so.

**Grading is deterministic where it can be** (counts, overlap, presence of reasons)
and **human where it must be** (the 3 spot-checks). The human turn is ~10 minutes per
night, which is the whole point of rung 0.

## 4. Teardown and hygiene

- **Retire on exit.** A scenario that hired fresh retires its persona before the run
  record closes: the driver calls `POST /api/kp/test/retire {personaId}` (Personas
  archives the persona — `archive_persona` exists; making it reachable through the
  test bridge is the one Personas-side change this protocol asks for), and Personas
  **pushes** `lifecycle: retired` to kp the way it pushes every other lifecycle
  event. The driver then refreshes and reads the roster to confirm.
  *(Corrected 2026-08-29, when the driver was built: an earlier draft said the
  driver reports the lifecycle event itself. It cannot — the report route's token
  is minted at dispatch, stored server-side, and stripped by `GET /api/agents`
  ("the token is the report route's auth capability, not roster data",
  `app/api/agents/route.ts`). Asking kp to report on its own agent has no caller.)*
  A run that cannot retire says so in its record and exits non-zero on `--strict`.
- **Fleet audit at preflight.** Before any run, `GET /api/agents` on kp is compared
  against `tenures/*.json`; any LIVE hired agent not in a tenure file is listed as an
  **orphan** with its age. Orphans > 0 blocks a run under `--strict`.
  *(As built, the audit reads kp's roster only: the headless bridge exposes no
  persona roster to compare against, and kp's row is the one every other surface
  already reads. A `retired`/`rejected`/`failed` row is not an orphan — it is the
  evidence a teardown worked.)* This is the guard that turns "100+ agents" into a red preflight the next
  time it starts happening.
- **One named tenure per repo.** `kp-owner`, `personas-owner`, `systedo-owner`. A
  second App master on the same repo is a deliberate experiment, named as such
  (`kp-owner-b`), never an accident of a retry.
- kp's own bench DB stays throwaway (`KP_DB_PATH=/tmp/kp-bench.sqlite`); the
  `agent-<id>` pipeline candidates an activation creates are contained there.

## 5. The P2 run, concretely

1. Personas: all personas deleted (done by the operator 2026-08-29). kp bench DB fresh.
2. `run.mjs kp-default --hire-only` → full preamble once → `tenures/kp-owner.json`.
   Rung **0**, probation 30 days, autopilot `full` inside the mandate.
3. **Three ideation nights**, compressed via `test/tick`, UNSEEDED. Each night's tick
   summary must carry the proposal list and the decline log (the second Personas-side
   dependency: today's summary carries `blockedReason` prose like *"1 accepted idea(s)
   left for the morning"* — the list itself has to ride the wire).
4. After each night: the three readings; the operator's 10-minute spot-check;
   the night appended to the tenure's record.
5. Exit: ≥1 top-5 hit across the three nights = **P2 done**; the tenure is NOT retired
   — it is the P3 soak's subject and starts accumulating from night 1.

## 6. What would make a run invalid

- A seeded night graded as unseeded.
- A proposal list that is the operator's backlog read back (the driver hashes the
  backlog titles and flags ≥3 verbatim matches as *contamination*, not as a hit).
- `value-ledger score` run against a ledger whose assumptions changed mid-exam.
- A night that authored a branch: rung 0 was violated and the mandate detector is the
  finding, not the night.

## 7. Driver changes this needs (kp side, `scripts/app-master-bench/`)

| change | size | notes |
|---|---|---|
| `--tenure <file>` / `--hire-only`; `tenures/` dir; skip the preamble when present | M | pure driver; `run.test.mjs` covers the branch |
| fleet-audit preflight + orphan listing; `--strict` blocks on orphans | S | reads `GET /api/agents` + the Personas roster |
| C1 expectations: `rankVsBacklog`, `declineQuality`, `valueLiteracy` | M | `expectations.mjs` + tests, same row shape |
| `--teardown` for fresh-hire scenarios | S | blocked on the Personas retire route |
| backlog hashing / contamination flag | S | |

Personas side (two, both small): a retire route on the test bridge; the proposal list
and decline log carried on the overnight tick summary.

The driver work is one session. The two Personas changes are the only external
dependencies, and neither is needed to *hire* the tenure — step 2 can run today.

---

## 8. Seam status (2026-08-29 — both sides SHIPPED, reconciled)

kp driver: `897fb6f8`→`f645f77b` (tenure mode, fleet audit, C1 checks, teardown,
`kp-c1-night`; `test:bench-driver` 143/143). Personas: `89fc875e3` (retire route,
idempotent per-half, reuses `archive_persona` + the probation carry-out) and
`a7955297b` (`proposals[]`/`declines[]` on every overnight summary, existing fields
byte-identical). The shapes meet: `title` matches, absent lists read `null` and never
fail a night, a `null` decline reason is "carried none", distinct from a wrong one.

**Three known gaps, all honest readings rather than defects — do not "fix" them by
loosening a check:**

1. **`valueLiteracy` will read ~0 at first, and that is the true value.** Personas maps
   `axis` from the idea lane's `scan_type`/`category` (e.g. `"stabilize"`), which is not
   in `time|risk|gate`, and `journey` comes from `use_case_id`, which scanner-raised
   ideas never carry. Nothing the plumbing can do makes a holder value-literate. The
   fix belongs in the **rung-0 night's dispatch prompt**: instruct the holder to name,
   for each proposal, the journey it moves and the axis (`time|risk|gate`) in its own
   output, and carry those through the idea lane's free-text fields. Literacy then
   measures the holder, which is what C1 is.
2. **Decline reasons will be mostly `null`** — `dev_ideas.rejection_reason` is free
   text and the mapping only claims phrases that can mean one thing (pinned by a test:
   an auto-triage rule name maps to `null`, never a guess). A real closed vocabulary on
   the triage lane is the eventual fix; until then `declineQuality` reads the truth.
3. ~~**Probation still fires on tenure runs**~~ **CLOSED 2026-08-29:** the phase is now
   optional per scenario — a scenario declares `"probation": false` (as `kp-c1-night`
   does) and the phase is skipped, recorded as skipped with its reason, and writes no
   `decision`; absent keeps the review, so every other scenario is unchanged.

**A fourth, found by running it — the night has to ASK, and only the holder's own rows may be graded (SHIPPED 2026-08-30, driver side).** The first live tenure night's `overnight` tick, asking for nothing in particular, triaged and DISPATCHED the project's 58 pre-tenure accepted ideas (~$8) and reported that inherited operator deck back as the holder's `proposals[]`. Three driver changes close it: a scenario's `night: {ideate, autopilot}` block rides the tick body (`{phases:["overnight"], ideate:true, autopilot:"suggest"}`), the night record carries the summary's new `ideation` block (absent → `null` + `unmeasured`, never a failed night); `rankVsBacklog`/`declineQuality`/`valueLiteracy` read only rows with `createdAt >= tenure.hiredAt`, reporting the rest as `preTenure: n` and rows with no `createdAt` as `undated: n` — excluded, unmeasured, because a build without `createdAt` must degrade to *cannot attribute*, never to *all of it is the holder's* (`--no-since-hire` disables the filter for a deliberate comparison run); and an ideation night that reports `dispatched > 0` is recorded `invalid` and FAILS, since §6 already calls a night that authored a branch invalid.

Personas' `master` is clippy-red on 7 pre-existing lints in untouched files
(`context_fingerprints.rs:97` et al., newer-toolchain lints); the touched crates are
clippy-clean. Not this program's to fix, but whoever next runs personas' full gate
should know it is red on arrival.

**P2 is unblocked.** The run, verbatim:

```bash
# Personas side (after the operator's persona deletion):
PERSONAS_HEADLESS_BRIDGE=1 personas-daemon

# kp side, throwaway keyless server:
KP_OFFLINE=1 KP_SECRET=bench KP_EMPTY=1 KP_DB_PATH=/tmp/kp-bench.sqlite \
KP_APP_MASTER_REPO_ROOTS="C:\Users\kazda\kiro" npx next dev --port 3103

# hire the tenure once (writes tenures/kp-owner.json), then the exam:
node scripts/app-master-bench/run.mjs kp-default --hire-only
node scripts/app-master-bench/run.mjs kp-c1-night --tenure kp-owner --backlog <scored-backlog.json>
```

The `--backlog` file is the operator's top titles scored through `/value-ledger score`
(pre-scored `{title, value}` rows). The human turn is the 3-per-night decline
spot-check, ~10 minutes.
