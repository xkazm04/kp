# Testing & evaluation

```bash
npm run lint
npm run typecheck         # also regenerates the Zod schema
npm run test:unit         # Node --test over app/**/*.test.ts (no jest/vitest)
npm run test:python       # python -m unittest discover pipeline/jobfit/tests
npm run test:python:gate  # gated runner with skip baseline
npm run test:e2e          # Playwright; Analyze suite auto-skips when no GEMINI_API_KEY
npm run test:eval         # golden-set eval (markdown report)
npm run test:eval:strict  # eval + non-zero exit when thresholds fail
npm run test:eval:match   # matching-quality eval (strict) — KEYLESS
npm run test:eval:automation  # automation reliability, deterministic path — KEYLESS
npm run test:eval:ci      # both of the above; this is the CI gate
npm run bench:gate        # App-master sweep verdict vs the committed baseline
npm run review:constitution   # deterministic gate-integrity pass over the diff
npm run docs:check        # decision-record integrity
npm run test:flake        # fixtures for the flake policy + quarantine register
```

## Which of these are gates, and which are probes

A harness nobody depends on decays: the signal only exists when somebody chooses
to look, and that is exactly the habit that erodes as work speeds up. So the
suites are split by whether a red result is **always** a real regression.

**Gated in CI, on every push and PR** — deterministic, keyless, cheap:

| Suite | Why it can be a gate |
| --- | --- |
| `test:eval:match` | needs no API key by construction; also carries the fairness probes (pedigree exclusion, socioeconomic inclusion, language neutrality, potential monotonicity) |
| `test:eval:automation` | `--no-llm`: the deterministic fallback path plus the hard reliability invariants. Also certifies [ADR 0004](../architecture/decisions/0004-keyless-degradation-is-a-product-property.md) — keyless degradation as a product property |
| `test:bench-driver` | the App-master driver's own node:test fixtures, including the bench baseline↔scenario pinning |
| `test:docs`, `test:review`, `docs:check` | the fixtures behind the doc-sync, ADR and change-review tooling |

**Deliberately on demand** — a red result may just mean a provider had a bad day,
or a live server was not running:

