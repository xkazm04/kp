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
[`.claude/CLAUDE.md`](../../.claude/CLAUDE.md) under "Common Commands".

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

Beyond the golden set: `eval/matching_eval.py` scores the matching engine,
`eval/automation_eval.py` scores the automation tasks
([automation-eval.md](automation-eval.md)), and `devcase/lifecycle_eval.py` hardens
the dev-case design loop (scenario generation, reliability/integrity health checks,
optional LLM design audits — [case-calibration.md](case-calibration.md)).
