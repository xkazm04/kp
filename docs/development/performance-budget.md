# Performance budget — the number that is allowed to fail a build

**Status.** One rule is live and blocking (see
[What already fails today](#what-already-fails-today) — the barrel restriction in
`npm run lint`). The **budget** is not: `scripts/perf/check-budget.mjs` is
committed, has no recorded `perf-budget.json`, and no CI step runs it. Two
commands finish it, in [Finishing it](#finishing-it). Said plainly because the
gap this page exists to close is precisely *"nothing fails when the app gets
slower"*, and a page claiming more than is wired would be the same failure in a
new place.

The sibling budget — *"nothing fails when the **pipeline** gets slower"* — **is**
wired: `scripts/perf/ci-budget.mjs` runs in its own `ci.yml` job on every run and
fails it when a job exceeds its declared ceiling. See
[The other budget](#the-other-budget-how-long-the-pipeline-itself-is-allowed-to-take).

## What is measured, and why this number

This repo measures cost carefully and gates none of it. 783 tests, e2e,
accessibility probes and LLM evals all read correctness; no committed threshold
reads cost. The one number with a measured cost model behind it already lives in
[`../architecture/app-structure.md`](../architecture/app-structure.md):

> `next dev` compiles a route's **entire module graph** on first hit, with no
> tree-shaking […] the cost tracks graph size almost linearly

with the numbers to match — `/api/comms/relay` (8 modules · 34 KB) answers its
first hit in 1.9 s, `/api/schedule` (132 modules · 1.34 MB) in 22.6 s — and a
rule derived from them: **import the slice (`@/app/_lib/db/pipeline`), not the
barrel (`@/app/_lib/db`)**, because one barrel import in a hub module taxes every
route downstream. Cutting it took `/api/health` from 55 modules · 718 KB to
14 · 180 KB.

That rule is prose. Nothing re-reads the graph, so the next change that types
`import { … } from "@/app/_lib/db"` into a hub re-inflates a hundred routes and
every gate stays green: typecheck passes, lint passes, the tests pass, the app is
simply slower. `scripts/perf/check-budget.mjs` is that rule as a number.

**Why a static graph and not a stopwatch.** A wall-clock budget on a shared CI
runner flaps, and a gate that flaps gets deleted — the same reason `ruff format`
is deliberately absent from autofix. The module graph is a pure function of the
committed source: same tree, same number, on any machine, with no build, no
server, no network, no `node_modules`. The repo's own measurement is what
licenses it as a performance proxy: cost tracks graph size almost linearly, so a
graph that doubles is a route that got slower.

## What already fails today

One slice of this is live. The barrel rule is an ESLint restriction in
`eslint.config.mjs`:

```js
selector: "ImportDeclaration[importKind!='type'][source.value='@/app/_lib/db']"
```

at `error`, over `app/**` and `packages/**`, tests exempt (a test file is never
compiled into a route, so its graph is not a request cost). It started at **zero
violations**, so anything it fires on is new, and it runs wherever `npm run lint`
runs — the node-quality job in `ci.yml` and `.githooks/pre-push`. When it fails,
the message names the fix: import the slice (`@/app/_lib/db/pipeline`), or make
it an `import type`, which is free.

`no-restricted-syntax` rather than `no-restricted-imports` for one reason: the
selector can read `importKind`, so it can permit the type-only import that costs
nothing. Note that the block re-spreads `TRANSACTION_SELECTORS` — flat config
replaces a rule's options rather than merging them, so a second
`no-restricted-syntax` block listing only its own selector would have quietly
switched the `db.transaction()` rules off.

That covers the single highest-leverage regression. It does not cover a route
that grows for any other reason, which is what the budget below is for.

## The budget file

`perf-budget.json` at the repo root — beside `ruff.toml` and `playwright.config.ts`,
where an agent editing a route meets it in the same directory listing rather than
three levels down in `docs/`.

```jsonc
{
  "version": 1,
  "slackPercent": 15,          // headroom over the measurement when recording
  "entries": {                 // named files with their own ceiling
    "app/page.tsx": { "maxModules": 1131, "maxKb": 4200, "why": "the whole ?tab= workspace behind one URL" }
  },
  "groups": {                  // one ceiling for every file matching a glob
    "app/api/**/route.ts": {
      "maxModules": 120, "maxKb": 1200,
      "why": "cost per request: next compiles a route's entire graph on first hit",
      "overrides": { "app/api/schedule/route.ts": { "maxModules": 160, "maxKb": 1600, "why": "above p95 when recorded" } }
    }
  },
  "barrels": {                 // how many VALUE importers a barrel may have
    "app/_lib/db.ts": { "maxValueImporters": 1, "why": "the export * barrel over 17 store modules" }
  }
}
```

(The numbers above are illustrative. `--record` writes the real ones.)

Three things are worth knowing about the shape:

- **A group covers a route that does not exist yet.** A new
  `app/api/**/route.ts` arriving over the group ceiling fails without anyone
  having added it to the budget first — which is the case a per-file baseline
  always misses.
- **The group ceiling is the p95 route, not the worst one.** One fat route must
  not buy headroom for two hundred, so anything above p95 gets a named override
  with its own ceiling and is visible in the diff.
- **`import type` is free** (erased before bundling) and is never counted, in the
  graph or in the barrel rule. That is the same line `app-structure.md` draws.

## How a ceiling moves

**Down by itself.** `--tighten` lowers every recorded ceiling to what the tree
now carries plus the slack, so a real improvement is recorded without anyone
typing a number — the shape `scripts/lint/ruff-ratchet.mjs` already uses here. It
can only lower: a measurement above a ceiling is a finding for the gate, never a
new ceiling.

**Up only in a diff.** Raising one is an edit to a committed file with a `why` —
which is the point. A route may legitimately grow; that should be a decision
somebody made and a reviewer can disagree with, not a number that drifted. A
ceiling without a `why` fails to load, so the reason cannot be skipped.

## When it fails

The message names the file, the measurement and the ceiling. In order of what
usually fixes it:

1. **A barrel import in a hub.** `--explain <path>` lists the heaviest modules on
   the path; import the slice instead.
2. **A helper living in a hub module.** Move it to a leaf — that is what
   `plannedInterviewMinutes` → `app/_lib/interview-planned-minutes.ts` was.
3. **`import type` written as a value import.** Free once it is a type import.
4. **The route genuinely needs it.** Raise the ceiling with a `why`.

```bash
node scripts/perf/check-budget.mjs --explain app/api/schedule/route.ts
```

## Finishing it

1. **Calibrate.** `node scripts/perf/check-budget.mjs --record` measures the tree
   and writes `perf-budget.json`. Read every number before committing it, and
   delete any target not worth a gate. (It refuses to overwrite an existing
   budget — lowering is `--tighten`, raising is an edit.)
2. **Gate.** Add to `package.json`:
   `"perf:budget": "node scripts/perf/check-budget.mjs"`, then a
   `- run: npm run perf:budget` step to the **node-quality** job in
   `.github/workflows/ci.yml`, beside `npm run design:check` — same tier: a
   static, key-free read of the committed tree that needs no build. Adding a step
   to an existing job changes no job name, so
   `.github/rulesets/main.json` and `npm run review:gate` need no edit.
3. Optionally add fixtures under `scripts/perf/__tests__/` and wire them into the
   `npm run test:docs` / `test:review` tier of ci.yml, the way every other gate
   script in this repo carries its own tests.

Until step 2 exists, nothing fails when the app gets slower.

## The other budget: how long the pipeline itself is allowed to take

Everything above measures the **app**. `scripts/perf/ci-budget.mjs` measures the
**pipeline that judges it**, and it is wired: the `Pipeline budget (wall-clock
against ci-budget.json)` job in `ci.yml` reads what the run actually took from
the Actions API and fails it when a job, or the run's own wall-clock, exceeds the
ceiling declared in [`ci-budget.json`](../../ci-budget.json).

Why it exists at all: seven workflows now run lint, three test runtimes, the
evals, the design-token and locale gates, and SBOM + signing on release. Each
addition is correct and each costs minutes, and with agents opening changes
continuously the time a pull request takes to go green is the rate limiter on the
whole loop. `timeout-minutes` does not measure that — it is a crash barrier at 25
or 30 minutes, so a job drifting from 6 minutes to 18 passes every gate here
while halving throughput.

| Aspect | The app budget (`check-budget.mjs`) | The pipeline budget (`ci-budget.mjs`) |
| --- | --- | --- |
| Metric | first-party module graph, static | job wall-clock, from the Actions API |
| Where it runs | (not yet wired — see [Finishing it](#finishing-it)) | the `pipeline-budget` job, `if: always()` |
| Ceilings | to be recorded from the tree | `ci-budget.json`, seeded at 0.6 × each job's `timeout-minutes` |
| Ratchet | `--tighten` | `--tighten` |
| Blocks a merge? | will, once recorded | **not yet** — see below |

**This does not contradict "why a static graph and not a stopwatch" above.** That
argument says an unmeasured wall-clock ceiling is a bad thing to *block merges*
on, and it holds: the seeded numbers are derived from timeouts, not measured, so
the job goes red on the run but is deliberately absent from
`.github/rulesets/main.json`. `npm run review:gate` reports it as an
`ungated-job` warn, which is true and is meant to stay visible. The condition for
requiring it is written in `ci-budget.json`: run
`npm run ci:budget -- --tighten` against real runs on main until the ceilings are
observed rather than derived, then add the context to the ruleset.

Three refusals make it a gate rather than a dashboard, and they carry fixtures in
`scripts/perf/__tests__/ci-budget.test.mjs`:

- **A job with no ceiling is a finding, not a pass.** Adding a gate to `ci.yml`
  now costs one entry saying how long it may take and why — which is the moment
  to notice the pipeline just got longer.
- **A job with no duration is never scored as zero.** Still running (the budget
  job judging the run it is inside), skipped, or cancelled — all report as *not
  measured*, and the run's wall-clock is computed from the rest.
- **`--tighten` can only lower.** An over-budget run is a finding for the gate to
  report, never a new ceiling to record. Unused headroom is printed in the step
  summary so tightening is a visible chore rather than an invisible one.

The run's wall-clock is the **span** — first job to start until the last one
finishes — not the sum of the jobs. A sum would grow every time a gate was moved
off the critical path onto its own runner, which is an improvement.

The scope is `ci.yml` only: the workflow every pull request waits on. `review.yml`,
`security.yml` and `release.yml` are unbudgeted, which is a known gap — the same
job would work there, keyed the same way, and the reason it is not there yet is
that only `ci.yml` blocks the loop this budget exists to protect.

## What this budget deliberately does not cover

- **Latency** (p95 on a jobfit request, cold start). The Python pipeline is
  spawned per request, so real request cost is dominated by process start and
  provider time — neither is stable enough on a shared runner to block a merge.
  Measure it with `scripts/perf/devbench.mjs` and record the result in
  `../architecture/app-structure.md`, which is where the dated measurements live.

  That tool now carries **its own** small ratchet, deliberately outside this
  budget: it compares each run to `scripts/perf/devbench-baseline.json` (keyed by
  variant — `warm` / `cold` / `+burst`, never by the free-text run label) and
  exits non-zero when `bootMs`, `firstMs`, `warmMs` or `totalMs` is more than
  **35%** worse than its entry. Before the baseline existed, devbench appended to
  a gitignored `.next/devbench.jsonl` that every `--cold` run wipes, so a
  dev-server regression was invisible between sessions — the tool could tell you
  today's number and never that it had doubled.

  Thirty-five percent is wide on purpose: these are wall-clock numbers off a
  developer's machine with a browser open, and a gate that cries wolf is a gate
  people learn to ignore. It catches a doubling, not jitter. Move a number with
  `node scripts/perf/devbench.mjs <label> --record` and review the diff — that is
  the whole ratchet, and it is why this stays a local tool rather than a CI step.
  The committed entries were seeded by transcription from the dated table in
  `../architecture/app-structure.md`; the file says so, and the first `--record`
  on a machine replaces a transcription with a measurement. The pure half is
  pinned by `scripts/perf/__tests__/devbench.test.mjs` (11 checks) in
  `npm run test:perf`, which also validates the committed file — a ratchet whose
  committed state is malformed is a gate that silently never fires.
- **Client bundle bytes.** A worthwhile second metric, and it needs a build
  (`.next/`), which puts it in a different CI tier from this one.
- **SQLite write throughput.** Already measured, with its result written down:
  `scripts/perf/sqlite-writer-knee.mjs` and
  [`../architecture/postgres-backend.md`](../architecture/postgres-backend.md).