| Suite | Needs |
| --- | --- |
| `test:eval` | `GEMINI_API_KEY`; skips with exit 0 without one |
| `test:eval:strict` | same, but a keyless run exits **1** — `--strict` asks for a verdict this run cannot give |
| `automation_eval --judge` | a live Claude CLI judge, and a judge model that is **not** the engine's (below) |
| `bench:app-master` | a running kp **and** Personas (or `--stub-personas`) |
| `test:e2e` (full) | provider keys for the Analyze suite |
| `test:eval:intake-sim` | the JD-grounded intake simulation. LIVE by default (both sides are LLMs — keyless that is the subscription-billed Claude CLI); add `--no-llm` for the deterministic pass, `--http` for a running kp server. A **probe**, never a gate: it is not in `test:eval:ci` ([below](#jd-grounded-intake-simulation)) |

The bench is the interesting case: it cannot run in CI, but its verdict is still
machine-readable rather than prose. `npm run bench:gate` compares the sweep
against `scripts/app-master-bench/baseline.json` and writes
`bench/app-master/gate.json`, so the next agent reads a file instead of parsing
a commit message. See [app-master](../features/app-master/README.md#the-verdict-lives-in-a-file-not-in-a-commit-body).

The Python suite covers insights rules, PDF parsing quality, the matching engine, the
Claude CLI provider, the automation tasks, fairness gates, and the full devcase module
(analyze/design/source/evaluate/reflect/provenance). Tests that would need a live LLM
are skipped unless enabled (`KP_CLAUDE_CLI_LIVE=1`). Playwright splits into
`e2e/analyze-smoke.spec.ts` (LLM-backed Analyze flow across input combinations, skips
cleanly without a Gemini key, includes a11y checks) and `e2e/profile-builder.spec.ts`
(deterministic build/save round-trip, no API key needed). The deterministic keyless
e2e subset and how to run it against an already-running server are listed in
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) under "Common Commands"; the list
itself is declared once, as `KEYLESS_SPECS` in `playwright.config.ts`, and pinned
to both readers by `scripts/docs/__tests__/keyless-e2e-pin.test.mjs`.

**The suite owns its database.** The managed webServer boots on a throwaway
`KP_DB_PATH` (`data/kp-e2e.sqlite`, gitignored) rather than `data/kp.sqlite`.
These specs write — an offer and an org invite are minted, profiles are saved,
pipeline entries move — so before this they mutated the developer's own demo
corpus, and each run changed what the next one measured. A fresh file self-seeds
from `data/seed_*`, so **deleting it is the reset**. Two caveats worth knowing:
`reuseExistingServer` means a dev server already on :3101 is used as it is, with
whatever DB it opened; and setting `KP_E2E_BASE_URL` drops the webServer block
entirely, so the server's env is whoever started it (ci.yml's keyless job boots
its own against a disposable checkout).

## The exit-code contract

Five eval entry points used four conventions, and the prompt hill-climb could not
fail at all — so a script could not tell "the gate failed" from "the run never
happened". One contract now, stated in `pipeline/jobfit/eval/__main__.py` and
carried by runner, matching_eval, automation_eval, intake_eval, interview_eval,
interview_optimize, fault_eval and thresholds:

| Exit | Means |
| --- | --- |
| 0 | the run happened, and under `--strict` every gate it could measure passed |
| 1 | a gate FAILED under `--strict`, or the run measured/accepted nothing while being asked to certify |
| 2 | the run could NOT be performed — unusable flags, no engine, an empty selection, a refused judge |

Two rules keep it readable: **`--strict` is what asks for a verdict** (without it
a failing gate still prints FAIL and exits 0, because these reports are read by
people at least as often as by CI), and **a data-integrity failure ignores
`--strict`** (a malformed fixture exits 1 either way).

## The judge is not the engine

`automation_eval --judge` used to generate every output with one provider and then
hand that same provider the "you are a strict QA reviewer" prompt, under a
docstring claiming an independent judge. A model grading its own work is
self-assessment. `pipeline/jobfit/eval/judging.py` now resolves the judge for both
harnesses:

```bash
python -m pipeline.jobfit.eval.automation_eval --judge                      # judge pinned to sonnet
python -m pipeline.jobfit.eval.automation_eval --judge --judge-provider opus
python -m pipeline.jobfit.eval.automation_eval --judge --allow-same-judge   # prints that scores are self-assessment
```

Judging with the engine's own model is refused unless `--allow-same-judge` is
passed, and taking that concession prints it into the run's own log. Where the
engine rode the Claude CLI's unpinned default, the run says independence is "by
pin only" rather than implying more than it can prove. `interview_eval --judge`
carries the same two flags. The same module owns the fail-closed reading of a
`--judge` run that produced zero usable scores (the quality axis is unmeasured, so
the gate cannot certify) — it was fixed twice, in two pasted copies, before it
lived in one place.

## Spend ceilings on the hill-climb

`interview_optimize` re-evaluates its working set on both folds every round and may
judge each row on top, so its cost is rounds x folds x scenarios. It had no ceiling
of any kind. `--max-calls` and `--max-minutes` bound it; every run counts its
provider calls and prints them in the report whether or not a cap was set. A spent
budget stops the climb, keeps the rules already accepted, and says so in the round
log — it is not a failed run.

```bash
python -m pipeline.jobfit.eval.interview_optimize --rounds 3 --max-calls 120 --max-minutes 20 --strict
```

## When a test fails once and passes on re-run

799 test files answered with one bit — the exit code. When the suite went red,
nothing in the run distinguished *this test is broken* from *this test failed
once and passes when you press the button again*, so the cheapest available move
for an agent that did not cause the failure was to press the button. That is a
lesson learned once and applied to every red build afterwards, including the real
ones.

`npm run test:unit` now answers the question instead of leaving it open. A second,
machine-readable reporter ([`scripts/test/flake-reporter.mjs`](../../scripts/test/flake-reporter.mjs))
rides alongside node's own — the console output is unchanged — and records which
files failed. Exactly those files are re-run once, in a fresh runner with the
same flags and the same scrubbed environment, and each is labelled:

| Verdict | Means | Blocks? |
| --- | --- | --- |
| `BROKEN` | failed twice | yes, exactly as before |
| `FLAKE` | failed, then **passed** on the immediate re-run | **yes** — see below |
| `QUARANTINE` | declared in [`test-quarantine.json`](../../test-quarantine.json) | no |
| `FAILED … not re-run` | more than 20 files failed, or `KP_FLAKE_RERUN=0` | yes — there is no evidence either way and none is invented |

The block is printed and appended to the GitHub step summary, which is where a
flake gets *recorded* rather than disappearing into "the suite was red and then
it wasn't".

**A flake still fails the build, on purpose.** Retrying until green converts a
flake from a visible cost into an invisible one, and the suite's own sensitivity
falls with nothing reporting it. The two real moves are to fix the test, or to
quarantine it — which is an entry in `test-quarantine.json` carrying a `file`, a
`why`, a `since` and an `expires`, in a commit a reviewer can disagree with.
Re-running is not a decision; quarantining is.

**The register is a ratchet**, on the shared protocol in
[`scripts/lint/ratchet.mjs`](../../scripts/lint/ratchet.mjs) that `ruff.toml` and
`ts-debt.json` already use — so a reader who learned one has learned this one.
The list is empty and the ceiling is **0**, which is the state to keep it in: the
first entry that arrives without someone raising the number is a red build. Three
rules are this register's own, and all three block:

- **dead** — the entry names a file that is not in the tree. A quarantine that
  excuses nothing reads as policy.
- **unexplained** — no `why` (under 20 characters counts as none), or no dates.
- **expired** — `expires` is in the past, or more than 30 days after `since`. A
  quarantine is a loan with a due date; the expiry is what forces the renewal to
  be a decision rather than a thing nobody looked at for a quarter.

The register is validated **before** the suite starts, so a dead or expired entry
is a red build even on a run where nothing fails — which is the only kind of run
those two rot on. The rules themselves are fixture-covered by `npm run test:flake`
([`scripts/test/__tests__/flake-policy.test.mjs`](../../scripts/test/__tests__/flake-policy.test.mjs)),
whose last case runs the policy over the committed register and the real tree.

**What this does not cover.** The Python suite (`test:python:gate`) has its own
pawl — the `KP_SKIP_BASELINE` skip count — and no flake classification; the
Playwright job is a single deterministic keyless subset against a production
build, where a re-run is a whole build. Both are honest gaps rather than
oversights: this covers the suite that is large enough for a flake to hide in.

## Route-handler tests and `next/server`

`npm run test:unit` runs through `scripts/test-alias-loader.mjs`, which teaches Node's
ESM resolver the two TS conveniences the app source uses (the `@/` alias, extensionless
relative imports) so a route handler is loadable in a plain `node --test` process.

One more thing happens there, and it only happens in a **linked checkout** — a git
worktree whose `node_modules` is a junction (Windows) or symlink (POSIX) back to the
primary clone, which is how agent lanes are given a tree. In that layout `next/server`
resolves through two module identities and every named export comes back `undefined`, so
a handler's `NextResponse.json(...)` throws `Cannot read properties of undefined (reading
'json')` before it can answer. It is an environment artefact, not a product bug: the same
tests are green in a normal clone.

So the loader redirects `next/server` to
[`app/_lib/testing/next-server-shim.mjs`](../../app/_lib/testing/next-server-shim.mjs)
**when, and only when, `node_modules` is a link**:

- normal checkouts and CI (which clones) load the real `next/server`, unchanged — a Next
  upgrade that drops an export still fails the suite where it should;
- a worktree lane gets the shim, because there the alternative is not "the real module",
  it is a suite that cannot run at all.

Two consequences worth knowing before you write a route test:

- A plain `import { POST } from "./route.ts"` is fine. The older pattern —
  `register(new URL(".../next-server-hooks.mjs", import.meta.url))` followed by
  `await import("./route.ts")` — still works and is what you want if you need the shim in
  a *normal* checkout too (e.g. to assert on `Set-Cookie` without Next's cookie jar).
- The shim's export surface is a hard dependency, not a nicety: an ESM import of a name it
  does not export is a **link-time SyntaxError**, so a new
  `import { ImageResponse } from "next/server"` would stop unrelated tests loading, in the
  worktree only. `app/_lib/testing/next-server-shim.test.ts` scans `app/**` and `proxy.ts`
  for every name imported from `next/server` and fails if the shim is missing one — it
  runs in `npm run test:unit`, including in a normal checkout where the shim is otherwise
  dormant, which is where that import gets written.
- The shim's **property** surface is the other half, and it is the half that bit. A
  `NextRequest` is not a plain `Request`: handlers read `request.nextUrl.searchParams`
  (26 sites) and `proxy.ts` reads `req.cookies` and calls `nextUrl.clone()`. For thirty
  waves the shim was `class NextRequest extends Request {}`, so `nextUrl` was `undefined`,
  every one of those handlers threw inside its own `try/catch` and answered **500**, and
  `app/api/decisions/decisions-auth.test.ts` and `app/api/pipeline/pipeline-routes.test.ts`
  were carried as "known worktree-only failures" rather than read as the shim gap they
  were. A missing property is a runtime `undefined`, not a load-time error, so the export
  scan could not see it. The same test now also walks every `request.<member>` read in
  `app/api/**/route.ts` and `proxy.ts` and asserts each resolves on a shim instance. Both
  route tests pass in a worktree today; if you add a handler that reads a new request
  member, that scan tells you before the 500 does.

## The unit gate: exit code and timeout

`npm run test:unit` does not call `node --test` directly — it goes through
[`scripts/run-unit-tests.mjs`](../../scripts/run-unit-tests.mjs), because two things have
to be true before the runner boots and neither can be fixed from inside it:

- **The environment is scrubbed.** `NODE_TEST_CONTEXT` inherited from any ancestor
  `node --test` flips a fresh runner into child-reporting mode — failures print and the
  process exits **0**. Node decides that during bootstrap, before `--import` preloads run,
  so only the parent that spawns the runner can delete it. `DATABASE_URL`,
  `KP_DB_BACKEND` and `KP_OFFLINE` go with it, so store and egress behaviour comes from
  the test file rather than from whichever shell hosts the run.
- **A hang is bounded.** The launcher passes `--test-timeout`, default **120 000 ms**
  (`KP_TEST_TIMEOUT_MS` overrides it). Node's runner otherwise waits forever, so one test
  that never settles pins the gate until a CI job timeout kills it — and the output at
  that point names a dead job, not a test. With the ceiling, a hang is an ordinary red
  with the offending test named, and the rest of the suite still reports.

`npm run test:bench-driver` runs through the same launcher for the first reason: the bench
driver is *the* documented source of an inherited `NODE_TEST_CONTEXT`, so a bare
`node --test` there is a runner nothing scrubs.

`app/_lib/testing/gate-exit-code.test.ts` pins all of it from the outside — it drives the
real launcher from a deliberately polluted environment and asserts that a failing suite
exits non-zero, a passing one exits zero, ambient backend env never reaches a test file, a
hanging file fails instead of blocking, and `test:bench-driver` still goes through the
launcher.

## `schemas:gen`: the Python step in front of typecheck and build

Both `npm run typecheck` and `npm run build` run `schemas:gen` first, so it is the first
command a fresh clone or a new CI image executes. It goes through
[`scripts/schemas-gen.mjs`](../../scripts/schemas-gen.mjs) rather than a bare
`python -m pipeline.jobfit.codegen`:

- it finds the interpreter — `PYTHON_CMD` if set (the same variable
  `app/_lib/python-runner.ts` honours), else `python`/`python3`/`py` on Windows and
  `python3`/`python` elsewhere;
- a missing interpreter and a missing package are told apart, and each says the command
  that fixes it (`pip install -r requirements.txt`, or `PYTHON_CMD=…`) instead of a raw
  `command not found` or a pydantic traceback under an npm exit-1 banner;
- argv passes straight through, so `npm run schemas:check` (`--check`) keeps its exit-code
  contract: 1 for a stale generated file, and that failure is *not* dressed up as an
  install problem.

It is idempotent — the generator rewrites `app/_lib/schemas.generated.ts` and
`app/_lib/taxonomy.generated.ts` from the Pydantic models. Fixtures:
`scripts/__tests__/schemas-gen.test.mjs`, run by `npm run test:docs`.

## The Python gate's time budget

`npm run test:python:gate` is one of the two slowest gates in `ci.yml`, and until
2026-09-05 the only thing it said about that was its own total — `Ran 2365 tests in
1276.629s`. A total cannot be acted on. Nobody could name which of the ~150 modules
owned it, so the expensive ones were never found and never budgeted, and "the Python
suite is slow" stayed a feeling rather than a list.

`--timings` (or `KP_TEST_TIMINGS=1`, which is what `ci.yml` sets on the gate step)
makes [`run_gated.py`](../../pipeline/jobfit/tests/run_gated.py) charge every test's
wall time to its **module** and print the ten most expensive after the run:

```
Slowest 10 modules (994.1s of 1265.3s charged, 79%):
   271.50s    10 tests  test_name_neutrality
   185.77s    11 tests  test_intake_eval
   171.16s     4 tests  test_scripts_entrypoints
    97.15s     3 tests  test_seed_analyses
    93.93s     8 tests  test_role_family_routing
    65.94s    12 tests  test_pipeline
    35.72s    10 tests  test_llm_self_host
    25.03s     5 tests  test_analyze_honesty_fields
    24.09s    67 tests  test_intake
    23.81s     6 tests  test_pipeline_degrade
```

Charging to the module, not the test, is deliberate: a module is the unit a person
can act on — it is what you split, mark, or hand to an agent — and it is where the
expensive things actually live (an import that spawns a subprocess, a class-level
fixture, a sleep in `setUp`), none of which belong to any one test method. The
bracket is `startTest`/`stopTest`, so setUp and tearDown are inside the number.

**It reports; it does not gate.** There is no ceiling that fails a run, because a
wall-clock threshold is not a property of the code here. Two runs of the same tree an
hour apart, on the same machine, beside two other agents building in the same
checkout, gave 1276s and 814s — and they did not even agree on the ORDER:
`test_scripts_entrypoints` was 171s in the first and 420s in the second, while
`test_name_neutrality` went 271s → 35s. Both of those modules shell out, so they
measure the machine's contention as much as their own work.

What DID hold across both runs is the **share**: the top ten of ~150 modules own 79%
and 85% of the clock respectively. That is the durable finding — the cost of this
suite lives in a handful of subprocess-spawning modules, not spread across it — and
it is the only thing to plan against.

So the budget is a reading, not an assertion:

- **The number to trust is CI's**, from the gate step's log: one machine, one job, no
  sibling agents. Compare a CI run against an earlier CI run and nothing else. A
  local figure is good for ranking modules WITHIN that same run, and for nothing
  across runs.
- **Before adding a slow module, look at this list.** Ten entries own ~80% of the
  gate; an eleventh joining them is a decision, not an accident.
- **The top of the list is where optimisation pays**, and the shape to look for is a
  high seconds-per-test ratio — `test_scripts_entrypoints` spends its whole cost on
  four tests, which is the signature of per-test work (a spawn, a fixture build) that
  could be class-level or cached.
- The suite's other two tripwires — the skip ceiling/floor and the hermeticity check —
  are described in `run_gated.py`'s own docstring and are unaffected by `--timings`.

## Eval harness

`pipeline/jobfit/eval/` ships a 14-fixture golden set of synthetic CVs covering the
role × seniority × language matrix plus deliberate edge cases:

- **Core roles**: junior frontend, medior data engineer, senior Python+AI, senior
  DevOps+security, senior PM, Czech-language lead engineer.
- **Edge cases**: senior iOS engineer, PhD-to-industry data scientist, Czech-language
  junior QA, CTO/co-founder (no recent code), career switcher (teaching → backend),
  very short CV, OSVČ freelancer with diverse engagements, COBOL/mainframe legacy
  specialist.

Each fixture is hand-verified (`label`, `expected_role_family`, `expected_seniority`,
`expected_salary_range`, `expected_skills_subset`, optional `expected_education` /
`expected_signals_subset` / `expected_language`). Multi-valued expectations are
supported (e.g., `["data_ai", "software_engineering"]` for genuinely ambiguous AI
engineers). The runner scores every fixture on four axes:

| Metric           | Threshold | Measured | Slack |
| ---------------- | --------- | -------- | ----- |
| `role_family`    | 85%       | 98%      | 20pt  |
| `seniority`      | 80%       | 100%     | 20pt  |
| `salary_overlap` | 72%       | 96.8%    | 25pt  |
| `salary_coverage`| 90%       | —        | 10pt  |
| `skill_recall`   | 75%       | 95.2%    | 20pt  |

Those bars are not free-floating numbers any more. Every threshold in
`pipeline/jobfit/eval/thresholds.py` is a `Bar` carrying **why** it protects what
it protects, the number the pipeline actually **measured** (with the date, the
command and the corpus), and the **slack** — how far below that measurement the
bar is allowed to sit. `pipeline/jobfit/tests/test_thresholds.py` fails when a bar
falls outside its own slack, which is how `role_relevance_at5` was caught sitting
at 0.60 against a deterministic 0.857: a quarter of the ranking could have rotted
without turning the gate red. It is 0.84 now.

```bash
python -m pipeline.jobfit.eval.thresholds            # the table, with reasons and measurements
python -m pipeline.jobfit.eval.thresholds --tighten  # propose the ratchet; exit 1 while one is outstanding
```

A bar with no recorded run says `UNMEASURED` and its `why` must say what it would
take to measure it (`salary_coverage` predates the coverage/overlap split;
`QUALITY_THRESHOLD` needs a judged run). "Nobody measured this" and "measured and
fine" never look the same in the table.

`salary_overlap` is containment-aware — a Gemini range fully inside the expected band
scores 1.0; partial overlaps fall back to IoU. The aggregate report and per-fixture
breakdown print as a markdown table; `--json` swaps in machine-readable output for
CI; `--strict` exits non-zero when any threshold is missed. Use it after every prompt
or taxonomy change to catch drift.

## JD-grounded intake simulation

`pipeline/jobfit/eval/intake_eval.py --jd-corpus` runs the role-intake dialog
against roles taken from OUTSIDE the repository: a corpus of real job
descriptions (`data/seed_calibration/jobs.json`, 100 EN postings;
`data/seed_jobs/jobs.json`, 120 Czech-market postings), one simulated hiring
requestor per posting. Three moving parts:

| Module | Does |
| --- | --- |
| `eval/intake_corpus.py` | reads a JSON corpus into `Posting` records (title/company/family/seniority/lang/body; `requirements[]` appended as bullets, a missing family filled by `classify_role_family`) and picks N **distinct** titles round-robin across families, deterministically |
| `eval/intake_jd_persona.py` | that posting → a requestor persona (live system prompt) + the deterministic answers the keyless script asks for (`--no-llm`) — see the persona's rules in [role-intake-research.md §4.1](role-intake-research.md#41-the-jd-grounded-requestor-breadth-not-behavior) |
| `eval/intake_http_client.py` | the same dialog against a RUNNING kp server: create → attach the JD as a note → message per turn → **promote** |

Every mode is graded by the same `check_dialog` invariants as the written banks
(completed, one_question_per_turn, no_premature_end, grounded_readback,
brief_core, shape, role_family, requirements_captured).

```bash
# offline / deterministic — 50 roles, no provider, ~15s
python -m pipeline.jobfit.eval.intake_eval --no-llm \
  --jd-corpus data/seed_calibration/jobs.json --roles 50 --strict

# live, in-process (both sides LLM; keyless = the subscription-billed Claude CLI)
npm run test:eval:intake-sim -- --roles 5 --dump bench/intake-sim/live

# against the real API, promoting every session into a JD + Job
KP_BENCH_MODE=1 KP_DB_PATH=data/kp-sim.sqlite npm run dev      # terminal 1
python -m pipeline.jobfit.eval.intake_eval --jd-corpus data/seed_calibration/jobs.json \
  --roles 50 --http http://localhost:3000 --dump bench/intake-sim/http \
  --wall-minutes 90 --resume                                    # terminal 2
```

Notes that bite:

- **Use a throwaway DB.** The HTTP mode WRITES — 50 sessions and 50 promoted
  jobs land in whatever `KP_DB_PATH` the server opened, which is the operator's
  own demo corpus by default. `KP_BENCH_MODE=1` (server env) raises the
  message/promote rate limits to 600/10min for the sweep; `POST /api/intake`
  (session create) is **not** raised — it stays 30/10min, so a 50-role run meets
  a 429 there and the client waits out its `Retry-After` rather than failing.
- **One role is ~8 minutes of provider calls**, so 50 serial roles is most of a
  day. `--workers N` (HTTP mode only) runs N roles concurrently — each worker
  gets its own client and its own persona provider, and the report is still
  ordered by the deterministic role order, not by completion time. In-process
  mode ignores the flag and stays serial: there the agent's own engine runs
  inside this process. `--wall-minutes` is honoured per worker — no NEW role
  starts past the budget, running ones finish.
- **The dump is written as the run goes**, not at the end: after every role its
  transcript and brief are written and `run.json` is rewritten atomically (tmp +
  `os.replace`). A sweep killed at role 34 leaves a readable 33-role `run.json`
  that `--resume` picks up, and the resumed run's report covers ALL roles —
  before this, a kill lost every finished dialog.
- **Dumps are run artifacts**, not results: `<DIR>/run.json` (per-role checks,
  turn count, captured vs JD family, promoted slug), `<DIR>/transcripts/<role>.md`
  and `<DIR>/briefs/<role>.json`. `/bench/` is gitignored; `--resume` re-reads
  `run.json` and skips roles already recorded as complete, which is what makes a
  long live sweep restartable.
- **`--wall-minutes M`** stops cleanly at the budget and reports the partial run.
- **A dealbreaker is a short noun phrase or it is nothing.** `requirements_captured`
  matches the conditions the requestor STATED against the brief's `requirements[]`
  rows by substring, so its ground truth has to be matchable: 2–5 lowercase words
  pulled from a credential (`bachelors degree`, `valid drivers license`) or a
  requirement cue (`experience with …`, `knowledge of …`, `degree in …`), never a
  heading and never a sentence fragment. A JD that states nothing that clean
  yields an EMPTY list, `check_dialog` then emits no `requirements_captured` key
  at all, and the table prints `—` for that role (the same way `role_family` is
  skipped for a scenario with no declared family). The report and `run.json`
  (`no_dealbreaker_ground_truth`) say how many roles that was — on the committed
  50-role selection, **16 of 50**. Never "fix" a red here by widening the
  matching; widen the extraction or accept the honest `—`.
- **Exit codes** follow the suite contract above: 0 ran (and passed under
  `--strict`), 1 a gate failed under `--strict`, 2 the run could not be performed
  (unreadable corpus, no usable postings, a server that could not be driven,
  nothing simulated).
- **Family drift is a finding, not a failure.** The `role_family` invariant's
  ground truth differs by mode on purpose: offline the answers ARE the
  deterministic script, so the truth is what this pipeline classifies from them;
  live the requestor improvises from the document, so the comparand is the
  POSTING's own family (grading a live dialog against a deterministic replay
  measures the replay). Either way the report lists every role where the
  captured family and the posting's disagree. On the committed 50-role
  selection (seed_calibration, `--no-llm`, 2026-09-08) that is **24 of 50**, and
  the dialogs land in 13 families where the postings declared 11 — the honest
  measurement of how much of a JD's family survives being re-elicited through a
  six-question conversation.

**What the live probes found (2026-09-08, Claude CLI, in-process).** Two rounds,
and the second is the one that matters — between them a sibling change landed on
the brief coercer and this harness's dealbreaker ground truth was rebuilt.

*Round 1 (2 roles)* — every dialog-reliability invariant held (9–11 agent turns,
grounded read-backs) while `brief_core`, `requirements_captured` and
`role_family` failed on both: the extracted brief came back with
`requirements: []` (the L2-NEW-2 shape, live, on real JDs) and
`spineProvenance.role_family` was never stamped, so a family that was actually
right was indistinguishable from the schema default.

*Round 2 (3 roles, `bench/intake-sim/smoke3`)* — **1/3 PASS**, and the table is
now readable rather than uniformly red:

| role | brief_core | req_captured | role_family | turns |
| --- | --- | --- | --- | --- |
| remote-website-designer | ✓ | – | ✓ | 9 |
| patient-advocate | ✓ | – | ✗ | 8 |
| career-coach-waitlist | ✓ | ✓ | ✗ | 15 |

`requirements[]` now fills (10, 4 and 22 rows) and `spineProvenance.role_family`
is stamped `inferred` on all three. The two `–` are roles whose JD states no
screenable condition. The two `role_family` failures are genuine divergence from
the CORPUS LABEL, and reading them is instructive: the patient advocate routed
`healthcare_clinical` where the corpus says `customer_support`, and the career
coach routed `education_academic` where the corpus says `data_ai`. At least the
second is the corpus being wrong, not the dialog — which is what the drift list
is for, and a reason to read a live `role_family` red before believing it.

Beyond the golden set: `eval/matching_eval.py` scores the matching engine,
`eval/automation_eval.py` scores the automation tasks
([automation-eval.md](automation-eval.md)), and `devcase/lifecycle_eval.py` hardens
the dev-case design loop (scenario generation, reliability/integrity health checks,
optional LLM design audits — [case-calibration.md](case-calibration.md)).

### Latest run — 2026-09-08, 50 roles over HTTP

`--jd-corpus data/seed_calibration/jobs.json --roles 50 --http … --cap 24
--workers 5` against a production build on a throwaway `KP_DB_PATH` with
`KP_BENCH_MODE=1`, engine and persona both on the Claude CLI. About 100 minutes
with five workers (a serial run had measured ~8 minutes per role).

| measure | value |
| --- | --- |
| dialogs completed | 50 / 50 |
| promoted to a saved JD | 49 / 50 (one `INTAKE_BRIEF_NOT_READY`, a posting titled by location) |
| agent turns per dialog | 5–10, median 6 |
| requirement rows per brief | 0–17, median 8 (zero on every live brief before `f5c7dec0`) |
| `completed` · `one_question_per_turn` · `grounded_readback` | 50 / 50 each |
| `brief_core` | 49 / 50 |
| `requirements_captured` | 19 / 34 measured (16 roles had no clean ground truth) |
| `role_family` | 29 / 50 — graded against the corpus label, which is often wrong (career coach → data_ai) |

`no_premature_end` is not measured over HTTP: the route strips the `<<END>>`
sentinel by contract, which this run recorded as a false red before `58aa0ccc`.
The two red rows are read for what they measure: a paraphrase-blind phrase
matcher (next step: token overlap, with 19/34 as its baseline) and an
unreviewed label set. The full per-role table lives in the gitignored
`docs/harness/intake-sim-2026-09-08/` on the machine that ran it.
